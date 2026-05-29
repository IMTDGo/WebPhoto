/**
 * app-mobile.js — mobile app logic
 */

import { CropEditor }              from './crop-editor.js';
import { PatternPreview }           from './preview.js';
import { generateChannels, uploadAllMaps, checkUploadQuota } from './upload.js';
import { showToast }               from './toast.js';
import { getHDRCapabilities, captureHDRFrames, mergeHDR } from './hdr.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const stepEntry    = document.getElementById('stepEntry');
const stepCamera   = document.getElementById('stepCamera');
const stepEdit     = document.getElementById('stepEdit');
const cameraVideo  = document.getElementById('cameraVideo');
const btnOpenCamera = document.getElementById('btnOpenCamera');
const btnCameraBack = document.getElementById('btnCameraBack');
const btnTakePhoto  = document.getElementById('btnTakePhoto');

const fileInputCapture = document.getElementById('fileInputCapture');
const fileInputGallery = document.getElementById('fileInputGallery');
const cropCanvas   = document.getElementById('cropCanvas');
const previewCanvas = document.getElementById('previewCanvas');
const previewWrap = document.getElementById('previewWrap');
const previewGridSlider = document.getElementById('previewGridSlider');
const previewGridVal    = document.getElementById('previewGridVal');
const btnRetake      = document.getElementById('btnRetake');
const btnPickAnother = document.getElementById('btnPickAnother');
const btnShowUpload  = document.getElementById('btnShowUpload');
const stepPreview    = document.getElementById('stepPreview');
const btnPreviewBack    = document.getElementById('btnPreviewBack');
const btnPreviewConfirm = document.getElementById('btnPreviewConfirm');
const genOverlay     = document.getElementById('genOverlay');
const genOverlayLabel = document.getElementById('genOverlayLabel');
const uploadSheet  = document.getElementById('uploadSheet');
const uploadSheetBackdrop = document.getElementById('uploadSheetBackdrop');
const uploadNameInput = document.getElementById('uploadName');
const btnConfirmUpload = document.getElementById('btnConfirmUpload');
const btnCancelUpload  = document.getElementById('btnCancelUpload');
const btnAspectLock    = document.getElementById('btnAspectLock');
const lockIconClosed   = document.getElementById('lockIconClosed');
const lockIconOpen     = document.getElementById('lockIconOpen');
const lockLabel        = document.getElementById('lockLabel');
const enableSeamless   = document.getElementById('enableSeamless');
const seamBlendWidth   = document.getElementById('seamBlendWidth');
const seamBlendWidthVal = document.getElementById('seamBlendWidthVal');

// ── Always show email section ──────────────────────────────────────────────
(function () {
  try {
    const raw  = sessionStorage.getItem('wp_user') || localStorage.getItem('wp_user');
    const user = raw ? JSON.parse(raw) : null;
    const label = document.getElementById('sendEmailLabel');
    const emailInput = document.getElementById('emailOverrideInput');
    if (label) { label.classList.remove('hidden'); label.style.display = 'flex'; }
    if (emailInput && user?.email) {
      emailInput.value = user.email;
      emailInput.closest('.email-input-wrap')?.classList.add('hidden');
    }
  } catch {}
})();
let cropEditor      = null;
let preview         = null;
let currentCrop     = null;
let generatedMaps   = null;
let cameraStream    = null;
let seamlessEnabled = true;
let seamlessParams  = { seamBlendWidth: 0.15, iterations: 80 };

// HDR state
let hdrMode         = true;
let hdrCapabilities = null;  // null = not supported / not yet checked

// Preview pan/zoom state
const previewPointers = new Map();
let previewPanX = 0;
let previewPanY = 0;
let previewScale = 1;
let previewPinchStartDist = 0;
let previewPinchStartScale = 1;
let previewPinchStartMid = null;
let previewPinchStartPan = null;
let previewDragStart = null;

// White balance state
let wbGains   = { r: 1, g: 1, b: 1 }; // per-channel gains (1 = neutral)
let wbApplied = false;                  // gains have been sampled at least once
let wbActive  = false;                  // WB-pick mode is open
let wbDragging = false;                 // pointer is currently held down

// Offset applied to raw touch point so the sample lands upper-right of finger
const WB_SAMPLE_DX =  35;  // CSS px to the right
const WB_SAMPLE_DY = -50;  // CSS px upward

const CAM_RULER_SZ = 22;   // must match css/camera.css --cam-ruler-sz
const CAPTURE_SIZE = 2048; // forced square capture resolution


// ── Initialise editors ────────────────────────────────────────────────────────
function initEditors() {
  const cropSizeInfo = document.getElementById('cropSizeInfo');
  function _updateCropSize(crop) {
    if (cropSizeInfo && crop) cropSizeInfo.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
  }

  cropEditor = new CropEditor(cropCanvas, {
    onChange: (crop) => {
      currentCrop = crop;
      preview.updateFast(crop);  // low-res, real-time
      _syncPreviewTransform();
      _updateCropSize(crop);
    },
    onChangeEnd: (crop) => {
      currentCrop = crop;
      preview.update(crop).then(() => _syncPreviewTransform());      // full quality after drag ends
      _updateCropSize(crop);
    },
  });

  preview = new PatternPreview(previewCanvas, { displaySize: 512, gridSize: 3 });
  preview.seamlessEnabled = seamlessEnabled;
  preview.params = { ...seamlessParams };
  _initPreviewGestures();
  _resetPreviewTransform();

  previewGridSlider.addEventListener('input', (e) => {
    const n = parseInt(e.target.value);
    previewGridVal.textContent = n;
    preview.setGridSize(n);
    _syncPreviewTransform();
  });

  // Aspect ratio lock
  function _updateLockUI(locked) {
    if (locked) {
      lockIconClosed?.classList.remove('hidden');
      lockIconOpen?.classList.add('hidden');
      if (lockLabel) lockLabel.textContent = '1:1';
      btnAspectLock?.classList.remove('btn-ghost');
      btnAspectLock?.classList.add('btn-outline');
    } else {
      lockIconClosed?.classList.add('hidden');
      lockIconOpen?.classList.remove('hidden');
      if (lockLabel) lockLabel.textContent = 'Free';
      btnAspectLock?.classList.remove('btn-outline');
      btnAspectLock?.classList.add('btn-ghost');
    }
  }
  btnAspectLock?.addEventListener('click', () => {
    const locked = !cropEditor?.aspectLocked;
    cropEditor?.setAspectLock(locked);
    _updateLockUI(locked);
    if (currentCrop) currentCrop = cropEditor.getCrop();
  });

  // Seamless controls
  function _applySeamlessToPreview() {
    if (!preview || !currentCrop) return;
    preview.seamlessEnabled = seamlessEnabled;
    preview.params = { ...seamlessParams };
    preview.update(currentCrop);
  }
  enableSeamless?.addEventListener('change', () => {
    seamlessEnabled = enableSeamless.checked;
    _applySeamlessToPreview();
  });
  seamBlendWidth?.addEventListener('input', () => {
    const pct = parseInt(seamBlendWidth.value);
    if (seamBlendWidthVal) seamBlendWidthVal.textContent = pct + '%';
    seamlessParams.seamBlendWidth = pct / 100;
    if (seamlessEnabled) _applySeamlessToPreview();
  });
}

function _dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function _mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function _getPanBounds() {
  const wrapW = previewWrap?.clientWidth || 0;
  const wrapH = previewWrap?.clientHeight || 0;
  const baseW = previewCanvas?.offsetWidth || 0;
  const baseH = previewCanvas?.offsetHeight || 0;
  const scaledW = baseW * previewScale;
  const scaledH = baseH * previewScale;
  return {
    x: Math.max(0, (scaledW - wrapW) / 2),
    y: Math.max(0, (scaledH - wrapH) / 2),
  };
}

function _syncPreviewTransform() {
  if (!previewCanvas) return;
  const bounds = _getPanBounds();
  previewPanX = Math.max(-bounds.x, Math.min(bounds.x, previewPanX));
  previewPanY = Math.max(-bounds.y, Math.min(bounds.y, previewPanY));
  previewCanvas.style.transform = `translate(calc(-50% + ${previewPanX}px), calc(-50% + ${previewPanY}px)) scale(${previewScale})`;
}

function _resetPreviewTransform() {
  previewPanX = 0;
  previewPanY = 0;
  previewScale = 1;
  requestAnimationFrame(() => requestAnimationFrame(_syncPreviewTransform));
}

function _initPreviewGestures() {
  if (!previewWrap || !previewCanvas || previewWrap.dataset.gestureBound === '1') return;
  previewWrap.dataset.gestureBound = '1';

  previewWrap.addEventListener('pointerdown', (e) => {
    previewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    previewWrap.setPointerCapture(e.pointerId);

    if (previewPointers.size === 1) {
      previewDragStart = { x: e.clientX, y: e.clientY, panX: previewPanX, panY: previewPanY };
      previewPinchStartMid = null;
    }
    if (previewPointers.size === 2) {
      const [a, b] = [...previewPointers.values()];
      previewPinchStartDist = Math.max(1, _dist(a, b));
      previewPinchStartScale = previewScale;
      previewPinchStartMid = _mid(a, b);
      previewPinchStartPan = { x: previewPanX, y: previewPanY };
      previewDragStart = null;
    }
  }, { passive: true });

  previewWrap.addEventListener('pointermove', (e) => {
    if (!previewPointers.has(e.pointerId)) return;
    previewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (previewPointers.size === 1 && previewDragStart) {
      previewPanX = previewDragStart.panX + (e.clientX - previewDragStart.x);
      previewPanY = previewDragStart.panY + (e.clientY - previewDragStart.y);
      _syncPreviewTransform();
      return;
    }

    if (previewPointers.size >= 2 && previewPinchStartMid && previewPinchStartPan) {
      const [a, b] = [...previewPointers.values()];
      const curDist = Math.max(1, _dist(a, b));
      const curMid = _mid(a, b);
      previewScale = Math.max(1, Math.min(5, previewPinchStartScale * (curDist / previewPinchStartDist)));
      previewPanX = previewPinchStartPan.x + (curMid.x - previewPinchStartMid.x);
      previewPanY = previewPinchStartPan.y + (curMid.y - previewPinchStartMid.y);
      _syncPreviewTransform();
    }
  }, { passive: true });

  function _endPointer(e) {
    previewPointers.delete(e.pointerId);
    if (previewPointers.size === 1) {
      const only = [...previewPointers.values()][0];
      previewDragStart = { x: only.x, y: only.y, panX: previewPanX, panY: previewPanY };
    } else {
      previewDragStart = null;
      previewPinchStartMid = null;
      previewPinchStartPan = null;
    }
    _syncPreviewTransform();
  }

  previewWrap.addEventListener('pointerup', _endPointer, { passive: true });
  previewWrap.addEventListener('pointercancel', _endPointer, { passive: true });
  previewWrap.addEventListener('dblclick', () => _resetPreviewTransform());
}

function showStep(stepName) {
  stepEntry.classList.add('hidden');
  stepCamera.classList.add('hidden');
  stepEdit.classList.add('hidden');
  stepPreview.classList.add('hidden');

  if      (stepName === 'camera')  stepCamera.classList.remove('hidden');
  else if (stepName === 'edit')    stepEdit.classList.remove('hidden');
  else if (stepName === 'preview') stepPreview.classList.remove('hidden');
  else                             stepEntry.classList.remove('hidden');
}

function paintPreviewThumbnails(maps) {
  for (const [key, canvas] of Object.entries(maps)) {
    const el = document.getElementById(`previewCh_${key}`);
    if (!el) continue;
    el.width  = canvas.width;
    el.height = canvas.height;
    el.getContext('2d').drawImage(canvas, 0, 0);
    el.style.width  = '100%';
    el.style.height = 'auto';
  }
}

// ── Crop guide + 1:1 square capture ─────────────────────────────────────────

/**
 * Draw the 1:1 crop guide (white border + corner brackets)
 * on the #camCropGuide canvas, centered in the video area.
 */
function drawCropGuide() {
  const canvas = document.getElementById('camCropGuide');
  if (!canvas) return;

  const vf  = stepCamera.querySelector('.cam-viewfinder');
  if (!vf) return;
  const vfW = vf.offsetWidth;
  const vfH = vf.offsetHeight;
  if (vfW <= 0 || vfH <= 0) return;

  const videoAreaW  = vfW - CAM_RULER_SZ;
  const videoAreaH  = vfH - CAM_RULER_SZ;
  const squareSide  = Math.min(videoAreaW, videoAreaH);
  const squareX     = CAM_RULER_SZ + (videoAreaW - squareSide) / 2;
  const squareY     = CAM_RULER_SZ; // align to top ruler

  // Clip the video element to the 1:1 square only
  const rightInset  = vfW - squareX - squareSide;
  const bottomInset = vfH - squareY - squareSide;
  cameraVideo.style.clipPath =
    `inset(${squareY}px ${rightInset}px ${bottomInset}px ${squareX}px)`;

  // Draw the crop-guide canvas (border + corner brackets)
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round(vfW * dpr);
  canvas.height = Math.round(vfH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Thin border around the square
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(squareX + 0.75, squareY + 0.75, squareSide - 1.5, squareSide - 1.5);

  // Corner brackets
  const BL = 18;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth   = 2.5;
  const corners = [
    [squareX, squareY,                        1,  1],
    [squareX + squareSide, squareY,           -1,  1],
    [squareX, squareY + squareSide,            1, -1],
    [squareX + squareSide, squareY + squareSide, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * BL, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * BL);
    ctx.stroke();
  }
}

/**
 * Crop the full-frame source canvas to the displayed 1:1 CSS square,
 * scale to CAPTURE_SIZE, and apply WB gains if active.
 */
function _cropToSquare(src, srcVideoW, srcVideoH) {
  const sw = src.width;
  const sh = src.height;

  const vf  = stepCamera.querySelector('.cam-viewfinder');
  const vfW = vf.offsetWidth;
  const vfH = vf.offsetHeight;
  const videoAreaW      = vfW - CAM_RULER_SZ;
  const videoAreaH      = vfH - CAM_RULER_SZ;
  const squareSide_css  = Math.min(videoAreaW, videoAreaH);
  const squareLeft_css  = CAM_RULER_SZ + (videoAreaW - squareSide_css) / 2;
  const squareTop_css   = CAM_RULER_SZ;

  // How the native video is laid out in the CSS container (object-fit: cover)
  const videoAspect     = srcVideoW / srcVideoH;
  const containerAspect = vfW / vfH;
  let renderW, renderH, offsetX, offsetY;
  if (videoAspect > containerAspect) {
    renderH = vfH; renderW = renderH * videoAspect;
    offsetX = (vfW - renderW) / 2; offsetY = 0;
  } else {
    renderW = vfW; renderH = renderW / videoAspect;
    offsetX = 0; offsetY = (vfH - renderH) / 2;
  }
  const cssToVideo = srcVideoW / renderW;

  // Crop region in native video pixel coords
  const vx    = Math.max(0, (squareLeft_css - offsetX) * cssToVideo);
  const vy    = Math.max(0, (squareTop_css  - offsetY) * cssToVideo);
  const vSize = squareSide_css * cssToVideo;

  // Scale to source canvas coords
  const hdrScale  = sw / srcVideoW;
  const sx        = Math.round(vx    * hdrScale);
  const sy        = Math.round(vy    * hdrScale);
  const rawSize   = Math.round(vSize * hdrScale);
  const clampedSz = Math.min(rawSize, sw - sx, sh - sy, sw, sh);

  const out = document.createElement('canvas');
  out.width  = CAPTURE_SIZE;
  out.height = CAPTURE_SIZE;
  const ctx  = out.getContext('2d');
  ctx.drawImage(src, sx, sy, clampedSz, clampedSz, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);

  // Apply white-balance gains per-pixel at capture time (CSS filter is visual only)
  if (wbApplied && (wbGains.r !== 1 || wbGains.g !== 1 || wbGains.b !== 1)) {
    _applyWbToCanvas(ctx, CAPTURE_SIZE, CAPTURE_SIZE);
  }
  return out;
}

/** Apply stored white-balance gains to a 2-D canvas context in-place. */
function _applyWbToCanvas(ctx, w, h) {
  const id  = ctx.getImageData(0, 0, w, h);
  const d   = id.data;
  const { r: rg, g: gg, b: bg } = wbGains;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.round(d[i]     * rg));
    d[i + 1] = Math.min(255, Math.round(d[i + 1] * gg));
    d[i + 2] = Math.min(255, Math.round(d[i + 2] * bg));
  }
  ctx.putImageData(id, 0, 0);
}

async function startCamera() {
  stopCamera();
  // Use ideal-only constraints (no min) to avoid OverconstrainedError on mid-range devices
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 3840 },
      height: { ideal: 2160 },
    },
  };

  cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  cameraVideo.srcObject = cameraStream;
  await new Promise((res) => {
    if (cameraVideo.readyState >= 2) return res();
    cameraVideo.addEventListener('loadedmetadata', res, { once: true });
  });
  await cameraVideo.play();

  // Detect HDR support on this track
  const track = cameraStream.getVideoTracks()[0];
  hdrCapabilities = getHDRCapabilities(track);
  const hdrBtn = document.getElementById('btnHDRToggle');
  if (hdrBtn) {
    if (hdrCapabilities) {
      hdrBtn.style.display = '';
      hdrMode = true;
      _updateHDRButton();
    } else {
      hdrBtn.style.display = 'none';
      hdrMode = false;
    }
  }
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
}

async function enterCameraStep() {
  // Show camera section immediately so user sees visual feedback (black bg)
  showStep('camera');
  const errOverlay = document.getElementById('cameraError');
  if (errOverlay) errOverlay.classList.add('hidden');

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Camera not supported on this device', 'warning');
    if (errOverlay) errOverlay.classList.remove('hidden');
    return;
  }

  try {
    await startCamera();
    // Draw crop guide after layout is stable
    requestAnimationFrame(() => requestAnimationFrame(drawCropGuide));
  } catch (err) {
    showToast('Unable to start camera', 'warning');
    if (errOverlay) errOverlay.classList.remove('hidden');
  }
}

function captureFromVideo() {
  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  if (!w || !h) throw new Error('Camera not ready');

  const full = document.createElement('canvas');
  full.width  = w;
  full.height = h;
  full.getContext('2d').drawImage(cameraVideo, 0, 0, w, h);

  // Crop to the displayed 1:1 square and apply WB gains
  return _cropToSquare(full, w, h);
}

function canvasToImage(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL('image/jpeg', 0.95);
  });
}

function openUploadSheet() {
  uploadSheetBackdrop.classList.remove('hidden');
  uploadSheet.classList.remove('hidden');
  uploadNameInput.focus();
}

function closeUploadSheet() {
  uploadSheetBackdrop.classList.add('hidden');
  uploadSheet.classList.add('hidden');
}

function resetToEntry() {
  closeUploadSheet();
  showStep('entry');
  fileInputCapture.value = '';
  fileInputGallery.value = '';
  currentCrop = null;
}

// ── TIFF decode helper ────────────────────────────────────────────────────────
function _isTiff(file) {
  return /\.tiff?$/i.test(file.name) || file.type === 'image/tiff' || file.type === 'image/x-tiff';
}

async function fileToImage(file) {
  if (_isTiff(file) && typeof UTIF !== 'undefined') {
    const buf  = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    UTIF.decodeImage(buf, ifds[0]);
    const ifd = ifds[0];
    const cvs = document.createElement('canvas');
    cvs.width  = ifd.width;
    cvs.height = ifd.height;
    const ctx  = cvs.getContext('2d');
    const imgData = ctx.createImageData(ifd.width, ifd.height);
    imgData.data.set(ifd.data);
    ctx.putImageData(imgData, 0, 0);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = cvs.toDataURL(); });
    return img;
  }
  const dataURL = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = (e) => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataURL; });
  return img;
}

// ── File handling ─────────────────────────────────────────────────────────────
async function handleFile(file) {
  if (!file?.type.startsWith('image/') && !_isTiff(file)) {
    showToast('Please select an image file', 'error');
    return;
  }
  let img;
  try {
    img = await fileToImage(file);
  } catch {
    showToast('Failed to load image \u2014 format may not be supported', 'error');
    return;
  }
  if (!cropEditor) initEditors();
  cropEditor.load(img);
  currentCrop = cropEditor.getCrop();
  preview.update(currentCrop);
  _resetPreviewTransform();
  showStep('edit');
}

fileInputCapture.addEventListener('change', (e) => handleFile(e.target.files[0]));
fileInputGallery.addEventListener('change', (e) => handleFile(e.target.files[0]));

// ── Camera controls ───────────────────────────────────────────────────────────
btnOpenCamera.addEventListener('click', () => enterCameraStep());

// ── White balance ─────────────────────────────────────────────────────────────

/** Reset all WB state and UI to neutral. */
function _resetWbState() {
  wbGains    = { r: 1, g: 1, b: 1 };
  wbApplied  = false;
  wbActive   = false;
  wbDragging = false;
  cameraVideo.style.filter      = '';
  cameraVideo.style.touchAction = '';
  cameraVideo.style.clipPath    = '';
  const matrix = document.getElementById('camWbMatrix');
  if (matrix) matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0');
  const loupe = document.getElementById('camWbLoupe');
  if (loupe)  loupe.style.display = 'none';
  const dot = document.getElementById('camWbDot');
  if (dot)    dot.style.display   = 'none';
  document.getElementById('camWbHint')?.style.setProperty('display', 'none');
  document.getElementById('camWbDoneRow')?.style.setProperty('display', 'none');
  const btn = document.getElementById('btnWbMode');
  if (btn) {
    btn.classList.remove('text-sky-300', 'border-sky-400/50');
    btn.classList.add('text-white/60', 'border-white/20');
  }
}

/** Enter WB-pick mode: disable other controls, show instruction. */
function _enterWbMode() {
  wbActive = true;
  btnTakePhoto.disabled  = true;
  btnCameraBack.disabled = true;
  document.getElementById('btnHDRToggle')?.setAttribute('disabled', '');

  const btn = document.getElementById('btnWbMode');
  if (btn) {
    btn.classList.add('text-sky-300', 'border-sky-400/50');
    btn.classList.remove('text-white/60', 'border-white/20');
  }

  const hintDiv = document.getElementById('camHintText')?.closest('div');
  if (hintDiv) hintDiv.style.display = 'none';
  const wbHint = document.getElementById('camWbHint');
  if (wbHint) wbHint.style.display = '';
  const doneRow = document.getElementById('camWbDoneRow');
  if (doneRow) doneRow.style.display = 'none';

  cameraVideo.style.touchAction = 'none'; // prevent scroll during WB drag
}

/** Exit WB-pick mode. Pass applied=true when a WB sample was committed. */
function _exitWbMode(applied) {
  wbActive   = false;
  wbDragging = false;
  btnTakePhoto.disabled  = false;
  btnCameraBack.disabled = false;
  document.getElementById('btnHDRToggle')?.removeAttribute('disabled');

  const btn = document.getElementById('btnWbMode');
  if (btn) {
    if (applied || wbApplied) {
      btn.classList.add('text-sky-300', 'border-sky-400/50');
      btn.classList.remove('text-white/60', 'border-white/20');
    } else {
      btn.classList.remove('text-sky-300', 'border-sky-400/50');
      btn.classList.add('text-white/60', 'border-white/20');
    }
  }

  const hintDiv = document.getElementById('camHintText')?.closest('div');
  if (hintDiv) { document.getElementById('camHintText').textContent = 'Aim at the surface then tap Capture'; hintDiv.style.display = ''; }
  const wbHint = document.getElementById('camWbHint');
  if (wbHint) wbHint.style.display = 'none';
  document.getElementById('camWbLoupe').style.display = 'none';
  document.getElementById('camWbDot').style.display   = 'none';

  if (applied) {
    const doneRow = document.getElementById('camWbDoneRow');
    if (doneRow) doneRow.style.display = '';
  }

  cameraVideo.style.touchAction = '';
}

/**
 * Map viewport pointer coords → native video frame pixel coords,
 * accounting for object-fit: cover on the camera video.
 */
function _clientToVideoCoords(clientX, clientY) {
  const rect = cameraVideo.getBoundingClientRect();
  const vw   = cameraVideo.videoWidth;
  const vh   = cameraVideo.videoHeight;
  if (!vw || !vh) return { vx: 0, vy: 0 };

  const cw  = rect.width;
  const ch  = rect.height;
  const va  = vw / vh;
  const ca  = cw / ch;
  let rW, rH, ox, oy;
  if (va > ca) { rH = ch; rW = rH * va; ox = (cw - rW) / 2; oy = 0; }
  else         { rW = cw; rH = rW / va; ox = 0; oy = (ch - rH) / 2; }

  const scale = rW / vw;
  const px    = clientX - rect.left;
  const py    = clientY - rect.top;
  return {
    vx: Math.max(0, Math.min(vw - 1, Math.round((px - ox) / scale))),
    vy: Math.max(0, Math.min(vh - 1, Math.round((py - oy) / scale))),
  };
}

/** Sample the average pixel color at a viewport point from the live video. */
function _sampleVideoPixel(clientX, clientY) {
  const { vx, vy } = _clientToVideoCoords(clientX, clientY);
  const vw = cameraVideo.videoWidth;
  const vh = cameraVideo.videoHeight;
  const sx = Math.max(0, Math.min(vw - 3, vx - 1));
  const sy = Math.max(0, Math.min(vh - 3, vy - 1));

  const tmp = document.createElement('canvas');
  tmp.width  = 3;
  tmp.height = 3;
  tmp.getContext('2d').drawImage(cameraVideo, sx, sy, 3, 3, 0, 0, 3, 3);
  const d = tmp.getContext('2d').getImageData(0, 0, 3, 3).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 9 * 4; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  return { r: r / 9, g: g / 9, b: b / 9 };
}

/** Compute and store WB gains from a sampled white-point pixel, update SVG filter. */
function _applyWhiteBalance(r, g, b) {
  if (Math.max(r, g, b) < 12) {
    showToast('Sample too dark \u2014 tap a white or grey area', 'warning');
    return false;
  }
  const rawR = 255 / r;
  const rawG = 255 / g;
  const rawB = 255 / b;
  const mx   = Math.max(rawR, rawG, rawB);
  wbGains   = { r: rawR / mx, g: rawG / mx, b: rawB / mx };
  wbApplied = true;

  // Update SVG filter for live preview
  const v = `${wbGains.r.toFixed(4)} 0 0 0 0  0 ${wbGains.g.toFixed(4)} 0 0 0  0 0 ${wbGains.b.toFixed(4)} 0 0  0 0 0 1 0`;
  document.getElementById('camWbMatrix')?.setAttribute('values', v);
  cameraVideo.style.filter = 'url(#camWbFilter)';
  return true;
}

/** Show/update the magnifier loupe at the pointer position. */
function _showWbLoupe(rawClientX, rawClientY) {
  // Shift sample point to upper-right of finger so user can see it
  const clientX = rawClientX + WB_SAMPLE_DX;
  const clientY = rawClientY + WB_SAMPLE_DY;

  const loupe = document.getElementById('camWbLoupe');
  if (!loupe) return;

  const RADIUS = 80;
  const ZOOM   = 5;
  const SIZE   = RADIUS * 2;
  const dpr    = window.devicePixelRatio || 1;

  loupe.style.width   = SIZE + 'px';
  loupe.style.height  = SIZE + 'px';
  loupe.width         = SIZE * dpr;
  loupe.height        = SIZE * dpr;
  loupe.style.display = 'block';

  // Position loupe above + centered on the sample point
  const vfRect     = stepCamera.querySelector('.cam-viewfinder').getBoundingClientRect();
  const sampleRelX = clientX - vfRect.left;
  const sampleRelY = clientY - vfRect.top;
  let lx = sampleRelX - RADIUS;
  let ly = sampleRelY - SIZE - RADIUS * 0.6;

  // Boundary clamps: keep inside viewfinder
  if (lx + SIZE > vfRect.width) lx = vfRect.width - SIZE;
  if (lx < CAM_RULER_SZ)        lx = CAM_RULER_SZ;
  if (ly < CAM_RULER_SZ)        ly = sampleRelY + RADIUS * 0.6;
  ly = Math.max(CAM_RULER_SZ, ly);

  loupe.style.left = lx + 'px';
  loupe.style.top  = ly + 'px';

  // Draw zoomed video frame centred on the sample point
  const { vx, vy } = _clientToVideoCoords(clientX, clientY);
  const vw      = cameraVideo.videoWidth;
  const vh      = cameraVideo.videoHeight;
  const srcSide = SIZE / ZOOM;
  const srcX    = Math.max(0, Math.min(vw - srcSide, vx - srcSide / 2));
  const srcY    = Math.max(0, Math.min(vh - srcSide, vy - srcSide / 2));

  const ctx = loupe.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.beginPath();
  ctx.arc(RADIUS, RADIUS, RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(cameraVideo, srcX, srcY, srcSide, srcSide, 0, 0, SIZE, SIZE);

  // Crosshair at centre
  ctx.strokeStyle = 'rgba(255, 50, 50, 0.9)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.moveTo(0, RADIUS); ctx.lineTo(SIZE, RADIUS); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(RADIUS, 0); ctx.lineTo(RADIUS, SIZE); ctx.stroke();
  ctx.restore();

  // Red dot on the video at the actual sample point
  const dot = document.getElementById('camWbDot');
  if (dot) {
    dot.style.display = 'block';
    dot.style.left    = sampleRelX + 'px';
    dot.style.top     = sampleRelY + 'px';
  }
}

// WB pointer events on the live camera video
cameraVideo.addEventListener('pointerdown', (e) => {
  if (!wbActive) return;
  e.preventDefault();
  wbDragging = true;
  cameraVideo.setPointerCapture(e.pointerId);
  _showWbLoupe(e.clientX, e.clientY);
}, { passive: false });

cameraVideo.addEventListener('pointermove', (e) => {
  if (!wbActive || !wbDragging) return;
  e.preventDefault();
  _showWbLoupe(e.clientX, e.clientY);
}, { passive: false });

cameraVideo.addEventListener('pointerup', (e) => {
  if (!wbActive) return;
  wbDragging = false;
  document.getElementById('camWbLoupe').style.display = 'none';
  document.getElementById('camWbDot').style.display   = 'none';
  const { r, g, b } = _sampleVideoPixel(e.clientX + WB_SAMPLE_DX, e.clientY + WB_SAMPLE_DY);
  const ok = _applyWhiteBalance(r, g, b);
  _exitWbMode(ok);
});

cameraVideo.addEventListener('pointercancel', () => {
  if (!wbActive) return;
  wbDragging = false;
  document.getElementById('camWbLoupe').style.display = 'none';
  document.getElementById('camWbDot').style.display   = 'none';
  _exitWbMode(false);
});

// WB button toggle
document.getElementById('btnWbMode')?.addEventListener('click', () => {
  if (wbActive) { _exitWbMode(false); } else { _enterWbMode(); }
});

// ── HDR helpers ───────────────────────────────────────────────────────────────
function _updateHDRButton() {
  const btn = document.getElementById('btnHDRToggle');
  if (!btn) return;
  if (hdrMode) {
    btn.classList.add('text-amber-300', 'border-amber-400/50');
    btn.classList.remove('text-white/50', 'border-white/20');
    btn.textContent = 'HDR ✓';
  } else {
    btn.classList.remove('text-amber-300', 'border-amber-400/50');
    btn.classList.add('text-white/50', 'border-white/20');
    btn.textContent = 'HDR';
  }
}

document.getElementById('btnHDRToggle')?.addEventListener('click', () => {
  if (!hdrCapabilities) return;
  hdrMode = !hdrMode;
  _updateHDRButton();
});

btnCameraBack.addEventListener('click', () => {
  _resetWbState();
  stopCamera();
  showStep('entry');
});

document.getElementById('btnCameraErrorBack')?.addEventListener('click', () => {
  stopCamera();
  showStep('entry');
});

btnTakePhoto.addEventListener('click', async () => {
  // ── HDR path ──
  if (hdrMode && hdrCapabilities) {
    const overlay      = document.getElementById('hdrOverlay');
    const progressText = document.getElementById('hdrProgressText');
    const dots = [
      document.getElementById('hdrDot0'),
      document.getElementById('hdrDot1'),
      document.getElementById('hdrDot2'),
    ];
    overlay.style.display = 'flex';

    const onProgress = (step, total, label) => {
      if (progressText) progressText.textContent = label;
      dots.forEach((d, i) => {
        if (!d) return;
        d.classList.toggle('bg-primary',  i < step);
        d.classList.toggle('bg-white/20', i >= step);
      });
    };

    try {
      const track  = cameraStream.getVideoTracks()[0];
      const frames = await captureHDRFrames(track, hdrCapabilities, onProgress);
      if (progressText) progressText.textContent = 'Merging HDR...';
      const merged       = mergeHDR(...frames);
      frames.forEach(f => f.close?.());
      const squaredCanvas = _cropToSquare(merged, merged.width, merged.height);
      const img = await canvasToImage(squaredCanvas);
      overlay.style.display = 'none';
      _resetWbState();
      stopCamera();
      if (!cropEditor) initEditors();
      cropEditor.load(img);
      currentCrop = cropEditor.getCrop();
      preview.update(currentCrop);
      _resetPreviewTransform();
      showStep('edit');
    } catch (err) {
      overlay.style.display = 'none';
      showToast('HDR capture failed: ' + err.message, 'error');
    }
    return;
  }

  // ── Single-shot path ──
  try {
    const captureCanvas = captureFromVideo();
    const img = await canvasToImage(captureCanvas);
    _resetWbState();
    stopCamera();
    if (!cropEditor) initEditors();
    cropEditor.load(img);
    currentCrop = cropEditor.getCrop();
    preview.update(currentCrop);
    _resetPreviewTransform();
    showStep('edit');
  } catch (err) {
    showToast('Capture failed. Please try again.', 'error');
  }
});

// ── Edit actions ──────────────────────────────────────────────────────────────
btnRetake.addEventListener('click', async () => {
  await enterCameraStep();
});

btnPickAnother.addEventListener('click', () => {
  resetToEntry();
});

btnShowUpload.addEventListener('click', async () => {
  if (!currentCrop) { showToast('Please adjust the crop area first', 'warning'); return; }
  genOverlayLabel.textContent = 'Generating channels...';
  genOverlay.classList.remove('hidden');
  try {
    const outSize = Infinity;  // upload at actual crop resolution — no downscaling
    const params  = seamlessEnabled ? { ...seamlessParams } : null;
    generatedMaps = await generateChannels(currentCrop, params, outSize);
    paintPreviewThumbnails(generatedMaps);
    showStep('preview');
  } catch (err) {
    showToast('Channel generation failed: ' + err.message, 'error');
  } finally {
    genOverlay.classList.add('hidden');
  }
});

btnPreviewBack.addEventListener('click', () => showStep('edit'));

btnPreviewConfirm.addEventListener('click', () => {
  uploadNameInput.value = '';
  openUploadSheet();
});

// ── Upload sheet ──────────────────────────────────────────────────────────────
btnCancelUpload.addEventListener('click', () => closeUploadSheet());
uploadSheetBackdrop.addEventListener('click', () => closeUploadSheet());

btnConfirmUpload.addEventListener('click', async () => {
  const name = uploadNameInput.value.trim();
  if (!name) { showToast('Please enter a folder name', 'warning'); return; }
  if (!currentCrop) { showToast('Please select a crop area first', 'warning'); return; }

  if (!generatedMaps) { showToast('Please preview channels first', 'warning'); return; }

  const uploadOverlay = document.getElementById('uploadProgressOverlay');
  const uploadLabel   = document.getElementById('uploadProgressLabel');
  const uploadBar     = document.getElementById('uploadProgressBar');
  const uploadCount   = document.getElementById('uploadProgressCount');

  if (uploadOverlay) {
    uploadBar.style.width = '0%';
    uploadLabel.textContent = 'Preparing\u2026';
    uploadCount.textContent = '0 / 6';
    uploadOverlay.classList.remove('hidden');
  }

  btnConfirmUpload.disabled = true;
  const origHTML = btnConfirmUpload.innerHTML;

  const onProgress = (done, total) => {
    if (uploadOverlay) {
      uploadBar.style.width = `${Math.round((done / total) * 100)}%`;
      uploadLabel.textContent = done < total ? `Channel ${done} / ${total}` : 'Finalizing\u2026';
      uploadCount.textContent = `${done} / ${total}`;
    }
  };

  try {
    const rawUser = sessionStorage.getItem('wp_user') || localStorage.getItem('wp_user');
    const currentUser = rawUser ? JSON.parse(rawUser) : null;
    const username = currentUser?.id || currentUser?.name || '';
    await checkUploadQuota(username);

    const result = await uploadAllMaps(name, generatedMaps, onProgress);

    // Persist upload record for quota and cleanup.
    const publicIds = Object.values(result.maps).map(i => i.public_id).filter(Boolean);
    if (publicIds.length) {
      const apiBase = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? `${location.protocol}//${location.host}`
        : 'https://webphoto-lidl.onrender.com';
      fetch(`${apiBase}/record-upload`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, folderName: name, publicIds })
      }).catch((e) => console.warn('[record-upload]', e.message));
    }

    closeUploadSheet();
    showToast('Upload successful \u2014 6 channels saved', 'success');

    // ── Send material links via Email ──────────────────────────────────────
    const chkSendEmail = document.getElementById('chkSendEmail');
    if (chkSendEmail?.checked) {
      try {
        const raw  = sessionStorage.getItem('wp_user') || localStorage.getItem('wp_user');
        const user = raw ? JSON.parse(raw) : null;
        const emailOverride = document.getElementById('emailOverrideInput')?.value?.trim();
        const toEmail = user?.email || emailOverride;
        if (toEmail) {
          const maps = {};
          for (const [ch, info] of Object.entries(result.maps)) maps[ch] = info.url;
          const apiBase = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? `${location.protocol}//${location.host}`
            : 'https://webphoto-lidl.onrender.com';
          await fetch(`${apiBase}/send-upload-report`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email: toEmail, name, maps })
          });
          showToast('Material links sent to ' + toEmail, 'info');
        } else {
          showToast('No email address — links not sent', 'warning');
        }
      } catch (mailErr) {
        showToast('Failed to send email: ' + mailErr.message, 'warning');
      }
    }

    generatedMaps = null;
    showStep('entry');
  } catch (err) {
    showToast('Upload failed: ' + err.message, 'error');
  } finally {
    if (uploadOverlay) uploadOverlay.classList.add('hidden');
    btnConfirmUpload.disabled = false;
    btnConfirmUpload.innerHTML = origHTML;
  }
});

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  cropEditor?.resize();
  _syncPreviewTransform();
  if (!stepCamera.classList.contains('hidden')) drawCropGuide();
});
window.addEventListener('beforeunload', () => stopCamera());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});

// ── Vertical split handle ─────────────────────────────────────────────────────
(function () {
  const handle   = document.getElementById('splitHandle');
  const cropCont = document.getElementById('cropContainer');
  if (!handle || !cropCont) return;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startY    = e.clientY;
    const startFlex = cropCont.offsetHeight;
    const totalH    = cropCont.parentElement.offsetHeight;

    const onMove = (ev) => {
      const delta = ev.clientY - startY;
      const newH  = Math.max(80, Math.min(totalH - 80, startFlex + delta));
      cropCont.style.flex = `0 0 ${newH}px`;
      cropEditor?.resize();
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
})();

/**
 * app-mobile.js — mobile app logic
 */

import { CropEditor }              from './crop-editor.js';
import { PatternPreview }           from './preview.js';
import { getCropCanvas, uploadSingleImage } from './upload.js';
import { showToast }               from './toast.js';
// seamless.js no longer needed for UI

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
const previewGridSlider = document.getElementById('previewGridSlider');
const previewGridVal    = document.getElementById('previewGridVal');
const btnRetake      = document.getElementById('btnRetake');
const btnPickAnother = document.getElementById('btnPickAnother');
const btnShowUpload  = document.getElementById('btnShowUpload');
const uploadSheet  = document.getElementById('uploadSheet');
const uploadSheetBackdrop = document.getElementById('uploadSheetBackdrop');
const uploadNameInput = document.getElementById('uploadName');
const btnConfirmUpload = document.getElementById('btnConfirmUpload');
const btnCancelUpload  = document.getElementById('btnCancelUpload');
const uploadResolution = document.getElementById('uploadResolution');
const btnAspectLock    = document.getElementById('btnAspectLock');
const lockIconClosed   = document.getElementById('lockIconClosed');
const lockIconOpen     = document.getElementById('lockIconOpen');
const lockLabel        = document.getElementById('lockLabel');

// ── State ─────────────────────────────────────────────────────────────────────
// Show email checkbox only if user has email stored
(function () {
  try {
    const raw  = sessionStorage.getItem('wp_user') || localStorage.getItem('wp_user');
    const user = raw ? JSON.parse(raw) : null;
    if (user?.email) document.getElementById('sendEmailLabel')?.classList.remove('hidden');
  } catch {}
})();
let cropEditor      = null;
let preview         = null;
let currentCrop     = null;
let cameraStream    = null;


// ── Initialise editors ────────────────────────────────────────────────────────
function initEditors() {
  const cropSizeInfo = document.getElementById('cropSizeInfo');
  function _updateCropSize(crop) {
    if (cropSizeInfo && crop?.w != null)
      cropSizeInfo.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
  }

  cropEditor = new CropEditor(cropCanvas, {
    onChange: (crop) => {
      currentCrop = crop;
      preview.updateFast(crop);
      _updateCropSize(crop);
    },
    onChangeEnd: (crop) => {
      currentCrop = crop;
      preview.update(crop);
      _updateCropSize(crop);
    },
  });

  preview = new PatternPreview(previewCanvas, { displaySize: 1024, gridSize: 3, fitMode: 'width' });

  previewGridSlider.addEventListener('input', (e) => {
    const zoom = parseInt(e.target.value);      // 1 = zoomed out, 10 = zoomed in
    previewGridVal.textContent = zoom;
    preview.setGridSize(Math.max(1, 11 - zoom)); // invert: zoom 8 → gridSize 3
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
      if (lockLabel) lockLabel.textContent = '自由';
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

  // Seamless controls removed
}

function showStep(stepName) {
  stepEntry.classList.add('hidden');
  stepCamera.classList.add('hidden');
  stepEdit.classList.add('hidden');

  if      (stepName === 'camera')  stepCamera.classList.remove('hidden');
  else if (stepName === 'edit') {
    stepEdit.classList.remove('hidden');
    requestAnimationFrame(() => preview?.resize());
  }
  else                             stepEntry.classList.remove('hidden');
}

async function startCamera() {
  stopCamera();
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { min: 1920, ideal: 3840, max: 4096 },
      height: { min: 1080, ideal: 2160, max: 2160 },
    },
  };

  cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  cameraVideo.srcObject = cameraStream;
  await new Promise((res) => {
    if (cameraVideo.readyState >= 2) return res();
    cameraVideo.addEventListener('loadedmetadata', res, { once: true });
  });
  await cameraVideo.play();
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
}

async function enterCameraStep() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('此裝置不支援網頁即時相機，改用系統拍照', 'warning');
    fileInputCapture.click();
    return;
  }

  try {
    showStep('camera');
    await startCamera();
  } catch (err) {
    showToast('無法啟用相機，改用系統拍照', 'warning');
    showStep('entry');
    fileInputCapture.click();
  }
}

function captureFromVideo() {
  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  if (!w || !h) throw new Error('相機尚未就緒');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(cameraVideo, 0, 0, w, h);
  return canvas;
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
    showToast('請選擇圖片檔案', 'error');
    return;
  }
  let img;
  try {
    img = await fileToImage(file);
  } catch {
    showToast('圖片載入失敗，格式可能不支援', 'error');
    return;
  }
  if (!cropEditor) initEditors();
  cropEditor.load(img);
  currentCrop = cropEditor.getCrop();
  preview.update(currentCrop);
  showStep('edit');
}

fileInputCapture.addEventListener('change', (e) => handleFile(e.target.files[0]));
fileInputGallery.addEventListener('change', (e) => handleFile(e.target.files[0]));

// ── Camera controls ───────────────────────────────────────────────────────────
btnOpenCamera.addEventListener('click', () => enterCameraStep());

btnCameraBack.addEventListener('click', () => {
  stopCamera();
  showStep('entry');
});

btnTakePhoto.addEventListener('click', async () => {
  try {
    const captureCanvas = captureFromVideo();
    const img = await canvasToImage(captureCanvas);
    stopCamera();
    if (!cropEditor) initEditors();
    cropEditor.load(img);
    currentCrop = cropEditor.getCrop();
    preview.update(currentCrop);
    showStep('edit');
  } catch (err) {
    showToast('拍照失敗，請重試', 'error');
  }
});

// ── Edit actions ──────────────────────────────────────────────────────────────
btnRetake.addEventListener('click', async () => {
  await enterCameraStep();
});

btnPickAnother.addEventListener('click', () => {
  resetToEntry();
});

btnShowUpload.addEventListener('click', () => {
  if (!currentCrop) { showToast('請先展開裁切區域', 'warning'); return; }
  uploadNameInput.value = '';
  openUploadSheet();
});

// ── Upload sheet ──────────────────────────────────────────────────────────────
btnCancelUpload.addEventListener('click', () => closeUploadSheet());
uploadSheetBackdrop.addEventListener('click', () => closeUploadSheet());

btnConfirmUpload.addEventListener('click', async () => {
  const name = uploadNameInput.value.trim();
  if (!name) { showToast('請輸入名稱', 'warning'); return; }
  if (!currentCrop) { showToast('請先選取裁切範圍', 'warning'); return; }

  btnConfirmUpload.disabled = true;
  const origHTML = btnConfirmUpload.innerHTML;
  btnConfirmUpload.innerHTML = '<span class="loading loading-spinner loading-sm"></span> 上傳中...';

  try {
    const outSize = parseInt(uploadResolution?.value || '1024');
    const canvas  = getCropCanvas(currentCrop, outSize, true);
    await uploadSingleImage(name, canvas);
    closeUploadSheet();
    showToast('上傳成功！', 'success');
    showStep('entry');
  } catch (err) {
    showToast('上傳失敗: ' + err.message, 'error');
  } finally {
    btnConfirmUpload.disabled = false;
    btnConfirmUpload.innerHTML = origHTML;
  }
});

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => cropEditor?.resize());

// ── Vertical split handle ─────────────────────────────────────────────────────
(function () {
  const handle   = document.getElementById('splitHandle');
  const cropCont = document.getElementById('cropContainer');
  if (!handle || !cropCont) return;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = cropCont.getBoundingClientRect().height;

    function onMove(me) {
      const dy   = me.clientY - startY;
      const newH = Math.max(80, Math.min(window.innerHeight - 220, startH + dy));
      cropCont.style.flex = `0 0 ${newH}px`;
      cropEditor?.resize();
      preview?.resizeFast();
    }
    function onUp() {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup',    onUp);
      handle.removeEventListener('pointercancel', onUp);
      cropEditor?.resize();
      preview?.resize();
    }
    handle.addEventListener('pointermove',  onMove);
    handle.addEventListener('pointerup',    onUp);
    handle.addEventListener('pointercancel', onUp);
  });
})();
// ── Preview pan & pinch-zoom ──────────────────────────────────────────────────
(function () {
  const wrap = document.getElementById('previewWrap');
  if (!wrap) return;

  let _pan   = null;   // { x, y }
  let _pinch = null;  // { dist }

  wrap.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      _pan   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      _pinch = null;
    } else if (e.touches.length === 2) {
      _pan = null;
      _pinch = { dist: Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      )};
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && _pan) {
      const dx = e.touches[0].clientX - _pan.x;
      const dy = e.touches[0].clientY - _pan.y;
      _pan.x = e.touches[0].clientX;
      _pan.y = e.touches[0].clientY;
      preview?.setPan(dx, dy);
    } else if (e.touches.length === 2 && _pinch) {
      const newDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      const factor = newDist / _pinch.dist;
      _pinch.dist = newDist;
      preview?.setPreviewZoom(factor);
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      _pan = null; _pinch = null;
      if (preview?._lastCrop) preview.update(preview._lastCrop);
    } else if (e.touches.length === 1) {
      _pan   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      _pinch = null;
    }
  });

  // Double-tap to reset pan & zoom
  let _lastTap = 0;
  wrap.addEventListener('touchend', (e) => {
    if (e.changedTouches.length !== 1) return;
    const now = Date.now();
    if (now - _lastTap < 300) preview?.resetView();
    _lastTap = now;
  });
})();

window.addEventListener('beforeunload', () => stopCamera());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});

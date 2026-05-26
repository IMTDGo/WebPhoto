/**
 * app-mobile.js — mobile app logic
 */

import { CropEditor }              from './crop-editor.js';
import { PatternPreview }           from './preview.js';
import { getCropCanvas, uploadSingleImage } from './upload.js';
import { showToast }               from './toast.js';
import { renderCategoryAccordion, highlightMaterial } from './bom-ui.js';
import { getHDRCapabilities, captureHDRFrames, mergeHDR } from './hdr.js';
import { drawCameraRulers } from './camera-ruler.js';

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
// BOM selection DOM refs
const stepProject    = document.getElementById('stepProject');
const stepBOM        = document.getElementById('stepBOM');
const projectList    = document.getElementById('projectList');
const projectLoading = document.getElementById('projectLoading');
const projectError   = document.getElementById('projectError');
const bomList        = document.getElementById('bomList');
const bomLoading     = document.getElementById('bomLoading');
const bomError       = document.getElementById('bomError');
const tabBtnPhoto    = document.getElementById('tabBtnPhoto');
const tabBtnAdmin    = document.getElementById('tabBtnAdmin');
const tabPhoto       = document.getElementById('tabPhoto');
const tabAdmin       = document.getElementById('tabAdmin');
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

// HDR state
let hdrMode         = false;
let hdrCapabilities = null;  // null = not supported / not yet checked

// White balance state
let wbGains   = { r: 1, g: 1, b: 1 }; // per-channel gains (1 = neutral)
let wbApplied = false;                  // gains have been sampled at least once
let wbActive  = false;                  // WB-pick mode is open
let wbDragging = false;                 // pointer is currently held down

// Offset applied to raw touch point so the sample lands upper-right of finger
const WB_SAMPLE_DX =  35;  // CSS px to the right
const WB_SAMPLE_DY = -50;  // CSS px upward

// BOM / texture selection state
let currentProjectId    = null;
let currentProjectName  = '';
let currentBomId        = null;
let currentBomName      = '';
let currentTexturePath  = null;
let currentTextureRecord = null;   // full textureRecord from project-parse
let currentMaterialItem  = null;   // selected texture item {_id, category, material, material_origin}


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
    const zoom = parseInt(e.target.value);      // 1 = 1 tile (original), 10 = zoomed out
    previewGridVal.textContent = zoom;
    preview.setGridSize(zoom);
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
  stepProject.classList.add('hidden');
  stepBOM.classList.add('hidden');
  stepEntry.classList.add('hidden');
  stepCamera.classList.add('hidden');
  stepEdit.classList.add('hidden');

  // Hide tab bar during camera/edit steps to reduce distraction
  const tabBar = document.getElementById('mainTabBar');
  const hideTabBar = stepName === 'camera' || stepName === 'edit';
  if (tabBar) tabBar.classList.toggle('hidden', hideTabBar);

  if      (stepName === 'project') stepProject.classList.remove('hidden');
  else if (stepName === 'bom')     stepBOM.classList.remove('hidden');
  else if (stepName === 'camera')  stepCamera.classList.remove('hidden');
  else if (stepName === 'edit') {
    stepEdit.classList.remove('hidden');
    requestAnimationFrame(() => preview?.resize());
  }
  else                             stepEntry.classList.remove('hidden');
}

// ── Auth token helper ────────────────────────────────────────────────────────────────────────────
function getAuthToken() {
  return sessionStorage.getItem('wp_token') || localStorage.getItem('wp_token') || '';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Project & BOM API ────────────────────────────────────────────────────────────────────────────
async function loadProjects() {
  projectLoading.classList.remove('hidden');
  projectList.classList.add('hidden');
  projectError.classList.add('hidden');

  try {
    const res = await fetch(
      `${window.__API_BASE__}/api/projects/list?page=1&pageSize=50`,
      { headers: { 'Authorization': `Bearer ${getAuthToken()}` } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    projectLoading.classList.add('hidden');
    projectList.classList.remove('hidden');
    _renderProjects(data);
  } catch (err) {
    projectLoading.classList.add('hidden');
    projectError.classList.remove('hidden');
    document.getElementById('projectErrorMsg').textContent = '載入失敗：' + err.message;
  }
}

function _renderProjects(data) {
  // Spec response: { total, items: [{ id, name, thumbnail, updatedAt }] }
  // Fallback for older/alternative shapes
  const list = Array.isArray(data)            ? data
    : Array.isArray(data.items)               ? data.items
    : Array.isArray(data.data?.list)          ? data.data.list
    : Array.isArray(data.list)                ? data.list
    : Array.isArray(data.data)                ? data.data
    : [];

  projectList.innerHTML = '';
  if (!list.length) {
    projectList.innerHTML = '<p class="text-center text-base-content/40 text-sm py-10">目前沒有任何專案</p>';
    return;
  }
  list.forEach(p => {
    const id    = p._id ?? p.id ?? p.project_id ?? '';
    const name  = p.name ?? String(id);
    const thumb = p.thumbnail ?? null;
    const date  = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('zh-TW') : '';

    const btn = document.createElement('button');
    btn.className = 'w-full text-left rounded-2xl bg-base-100/90 backdrop-blur border border-base-content/10 overflow-hidden active:scale-[0.98] transition-transform flex items-center gap-3 pr-4 mb-3';
    btn.innerHTML = thumb
      ? `<img src="${escapeHtml(thumb)}" class="w-16 h-16 object-cover shrink-0 rounded-l-2xl" loading="lazy" onerror="this.style.display='none'" />
         <div class="py-3 min-w-0">
           <div class="font-semibold text-base leading-tight truncate">${escapeHtml(name)}</div>
           <div class="text-xs text-base-content/40 mt-0.5">${escapeHtml(date)}</div>
         </div>`
      : `<div class="w-16 h-16 shrink-0 rounded-l-2xl bg-base-200/60 flex items-center justify-center text-2xl opacity-40">📁</div>
         <div class="py-3 min-w-0">
           <div class="font-semibold text-base leading-tight truncate">${escapeHtml(name)}</div>
           <div class="text-xs text-base-content/40 mt-0.5">${escapeHtml(date)}</div>
         </div>`;

    btn.addEventListener('click', () => {
      currentProjectId   = id;
      currentProjectName = name;
      document.getElementById('bomProjectName').textContent = name;
      showStep('bom');
      loadBomList(id);
    });
    projectList.appendChild(btn);
  });
}

async function loadBomList(projectId) {
  bomLoading.classList.remove('hidden');
  bomList.classList.add('hidden');
  bomError.classList.add('hidden');

  try {
    const res = await fetch(
      `${window.__API_BASE__}/api/projects/bom-list?project_id=${encodeURIComponent(projectId)}`,
      { headers: { 'Authorization': `Bearer ${getAuthToken()}` } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.success === false) throw new Error(json.message ?? '載入失敗');

    // data may be an array of {bom_id, bomFileName} or a single object
    const raw = json.data;
    const items = Array.isArray(raw) ? raw
      : Array.isArray(raw?.list)   ? raw.list
      : Array.isArray(raw?.items)  ? raw.items
      : (raw?.bom_id !== undefined ? [raw] : []);

    bomLoading.classList.add('hidden');
    bomList.classList.remove('hidden');
    _renderBomItems(items);
  } catch (err) {
    bomLoading.classList.add('hidden');
    bomError.classList.remove('hidden');
    document.getElementById('bomErrorMsg').textContent = '載入失敗：' + err.message;
  }
}

function _renderBomItems(items) {
  bomList.innerHTML = '';
  if (!items.length) {
    bomList.innerHTML = '<p class="text-center text-base-content/40 text-sm py-10">此專案暫無 BOM 資料</p>';
    return;
  }
  items.forEach(item => {
    const id   = item.bom_id ?? item._id ?? item.id ?? '';
    const name = item.bomFileName ?? item.bomName ?? item.name ?? String(id);
    const btn  = document.createElement('button');
    btn.className = 'w-full text-left rounded-xl bg-base-100/80 border border-base-content/10 px-4 py-3 flex items-center gap-3 active:scale-[0.98] transition-transform mb-2';
    btn.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm leading-tight truncate">${escapeHtml(name)}</div>
        <div class="text-xs text-base-content/40 mt-0.5 truncate">${escapeHtml(String(id))}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>`;
    btn.addEventListener('click', () => _selectBomItem(id, name));
    bomList.appendChild(btn);
  });
}

async function _lookupBomById(bomIdValue) {
  bomLoading.classList.remove('hidden');
  bomError.classList.add('hidden');
  bomList.classList.add('hidden');

  try {
    const url = `${window.__API_BASE__}/api/texture/project-parse`
      + `?project_id=${encodeURIComponent(currentProjectId)}`
      + `&bom_id=${encodeURIComponent(bomIdValue)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.success === false) throw new Error(json.message ?? '查詢失敗');

    const record = json.data?.textureRecord;
    if (!record) throw new Error('無法取得 textureRecord');

    bomLoading.classList.add('hidden');
    const name = record.bomName ?? record.textureGroupName ?? bomIdValue;
    const sub  = [record.brand, record.supplier, record.season].filter(Boolean).join(' · ');

    bomList.classList.remove('hidden');
    bomList.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'w-full text-left rounded-xl bg-base-100/80 border border-base-content/10 px-4 py-3 flex items-center gap-3 active:scale-[0.98] transition-transform mb-2';
    btn.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm leading-tight truncate">${escapeHtml(name)}</div>
        ${sub ? `<div class="text-xs text-base-content/40 mt-0.5 truncate">${escapeHtml(sub)}</div>` : ''}
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
    `;
    btn.addEventListener('click', () => _selectBomItem(record._id ?? bomIdValue, name, record));
    bomList.appendChild(btn);
  } catch (err) {
    bomLoading.classList.add('hidden');
    bomError.classList.remove('hidden');
    bomError.classList.add('flex');
    document.getElementById('bomErrorMsg').textContent = '查詢失敗：' + err.message;
  }
}

async function _selectBomItem(bomId, bomName, record) {
  currentBomId          = bomId;
  currentBomName        = bomName;
  currentTexturePath    = null;
  currentTextureRecord  = null;
  currentMaterialItem   = null;

  // Update entry chip
  const projLabel = document.getElementById('entryProjectLabel');
  const sep       = document.getElementById('entryBomSep');
  const bomLabel  = document.getElementById('entryBomLabel');
  if (projLabel) projLabel.textContent = currentProjectName;
  if (sep)       sep.classList.remove('hidden');
  if (bomLabel)  bomLabel.textContent  = bomName;

  // If record already provided by bom-list flow, use it; otherwise fetch
  if (!record) {
    try {
      const url = `${window.__API_BASE__}/api/texture/project-parse`
        + `?project_id=${encodeURIComponent(currentProjectId)}`
        + `&bom_id=${encodeURIComponent(bomId)}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getAuthToken()}` } });
      if (res.ok) record = (await res.json()).data?.textureRecord ?? null;
    } catch { /* silent */ }
  }

  if (record) {
    currentTextureRecord = record;
    const texPath = record.textureGroupName ?? record.bomName ?? null;
    if (texPath) {
      currentTexturePath = texPath;
      if (projLabel) projLabel.textContent = texPath;
      if (sep) sep.classList.add('hidden');
      if (bomLabel) bomLabel.textContent = '';
    }
  }

  _renderCategoryList();
  showStep('entry');
}

// ── Category / Material rendering ────────────────────────────────────────────
function _renderCategoryList() {
  const categoryList  = document.getElementById('entryCategoryList');
  const noTexture     = document.getElementById('entryNoTexture');
  const entryActions  = document.getElementById('entryActions');

  // Reset material selection
  currentMaterialItem = null;
  if (entryActions) entryActions.classList.add('hidden');

  const textures = currentTextureRecord?.texture;
  if (!textures?.length) {
    // No texture data — show plain camera buttons
    if (categoryList) categoryList.classList.add('hidden');
    if (noTexture)    noTexture.classList.remove('hidden');
    return;
  }

  if (noTexture)    noTexture.classList.add('hidden');
  if (categoryList) categoryList.classList.remove('hidden');

  renderCategoryAccordion(categoryList, textures, _selectMaterial);
}

function _selectMaterial(item) {
  currentMaterialItem = item;

  // Highlight selected button
  highlightMaterial(item._id);

  // Show action bar
  const actions = document.getElementById('entryActions');
  const label   = document.getElementById('entryMaterialLabel');
  if (label)   label.textContent = item.material || item.material_origin || '—';
  if (actions) actions.classList.remove('hidden');
}

// ── Crop guide + 1:1 square capture ─────────────────────────────────────────

const CAM_RULER_SZ = 22; // must match css/camera.css --cam-ruler-sz

/**
 * Draw the 1:1 crop guide (dimmed vignette + white corner brackets)
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
  const squareY     = CAM_RULER_SZ + (videoAreaH - squareSide) / 2;

  // ── Clip the video element to the 1:1 square only ───────────────────────
  const rightInset  = vfW - squareX - squareSide;
  const bottomInset = vfH - squareY - squareSide;
  cameraVideo.style.clipPath =
    `inset(${squareY}px ${rightInset}px ${bottomInset}px ${squareX}px)`;

  // ── Draw the crop-guide canvas (border + corner brackets only) ───────────
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
    [squareX, squareY,               1,  1],
    [squareX + squareSide, squareY,  -1,  1],
    [squareX, squareY + squareSide,   1, -1],
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
 * Compute the video-frame crop region that corresponds to the 1:1 CSS square.
 * Works for any source canvas that has the same aspect ratio as the camera video
 * (e.g., a full-resolution grab or a merged HDR canvas).
 *
 * @param {HTMLCanvasElement} src          — full-frame source canvas
 * @param {number}            srcVideoW    — native video width  (cameraVideo.videoWidth)
 * @param {number}            srcVideoH    — native video height (cameraVideo.videoHeight)
 * @returns {HTMLCanvasElement}            — square canvas, WB applied if wbApplied
 */
function _cropToSquare(src, srcVideoW, srcVideoH) {
  const sw = src.width;
  const sh = src.height;

  const vf  = stepCamera.querySelector('.cam-viewfinder');
  const vfW = vf.offsetWidth;
  const vfH = vf.offsetHeight;
  const videoAreaW  = vfW - CAM_RULER_SZ;
  const videoAreaH  = vfH - CAM_RULER_SZ;
  const squareSide_css = Math.min(videoAreaW, videoAreaH);
  const squareLeft_css = CAM_RULER_SZ + (videoAreaW - squareSide_css) / 2;
  const squareTop_css  = CAM_RULER_SZ + (videoAreaH - squareSide_css) / 2;

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
  const cssToVideo = srcVideoW / renderW;   // CSS px → native video px

  // Crop region in native video pixel coords
  const vx    = Math.max(0, (squareLeft_css - offsetX) * cssToVideo);
  const vy    = Math.max(0, (squareTop_css  - offsetY) * cssToVideo);
  const vSize = squareSide_css * cssToVideo;

  // Scale to source canvas coords (src may be at a different resolution than native)
  const hdrScale   = sw / srcVideoW;
  const sx         = Math.round(vx    * hdrScale);
  const sy         = Math.round(vy    * hdrScale);
  const rawSize    = Math.round(vSize * hdrScale);
  const clampedSz  = Math.min(rawSize, sw - sx, sh - sy, sw, sh);

  const out = document.createElement('canvas');
  out.width  = clampedSz;
  out.height = clampedSz;
  const ctx  = out.getContext('2d');
  ctx.drawImage(src, sx, sy, clampedSz, clampedSz, 0, 0, clampedSz, clampedSz);

  // Apply white-balance gains per-pixel at capture time (CSS filter is visual only)
  if (wbApplied && (wbGains.r !== 1 || wbGains.g !== 1 || wbGains.b !== 1)) {
    _applyWbToCanvas(ctx, clampedSz, clampedSz);
  }
  return out;
}

/** Apply stored white-balance gains to a 2-D canvas context in-place. */
function _applyWbToCanvas(ctx, w, h) {
  const id   = ctx.getImageData(0, 0, w, h);
  const d    = id.data;
  const { r: rg, g: gg, b: bg } = wbGains;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, d[i]     * rg + 0.5 | 0);
    d[i + 1] = Math.min(255, d[i + 1] * gg + 0.5 | 0);
    d[i + 2] = Math.min(255, d[i + 2] * bg + 0.5 | 0);
  }
  ctx.putImageData(id, 0, 0);
}

async function startCamera() {
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

  // Detect HDR support on this track
  const track = cameraStream.getVideoTracks()[0];
  hdrCapabilities = getHDRCapabilities(track);
  const hdrBtn = document.getElementById('btnHDRToggle');
  if (hdrBtn) {
    if (hdrCapabilities) {
      hdrBtn.style.display = '';
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
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('此裝置不支援網頁即時相機，改用系統拍照', 'warning');
    fileInputCapture.click();
    return;
  }

  try {
    showStep('camera');
    await startCamera();
    // Redraw rulers now that stepCamera is visible and the viewfinder is sized
    const _vf = stepCamera.querySelector('.cam-viewfinder');
    if (_vf) {
      drawCameraRulers(_vf);
      drawCropGuide();
      // Redraw crop guide on orientation change / resize
      const _cgRO = new ResizeObserver(() => drawCropGuide());
      _cgRO.observe(_vf);
    }
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
  const name = currentMaterialItem?.material
    ?? currentMaterialItem?.material_origin
    ?? currentTexturePath
    ?? currentBomName;
  uploadNameInput.value = name;
  const display = document.getElementById('uploadNameDisplay');
  if (display) display.textContent = name || '（未選擇部件）';
  uploadSheetBackdrop.classList.remove('hidden');
  uploadSheet.classList.remove('hidden');
}

function closeUploadSheet() {
  uploadSheetBackdrop.classList.add('hidden');
  uploadSheet.classList.add('hidden');
}

function resetToEntry() {
  closeUploadSheet();
  // Reset material selection and re-render category list
  currentMaterialItem = null;
  _renderCategoryList();
  showStep('entry');
  fileInputCapture.value = '';
  fileInputGallery.value = '';
  const galleryEntry = document.getElementById('fileInputGalleryEntry');
  if (galleryEntry) galleryEntry.value = '';
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
document.getElementById('fileInputGalleryEntry')?.addEventListener('change', (e) => handleFile(e.target.files[0]));

// ── Camera controls ───────────────────────────────────────────────────────────
btnOpenCamera.addEventListener('click', () => enterCameraStep());
document.getElementById('btnOpenCameraEntry')?.addEventListener('click', () => enterCameraStep());

document.getElementById('btnClearMaterial')?.addEventListener('click', () => {
  currentMaterialItem = null;
  document.querySelectorAll('.mat-btn').forEach(b => {
    b.classList.remove('bg-primary/20', 'text-primary');
  });
  document.getElementById('entryActions')?.classList.add('hidden');
});

btnCameraBack.addEventListener('click', () => {
  _resetWbState();
  stopCamera();
  showStep('entry');
});

// ── White balance ─────────────────────────────────────────────────────────────

/** Reset all WB state and UI to neutral. */
function _resetWbState() {
  wbGains   = { r: 1, g: 1, b: 1 };
  wbApplied = false;
  wbActive  = false;
  wbDragging = false;
  cameraVideo.style.filter = '';
  cameraVideo.style.touchAction = '';
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
    btn.classList.remove('text-yellow-300', 'border-yellow-500/50');
    btn.classList.add('text-white/60', 'border-white/20');
  }
}

/** Enter WB-pick mode: disable other controls, show instruction. */
function _enterWbMode() {
  wbActive = true;
  btnTakePhoto.disabled = true;
  btnCameraBack.disabled = true;
  document.getElementById('btnHDRToggle')?.setAttribute('disabled', '');

  const btn = document.getElementById('btnWbMode');
  if (btn) {
    btn.classList.add('text-yellow-300', 'border-yellow-500/50');
    btn.classList.remove('text-white/60', 'border-white/20');
    btn.textContent = 'WB ✕';
  }

  document.getElementById('camHintText').textContent = '';
  document.getElementById('camWbHint').style.display    = '';
  document.getElementById('camWbDoneRow').style.display = 'none';

  cameraVideo.style.touchAction = 'none'; // prevent scroll during WB drag
}

/** Exit WB-pick mode. Pass applied=true when a WB sample was committed. */
function _exitWbMode(applied) {
  wbActive   = false;
  wbDragging = false;
  btnTakePhoto.disabled = false;
  btnCameraBack.disabled = false;
  document.getElementById('btnHDRToggle')?.removeAttribute('disabled');

  const btn = document.getElementById('btnWbMode');
  if (btn) {
    btn.classList.remove('text-yellow-300', 'border-yellow-500/50');
    btn.classList.add('text-white/60', 'border-white/20');
    btn.textContent = 'WB';
  }

  document.getElementById('camHintText').textContent = '對準材質後按下拍照';
  document.getElementById('camWbHint').style.display  = 'none';
  document.getElementById('camWbLoupe').style.display  = 'none';
  document.getElementById('camWbDot').style.display    = 'none';

  if (applied) {
    document.getElementById('camWbDoneRow').style.display = '';
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
  for (let i = 0; i < 9 * 4; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
  return { r: r / 9, g: g / 9, b: b / 9 };
}

/** Compute and store WB gains from a sampled white-point pixel, update SVG filter. */
function _applyWhiteBalance(r, g, b) {
  if (Math.max(r, g, b) < 12) {
    showToast('點選區域太暗，請選擇純白色區域', 'warning');
    return false;
  }
  const rawR = 255 / r;
  const rawG = 255 / g;
  const rawB = 255 / b;
  const mx   = Math.max(rawR, rawG, rawB);
  wbGains  = { r: rawR / mx, g: rawG / mx, b: rawB / mx };
  wbApplied = true;

  // Update SVG filter for live preview
  const v  = `${wbGains.r.toFixed(4)} 0 0 0 0  0 ${wbGains.g.toFixed(4)} 0 0 0  0 0 ${wbGains.b.toFixed(4)} 0 0  0 0 0 1 0`;
  document.getElementById('camWbMatrix')?.setAttribute('values', v);
  cameraVideo.style.filter = 'url(#camWbFilter)';
  return true;
}

/** Show/update the magnifier loupe at the pointer position. */
function _showWbLoupe(rawClientX, rawClientY) {
  // Shift sample point to upper-right of finger so user can see it
  const clientX = rawClientX + WB_SAMPLE_DX;
  const clientY = rawClientY + WB_SAMPLE_DY;

  const loupe  = document.getElementById('camWbLoupe');
  if (!loupe) return;

  const RADIUS = 80;         // larger loupe radius (px)
  const ZOOM   = 5;
  const SIZE   = RADIUS * 2;
  const dpr    = window.devicePixelRatio || 1;

  loupe.style.width   = SIZE + 'px';
  loupe.style.height  = SIZE + 'px';
  loupe.width         = SIZE * dpr;
  loupe.height        = SIZE * dpr;
  loupe.style.display = 'block';

  // Position loupe above + centered on the sample point
  const vfRect = stepCamera.querySelector('.cam-viewfinder').getBoundingClientRect();
  const sampleRelX = clientX - vfRect.left;
  const sampleRelY = clientY - vfRect.top;
  let lx = sampleRelX - RADIUS;               // center loupe on sample X
  let ly = sampleRelY - SIZE - RADIUS * 0.6;  // place loupe above the sample point

  // Boundary clamps: keep inside viewfinder
  if (lx + SIZE > vfRect.width)  lx = vfRect.width - SIZE - 4;
  if (lx < CAM_RULER_SZ)         lx = CAM_RULER_SZ;
  if (ly < CAM_RULER_SZ)         ly = sampleRelY + RADIUS * 0.4; // flip below if too high
  ly = Math.max(CAM_RULER_SZ, ly);

  loupe.style.left = lx + 'px';
  loupe.style.top  = ly + 'px';

  // Draw zoomed video frame centred on the sample point
  const { vx, vy } = _clientToVideoCoords(clientX, clientY);
  const vw = cameraVideo.videoWidth;
  const vh = cameraVideo.videoHeight;
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
    dot.style.left    = sampleRelX + 'px';
    dot.style.top     = sampleRelY + 'px';
    dot.style.display = 'block';
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
  // Sample at the adjusted point (upper-right of finger)
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
    btn.textContent = 'HDR ✓';
    btn.classList.remove('text-white/50', 'border-white/20');
    btn.classList.add('text-primary', 'border-primary/60');
  } else {
    btn.textContent = 'HDR';
    btn.classList.remove('text-primary', 'border-primary/60');
    btn.classList.add('text-white/50', 'border-white/20');
  }
}

document.getElementById('btnHDRToggle')?.addEventListener('click', () => {
  if (!hdrCapabilities) return;
  hdrMode = !hdrMode;
  _updateHDRButton();
});

btnTakePhoto.addEventListener('click', async () => {
  // ── HDR path ──
  if (hdrMode && hdrCapabilities) {
    const overlay  = document.getElementById('hdrOverlay');
    const progText = document.getElementById('hdrProgressText');
    const dots     = [0, 1, 2].map(i => document.getElementById(`hdrDot${i}`));

    function setDot(step) {
      dots.forEach((d, i) => {
        if (!d) return;
        d.className = `w-3 h-3 rounded-full transition-colors duration-200 ${i < step ? 'bg-primary' : 'bg-white/20'}`;
      });
    }

    btnTakePhoto.disabled = true;
    document.getElementById('btnHDRToggle').disabled = true;
    if (overlay) overlay.style.display = '';

    try {
      const track = cameraStream.getVideoTracks()[0];
      const frames = await captureHDRFrames(track, hdrCapabilities, (step, total, label) => {
        if (progText) progText.textContent = `拍攝 ${step}/${total}：${label}`;
        setDot(step);
      });

      if (progText) progText.textContent = 'HDR 合成中…';
      setDot(3);

      const [dark, normal, bright] = frames;
      const merged = mergeHDR(dark, normal, bright);
      frames.forEach(f => f.close?.());

      // Crop to 1:1 square + apply WB before handing off to editor
      const videoW = cameraVideo.videoWidth;
      const videoH = cameraVideo.videoHeight;
      const cropped = _cropToSquare(merged, videoW, videoH);

      stopCamera();
      const img = await canvasToImage(cropped);
      if (!cropEditor) initEditors();
      cropEditor.load(img);
      currentCrop = cropEditor.getCrop();
      preview.update(currentCrop);
      showStep('edit');
    } catch (err) {
      showToast('HDR 拍攝失敗，改用普通模式', 'warning');
      // Fallback: single shot from video
      try {
        const canvas = captureFromVideo();
        const img    = await canvasToImage(canvas);
        stopCamera();
        if (!cropEditor) initEditors();
        cropEditor.load(img);
        currentCrop = cropEditor.getCrop();
        preview.update(currentCrop);
        showStep('edit');
      } catch {
        showToast('拍照失敗，請重試', 'error');
      }
    } finally {
      btnTakePhoto.disabled = false;
      const hdrBtn = document.getElementById('btnHDRToggle');
      if (hdrBtn) hdrBtn.disabled = false;
      if (overlay) overlay.style.display = 'none';
    }
    return;
  }

  // ── Single-shot path (original) ──
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
  openUploadSheet();
});

// ── Upload sheet ──────────────────────────────────────────────────────────────
btnCancelUpload.addEventListener('click', () => closeUploadSheet());
uploadSheetBackdrop.addEventListener('click', () => closeUploadSheet());

btnConfirmUpload.addEventListener('click', async () => {
  const name = uploadNameInput.value.trim() || currentBomName;
  if (!name) { showToast('尚未選擇 BOM 部件', 'warning'); return; }
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
    // 回到 BOM 列表，方便選取下一個部件
    fileInputCapture.value = '';
    fileInputGallery.value = '';
    currentCrop = null;
    showStep('bom');
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

// ── Tab switching ─────────────────────────────────────────────────────────────
tabBtnPhoto?.addEventListener('click', () => {
  tabPhoto?.classList.remove('hidden');
  tabAdmin?.classList.add('hidden');
  tabBtnPhoto.classList.add('border-primary', 'text-primary');
  tabBtnPhoto.classList.remove('border-transparent', 'text-base-content/40');
  tabBtnAdmin?.classList.remove('border-primary', 'text-primary');
  tabBtnAdmin?.classList.add('border-transparent', 'text-base-content/40');
});

tabBtnAdmin?.addEventListener('click', () => {
  tabPhoto?.classList.add('hidden');
  tabAdmin?.classList.remove('hidden');
  tabBtnAdmin.classList.add('border-primary', 'text-primary');
  tabBtnAdmin.classList.remove('border-transparent', 'text-base-content/40');
  tabBtnPhoto?.classList.remove('border-primary', 'text-primary');
  tabBtnPhoto?.classList.add('border-transparent', 'text-base-content/40');
});

// ── BOM navigation listeners ──────────────────────────────────────────────────
document.getElementById('btnBomBack')?.addEventListener('click', () => showStep('project'));
document.getElementById('btnEntryBack')?.addEventListener('click', () => showStep('bom'));

document.getElementById('btnChangeBom')?.addEventListener('click', () => {
  showStep('project');
  loadProjects();
});

document.getElementById('btnRetryProjects')?.addEventListener('click', loadProjects);

document.getElementById('btnRetryBom')?.addEventListener('click', () => {
  if (currentProjectId) loadBomList(currentProjectId);
});

// ── Initialise — load projects on mount ──────────────────────────────────────
loadProjects();

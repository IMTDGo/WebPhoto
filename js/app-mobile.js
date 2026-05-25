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
    if (_vf) drawCameraRulers(_vf);
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
  stopCamera();
  showStep('entry');
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

      stopCamera();
      const img = await canvasToImage(merged);
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

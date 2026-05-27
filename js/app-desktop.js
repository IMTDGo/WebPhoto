/**
 * app-desktop.js — desktop app logic (3-panel: original | crop | tiled preview)
 */

import { CropEditor }     from './crop-editor.js';
import { PatternPreview } from './preview.js';
import { getCropCanvas, uploadSingleImage, fileToImage, _isTiff } from './upload.js';
import { showToast }      from './toast.js';
import { renderCategoryAccordion, escapeHtml, highlightMaterial, clearAccordionHighlight } from './bom-ui.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('dropZone');
const fileInput       = document.getElementById('fileInput');
const emptyState      = document.getElementById('emptyState');
const originalImg     = document.getElementById('originalImg');
const cropCanvas      = document.getElementById('cropCanvas');
const imageInfo       = document.getElementById('imageInfo');
const cropPanel       = document.getElementById('cropPanel');
const rightCropPanel  = document.getElementById('rightCropPanel');
const previewSection  = document.getElementById('previewSection');
const previewCanvas   = document.getElementById('previewCanvas');
const uploadPanel     = document.getElementById('uploadPanel');
const btnUpload       = document.getElementById('btnUpload');
const uploadNameInput = document.getElementById('uploadName');
const uploadResolution = document.getElementById('uploadResolution');
const btnAspectLock   = document.getElementById('btnAspectLock');
const lockIconClosed  = document.getElementById('lockIconClosed');
const lockIconOpen    = document.getElementById('lockIconOpen');
const lockLabel       = document.getElementById('lockLabel');

const uvScale         = document.getElementById('uvScale');
const uvScaleVal      = document.getElementById('uvScaleVal');

// ── State ───────────────────────────────────────────────────────────────────
let cropEditor    = null;
let preview       = null;
let currentCrop   = null;
let _lastObjUrl   = null;


function updatePreview() {
  if (!currentCrop?.img || !preview) return;
  preview.update(currentCrop);
}

// ── Load image ────────────────────────────────────────────────────────────────
async function loadImage(file) {
  let img;
  try {
    img = await fileToImage(file);
  } catch {
    showToast('Failed to load image, format may be unsupported', 'error');
    return;
  }

  // Show original image in top-left panel
  if (_lastObjUrl) URL.revokeObjectURL(_lastObjUrl);
  _lastObjUrl = URL.createObjectURL(file);
  originalImg.src = _lastObjUrl;
  originalImg.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Init crop editor on first load
  if (!cropEditor) {
    cropEditor = new CropEditor(cropCanvas, {
      onChange: (crop) => {
        currentCrop = crop;
        preview?.updateFast(crop);
      },
      onChangeEnd: (crop) => {
        currentCrop = crop;
        updatePreview();
      },
    });
  }

  // Init preview on first load
  if (!preview) {
    preview = new PatternPreview(previewCanvas, {
      displaySize: 1024,
      gridSize: parseInt(uvScale.value) || 3,
    });
  }

  cropEditor.load(img);
  currentCrop = cropEditor.getCrop();
  updatePreview();

  document.getElementById('infoName').textContent = file.name;
  document.getElementById('infoSize').textContent = `${img.width} \u00d7 ${img.height}`;
  imageInfo.classList.remove('hidden');
  cropPanel.classList.remove('hidden');
  rightCropPanel.style.display = '';
  previewSection.style.display = '';
  uploadPanel.classList.remove('hidden');
  _updateResolutionLabels(cropEditor.aspectLocked);
}

// ── File input / drop ─────────────────────────────────────────────────────────
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); });

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file?.type.startsWith('image/') || /\.tiff?$/i.test(file?.name)) loadImage(file);
  else showToast('Please drop an image file', 'error');
});

// ── Aspect ratio lock ─────────────────────────────────────────────────────────
function _updateResolutionLabels(locked) {
  if (!uploadResolution) return;
  for (const opt of uploadResolution.options) {
    const n = opt.value;
    opt.textContent = locked ? `${n} × ${n}` : `${n} px (longest side)`;
  }
}

function _updateLockUI(locked) {
  if (locked) {
    lockIconClosed.classList.remove('hidden');
    lockIconOpen.classList.add('hidden');
    lockLabel.textContent = '1:1';
    btnAspectLock.classList.remove('btn-ghost');
    btnAspectLock.classList.add('btn-outline');
  } else {
    lockIconClosed.classList.add('hidden');
    lockIconOpen.classList.remove('hidden');
    lockLabel.textContent = 'Free';
    btnAspectLock.classList.remove('btn-outline');
    btnAspectLock.classList.add('btn-ghost');
  }
  _updateResolutionLabels(locked);
}
btnAspectLock.addEventListener('click', () => {
  const locked = !cropEditor?.aspectLocked;
  cropEditor?.setAspectLock(locked);
  _updateLockUI(locked);
  if (currentCrop) currentCrop = cropEditor.getCrop();
});

// ── UV scale (tile count) ─────────────────────────────────────────────────────
uvScale.addEventListener('input', (e) => {
  const n = parseInt(e.target.value);
  uvScaleVal.textContent = n;
  if (preview) preview.setGridSize(n);
});

// ── Upload ────────────────────────────────────────────────────────────────────
btnUpload.addEventListener('click', async () => {
  if (!currentCrop) { showToast('Please select an image first', 'warning'); return; }
  const name = uploadNameInput.value.trim();
  if (!name) { showToast('Please enter a name', 'warning'); return; }
  const outSize = parseInt(uploadResolution?.value || '1024');

  btnUpload.disabled = true;
  const origHTML = btnUpload.innerHTML;
  btnUpload.innerHTML = '<span class="loading loading-spinner loading-sm"></span> Uploading...';

  try {
    const canvas     = getCropCanvas(currentCrop, outSize, cropEditor?.aspectLocked ?? true);
    const textureId  = deskMaterialItem?._id || name;
    await uploadSingleImage(textureId, canvas, _deskGetToken());
    showToast('Upload successful!', 'success');
  } catch (err) {
    showToast('Upload failed: ' + err.message, 'error');
  } finally {
    btnUpload.disabled = false;
    btnUpload.innerHTML = origHTML;
  }
});

// ── Keyboard crop control ─────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (!cropEditor?.img) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

  const img      = cropEditor.img;
  const step     = Math.max(1, Math.round(img.width * 0.005));
  const sizeStep = Math.max(1, Math.round(Math.min(img.width, img.height) * 0.01));
  let handled = true;

  switch (e.key) {
    case 'ArrowLeft':  cropEditor.cropX -= step; break;
    case 'ArrowRight': cropEditor.cropX += step; break;
    case 'ArrowUp':    cropEditor.cropY -= step; break;
    case 'ArrowDown':  cropEditor.cropY += step; break;
    case '+': case '=': {
      if (cropEditor.aspectLocked) {
        const maxDim = Math.min(img.width, img.height);
        const newSz = Math.min(maxDim, cropEditor.cropW + sizeStep);
        cropEditor.cropW = newSz; cropEditor.cropH = newSz;
      } else {
        cropEditor.cropW = Math.min(img.width,  cropEditor.cropW + sizeStep);
        cropEditor.cropH = Math.min(img.height, cropEditor.cropH + sizeStep);
      }
      break;
    }
    case '-': case '_': {
      if (cropEditor.aspectLocked) {
        const newSz = Math.max(16, cropEditor.cropW - sizeStep);
        cropEditor.cropW = newSz; cropEditor.cropH = newSz;
      } else {
        cropEditor.cropW = Math.max(16, cropEditor.cropW - sizeStep);
        cropEditor.cropH = Math.max(16, cropEditor.cropH - sizeStep);
      }
      break;
    }
    default: handled = false;
  }

  if (handled) {
    e.preventDefault();
    cropEditor._clampCrop();
    cropEditor._draw();
    currentCrop = cropEditor.getCrop();
    updatePreview();
  }
});

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => cropEditor?.resize());

// ════════════════════════════════════════════════════════════════════════════════
// BOM / Material selection
// ════════════════════════════════════════════════════════════════════════════════

// State
let deskProjectId      = null;
let deskTextureRecord  = null;
let deskMaterialItem   = null;

function _deskGetToken() {
  return sessionStorage.getItem('wp_token') || localStorage.getItem('wp_token') || '';
}

// ── Load project list ─────────────────────────────────────────────────────────
async function loadDeskProjects() {
  const sel = document.getElementById('deskProjectSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Loading —</option>';
  try {
    const res  = await fetch(`${window.__API_BASE__}/api/projects/list?page=1&pageSize=100`,
      { headers: { 'Authorization': `Bearer ${_deskGetToken()}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const items = Array.isArray(json) ? json
      : Array.isArray(json.items)      ? json.items
      : Array.isArray(json.data?.list) ? json.data.list
      : [];
    sel.innerHTML = '<option value="">— Select Project —</option>'
      + items.map(p => `<option value="${escapeHtml(p._id ?? p.id)}">${escapeHtml(p.name)}</option>`).join('');
  } catch (err) {
    sel.innerHTML = `<option value="">Load failed: ${escapeHtml(err.message)}</option>`;
  }
}

// ── BOM panel show/hide helpers ───────────────────────────────────────────────
function _deskShow(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function _deskHide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

document.getElementById('deskProjectSelect')?.addEventListener('change', (e) => {
  deskProjectId     = e.target.value || null;
  deskTextureRecord = null;
  deskMaterialItem  = null;

  try { _deskClearMaterialUI(); } catch (_) {}

  _deskHide('deskBomSelectWrap');
  _deskHide('deskBomInputWrap');
  _deskHide('deskCategoryWrap');
  _deskHide('deskBomError');

  if (!deskProjectId) return;

  // Show BOM manual input immediately
  const inputEl = document.getElementById('deskBomInput');
  if (inputEl) inputEl.value = '';
  _deskShow('deskBomInputWrap');

  // Background: try bom-list API; if it works, upgrade to dropdown
  (async () => {
    try {
      const res = await fetch(
        `${window.__API_BASE__}/api/projects/bom-list?project_id=${encodeURIComponent(deskProjectId)}`,
        { headers: { 'Authorization': `Bearer ${_deskGetToken()}` } }
      );
      if (!res.ok) return;
      const json = await res.json();
      const raw  = json.data ?? json;
      const items = Array.isArray(raw) ? raw
        : Array.isArray(raw?.list)  ? raw.list
        : Array.isArray(raw?.items) ? raw.items
        : (raw?.bom_id !== undefined ? [raw] : []);
      if (!items.length) return;

      const sel = document.getElementById('deskBomSelect');
      if (!sel) return;
      sel.innerHTML = '<option value="">— Select BOM —</option>'
        + items.map(b => `<option value="${escapeHtml(b.bom_id ?? b._id ?? b.id)}">${escapeHtml(b.bomFileName ?? b.bomName ?? b.name ?? b.bom_id)}</option>`).join('');
      _deskHide('deskBomInputWrap');
      _deskShow('deskBomSelectWrap');

      if (items.length === 1) {
        sel.value = items[0].bom_id ?? items[0]._id ?? items[0].id;
        lookupDeskBom(sel.value);
      }
    } catch (_) { /* keep manual input */ }
  })();
});

// BOM dropdown change → auto load categories
document.getElementById('deskBomSelect')?.addEventListener('change', (e) => {
  const bomId = e.target.value;
  if (bomId && deskProjectId) lookupDeskBom(bomId);
});

// BOM lookup via project-parse ──────────────────────────────────────────────
async function lookupDeskBom(bomId) {
  const errEl = document.getElementById('deskBomError');
  const btn   = document.getElementById('deskBomConfirm');
  errEl?.classList.add('hidden');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }

  try {
    const url = `${window.__API_BASE__}/api/texture/project-parse`
      + `?project_id=${encodeURIComponent(deskProjectId)}`
      + `&bom_id=${encodeURIComponent(bomId)}`;
    const res  = await fetch(url, { headers: { 'Authorization': `Bearer ${_deskGetToken()}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.success === false) throw new Error(json.message ?? 'Query failed');
    const record = json.data?.textureRecord;
    if (!record) throw new Error('Unable to retrieve textureRecord');
    deskTextureRecord = record;
    renderDeskCategories(record);
  } catch (err) {
    if (errEl) { errEl.textContent = 'Query failed: ' + err.message; errEl.classList.remove('hidden'); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm'; }
  }
}

document.getElementById('deskBomConfirm')?.addEventListener('click', () => {
  const val = document.getElementById('deskBomInput')?.value.trim();
  if (!val || !deskProjectId) return;
  lookupDeskBom(val);
});
document.getElementById('deskBomInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('deskBomConfirm')?.click();
});

// ── Category accordion (delegates to shared bom-ui.js) ───────────────────────
function renderDeskCategories(record) {
  const wrap = document.getElementById('deskCategoryWrap');
  const list = document.getElementById('deskCategoryList');
  if (!list || !wrap) return;

  _deskClearMaterialUI();
  renderCategoryAccordion(list, record.texture ?? [], selectDeskMaterial);
  wrap.style.display = '';   // show
}

// ── Material select ───────────────────────────────────────────────────────────
function selectDeskMaterial(item) {
  deskMaterialItem = item;
  highlightMaterial(item._id);

  // Show chip
  const chip  = document.getElementById('deskMaterialChip');
  const label = document.getElementById('deskMaterialLabel');
  if (label) label.textContent = item.material || item.material_origin || '—';
  if (chip) chip.style.display = '';  // show

  // Auto-fill upload name
  if (uploadNameInput) uploadNameInput.value = item.material || item.material_origin || '';
}

function _deskClearMaterialUI() {
  deskMaterialItem = null;
  const chip = document.getElementById('deskMaterialChip');
  if (chip) chip.style.display = 'none';
  clearAccordionHighlight();
}

document.getElementById('deskClearMaterial')?.addEventListener('click', () => {
  _deskClearMaterialUI();
  if (uploadNameInput) uploadNameInput.value = '';
});

// ── Init: load projects on page load ─────────────────────────────────────────
loadDeskProjects();

/**
 * app-desktop.js — desktop app logic (3-panel: original | crop | tiled preview)
 */

import { CropEditor }     from './crop-editor.js';
import { PatternPreview } from './preview.js';
import { generateChannels, uploadAllMaps } from './upload.js';
import { showToast }      from './toast.js';

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
const seamlessPanel   = document.getElementById('seamlessPanel');
const enableSeamless  = document.getElementById('enableSeamless');
const seamBlendWidth  = document.getElementById('seamBlendWidth');
const seamBlendWidthVal = document.getElementById('seamBlendWidthVal');
const poissonIter     = document.getElementById('poissonIter');
const poissonIterVal  = document.getElementById('poissonIterVal');

// ── State ─────────────────────────────────────────────────────────────────────
let cropEditor    = null;
let preview       = null;
let currentCrop   = null;
let seamlessParams = { seamBlendWidth: 0.15, iterations: 80 };
let seamlessEnabled = false;
let generatedMaps = null;
let _lastObjUrl   = null;

// ── Modal refs ────────────────────────────────────────────────────────────────
const previewModal        = document.getElementById('previewModal');
const btnPreviewModalClose   = document.getElementById('btnPreviewModalClose');
const btnPreviewModalConfirm = document.getElementById('btnPreviewModalConfirm');
const chkSendEmail        = document.getElementById('chkSendEmail');
const sendEmailLabel      = document.getElementById('sendEmailLabel');

// ── Show email checkbox only if user has email stored ─────────────────────────
(function initEmailCheckbox() {
  try {
    const raw  = sessionStorage.getItem('wp_user') || localStorage.getItem('wp_user');
    const user = raw ? JSON.parse(raw) : null;
    if (user?.email) sendEmailLabel?.classList.remove('hidden');
  } catch {}
})();
function updatePreview() {
  if (!currentCrop?.img || !preview) return;
  preview.update(currentCrop);
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

// ── Load image ────────────────────────────────────────────────────────────────
async function loadImage(file) {
  let img;
  try {
    img = await fileToImage(file);
  } catch {
    showToast('圖片載入失敗，格式可能不支援', 'error');
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
  seamlessPanel.classList.remove('hidden');
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
  else showToast('\u8acb\u62d6\u653e\u5716\u7247\u6a94\u6848', 'error');
});

// ── Seamless controls ──────────────────────────────────────────────────────────────────
function _applySeamlessToPreview() {
  if (!preview || !currentCrop) return;
  preview.seamlessEnabled = seamlessEnabled;
  preview.params = { ...seamlessParams };
  preview.update(currentCrop);
}

enableSeamless.addEventListener('change', () => {
  seamlessEnabled = enableSeamless.checked;
  _applySeamlessToPreview();
});

seamBlendWidth.addEventListener('input', () => {
  const pct = parseInt(seamBlendWidth.value);
  seamBlendWidthVal.textContent = pct + '%';
  seamlessParams.seamBlendWidth = pct / 100;
  if (seamlessEnabled) _applySeamlessToPreview();
});

poissonIter.addEventListener('input', () => {
  const n = parseInt(poissonIter.value);
  poissonIterVal.textContent = n;
  seamlessParams.iterations = n;
  if (seamlessEnabled) _applySeamlessToPreview();
});

// ── Aspect ratio lock ─────────────────────────────────────────────────────────
function _updateResolutionLabels(locked) {
  if (!uploadResolution) return;
  for (const opt of uploadResolution.options) {
    const n = opt.value;
    opt.textContent = locked ? `${n} × ${n}` : `${n} px (最長邊)`;
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
    lockLabel.textContent = '自由';
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
  if (!currentCrop) { showToast('\u8acb\u5148\u9078\u64c7\u5716\u7247', 'warning'); return; }
  const name = uploadNameInput.value.trim();
  if (!name) { showToast('\u8acb\u8f38\u5165\u540d\u7a31', 'warning'); return; }
  const outSize = parseInt(uploadResolution?.value || '1024');
  const params  = seamlessEnabled ? { ...seamlessParams } : null;

  btnUpload.disabled = true;
  const origHTML = btnUpload.innerHTML;
  btnUpload.innerHTML = '<span class="loading loading-spinner loading-sm"></span> \u751f\u6210\u901a\u9053...';

  try {
    generatedMaps = await generateChannels(currentCrop, params, outSize, cropEditor?.aspectLocked ?? true);
    for (const [key, canvas] of Object.entries(generatedMaps)) {
      const el = document.getElementById(`modalCh_${key}`);
      if (!el) continue;
      el.width  = canvas.width;
      el.height = canvas.height;
      el.getContext('2d').drawImage(canvas, 0, 0);
      el.style.width  = '100%';
      el.style.height = 'auto';
    }
    previewModal.showModal();
  } catch (err) {
    showToast('\u901a\u9053\u751f\u6210\u5931\u6557: ' + err.message, 'error');
  } finally {
    btnUpload.disabled = false;
    btnUpload.innerHTML = origHTML;
  }
});

btnPreviewModalClose.addEventListener('click', () => previewModal.close());

btnPreviewModalConfirm.addEventListener('click', async () => {
  const name = uploadNameInput.value.trim();
  if (!generatedMaps) return;
  previewModal.close();

  btnUpload.disabled = true;
  const origHTML = btnUpload.innerHTML;

  const onProgress = (done, total) => {
    btnUpload.innerHTML = `<span class="loading loading-spinner loading-sm"></span> 上傳中... (${done}/${total})`;
  };

  try {
    const result = await uploadAllMaps(name, generatedMaps, onProgress);
    showToast('上傳成功！共 6 個通道', 'success');

    // ── 寄送材質連結 Email ──────────────────────────────────────────────────
    if (chkSendEmail?.checked) {
      try {
        const raw  = sessionStorage.getItem('wp_user') || localStorage.getItem('wp_user');
        const user = raw ? JSON.parse(raw) : null;
        if (user?.email) {
          const maps = {};
          for (const [ch, info] of Object.entries(result.maps)) maps[ch] = info.url;
          const apiBase = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? `${location.protocol}//${location.host}`
            : 'https://webphoto-lidl.onrender.com';
          await fetch(`${apiBase}/send-upload-report`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email: user.email, name, maps })
          });
          showToast('材質連結已寄至 ' + user.email, 'info');
        }
      } catch (mailErr) {
        showToast('寄信失敗: ' + mailErr.message, 'warning');
      }
    }

    generatedMaps = null;
  } catch (err) {
    showToast('上傳失敗: ' + err.message, 'error');
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

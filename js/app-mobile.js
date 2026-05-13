/**
 * app-mobile.js — mobile app logic
 */

import { CropEditor }              from './crop-editor.js';
import { PatternPreview }           from './preview.js';
import { generateChannels, uploadAllMaps } from './upload.js';
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
const uploadResolution = document.getElementById('uploadResolution');
const btnAspectLock    = document.getElementById('btnAspectLock');
const lockIconClosed   = document.getElementById('lockIconClosed');
const lockIconOpen     = document.getElementById('lockIconOpen');
const lockLabel        = document.getElementById('lockLabel');

// ── State ─────────────────────────────────────────────────────────────────────
let cropEditor      = null;
let preview         = null;
let currentCrop     = null;
let generatedMaps   = null;   // { basecolor, roughness, ao, height, metallic, normal } canvases
let cameraStream    = null;


// ── Initialise editors ────────────────────────────────────────────────────────
function initEditors() {
  cropEditor = new CropEditor(cropCanvas, {
    onChange: (crop) => {
      currentCrop = crop;
      preview.updateFast(crop);  // low-res, real-time
    },
    onChangeEnd: (crop) => {
      currentCrop = crop;
      preview.update(crop);      // full quality after drag ends
    },
  });

  preview = new PatternPreview(previewCanvas, { displaySize: 512, gridSize: 3 });

  previewGridSlider.addEventListener('input', (e) => {
    const n = parseInt(e.target.value);
    previewGridVal.textContent = n;
    preview.setGridSize(n);
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

btnShowUpload.addEventListener('click', async () => {
  if (!currentCrop) { showToast('請先展開裁切區域', 'warning'); return; }
  genOverlayLabel.textContent = '生成通道中...';
  genOverlay.classList.remove('hidden');
  try {
    const outSize = parseInt(uploadResolution?.value || '1024');
    generatedMaps = await generateChannels(currentCrop, null, outSize);
    paintPreviewThumbnails(generatedMaps);
    showStep('preview');
  } catch (err) {
    showToast('通道生成失敗: ' + err.message, 'error');
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
  if (!name) { showToast('請輸入名稱', 'warning'); return; }
  if (!currentCrop) { showToast('請先選取裁切範圍', 'warning'); return; }

  if (!generatedMaps) { showToast('請先預覽通道', 'warning'); return; }
  btnConfirmUpload.disabled = true;
  const origHTML = btnConfirmUpload.innerHTML;

  const onProgress = (done, total) => {
    btnConfirmUpload.innerHTML = `<span class="loading loading-spinner loading-sm"></span> 上傳中... (${done}/${total})`;
  };

  try {
    await uploadAllMaps(name, generatedMaps, onProgress);
    closeUploadSheet();
    generatedMaps = null;
    showToast('上傳成功！共 6 個通道', 'success');
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
window.addEventListener('beforeunload', () => stopCamera());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});

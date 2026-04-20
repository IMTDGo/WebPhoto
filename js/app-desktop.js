/**
 * app-desktop.js — desktop app logic (Three.js viewer)
 */

import * as THREE            from 'three';
import { CropEditor }        from './crop-editor.js';
import { PatternPreview }    from './preview.js';
import { generateChannels, uploadAllMaps } from './upload.js';
import { showToast }         from './toast.js';
import { applySeamless, extractCrop, DEFAULT_PARAMS } from './seamless.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const threeCanvas    = document.getElementById('threeCanvas');
const emptyState     = document.getElementById('emptyState');
const cropCanvas     = document.getElementById('cropCanvas');
const imageInfo      = document.getElementById('imageInfo');
const cropPanel      = document.getElementById('cropPanel');
const seamlessPanel  = document.getElementById('seamlessPanel');
const uvPanel        = document.getElementById('uvPanel');
const uploadPanel    = document.getElementById('uploadPanel');
const sizeSlider        = document.getElementById('cropSizeSlider');
const sizeVal           = document.getElementById('cropSizeVal');
const btnUpload      = document.getElementById('btnUpload');
const uploadNameInput = document.getElementById('uploadName');
const enableSeamless = document.getElementById('enableSeamless');
const blendStrength  = document.getElementById('blendStrength');
const blendWidth     = document.getElementById('blendWidth');
const uvScale        = document.getElementById('uvScale');
const uvOffX         = document.getElementById('uvOffX');
const uvOffY         = document.getElementById('uvOffY');

// ── State ─────────────────────────────────────────────────────────────────────
let cropEditor  = null;
let currentCrop = null;
let generatedMaps = null;   // { basecolor, roughness, ... } canvases
let threeTexture = null;
let threeMaterial = null;
const seamlessParams = { ...DEFAULT_PARAMS };
let seamlessEnabled = true;

// ── Three.js setup ────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
camera.position.z = 5;
const mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(3, 3),
  new THREE.MeshBasicMaterial({ color: 0x222233 })
);
scene.add(mesh);

function resizeThree() {
  const parent = threeCanvas.parentElement;
  const w = parent.clientWidth, h = parent.clientHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  camera.left  = -1.5 * aspect;
  camera.right =  1.5 * aspect;
  camera.updateProjectionMatrix();
}

(function animLoop() { requestAnimationFrame(animLoop); renderer.render(scene, camera); })();

// ── Update Three.js texture from current crop ─────────────────────────────────
function updateThreeTexture() {
  if (!currentCrop?.img) return;
  const TILE = 512;
  const src  = extractCrop(currentCrop.img, currentCrop.x, currentCrop.y, currentCrop.size);
  const tex  = seamlessEnabled ? applySeamless(src, TILE, seamlessParams) : src;

  if (threeTexture) threeTexture.dispose();
  threeTexture = new THREE.CanvasTexture(tex);
  threeTexture.wrapS = threeTexture.wrapT = THREE.RepeatWrapping;
  const sc  = parseFloat(uvScale.value);
  const ox  = parseFloat(uvOffX.value);
  const oy  = parseFloat(uvOffY.value);
  threeTexture.repeat.set(sc, sc);
  threeTexture.offset.set(ox, oy);
  threeTexture.needsUpdate = true;

  if (threeMaterial) threeMaterial.dispose();
  threeMaterial = new THREE.MeshBasicMaterial({ map: threeTexture });
  mesh.material = threeMaterial;
}

// ── Load image ────────────────────────────────────────────────────────────────
function loadImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Init editors on first load
      if (!cropEditor) {
        cropEditor = new CropEditor(cropCanvas, {
          onChange: (crop) => {
            currentCrop = crop;
          },
          onChangeEnd: (crop) => {
            currentCrop = crop;
            updateThreeTexture();
          },
        });
      }

      cropEditor.load(img);
      currentCrop = cropEditor.getCrop();
      updateThreeTexture();

      document.getElementById('infoName').textContent = file.name;
      document.getElementById('infoSize').textContent = `${img.width} × ${img.height}`;
      imageInfo.classList.remove('hidden');
      cropPanel.classList.remove('hidden');
      seamlessPanel.classList.remove('hidden');
      uvPanel.classList.remove('hidden');
      uploadPanel.classList.remove('hidden');
      emptyState.classList.add('hidden');
      threeCanvas.classList.remove('hidden');
      resizeThree();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── File input / drop ─────────────────────────────────────────────────────────
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); });

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file?.type.startsWith('image/')) loadImage(file);
  else showToast('請拖放圖片檔案', 'error');
});

// ── Crop size slider (removed — corner handles are the sole resize interaction) ──────

// ── Seamless controls ─────────────────────────────────────────────────────────
enableSeamless.addEventListener('change', (e) => {
  seamlessEnabled = e.target.checked;
  document.getElementById('seamlessControls').style.display = e.target.checked ? '' : 'none';
  updateThreeTexture();
});

blendStrength.addEventListener('input', (e) => {
  seamlessParams.blendStrength = parseFloat(e.target.value);
  document.getElementById('blendStrengthVal').textContent = parseFloat(e.target.value).toFixed(2);
  updateThreeTexture();
});

blendWidth.addEventListener('input', (e) => {
  seamlessParams.blendWidth = parseFloat(e.target.value);
  document.getElementById('blendWidthVal').textContent = parseFloat(e.target.value).toFixed(2);
  updateThreeTexture();
});

// ── UV controls ───────────────────────────────────────────────────────────────
uvScale.addEventListener('input', (e) => {
  document.getElementById('uvScaleVal').textContent = parseFloat(e.target.value).toFixed(2);
  if (threeTexture) { threeTexture.repeat.set(parseFloat(e.target.value), parseFloat(e.target.value)); threeTexture.needsUpdate = true; }
});
uvOffX.addEventListener('input', (e) => {
  document.getElementById('uvOffXVal').textContent = parseFloat(e.target.value).toFixed(2);
  if (threeTexture) { threeTexture.offset.x = parseFloat(e.target.value); threeTexture.needsUpdate = true; }
});
uvOffY.addEventListener('input', (e) => {
  document.getElementById('uvOffYVal').textContent = parseFloat(e.target.value).toFixed(2);
  if (threeTexture) { threeTexture.offset.y = parseFloat(e.target.value); threeTexture.needsUpdate = true; }
});

// ── Upload ────────────────────────────────────────────────────────────────────
const previewModal          = document.getElementById('previewModal');
const btnPreviewModalClose   = document.getElementById('btnPreviewModalClose');
const btnPreviewModalConfirm = document.getElementById('btnPreviewModalConfirm');

btnUpload.addEventListener('click', async () => {
  if (!currentCrop) { showToast('請先選擇圖片', 'warning'); return; }
  const name = uploadNameInput.value.trim();
  if (!name) { showToast('請輸入名稱', 'warning'); return; }

  btnUpload.disabled = true;
  const origHTML = btnUpload.innerHTML;
  btnUpload.innerHTML = '<span class="loading loading-spinner loading-sm"></span> 生成通道...';

  try {
    generatedMaps = await generateChannels(currentCrop, seamlessEnabled ? seamlessParams : null);
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
    showToast('通道生成失敗: ' + err.message, 'error');
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
    await uploadAllMaps(name, generatedMaps, onProgress);
    showToast('上傳成功！共 6 個通道', 'success');
    generatedMaps = null;
  } catch (err) {
    showToast('上傳失敗: ' + err.message, 'error');
  } finally {
    btnUpload.disabled = false;
    btnUpload.innerHTML = origHTML;
  }
});

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => { resizeThree(); cropEditor?.resize(); });
resizeThree();

/**
 * upload.js
 *
 * Two-step pipeline:
 *   1. generateChannels(crop, params, outSize)
 *      → generates 6 PBR canvases via Web Worker (falls back to main thread)
 *   2. uploadAllMaps(name, canvasMap, onProgress)
 *      → uploads all canvases in PARALLEL to Cloudinary
 *
 * Cloudinary folder structure:
 *   {name}/{name}_basecolor.png
 *   {name}/{name}_roughness.png
 *   {name}/{name}_ao.png
 *   {name}/{name}_height.png
 *   {name}/{name}_metallic.png
 *   {name}/{name}_normal.png
 */

import { applySeamless, extractCrop, DEFAULT_PARAMS } from './seamless.js';
import {
  generateRoughnessMap,
  generateAOMap,
  generateHeightMap,
  generateNormalMap,
  canvasFromData,
} from './textureGenerator.js';

// ── Texture upload API ───────────────────────────────────────────────────────
const TEXTURE_UPLOAD_PATH = '/api/texture/upload-texture-images';

// ── Internal helpers (PBR uploadAllMaps pipeline) ────────────────────────────
async function _uploadCanvas(canvas, folder, suffix) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const fd = new FormData();
  fd.append('texure_id', folder);
  fd.append('images[]', blob, `${folder}_${suffix}.png`);
  const resp = await fetch(
    `${window.__API_BASE__ || ''}${TEXTURE_UPLOAD_PATH}`,
    { method: 'POST', body: fd }
  );
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  if (!data.success) throw new Error(data.message ?? '上傳失敗');
  const img = data.data?.images?.[0];
  return { url: img?.url ?? '', public_id: img?.id ?? '' };
}

function _workerResults(workerData, w, h, baseCanvas) {
  const make = (buf) => canvasFromData(new Uint8ClampedArray(buf), w, h);
  return {
    basecolor: baseCanvas,
    roughness: make(workerData.roughness),
    ao:        make(workerData.ao),
    height:    make(workerData.height),
    normal:    make(workerData.normal),
  };
}

function _generateMainThread(imageData, w, h, baseCanvas) {
  return {
    basecolor: baseCanvas,
    roughness: canvasFromData(generateRoughnessMap(imageData, 1.0),    w, h),
    ao:        canvasFromData(generateAOMap(imageData, 1.0),           w, h),
    height:    canvasFromData(generateHeightMap(imageData, 1.0),       w, h),
    normal:    canvasFromData(generateNormalMap(imageData, w, h, 5.0), w, h),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Step 1 — Generate all 6 PBR channels from a crop.
 * Uses Web Worker when available to keep UI responsive.
 *
 * @param {{ img, x, y, size }} crop
 * @param {object|null}  params   — seamless params; null to skip seamless
 * @param {number}       outSize  — output resolution (default 512)
 * @returns {Promise<{ basecolor, roughness, ao, height, metallic, normal }>}
 *          each value is an HTMLCanvasElement
 */
export function generateChannels(crop, params = DEFAULT_PARAMS, outSize = 1024, aspectLocked = true) {
  const srcCanvas = extractCrop(crop.img, crop.x, crop.y, crop.w, crop.h);
  const cropW = srcCanvas.width;
  const cropH = srcCanvas.height;

  // Compute output dimensions
  let outW, outH;
  if (aspectLocked) {
    // Square output — cap at outSize, never upscale
    const side = Math.min(cropW, outSize);
    outW = outH = side;
  } else {
    // Free aspect ratio — apply outSize to longest edge if crop exceeds it
    const longest = Math.max(cropW, cropH);
    if (longest <= outSize) {
      outW = cropW;
      outH = cropH;
    } else {
      const scale = outSize / longest;
      outW = Math.max(1, Math.round(cropW * scale));
      outH = Math.max(1, Math.round(cropH * scale));
    }
  }

  let baseCanvas;
  if (params) {
    baseCanvas = applySeamless(srcCanvas, outW, params);
  } else {
    baseCanvas = document.createElement('canvas');
    baseCanvas.width  = outW;
    baseCanvas.height = outH;
    baseCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, outW, outH);
  }
  const w = baseCanvas.width, h = baseCanvas.height;
  const imageData  = baseCanvas.getContext('2d').getImageData(0, 0, w, h);

  // Copy the buffer before sending — keeps imageData intact for the main-thread fallback
  const bufferCopy = imageData.data.buffer.slice(0);

  return new Promise((resolve) => {
    try {
      const worker = new Worker(new URL('./textureWorker.js', import.meta.url), { type: 'module' });

      // Safety timeout: if Worker hangs or never fires, fall back after 20 s
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(_generateMainThread(imageData, w, h, baseCanvas));
      }, 20000);

      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(_workerResults(data, w, h, baseCanvas));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve(_generateMainThread(imageData, w, h, baseCanvas));
      };
      // Transfer the COPY — original imageData stays usable for fallback
      worker.postMessage({ buffer: bufferCopy, width: w, height: h }, [bufferCopy]);
    } catch (_) {
      resolve(_generateMainThread(imageData, w, h, baseCanvas));
    }
  });
}

/**
 * Step 2 — Upload all pre-generated channel canvases in PARALLEL.
 * Progress callback fires as each upload completes (order is non-deterministic).
 *
 * @param {string}   name       — folder & file prefix
 * @param {object}   canvasMap  — { basecolor, roughness, ao, height, metallic, normal }
 * @param {function} onProgress — (completedCount, total, suffix) optional
 * @returns {Promise<{ ok: boolean, folder: string, maps: object }>}
 */
export async function uploadAllMaps(name, canvasMap, onProgress = null) {
  const entries = Object.entries(canvasMap);
  const total   = entries.length;
  let completed = 0;

  const results = await Promise.all(
    entries.map(async ([suffix, canvas]) => {
      const result = await _uploadCanvas(canvas, name, suffix);
      onProgress?.(++completed, total, suffix);
      return [suffix, result];
    })
  );

  return { ok: true, folder: name, maps: Object.fromEntries(results) };
}

// ── Single-image helpers (no PBR channel generation) ─────────────────────────

/**
 * Extract & scale the crop to a canvas, respecting aspect lock.
 */
export function getCropCanvas(crop, outSize = 1024, aspectLocked = true) {
  const srcCanvas = extractCrop(crop.img, crop.x, crop.y, crop.w, crop.h);
  const cropW = srcCanvas.width;
  const cropH = srcCanvas.height;
  let outW, outH;
  if (aspectLocked) {
    const side = Math.min(cropW, outSize);
    outW = outH = side;
  } else {
    const longest = Math.max(cropW, cropH);
    if (longest <= outSize) { outW = cropW; outH = cropH; }
    else {
      const scale = outSize / longest;
      outW = Math.max(1, Math.round(cropW * scale));
      outH = Math.max(1, Math.round(cropH * scale));
    }
  }
  const cvs = document.createElement('canvas');
  cvs.width  = outW;
  cvs.height = outH;
  cvs.getContext('2d').drawImage(srcCanvas, 0, 0, outW, outH);
  return cvs;
}

/**
 * Encode canvas as JPEG, iteratively reducing quality until the blob fits within
 * maxBytes. Starts at startQuality and steps down by 0.05 each iteration.
 * @param {HTMLCanvasElement} canvas
 * @param {number} maxBytes       - size ceiling in bytes (default 1 MB)
 * @param {number} startQuality   - initial JPEG quality 0–1 (default 0.92)
 * @returns {Promise<Blob>}
 */
async function _compressJpeg(canvas, maxBytes = 1024 * 1024, startQuality = 0.92) {
  const toBlob = (q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
  let quality = startQuality;
  let blob = await toBlob(quality);
  while (blob.size > maxBytes && quality > 0.20) {
    quality = Math.round((quality - 0.05) * 100) / 100;
    blob = await toBlob(quality);
  }
  return blob;
}

/**
 * Upload a single texture photo to /api/texture/upload-texture-images.
 * @param {string}           textureId  - texture record _id
 * @param {HTMLCanvasElement} canvas
 * @param {string}           token      - bearer auth token
 * @param {function}         [onProgress]
 */
export async function uploadSingleImage(textureId, canvas, token, onProgress = null) {
  const blob  = await _compressJpeg(canvas);
  const safeId = String(textureId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');

  const fd = new FormData();
  fd.append('texture_id', textureId);
  fd.append('images',     blob, `${safeId}_photo.jpg`);

  console.log('[upload] texture_id =', textureId, '| blob', blob.size, 'bytes | token:', token ? token.slice(0,12) + '…' : '(empty)');

  const resp = await fetch(
    `${window.__API_BASE__ || ''}${TEXTURE_UPLOAD_PATH}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd,
    }
  );

  let text = '';
  try { text = await resp.text(); } catch (_) { text = '(empty)'; }

  if (!resp.ok) {
    console.error('[upload] server error', resp.status, text);
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  let data;
  try { data = JSON.parse(text); } catch (_) {
    throw new Error(`伺服器回傳非 JSON: ${text.slice(0, 200)}`);
  }

  if (!data.success) throw new Error(data.message ?? '上傳失敗');
  onProgress?.(1, 1);
  return { ok: true, data: data.data };
}



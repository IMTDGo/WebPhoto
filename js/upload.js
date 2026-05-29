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

const CLOUDINARY_CLOUD_NAME    = 'dnxqob2cu';
const CLOUDINARY_UPLOAD_PRESET = 'WebTexureUpload';
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

// ── Internal helpers ──────────────────────────────────────────────────────────

function getApiBase() {
  return (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? `${location.protocol}//${location.host}`
    : 'https://webphoto-lidl.onrender.com';
}

async function _encodeBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`Failed to encode ${mimeType}`));
    }, mimeType, quality);
  });
}

async function _toSizedBlob(canvas, maxBytes = MAX_UPLOAD_BYTES) {
  let work = canvas;

  for (let pass = 0; pass < 5; pass++) {
    for (const q of [0.92, 0.86, 0.8, 0.74, 0.68, 0.62]) {
      const webp = await _encodeBlob(work, 'image/webp', q).catch(() => null);
      if (webp && webp.size <= maxBytes) return { blob: webp, mime: 'image/webp', ext: 'webp' };
    }
    for (const q of [0.9, 0.82, 0.74, 0.66, 0.58]) {
      const jpg = await _encodeBlob(work, 'image/jpeg', q).catch(() => null);
      if (jpg && jpg.size <= maxBytes) return { blob: jpg, mime: 'image/jpeg', ext: 'jpg' };
    }

    const next = document.createElement('canvas');
    next.width = Math.max(256, Math.round(work.width * 0.85));
    next.height = Math.max(256, Math.round(work.height * 0.85));
    next.getContext('2d').drawImage(work, 0, 0, next.width, next.height);
    work = next;
  }

  // Last resort: lowest-quality JPEG even if slightly above target
  const fallback = await _encodeBlob(work, 'image/jpeg', 0.5);
  if (fallback.size > maxBytes) {
    throw new Error('Unable to compress image under 3MB');
  }
  return { blob: fallback, mime: 'image/jpeg', ext: 'jpg' };
}

async function _uploadCanvas(canvas, folder, suffix) {
  const encoded = await _toSizedBlob(canvas, MAX_UPLOAD_BYTES);
  const fd = new FormData();
  fd.append('file', encoded.blob, `${folder}_${suffix}.${encoded.ext}`);  // explicit filename fixes Cloudinary naming
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('folder', folder);
  fd.append('public_id', `${folder}_${suffix}`);
  const resp = await fetch(CLOUDINARY_URL, { method: 'POST', body: fd });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return { url: data.secure_url, public_id: data.public_id, bytes: data.bytes || encoded.blob.size };
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
    baseCanvas = applySeamless(srcCanvas, outW, outH, params);
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
 * Check whether the current user is allowed to upload right now.
 * Server enforces:
 * - max 200 unique uploader accounts per day
 * - max 3 uploads per user per day (except exempt test account)
 */
export async function checkUploadQuota(username) {
  const resp = await fetch(`${getApiBase()}/upload-quota/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: String(username || '').trim() })
  });
  let data = null;
  try { data = await resp.json(); } catch {}
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.message || 'Upload quota check failed');
  }
  return data;
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



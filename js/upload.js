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
  generateMetallicMap,
  generateNormalMap,
  canvasFromData,
} from './textureGenerator.js';

const CLOUDINARY_CLOUD_NAME    = 'dnxqob2cu';
const CLOUDINARY_UPLOAD_PRESET = 'WebTexureUpload';
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _uploadCanvas(canvas, publicId) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const fd = new FormData();
  fd.append('file', blob);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('public_id', publicId);
  const resp = await fetch(CLOUDINARY_URL, { method: 'POST', body: fd });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return { url: data.secure_url, public_id: data.public_id };
}

function _workerResults(workerData, w, h, baseCanvas) {
  const make = (buf) => canvasFromData(new Uint8ClampedArray(buf), w, h);
  return {
    basecolor: baseCanvas,
    roughness: make(workerData.roughness),
    ao:        make(workerData.ao),
    height:    make(workerData.height),
    metallic:  make(workerData.metallic),
    normal:    make(workerData.normal),
  };
}

function _generateMainThread(imageData, w, h, baseCanvas) {
  return {
    basecolor: baseCanvas,
    roughness: canvasFromData(generateRoughnessMap(imageData, 1.0),        w, h),
    ao:        canvasFromData(generateAOMap(imageData, 1.0),               w, h),
    height:    canvasFromData(generateHeightMap(imageData, 1.0),           w, h),
    metallic:  canvasFromData(generateMetallicMap(imageData, 0.8),         w, h),
    normal:    canvasFromData(generateNormalMap(imageData, w, h, 5.0),     w, h),
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
export function generateChannels(crop, params = DEFAULT_PARAMS, outSize = 512) {
  const srcCanvas  = extractCrop(crop.img, crop.x, crop.y, crop.size);
  const baseCanvas = params ? applySeamless(srcCanvas, outSize, params) : srcCanvas;
  const w = baseCanvas.width, h = baseCanvas.height;
  const imageData  = baseCanvas.getContext('2d').getImageData(0, 0, w, h);

  return new Promise((resolve) => {
    try {
      const worker = new Worker(new URL('./textureWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        worker.terminate();
        resolve(_workerResults(data, w, h, baseCanvas));
      };
      worker.onerror = () => {
        worker.terminate();
        resolve(_generateMainThread(imageData, w, h, baseCanvas));
      };
      // Transfer buffer (zero-copy) — imageData is no longer needed on main thread
      worker.postMessage({ buffer: imageData.data.buffer, width: w, height: h }, [imageData.data.buffer]);
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
      const result = await _uploadCanvas(canvas, `${name}/${name}_${suffix}`);
      onProgress?.(++completed, total, suffix);
      return [suffix, result];
    })
  );

  return { ok: true, folder: name, maps: Object.fromEntries(results) };
}



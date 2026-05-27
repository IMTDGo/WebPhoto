/**
 * upload.js
 */

import { extractCrop } from './seamless.js';

// ── Texture upload API ───────────────────────────────────────────────────────
const TEXTURE_UPLOAD_PATH = '/api/texture/upload-texture-images';

// ── File helpers (shared by desktop and mobile) ──────────────────────────────

export function _isTiff(file) {
  return /\.tiff?$/i.test(file.name) || file.type === 'image/tiff' || file.type === 'image/x-tiff';
}

export async function fileToImage(file) {
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

// ── Public API ────────────────────────────────────────────────────────────────

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
    throw new Error(`Server returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!data.success) throw new Error(data.message ?? 'Upload failed');
  onProgress?.(1, 1);
  return { ok: true, data: data.data };
}



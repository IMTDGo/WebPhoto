/**
 * upload.js
 *
 * Shared upload helper. Applies seamless blending to the cropped region
 * and uploads it directly to Cloudinary (unsigned preset).
 */

import { applySeamless, extractCrop, DEFAULT_PARAMS } from './seamless.js';

const CLOUDINARY_CLOUD_NAME = 'dnuf3vfm5';
const CLOUDINARY_UPLOAD_PRESET = 'TexUpload';
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

/**
 * @param {{ img, x, y, size }} crop
 * @param {string} name        — user-provided filename (without extension)
 * @param {object} params      — seamless params; pass null to skip seamless
 * @param {number} [outSize]   — output PNG resolution (default 512)
 * @returns {Promise<{ok: boolean, url: string, public_id: string}>}
 */
export async function uploadCrop(crop, name, params = DEFAULT_PARAMS, outSize = 512) {
  const { img, x, y, size } = crop;

  const srcCanvas = extractCrop(img, x, y, size);
  const texCanvas = params ? applySeamless(srcCanvas, outSize, params) : srcCanvas;

  const blob = await new Promise((resolve) => texCanvas.toBlob(resolve, 'image/png'));

  const formData = new FormData();
  formData.append('file', blob, name + '.png');
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('public_id', name);

  const resp = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return { ok: true, url: data.secure_url, public_id: data.public_id };
}

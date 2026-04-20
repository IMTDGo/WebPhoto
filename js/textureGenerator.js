/**
 * textureGenerator.js
 *
 * Pure-canvas multi-channel texture generation (no THREE.js dependency).
 * All functions take ImageData / Uint8ClampedArray and return Uint8ClampedArray.
 * Use canvasFromData() to convert the result to an HTMLCanvasElement for upload.
 */

/** Roughness: bright & desaturated areas → low roughness, dark & saturated → high */
export function generateRoughnessMap(imageData, intensity = 1.0) {
  const data = imageData.data;
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const sat = Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 1] - data[i + 2]);
    const r   = Math.min(255, (255 - lum * 0.5 + sat * 0.3) * intensity);
    result[i] = result[i + 1] = result[i + 2] = r;
    result[i + 3] = 255;
  }
  return result;
}

/** AO: local neighbourhood average vs. centre brightness */
export function generateAOMap(imageData, intensity = 1.0) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const result = new Uint8ClampedArray(data.length);
  const radius = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx  = Math.min(Math.max(x + dx, 0), w - 1);
          const ny  = Math.min(Math.max(y + dy, 0), h - 1);
          const idx = (ny * w + nx) * 4;
          sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          count++;
        }
      }
      const avg      = sum / count;
      const idx      = (y * w + x) * 4;
      const centerLum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const ao       = 255 - (avg - centerLum) * intensity * 2;
      result[idx] = result[idx + 1] = result[idx + 2] = Math.max(0, Math.min(255, ao));
      result[idx + 3] = 255;
    }
  }
  return result;
}

/** Height: luminance → greyscale displacement */
export function generateHeightMap(imageData, intensity = 1.0) {
  const data = imageData.data;
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const val = Math.min(255, lum * intensity);
    result[i] = result[i + 1] = result[i + 2] = val;
    result[i + 3] = 255;
  }
  return result;
}

/** Metallic: bright & desaturated pixels → white, rest → black */
export function generateMetallicMap(imageData, threshold = 0.8) {
  const data = imageData.data;
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (r + g + b) / 3;
    const val = (lum > threshold && sat < 0.2) ? 255 : 0;
    result[i] = result[i + 1] = result[i + 2] = val;
    result[i + 3] = 255;
  }
  return result;
}

/**
 * Normal map using Sobel operator directly on base-color luminance.
 * Better quality than central differences on a pre-computed height channel.
 * @param {ImageData|{data:Uint8ClampedArray}} imageData  — base color ImageData
 * @param {number} width
 * @param {number} height
 * @param {number} strength — default 5.0
 */
export function generateNormalMap(imageData, width, height, strength = 5.0) {
  const data = imageData.data;
  // Build luminance float array from colour data
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const b = i * 4;
    lum[i] = (data[b] + data[b + 1] + data[b + 2]) / 765.0;
  }
  const clampX = (x) => Math.max(0, Math.min(width  - 1, x));
  const clampY = (y) => Math.max(0, Math.min(height - 1, y));
  const result = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = lum[clampY(y - 1) * width + clampX(x - 1)];
      const t  = lum[clampY(y - 1) * width + x];
      const tr = lum[clampY(y - 1) * width + clampX(x + 1)];
      const l  = lum[y            * width + clampX(x - 1)];
      const r  = lum[y            * width + clampX(x + 1)];
      const bl = lum[clampY(y + 1) * width + clampX(x - 1)];
      const b  = lum[clampY(y + 1) * width + x];
      const br = lum[clampY(y + 1) * width + clampX(x + 1)];
      // Sobel X: [-1,0,1; -2,0,2; -1,0,1]   Sobel Y: [1,2,1; 0,0,0; -1,-2,-1]
      const gx = (-tl + tr - 2 * l + 2 * r - bl + br) * strength;
      const gy = ( tl + 2 * t + tr - bl - 2 * b - br) * strength;
      const nx = -gx, ny = -gy, nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * width + x) * 4;
      result[idx]     = ((nx / len) * 0.5 + 0.5) * 255;
      result[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      result[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      result[idx + 3] = 255;
    }
  }
  return result;
}

/**
 * Convert a Uint8ClampedArray (RGBA) to an HTMLCanvasElement.
 */
export function canvasFromData(data, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  return canvas;
}

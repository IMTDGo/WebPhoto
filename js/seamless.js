/**
 * seamless.js — JS port of the seamless-tiling algorithm from uv-editor.js
 * Shared between mobile and desktop.
 */

export const DEFAULT_PARAMS = {
  offsetX:       0.5,
  offsetY:       0.5,
  blendStrength: 1.0,
  blendWidth:    0.15,
};

function smoothEdge(x, w) {
  const a = Math.max(0, Math.min(1, x / w));
  const b = Math.max(0, Math.min(1, (1 - x) / w));
  return a * (3 - 2 * a) * (b * (3 - 2 * b));
}

function fract(v) { return v - Math.floor(v); }

function sampleBilinear(pixels, W, H, u, v) {
  const px = fract(u) * W;
  const py = fract(v) * H;
  const x0 = Math.floor(px) % W;
  const y0 = Math.floor(py) % H;
  const x1 = (x0 + 1) % W;
  const y1 = (y0 + 1) % H;
  const fx = px - Math.floor(px);
  const fy = py - Math.floor(py);

  function g(x, y) {
    const i = (y * W + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  }

  const c00 = g(x0, y0), c10 = g(x1, y0);
  const c01 = g(x0, y1), c11 = g(x1, y1);
  return [
    c00[0] * (1 - fx) * (1 - fy) + c10[0] * fx * (1 - fy) + c01[0] * (1 - fx) * fy + c11[0] * fx * fy,
    c00[1] * (1 - fx) * (1 - fy) + c10[1] * fx * (1 - fy) + c01[1] * (1 - fx) * fy + c11[1] * fx * fy,
    c00[2] * (1 - fx) * (1 - fy) + c10[2] * fx * (1 - fy) + c01[2] * (1 - fx) * fy + c11[2] * fx * fy,
    c00[3] * (1 - fx) * (1 - fy) + c10[3] * fx * (1 - fy) + c01[3] * (1 - fx) * fy + c11[3] * fx * fy,
  ];
}

function lerp4(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

/**
 * Apply seamless blending to a source canvas.
 *
 * @param {HTMLCanvasElement} srcCanvas  — square-ish source image canvas
 * @param {number}            outSize    — output canvas resolution (pixels)
 * @param {object}            params     — seamless parameters
 * @returns {HTMLCanvasElement}
 */
export function applySeamless(srcCanvas, outSize, params = DEFAULT_PARAMS) {
  const W = srcCanvas.width, H = srcCanvas.height;
  const srcCtx = srcCanvas.getContext('2d');
  const pixels = srcCtx.getImageData(0, 0, W, H).data;

  const out = document.createElement('canvas');
  out.width = outSize;
  out.height = outSize;
  const outCtx = out.getContext('2d');
  const outData = outCtx.createImageData(outSize, outSize);
  const op = outData.data;

  const { offsetX: offX, offsetY: offY, blendStrength: strength, blendWidth: blendW } = params;

  for (let py = 0; py < outSize; py++) {
    for (let px = 0; px < outSize; px++) {
      const u = px / outSize;
      const v = py / outSize;
      const ou = fract(u + offX);
      const ov = fract(v + offY);

      const c1 = sampleBilinear(pixels, W, H, ou,              ov);
      const c2 = sampleBilinear(pixels, W, H, fract(ou + 0.5), ov);
      const c3 = sampleBilinear(pixels, W, H, ou,              fract(ov + 0.5));
      const c4 = sampleBilinear(pixels, W, H, fract(ou + 0.5), fract(ov + 0.5));

      const eX = smoothEdge(ou, blendW);
      const eY = smoothEdge(ov, blendW);
      const f  = strength;

      const mx1 = lerp4(c2, c1, eX * f + (1 - f));
      const mx2 = lerp4(c4, c3, eX * f + (1 - f));
      let   fin = lerp4(mx2, mx1, eY * f + (1 - f));

      const center = (1 - eX) * (1 - eY) * blendW * 2.0;
      fin = lerp4(fin, c4, center * f * 0.3);

      const i = (py * outSize + px) * 4;
      op[i]     = Math.round(Math.max(0, Math.min(255, fin[0])));
      op[i + 1] = Math.round(Math.max(0, Math.min(255, fin[1])));
      op[i + 2] = Math.round(Math.max(0, Math.min(255, fin[2])));
      op[i + 3] = Math.round(Math.max(0, Math.min(255, fin[3])));
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return out;
}

/**
 * Extract a cropped region from a source image into a new canvas.
 *
 * @param {HTMLImageElement} img
 * @param {number} x   crop origin X in image pixels
 * @param {number} y   crop origin Y in image pixels
 * @param {number} size square size in image pixels
 * @returns {HTMLCanvasElement}
 */
export function extractCrop(img, x, y, size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.getContext('2d').drawImage(img, x, y, size, size, 0, 0, size, size);
  return c;
}

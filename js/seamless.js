/**
 * seamless.js — Two-pass Poisson seamless-tiling algorithm.
 * Shared between mobile and desktop.
 *
 * Pass 1 — Edge Blending (makeEdgeBlended):
 *   Each pixel inside the seam band on each edge is lerped with the pixel on
 *   the opposite edge using smoothstep, forcing pixel-level continuity at all
 *   four tile borders.  Parameter: seamBlendWidth (fraction of image size).
 *
 * Pass 2 — Poisson Smooth (poissonSmooth):
 *   A Gauss-Seidel solver runs on the blended image, preserving original
 *   gradients (texture detail) while diffusing the transition zone smoothly.
 *   DC offset is corrected to match source mean brightness.
 *   Parameter: iterations (Gauss-Seidel iteration count).
 */

export const DEFAULT_PARAMS = {
  seamBlendWidth: 0.15,   // fraction of image size, 0.03–0.40
  iterations:     80,
};

function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/**
 * Pass 1 — Edge Blending
 *
 * @param {Uint8ClampedArray} px   — source RGBA pixel data
 * @param {number}            W    — image width
 * @param {number}            H    — image height
 * @param {number}            pct  — seam band as fraction of image size (0–0.4)
 * @returns {Float32Array}         — RGBA data with forced boundary continuity
 */
function makeEdgeBlended(px, W, H, pct) {
  const buf = new Float32Array(px.length);
  for (let i = 0; i < px.length; i++) buf[i] = px[i];

  const bx = Math.max(1, Math.round(W * pct));
  const by = Math.max(1, Math.round(H * pct));

  // Left ↔ Right
  for (let y = 0; y < H; y++) {
    for (let d = 0; d < bx; d++) {
      const t  = smoothstep(1 - d / bx);
      const li = (y * W + d) * 4;
      const ri = (y * W + (W - 1 - d)) * 4;
      for (let c = 0; c < 3; c++) {
        buf[li + c] = px[li + c] * (1 - t) + px[ri + c] * t;
        buf[ri + c] = px[ri + c] * (1 - t) + px[li + c] * t;
      }
    }
  }

  // Top ↔ Bottom (operates on buf so corners get both passes)
  for (let x = 0; x < W; x++) {
    for (let d = 0; d < by; d++) {
      const t  = smoothstep(1 - d / by);
      const ti = (d * W + x) * 4;
      const bi = ((H - 1 - d) * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const tv = buf[ti + c], bv = buf[bi + c];
        buf[ti + c] = tv * (1 - t) + bv * t;
        buf[bi + c] = bv * (1 - t) + tv * t;
      }
    }
  }

  return buf;
}

/**
 * Pass 2 — Poisson Smooth (Gauss-Seidel)
 *
 * Solves ∇²u = div(∇src) with toroidal boundary conditions.
 *
 * @param {Float32Array}      px    — RGBA pixel data (output of makeEdgeBlended)
 * @param {number}            W     — image width
 * @param {number}            H     — image height
 * @param {number}            iters — Gauss-Seidel iterations
 * @returns {Uint8ClampedArray}     — final RGBA seamless image
 */
function poissonSmooth(px, W, H, iters) {
  const N = W * H;

  function idx(x, y) { return ((y + H) % H) * W + ((x + W) % W); }

  // Build RHS = divergence of gradient field (toroidal neighbours)
  const rhs = new Float32Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      for (let c = 0; c < 3; c++) {
        const v = px[i * 4 + c];
        rhs[i * 3 + c] =
          (px[idx(x + 1, y) * 4 + c] - v) - (v - px[idx(x - 1, y) * 4 + c]) +
          (px[idx(x, y + 1) * 4 + c] - v) - (v - px[idx(x, y - 1) * 4 + c]);
      }
    }
  }

  // Gauss-Seidel solve: u_i = (sum of neighbours − rhs_i) / 4
  const u = new Float32Array(N * 3);
  for (let i = 0; i < N; i++)
    for (let c = 0; c < 3; c++) u[i * 3 + c] = px[i * 4 + c];

  for (let iter = 0; iter < iters; iter++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i  = idx(x, y);
        const ir = idx(x + 1, y), il = idx(x - 1, y);
        const id = idx(x, y + 1), iu = idx(x, y - 1);
        for (let c = 0; c < 3; c++) {
          u[i * 3 + c] = (
            u[ir * 3 + c] + u[il * 3 + c] +
            u[id * 3 + c] + u[iu * 3 + c] -
            rhs[i * 3 + c]
          ) * 0.25;
        }
      }
    }
  }

  // DC correction: shift solved image so mean matches source
  const ms = [0, 0, 0], mu = [0, 0, 0];
  for (let i = 0; i < N; i++)
    for (let c = 0; c < 3; c++) { ms[c] += px[i * 4 + c]; mu[c] += u[i * 3 + c]; }
  for (let c = 0; c < 3; c++) { ms[c] /= N; mu[c] /= N; }

  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++)
      out[i * 4 + c] = Math.max(0, Math.min(255,
        Math.round(u[i * 3 + c] + (ms[c] - mu[c]))
      ));
    out[i * 4 + 3] = px[i * 4 + 3]; // preserve alpha
  }
  return out;
}

/**
 * Apply two-pass Poisson seamless blending to a source canvas.
 *
 * @param {HTMLCanvasElement} srcCanvas  — source image canvas
 * @param {number}            outSize    — output canvas resolution (pixels)
 * @param {object}            params     — { seamBlendWidth, iterations }
 * @returns {HTMLCanvasElement}
 */
export function applySeamless(srcCanvas, outSize, params = DEFAULT_PARAMS) {
  const W = srcCanvas.width, H = srcCanvas.height;
  const { seamBlendWidth, iterations } = params;

  const srcPx = srcCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const blended = makeEdgeBlended(srcPx, W, H, seamBlendWidth);
  const result  = poissonSmooth(blended, W, H, iterations);

  const mid = document.createElement('canvas');
  mid.width = W; mid.height = H;
  const midCtx = mid.getContext('2d');
  const imgData = midCtx.createImageData(W, H);
  imgData.data.set(result);
  midCtx.putImageData(imgData, 0, 0);

  const out = document.createElement('canvas');
  out.width = outSize; out.height = outSize;
  out.getContext('2d').drawImage(mid, 0, 0, outSize, outSize);
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

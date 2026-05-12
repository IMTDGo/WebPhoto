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
// Maximum pixel dimension used for the Poisson solve.
// Crops larger than this are downscaled before solving to avoid O(n²) cost.
const MAX_SOLVE = 512;

function _prepSolveCanvas(srcCanvas) {
  const W = srcCanvas.width, H = srcCanvas.height;
  if (W <= MAX_SOLVE && H <= MAX_SOLVE) return srcCanvas;
  const s  = MAX_SOLVE / Math.max(W, H);
  const sw = Math.round(W * s), sh = Math.round(H * s);
  const c  = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(srcCanvas, 0, 0, sw, sh);
  return c;
}

export function applySeamless(srcCanvas, outSize, params = DEFAULT_PARAMS) {
  const { seamBlendWidth, iterations } = params;

  const solve  = _prepSolveCanvas(srcCanvas);
  const sW = solve.width, sH = solve.height;
  const srcPx  = solve.getContext('2d').getImageData(0, 0, sW, sH).data;
  const blended = makeEdgeBlended(srcPx, sW, sH, seamBlendWidth);
  const result  = poissonSmooth(blended, sW, sH, iterations);

  const mid = document.createElement('canvas');
  mid.width = sW; mid.height = sH;
  const imgData = mid.getContext('2d').createImageData(sW, sH);
  imgData.data.set(result);
  mid.getContext('2d').putImageData(imgData, 0, 0);

  const out = document.createElement('canvas');
  out.width = outSize; out.height = outSize;
  out.getContext('2d').drawImage(mid, 0, 0, outSize, outSize);
  return out;
}

/**
 * Fast sync function: edge-blend pass only (no Poisson).
 * Suitable for real-time drag feedback — completes in <1ms on small tiles.
 *
 * @param {HTMLCanvasElement} srcCanvas
 * @param {number}            outSize
 * @param {object}            params
 * @returns {HTMLCanvasElement}
 */
export function applyEdgeBlendOnly(srcCanvas, outSize, params = DEFAULT_PARAMS) {
  const solve = _prepSolveCanvas(srcCanvas);
  const sW = solve.width, sH = solve.height;
  const srcPx  = solve.getContext('2d').getImageData(0, 0, sW, sH).data;
  const blended = makeEdgeBlended(srcPx, sW, sH, params.seamBlendWidth);

  const mid = document.createElement('canvas');
  mid.width = sW; mid.height = sH;
  const imgData = mid.getContext('2d').createImageData(sW, sH);
  for (let i = 0; i < blended.length; i++)
    imgData.data[i] = Math.max(0, Math.min(255, Math.round(blended[i])));
  mid.getContext('2d').putImageData(imgData, 0, 0);

  const out = document.createElement('canvas');
  out.width = outSize; out.height = outSize;
  out.getContext('2d').drawImage(mid, 0, 0, outSize, outSize);
  return out;
}

// ── Async Poisson via Web Worker ──────────────────────────────────────────────

let   _worker   = null;
let   _latestId = 0;
const _pending  = new Map(); // id → { resolve, outSize, sW, sH }

function _ensureWorker() {
  if (_worker) return _worker;
  _worker = new Worker(new URL('./seamlessWorker.js', import.meta.url));
  _worker.addEventListener('message', ({ data: { id, result } }) => {
    const entry = _pending.get(id);
    _pending.delete(id);
    if (!entry) return; // stale / superseded

    const { resolve, outSize, sW, sH } = entry;
    const mid = document.createElement('canvas');
    mid.width = sW; mid.height = sH;
    const imgData = mid.getContext('2d').createImageData(sW, sH);
    imgData.data.set(new Uint8ClampedArray(result));
    mid.getContext('2d').putImageData(imgData, 0, 0);

    const out = document.createElement('canvas');
    out.width = outSize; out.height = outSize;
    out.getContext('2d').drawImage(mid, 0, 0, outSize, outSize);
    resolve(out);
  });
  return _worker;
}

/**
 * Async version — runs the Poisson solve in a Web Worker.
 * Returns Promise<HTMLCanvasElement|null>.
 * If a newer call arrives before this one completes, resolves with null.
 *
 * @param {HTMLCanvasElement} srcCanvas
 * @param {number}            outSize
 * @param {object}            params
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export function applySeamlessAsync(srcCanvas, outSize, params = DEFAULT_PARAMS) {
  const { seamBlendWidth, iterations } = params;

  // Downscale on the main thread (canvas API not available in worker)
  const solve = _prepSolveCanvas(srcCanvas);
  const sW = solve.width, sH = solve.height;
  const srcPx = solve.getContext('2d').getImageData(0, 0, sW, sH).data;

  // Cancel all pending — only the latest result matters
  for (const [pid, entry] of _pending) {
    _pending.delete(pid);
    entry.resolve(null);
  }

  const id      = ++_latestId;
  const pixBuf  = new Uint8ClampedArray(srcPx).buffer; // copy for transfer

  return new Promise((resolve) => {
    _pending.set(id, { resolve, outSize, sW, sH });
    _ensureWorker().postMessage(
      { id, pixels: pixBuf, W: sW, H: sH, seamBlendWidth, iterations },
      [pixBuf]
    );
  });
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

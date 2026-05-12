/**
 * seamless.js — Poisson Image Editing based seamless-tiling algorithm.
 * Shared between mobile and desktop.
 *
 * Parameters:
 *   offsetX / offsetY   — toroidal shift applied before the solve (0–1).
 *                         0.5 / 0.5 centres the original seam edges.
 *   blendStrength       — lerp weight between the original shifted image
 *                         and the full Poisson result (0 = no effect, 1 = full).
 *   blendWidth          — controls Gauss-Seidel iteration count (quality).
 *                         Range 0.01–0.49 maps to ~4–196 iterations.
 *                         Default 0.15 → 60 iterations (good balance).
 */

export const DEFAULT_PARAMS = {
  offsetX:       0.5,
  offsetY:       0.5,
  blendStrength: 1.0,
  blendWidth:    0.15,
};

/**
 * Poisson seamless tiling via Gauss-Seidel relaxation.
 *
 * Algorithm:
 *  1. Compute the divergence of the gradient field of the source image
 *     with toroidal (wrap-around) boundary conditions (RHS of ∇²u = div(∇src)).
 *  2. Solve ∇²u = rhs using Gauss-Seidel iteration. The solution u preserves
 *     all local gradients while removing global DC discontinuities at tile edges.
 *  3. Correct the DC offset so mean brightness matches the source.
 *
 * @param {Uint8ClampedArray} px    — RGBA pixel data (source)
 * @param {number}            W     — image width
 * @param {number}            H     — image height
 * @param {number}            iters — Gauss-Seidel iterations
 * @returns {Uint8ClampedArray}     — RGBA pixel data (seamless result)
 */
function poissonSeamless(px, W, H, iters) {
  const N = W * H;

  function idx(x, y) { return ((y + H) % H) * W + ((x + W) % W); }
  function getC(x, y, c) { return px[idx(x, y) * 4 + c]; }

  // Step 1: build RHS = divergence of source gradient (toroidal)
  const rhs = new Float32Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      for (let c = 0; c < 3; c++) {
        const v = getC(x, y, c);
        rhs[i * 3 + c] =
          (getC(x + 1, y, c) - v) - (v - getC(x - 1, y, c)) +
          (getC(x, y + 1, c) - v) - (v - getC(x, y - 1, c));
      }
    }
  }

  // Step 2: Gauss-Seidel solve ∇²u = rhs, initialised with source values
  const u = new Float32Array(N * 3);
  for (let i = 0; i < N; i++)
    for (let c = 0; c < 3; c++)
      u[i * 3 + c] = px[i * 4 + c];

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

  // Step 3: correct DC offset to match source mean
  const meanSrc = [0, 0, 0], meanU = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) {
      meanSrc[c] += px[i * 4 + c];
      meanU[c]   += u[i * 3 + c];
    }
  }
  for (let c = 0; c < 3; c++) { meanSrc[c] /= N; meanU[c] /= N; }

  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.max(0, Math.min(255,
        Math.round(u[i * 3 + c] + (meanSrc[c] - meanU[c]))
      ));
    }
    out[i * 4 + 3] = px[i * 4 + 3]; // preserve alpha
  }
  return out;
}

/**
 * Apply Poisson seamless blending to a source canvas.
 *
 * @param {HTMLCanvasElement} srcCanvas  — source image canvas
 * @param {number}            outSize    — output canvas resolution (pixels)
 * @param {object}            params     — seamless parameters
 * @returns {HTMLCanvasElement}
 */
export function applySeamless(srcCanvas, outSize, params = DEFAULT_PARAMS) {
  const W = srcCanvas.width, H = srcCanvas.height;
  const { offsetX: offX, offsetY: offY, blendStrength: strength, blendWidth: blendW } = params;

  // Apply toroidal offset shift so the original seam lines land in the image centre
  const sx = Math.round(offX * W) % W;
  const sy = Math.round(offY * H) % H;
  const shiftCanvas = document.createElement('canvas');
  shiftCanvas.width  = W;
  shiftCanvas.height = H;
  const shiftCtx = shiftCanvas.getContext('2d');
  shiftCtx.drawImage(srcCanvas,  sx,  sy, W - sx, H - sy,    0,    0, W - sx, H - sy);
  if (sx > 0)            shiftCtx.drawImage(srcCanvas,   0,  sy,     sx, H - sy, W - sx,    0,     sx, H - sy);
  if (sy > 0)            shiftCtx.drawImage(srcCanvas,  sx,   0, W - sx,      sy,    0, H - sy, W - sx,      sy);
  if (sx > 0 && sy > 0)  shiftCtx.drawImage(srcCanvas,   0,   0,     sx,      sy, W - sx, H - sy,     sx,      sy);

  const shiftedPx = shiftCtx.getImageData(0, 0, W, H).data;

  // Poisson solve — blendWidth maps to iteration count
  // 0.01 → 4 iters (min 10), 0.15 → 60 iters, 0.49 → ~196 iters
  const iters = Math.max(10, Math.round(blendW * 400));
  const poissonPx = poissonSeamless(shiftedPx, W, H, iters);

  // Lerp between shifted original and Poisson result using blendStrength
  const blended = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) {
      blended[i * 4 + c] = Math.round(
        shiftedPx[i * 4 + c] * (1 - strength) + poissonPx[i * 4 + c] * strength
      );
    }
    blended[i * 4 + 3] = shiftedPx[i * 4 + 3];
  }

  // Write blended result into an intermediate canvas, then scale to outSize
  const midCanvas = document.createElement('canvas');
  midCanvas.width  = W;
  midCanvas.height = H;
  const midCtx = midCanvas.getContext('2d');
  const imgData = midCtx.createImageData(W, H);
  imgData.data.set(blended);
  midCtx.putImageData(imgData, 0, 0);

  const out = document.createElement('canvas');
  out.width  = outSize;
  out.height = outSize;
  out.getContext('2d').drawImage(midCanvas, 0, 0, outSize, outSize);
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

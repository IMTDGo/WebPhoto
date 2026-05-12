/**
 * seamlessWorker.js — Off-thread Poisson seamless computation.
 * Self-contained: no imports required.
 *
 * Receives: { id, pixels: ArrayBuffer, W, H, seamBlendWidth, iterations }
 * Posts:    { id, result: ArrayBuffer }  (transferred back)
 */

function smoothstep(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function makeEdgeBlended(px, W, H, pct) {
  const buf = new Float32Array(px.length);
  for (let i = 0; i < px.length; i++) buf[i] = px[i];

  const bx = Math.max(1, Math.round(W * pct));
  const by = Math.max(1, Math.round(H * pct));

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

function poissonSmooth(px, W, H, iters) {
  const N = W * H;
  function idx(x, y) { return ((y + H) % H) * W + ((x + W) % W); }

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
    out[i * 4 + 3] = px[i * 4 + 3];
  }
  return out;
}

self.onmessage = ({ data }) => {
  const { id, pixels, W, H, seamBlendWidth, iterations } = data;
  const px      = new Uint8ClampedArray(pixels);
  const blended = makeEdgeBlended(px, W, H, seamBlendWidth);
  const result  = poissonSmooth(blended, W, H, iterations);
  self.postMessage({ id, result: result.buffer }, [result.buffer]);
};

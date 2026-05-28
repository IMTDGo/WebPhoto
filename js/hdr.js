/**
 * hdr.js — Browser HDR capture + merge
 *
 * Workflow:
 *   1. getHDRCapabilities(track)  → null if unsupported, or { min, max, step }
 *   2. captureHDRFrames(track, evCaps, onProgress) → [darkBitmap, normalBitmap, brightBitmap]
 *   3. mergeHDR(dark, normal, bright) → HTMLCanvasElement
 *
 * Android Chrome + supporting hardware only.
 * iOS Safari: getHDRCapabilities() returns null → caller uses single-shot fallback.
 */

/** @param {number} ms */
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Check if this video track supports programmatic exposure compensation.
 * @param {MediaStreamTrack} track
 * @returns {{ min:number, max:number, step:number } | null}
 */
export function getHDRCapabilities(track) {
  if (!track?.getCapabilities) return null;
  try {
    const caps = track.getCapabilities();
    const ev = caps.exposureCompensation;
    if (!ev || ev.max == null || ev.min == null) return null;
    // Sanity: need at least ±1 EV range to be useful
    if (ev.max - ev.min < 2) return null;
    return { min: ev.min, max: ev.max, step: ev.step ?? 1 };
  } catch {
    return null;
  }
}

/**
 * Capture 3 frames at −2 EV, 0 EV, +2 EV.
 * Returns them as ImageBitmaps scaled to maxSize (default 2048 px on longest edge).
 *
 * @param {MediaStreamTrack} track
 * @param {{ min:number, max:number }} evCaps  result from getHDRCapabilities()
 * @param {(step:number, total:number, label:string)=>void} [onProgress]
 * @param {number} [maxSize=2048]
 * @returns {Promise<[ImageBitmap, ImageBitmap, ImageBitmap]>}  [dark, normal, bright]
 */
export async function captureHDRFrames(track, evCaps, onProgress, maxSize = 2048) {
  if (typeof ImageCapture === 'undefined') {
    throw new Error('ImageCapture API not supported');
  }

  const clamp = (v) => Math.max(evCaps.min, Math.min(evCaps.max, v));
  const shots = [
    { ev: clamp(-2), label: 'Dark (−2 EV)' },
    { ev: clamp(0),  label: 'Normal (0 EV)'  },
    { ev: clamp(2),  label: 'Bright (+2 EV)' },
  ];

  const imageCapture = new ImageCapture(track);
  const frames = [];

  for (let i = 0; i < shots.length; i++) {
    const { ev, label } = shots[i];
    onProgress?.(i + 1, shots.length, label);

    // Apply exposure offset and wait for the sensor to settle.
    // NOTE: We set exposureCompensation only (no exposureMode:'manual').
    // Setting exposureMode:'manual' triggers setPhotoOptions in Chrome Android,
    // which crashes the track with InvalidStateError on many devices.
    await track.applyConstraints({
      advanced: [{ exposureCompensation: ev }],
    });
    await _delay(500);

    // Always use grabFrame() instead of takePhoto().
    // takePhoto() triggers setPhotoOptions internally in Chrome Android;
    // after the first call succeeds, subsequent applyConstraints calls
    // fail with "setPhotoOptions failed" because the photo pipeline is
    // left in a dirty state. grabFrame() reads directly from the video
    // stream and never touches the photo pipeline.
    const frame = await imageCapture.grabFrame();
    const bitmap = await _resizeBitmap(frame, maxSize);
    frames.push(bitmap);
  }

  // Restore EV to 0
  try {
    await track.applyConstraints({ advanced: [{ exposureCompensation: 0 }] });
  } catch { /* best-effort */ }

  return frames; // [dark, normal, bright]
}

/**
 * Merge three exposure frames into a single tone-mapped canvas.
 * Uses luminance-based weighted blending:
 *   - Overexposed regions → pulled from dark frame
 *   - Underexposed regions → pulled from bright frame
 *   - Well-exposed regions → kept from normal frame
 *
 * @param {ImageBitmap|HTMLCanvasElement} dark
 * @param {ImageBitmap|HTMLCanvasElement} normal
 * @param {ImageBitmap|HTMLCanvasElement} bright
 * @returns {HTMLCanvasElement}
 */
export function mergeHDR(dark, normal, bright) {
  const w = normal.width;
  const h = normal.height;

  // Use a single temp canvas for readback
  const tmp    = document.createElement('canvas');
  tmp.width    = w;
  tmp.height   = h;
  const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });

  function readPixels(src) {
    tmpCtx.clearRect(0, 0, w, h);
    tmpCtx.drawImage(src, 0, 0, w, h);
    return tmpCtx.getImageData(0, 0, w, h).data;
  }

  const dPx = readPixels(dark);
  const nPx = readPixels(normal);
  const bPx = readPixels(bright);

  const out = tmpCtx.createImageData(w, h);
  const o   = out.data;

  // Blend thresholds (0–255 luminance)
  const HI_START = 195;  // start blending normal → dark
  const HI_END   = 235;  // fully use dark
  const LO_END   = 28;   // fully use bright
  const LO_START = 62;   // start blending normal → bright

  for (let i = 0; i < nPx.length; i += 4) {
    const r   = nPx[i], g = nPx[i + 1], b = nPx[i + 2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    let fr, fg, fb;

    if (lum >= HI_END) {
      // Fully blown-out → use dark frame
      fr = dPx[i]; fg = dPx[i + 1]; fb = dPx[i + 2];
    } else if (lum >= HI_START) {
      const t = (lum - HI_START) / (HI_END - HI_START);
      fr = r + t * (dPx[i]     - r);
      fg = g + t * (dPx[i + 1] - g);
      fb = b + t * (dPx[i + 2] - b);
    } else if (lum <= LO_END) {
      // Fully blocked-up → use bright frame
      fr = bPx[i]; fg = bPx[i + 1]; fb = bPx[i + 2];
    } else if (lum <= LO_START) {
      const t = (LO_START - lum) / (LO_START - LO_END);
      fr = r + t * (bPx[i]     - r);
      fg = g + t * (bPx[i + 1] - g);
      fb = b + t * (bPx[i + 2] - b);
    } else {
      fr = r; fg = g; fb = b;
    }

    o[i]     = Math.round(Math.max(0, Math.min(255, fr)));
    o[i + 1] = Math.round(Math.max(0, Math.min(255, fg)));
    o[i + 2] = Math.round(Math.max(0, Math.min(255, fb)));
    o[i + 3] = 255;
  }

  const out_canvas    = document.createElement('canvas');
  out_canvas.width    = w;
  out_canvas.height   = h;
  out_canvas.getContext('2d').putImageData(out, 0, 0);
  return out_canvas;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Decode a Blob or ImageBitmap, scaling down so the longest edge ≤ maxSize.
 * Uses the browser's built-in resizing (hardware-accelerated where available).
 */
async function _resizeBitmap(source, maxSize) {
  // Normalise: Blob → ImageBitmap first
  const isBlob  = source instanceof Blob;
  const natural = isBlob ? await createImageBitmap(source) : source;
  const { width: nw, height: nh } = natural;

  if (nw <= maxSize && nh <= maxSize) return natural;

  const scale = maxSize / Math.max(nw, nh);
  const tw    = Math.round(nw * scale);
  const th    = Math.round(nh * scale);

  if (isBlob) {
    natural.close(); // safe: original source is still the Blob
    return createImageBitmap(source, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
  } else {
    // ImageBitmap (e.g. from grabFrame): resize then close the original
    const resized = await createImageBitmap(natural, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
    natural.close();
    return resized;
  }
}

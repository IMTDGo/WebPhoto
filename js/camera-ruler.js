/**
 * camera-ruler.js — draws 10 cm graduated rulers on the
 * .cam-ruler-h (horizontal/top) and .cam-ruler-v (vertical/left) canvas
 * elements inside every .cam-viewfinder container on the page.
 *
 * Tick hierarchy:
 *   1 mm  — short tick
 *   5 mm  — medium tick
 *  10 mm  — tall tick + numeric cm label
 *
 * Scale reference: 1 CSS cm ≈ 96 / 2.54 ≈ 37.795 CSS pixels.
 * The ruler spans RULER_CM centimetres starting from 0.
 *
 * Usage:
 *   import './camera-ruler.js';          // auto-inits; ResizeObserver redraws
 *   import { drawCameraRulers } from './camera-ruler.js';  // explicit redraw
 */

const PX_PER_CM = 96 / 2.54; // CSS reference pixels per centimetre
const RULER_CM  = 10;         // ruler span in centimetres

/* ── Drawing helpers ─────────────────────────────────────────────────────── */

/**
 * Draw a horizontal ruler (top edge).
 * @param {HTMLCanvasElement} c
 * @param {number} dpr  — window.devicePixelRatio
 */
function _drawH(c, dpr) {
  const W = c.offsetWidth;
  const H = c.offsetHeight;
  if (W <= 0 || H <= 0) return;

  c.width  = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = 'rgba(6, 8, 14, 0.92)';
  ctx.fillRect(0, 0, W, H);

  const pxMm     = PX_PER_CM / 10;
  const fontSize = Math.max(6, Math.floor(H * 0.46));
  const font     = `${fontSize}px ui-monospace, "SF Mono", monospace`;

  ctx.textBaseline = 'top';
  ctx.textAlign    = 'center';
  ctx.lineWidth    = 0.8;

  for (let mm = 0; mm <= RULER_CM * 10; mm++) {
    const x = mm * pxMm;
    if (x > W + pxMm) break;

    let tickH, color;
    if (mm % 10 === 0) {
      tickH = H * 0.70;
      color = 'rgba(200, 210, 230, 0.90)';
    } else if (mm % 5 === 0) {
      tickH = H * 0.50;
      color = 'rgba(160, 172, 195, 0.75)';
    } else {
      tickH = H * 0.28;
      color = 'rgba(110, 120, 145, 0.60)';
    }

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x, H - tickH);
    ctx.stroke();

    // cm numeric label (skip 0)
    if (mm % 10 === 0 && mm > 0) {
      ctx.fillStyle = 'rgba(190, 202, 225, 0.92)';
      ctx.font = font;
      ctx.fillText(`${mm / 10}`, x, 1);
    }
  }

  // Separator line at bottom edge of ruler strip
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, H - 0.5);
  ctx.lineTo(W, H - 0.5);
  ctx.stroke();
}

/**
 * Draw a vertical ruler (left edge).
 * @param {HTMLCanvasElement} c
 * @param {number} dpr
 */
function _drawV(c, dpr) {
  const W = c.offsetWidth;
  const H = c.offsetHeight;
  if (W <= 0 || H <= 0) return;

  c.width  = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = 'rgba(6, 8, 14, 0.92)';
  ctx.fillRect(0, 0, W, H);

  const pxMm     = PX_PER_CM / 10;
  const fontSize = Math.max(5, Math.floor(W * 0.40));
  const font     = `${fontSize}px ui-monospace, "SF Mono", monospace`;
  ctx.lineWidth  = 0.8;

  for (let mm = 0; mm <= RULER_CM * 10; mm++) {
    const y = mm * pxMm;
    if (y > H + pxMm) break;

    let tickW, color;
    if (mm % 10 === 0) {
      tickW = W * 0.70;
      color = 'rgba(200, 210, 230, 0.90)';
    } else if (mm % 5 === 0) {
      tickW = W * 0.50;
      color = 'rgba(160, 172, 195, 0.75)';
    } else {
      tickW = W * 0.28;
      color = 'rgba(110, 120, 145, 0.60)';
    }

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(W, y);
    ctx.lineTo(W - tickW, y);
    ctx.stroke();

    // cm numeric label — rotated 90° CCW
    if (mm % 10 === 0 && mm > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(190, 202, 225, 0.92)';
      ctx.font = font;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(W / 2, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${mm / 10}`, 0, 0);
      ctx.restore();
    }
  }

  // Separator line at right edge of ruler strip
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(W - 0.5, 0);
  ctx.lineTo(W - 0.5, H);
  ctx.stroke();
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Draw (or redraw) rulers inside a .cam-viewfinder element.
 * Safe to call at any time; silently skips if canvas has no rendered size yet.
 * @param {HTMLElement} vf  — the .cam-viewfinder element
 */
export function drawCameraRulers(vf) {
  const dpr = window.devicePixelRatio || 1;
  const ch  = vf.querySelector('canvas.cam-ruler-h');
  const cv  = vf.querySelector('canvas.cam-ruler-v');
  if (ch) _drawH(ch, dpr);
  if (cv) _drawV(cv, dpr);
}

/* ── Auto-init (runs on import) ─────────────────────────────────────────── */

/**
 * Attach a ResizeObserver to a .cam-viewfinder so rulers are redrawn
 * whenever the container is resized or first becomes visible.
 * @param {HTMLElement} vf
 */
function _watch(vf) {
  drawCameraRulers(vf); // initial attempt (may be a no-op if hidden)
  const ro = new ResizeObserver(() => drawCameraRulers(vf));
  ro.observe(vf);
}

function _autoInit() {
  document.querySelectorAll('.cam-viewfinder').forEach(_watch);
}

// Works whether the module is evaluated before or after DOM parsing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _autoInit);
} else {
  _autoInit();
}

/**
 * preview.js
 *
 * Renders a tiled seamless-pattern preview onto a canvas (3×3 grid by default).
 * Shared between mobile and desktop.
 */

import { applySeamless, extractCrop, DEFAULT_PARAMS } from './seamless.js';

export class PatternPreview {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ displaySize?: number, gridSize?: number }} options
   *
   * displaySize — fixed output canvas resolution (px). Default 512.
   * gridSize    — how many tiles per row (1–50). Default 3.
   *               tileSize = displaySize / gridSize (computed dynamically).
   */
  constructor(canvas, options = {}) {
    this.canvas      = canvas;
    this.ctx         = canvas.getContext('2d');
    this.displaySize = options.displaySize || 512;
    this.gridSize    = options.gridSize    || 3;
    this.params      = { ...DEFAULT_PARAMS };
    this._lastCrop   = null;  // cached so gridSize changes auto-redraw
  }

  /**
   * Change the number of tiles shown and re-render immediately.
   * @param {number} n — integer 1–50
   */
  setGridSize(n) {
    this.gridSize = Math.max(1, Math.min(50, Math.round(n)));
    if (this._lastCrop) this.update(this._lastCrop);
  }

  /**
   * Fast low-resolution update — suitable for real-time drag feedback.
   * Computes a small seamless tile (~48px) and tiles it at display size.
   */
  updateFast(crop) {
    const { img, x, y, size } = crop;
    if (!img) return;
    this._lastCrop = crop;

    const fastTile = Math.max(16, Math.round(this.displaySize / this.gridSize / 4));
    const srcCanvas      = extractCrop(img, x, y, size);
    const seamlessCanvas = applySeamless(srcCanvas, fastTile, this.params);

    const D = this.displaySize;
    this.canvas.width  = D;
    this.canvas.height = D;

    const pat = this.ctx.createPattern(seamlessCanvas, 'repeat');
    this.ctx.fillStyle = pat;
    this.ctx.fillRect(0, 0, D, D);

    this._fitDisplay();
  }

  /**
   * Full-quality update — run after drag ends.
   */
  update(crop) {
    const { img, x, y, size } = crop;
    if (!img) return;
    this._lastCrop = crop;

    // tileSize shrinks as gridSize grows, keeping canvas at fixed displaySize
    const tileSize = Math.max(4, Math.round(this.displaySize / this.gridSize));

    const srcCanvas      = extractCrop(img, x, y, size);
    const seamlessCanvas = applySeamless(srcCanvas, tileSize, this.params);

    const D = this.displaySize;
    this.canvas.width  = D;
    this.canvas.height = D;

    const pat = this.ctx.createPattern(seamlessCanvas, 'repeat');
    this.ctx.fillStyle = pat;
    this.ctx.fillRect(0, 0, D, D);

    this._fitDisplay();
  }

  /** Fit the canvas display size to its container element. */
  _fitDisplay() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const maxW  = (parent.clientWidth  || this.displaySize) - 8;
    const maxH  = (parent.clientHeight || this.displaySize) - 8;
    const scale = Math.min(maxW / this.displaySize, maxH / this.displaySize, 1);
    this.canvas.style.width  = Math.round(this.displaySize * scale) + 'px';
    this.canvas.style.height = Math.round(this.displaySize * scale) + 'px';
  }
}

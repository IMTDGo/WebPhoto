/**
 * preview.js
 *
 * Renders a tiled seamless-pattern preview onto a canvas (3×3 grid by default).
 * Shared between mobile and desktop.
 */

import { applySeamlessAsync, applyEdgeBlendOnly, extractCrop, DEFAULT_PARAMS } from './seamless.js';

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
    this.seamlessEnabled = false;  // default off — seamless feature is hidden
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
   * Uses edge-blend only (no Poisson) so it completes in <1ms.
   */
  updateFast(crop) {
    const { img, x, y, w, h } = crop;
    if (!img) return;
    this._lastCrop = crop;

    const srcCanvas = extractCrop(img, x, y, w, h);

    const tileW = Math.max(4, Math.round(this.displaySize / this.gridSize / 4));
    const tileH = Math.max(4, Math.round(tileW * h / w));

    let tileCanvas;
    if (this.seamlessEnabled) {
      tileCanvas = applyEdgeBlendOnly(srcCanvas, tileW, this.params);
    } else {
      tileCanvas = document.createElement('canvas');
      tileCanvas.width  = tileW;
      tileCanvas.height = tileH;
      tileCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, tileW, tileH);
    }

    const DW = tileW * this.gridSize;
    const DH = tileH * this.gridSize;
    this.canvas.width  = DW;
    this.canvas.height = DH;

    const pat = this.ctx.createPattern(tileCanvas, 'repeat');
    this.ctx.fillStyle = pat;
    this.ctx.fillRect(0, 0, DW, DH);

    this._fitDisplay();
  }

  /**
   * Full-quality async update — run after drag ends.
   * Poisson solve runs in a Web Worker so the main thread stays responsive.
   */
  async update(crop) {
    const { img, x, y, w, h } = crop;
    if (!img) return;
    this._lastCrop = crop;

    const srcCanvas = extractCrop(img, x, y, w, h);

    const tileW = Math.max(4, Math.round(this.displaySize / this.gridSize));
    const tileH = Math.max(4, Math.round(tileW * h / w));

    let tileCanvas;
    if (this.seamlessEnabled) {
      tileCanvas = await applySeamlessAsync(srcCanvas, tileW, this.params);
      if (!tileCanvas) return; // superseded by a newer call
    } else {
      tileCanvas = document.createElement('canvas');
      tileCanvas.width  = tileW;
      tileCanvas.height = tileH;
      tileCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, tileW, tileH);
    }

    const DW = tileW * this.gridSize;
    const DH = tileH * this.gridSize;
    this.canvas.width  = DW;
    this.canvas.height = DH;

    const pat = this.ctx.createPattern(tileCanvas, 'repeat');
    this.ctx.fillStyle = pat;
    this.ctx.fillRect(0, 0, DW, DH);

    this._fitDisplay();
  }

  /** Fit the canvas display size to fill its container, maintaining aspect ratio. */
  _fitDisplay() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const maxW  = (parent.clientWidth  || this.canvas.width)  - 4;
    const maxH  = (parent.clientHeight || this.canvas.height) - 4;
    // No upper cap — allows upscaling low-res tiles during fast drag so size stays stable
    const scale = Math.min(maxW / this.canvas.width, maxH / this.canvas.height);
    this.canvas.style.width  = Math.round(this.canvas.width  * scale) + 'px';
    this.canvas.style.height = Math.round(this.canvas.height * scale) + 'px';
  }
}

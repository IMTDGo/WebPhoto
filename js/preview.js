/**
 * preview.js
 *
 * Renders a tiled seamless-pattern preview onto a canvas (3×3 grid by default).
 * Shared between mobile and desktop.
 */

import { extractCrop } from './seamless.js';

/**
 * Returns a tile canvas scaled by `zoom` and with pattern origin offset by (panX, panY).
 * The returned canvas is used as the source for ctx.createPattern().
 */
function _applyPanZoom(tileCanvas, tileW, tileH, zoom, panX, panY) {
  const eTW = Math.max(1, Math.round(tileW * zoom));
  const eTH = Math.max(1, Math.round(tileH * zoom));

  // Scale tile if needed
  let drawTile = tileCanvas;
  if (eTW !== tileW || eTH !== tileH) {
    drawTile = document.createElement('canvas');
    drawTile.width  = eTW;
    drawTile.height = eTH;
    drawTile.getContext('2d').drawImage(tileCanvas, 0, 0, eTW, eTH);
  }

  // Wrap pan within one tile to keep offset minimal
  const ox = ((panX % eTW) + eTW) % eTW;
  const oy = ((panY % eTH) + eTH) % eTH;
  if (ox || oy) {
    // Embed offset in a wrapper canvas so createPattern picks it up
    const wrapped = document.createElement('canvas');
    wrapped.width  = eTW;
    wrapped.height = eTH;
    const wctx = wrapped.getContext('2d');
    // draw four quadrants to simulate offset wrapping
    wctx.drawImage(drawTile,  ox - eTW,  oy - eTH);
    wctx.drawImage(drawTile,  ox,        oy - eTH);
    wctx.drawImage(drawTile,  ox - eTW,  oy);
    wctx.drawImage(drawTile,  ox,        oy);
    return wrapped;
  }
  return drawTile;
}

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
    this.fitMode     = options.fitMode     || 'contain'; // 'contain' | 'width'
    this._lastCrop   = null;  // cached so gridSize changes auto-redraw
    this._panX       = 0;
    this._panY       = 0;
    this._previewZoom = 1;
  }

  /**
   * Change the number of tiles shown and re-render immediately.
   * @param {number} n — integer 1–50
   */
  setGridSize(n) {
    this.gridSize = Math.max(1, Math.min(50, Math.round(n)));
    if (this._lastCrop) this.update(this._lastCrop);
  }

  /** Offset the tiled pattern by (dx, dy) pixels and fast-redraw. */
  setPan(dx, dy) {
    this._panX += dx;
    this._panY += dy;
    if (this._lastCrop) this.updateFast(this._lastCrop);
  }

  /** Multiply the preview zoom factor and fast-redraw. */
  setPreviewZoom(factor) {
    this._previewZoom = Math.max(0.1, Math.min(20, this._previewZoom * factor));
    if (this._lastCrop) this.updateFast(this._lastCrop);
  }

  /** Reset pan and zoom to default and full-quality redraw. */
  resetView() {
    this._panX = 0; this._panY = 0; this._previewZoom = 1;
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

    let DW, DH, tileW, tileH;
    if (this.fitMode === 'width') {
      const parent = this.canvas.parentElement;
      const cW = parent?.clientWidth  || this.displaySize;
      const cH = parent?.clientHeight || cW;
      if (!cW) return;
      // Same tile COUNT as update() so the grid never jumps during drag
      tileW = Math.max(4, Math.round(cW / this.gridSize));
      tileH = Math.max(4, Math.round(tileW * h / w));
      DW = cW; DH = cH;
    } else {
      tileW = Math.max(4, Math.round(this.displaySize / this.gridSize / 4));
      tileH = Math.max(4, Math.round(tileW * h / w));
      DW = tileW * this.gridSize;
      DH = tileH * this.gridSize;
    }

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width  = tileW;
    tileCanvas.height = tileH;
    tileCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, tileW, tileH);

    this.canvas.width  = DW;
    this.canvas.height = DH;

    const pat = this.ctx.createPattern(_applyPanZoom(tileCanvas, tileW, tileH, this._previewZoom, this._panX, this._panY), 'repeat');
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

    let DW, DH, tileW, tileH;
    if (this.fitMode === 'width') {
      const parent = this.canvas.parentElement;
      const cW = parent?.clientWidth  || this.displaySize;
      const cH = parent?.clientHeight || cW;
      if (!cW) { requestAnimationFrame(() => this.update(crop)); return; }
      tileW = Math.max(4, Math.round(cW / this.gridSize));
      tileH = Math.max(4, Math.round(tileW * h / w));
      DW = cW; DH = cH;
    } else {
      tileW = Math.max(4, Math.round(this.displaySize / this.gridSize));
      tileH = Math.max(4, Math.round(tileW * h / w));
      DW = tileW * this.gridSize;
      DH = tileH * this.gridSize;
    }

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width  = tileW;
    tileCanvas.height = tileH;
    tileCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, tileW, tileH);

    this.canvas.width  = DW;
    this.canvas.height = DH;

    const pat = this.ctx.createPattern(_applyPanZoom(tileCanvas, tileW, tileH, this._previewZoom, this._panX, this._panY), 'repeat');
    this.ctx.fillStyle = pat;
    this.ctx.fillRect(0, 0, DW, DH);

    this._fitDisplay();
  }

  /** Re-render at new container size (full quality). Call after layout changes. */
  resize() {
    if (this.fitMode === 'width' && this._lastCrop) this.update(this._lastCrop);
    else this._fitDisplay();
  }

  /** Re-render at new container size (low quality). Use during live drag. */
  resizeFast() {
    if (this.fitMode === 'width' && this._lastCrop) this.updateFast(this._lastCrop);
    else this._fitDisplay();
  }

  /** Fit the canvas display size to fill its container, maintaining aspect ratio. */
  _fitDisplay() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    if (this.fitMode === 'width') {
      // Canvas pixels already match container dimensions — clear any CSS overrides.
      this.canvas.style.width  = '';
      this.canvas.style.height = '';
      return;
    }

    // 'contain' — default: shrink to fit within both width and height
    const maxW  = (parent.clientWidth  || this.canvas.width)  - 4;
    const maxH  = (parent.clientHeight || this.canvas.height) - 4;
    // No upper cap — allows upscaling low-res tiles during fast drag so size stays stable
    const scale = Math.min(maxW / this.canvas.width, maxH / this.canvas.height);
    this.canvas.style.width  = Math.round(this.canvas.width  * scale) + 'px';
    this.canvas.style.height = Math.round(this.canvas.height * scale) + 'px';
  }
}

/**
 * crop-editor.js
 *
 * Renders a full-image preview with a draggable / pinch-zoomable
 * crop box. Supports both 1:1 locked and free-form aspect ratio.
 *
 * Usage:
 *   const editor = new CropEditor(canvasEl, { onChange: ({ img, x, y, w, h }) => ... });
 *   editor.load(imageElement);
 */

export class CropEditor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onChange?: function }} options
   */
  constructor(canvas, options = {}) {
    this.canvas      = canvas;
    this.ctx         = canvas.getContext('2d');
    this.onChange    = options.onChange    || null;
    this.onChangeEnd = options.onChangeEnd || null;

    // Source image
    this.img  = null;

    // Crop box in IMAGE coordinates
    this.cropX = 0;
    this.cropY = 0;
    this.cropW = 100;  // width
    this.cropH = 100;  // height

    // Aspect ratio lock: true = 1:1, false = free-form
    this.aspectLocked = true;

    // Drag state: { mode:'move'|'resize', ... }
    this._drag = null;

    // Pinch state
    this._pinch = null;

    // Corner hit radius in canvas-display pixels
    this._hitRadius = 28;

    this._bindEvents();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Load a new image and reset the crop box. */
  load(img) {
    this.img   = img;
    this._drag  = null;   // discard any stale pointer state
    this._pinch = null;
    this._fitCanvas();
    this._resetCrop();
    this._draw();
  }

  /** Return current crop parameters in image-space. */
  getCrop() {
    return { img: this.img, x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH };
  }

  /** Set normalised crop size (0–1 relative to shorter side). Always sets 1:1. */
  setSizeNorm(norm) {
    if (!this.img) return;
    const minDim = Math.min(this.img.width, this.img.height);
    const size = Math.max(8, Math.min(minDim, Math.round(norm * minDim)));
    this.cropW = size;
    this.cropH = size;
    this._clampCrop();
    this._draw();
    this._emitChange();
  }

  /** Get normalised crop size (based on width). */
  getSizeNorm() {
    if (!this.img) return 0.5;
    const minDim = Math.min(this.img.width, this.img.height);
    return this.cropW / minDim;
  }

  /**
   * Toggle aspect ratio lock.
   * When locked=true, forces a square crop (uses current cropW).
   */
  setAspectLock(locked) {
    this.aspectLocked = locked;
    if (locked && this.img) {
      // Snap to square using current width
      const minDim = Math.min(this.img.width, this.img.height);
      const size = Math.max(16, Math.min(minDim, this.cropW));
      this.cropW = size;
      this.cropH = size;
      this._clampCrop();
      this._draw();
      this._emitChange();
    }
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  _fitCanvas() {
    const parent = this.canvas.parentElement;
    const W = parent.clientWidth  || 400;
    const H = parent.clientHeight || 400;
    const scale = Math.min(W / this.img.width, H / this.img.height, 1);
    this.canvas.width  = Math.round(this.img.width  * scale);
    this.canvas.height = Math.round(this.img.height * scale);
    // Store scale for coord transforms
    this._scaleToCanvas = scale;
  }

  /** Trigger re-layout (call on window resize). */
  resize() {
    if (!this.img) return;
    this._fitCanvas();
    this._draw();
  }

  // ── Crop helpers ───────────────────────────────────────────────────────────

  _resetCrop() {
    const minDim = Math.min(this.img.width, this.img.height);
    const size   = Math.round(minDim * 0.6);
    this.cropW = size;
    this.cropH = size;
    this.cropX = Math.round((this.img.width  - this.cropW) / 2);
    this.cropY = Math.round((this.img.height - this.cropH) / 2);
  }

  _clampCrop() {
    this.cropX = Math.max(0, Math.min(this.img.width  - this.cropW, this.cropX));
    this.cropY = Math.max(0, Math.min(this.img.height - this.cropH, this.cropY));
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  _draw() {
    const { canvas, ctx, img } = this;
    const cw = canvas.width, ch = canvas.height;
    const s  = this._scaleToCanvas;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    // Dim area outside crop
    const cx = Math.round(this.cropX * s);
    const cy = Math.round(this.cropY * s);
    const cw2 = Math.round(this.cropW * s);
    const ch2 = Math.round(this.cropH * s);

    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(0,        0,        cw,       cy);               // top
    ctx.fillRect(0,        cy + ch2, cw,       ch - cy - ch2);    // bottom
    ctx.fillRect(0,        cy,       cx,       ch2);              // left
    ctx.fillRect(cx + cw2, cy,       cw - cx - cw2, ch2);        // right

    // Crop border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw2 - 1, ch2 - 1);

    // Rule-of-thirds grid inside crop
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 0.5;
    for (let i = 1; i <= 2; i++) {
      const gx = cx + Math.round(cw2 * i / 3);
      const gy = cy + Math.round(ch2 * i / 3);
      ctx.beginPath(); ctx.moveTo(gx, cy); ctx.lineTo(gx, cy + ch2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx + cw2, gy); ctx.stroke();
    }

    // Corner handles
    const hLen = Math.min(18, Math.min(cw2, ch2) * 0.2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth   = 3;
    const corners = [[cx, cy], [cx + cw2, cy], [cx, cy + ch2], [cx + cw2, cy + ch2]];
    corners.forEach(([px, py]) => {
      const sx = px === cx ? 1 : -1;
      const sy = py === cy ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(px + sx * hLen, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + sy * hLen);
      ctx.stroke();
    });
  }

  // ── Event helpers ──────────────────────────────────────────────────────────

  _clientToImage(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const s    = this._scaleToCanvas;
    return {
      x: (clientX - rect.left)  / (rect.width  / this.canvas.width)  / s,
      y: (clientY - rect.top)   / (rect.height / this.canvas.height) / s,
    };
  }

  /** Convert clientX/Y to canvas-display pixel (for hit-testing corners). */
  _clientToDisplay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.canvas.width  / rect.width),
      y: (clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  /**
   * Returns corner metadata if clientX/Y is within hit radius of any corner,
   * otherwise null.
   * anchorImgX/Y: the OPPOSITE corner in image coords (stays fixed during resize).
   * xMode: 'fixed'  → cropX = anchorImgX
   *        'offset' → cropX = anchorImgX - newSize
   */
  _hitCorner(clientX, clientY) {
    if (!this.img) return null;
    const s   = this._scaleToCanvas;
    const cx  = Math.round(this.cropX * s);
    const cy  = Math.round(this.cropY * s);
    const cw2 = Math.round(this.cropW * s);
    const ch2 = Math.round(this.cropH * s);
    const dp  = this._clientToDisplay(clientX, clientY);

    const corners = [
      // Top-Left dragged → anchor = Bottom-Right
      { px: cx,       py: cy,       anchorImgX: this.cropX + this.cropW, anchorImgY: this.cropY + this.cropH, xMode: 'offset', yMode: 'offset', cursor: 'nw-resize' },
      // Top-Right dragged → anchor = Bottom-Left
      { px: cx + cw2, py: cy,       anchorImgX: this.cropX,              anchorImgY: this.cropY + this.cropH, xMode: 'fixed',  yMode: 'offset', cursor: 'ne-resize' },
      // Bottom-Left dragged → anchor = Top-Right
      { px: cx,       py: cy + ch2, anchorImgX: this.cropX + this.cropW, anchorImgY: this.cropY,              xMode: 'offset', yMode: 'fixed',  cursor: 'sw-resize' },
      // Bottom-Right dragged → anchor = Top-Left
      { px: cx + cw2, py: cy + ch2, anchorImgX: this.cropX,              anchorImgY: this.cropY,              xMode: 'fixed',  yMode: 'fixed',  cursor: 'se-resize' },
    ];

    for (const c of corners) {
      if (Math.hypot(dp.x - c.px, dp.y - c.py) <= this._hitRadius) return c;
    }
    return null;
  }

  _emitChange() {
    if (this.onChange) this.onChange(this.getCrop());
  }

  _emitChangeEnd() {
    if (this.onChangeEnd) this.onChangeEnd(this.getCrop());
  }

  // ── Event binding ──────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;

    // Mouse — update cursor on hover
    c.addEventListener('mousemove', (e) => {
      if (this._drag) return;
      const corner = this._hitCorner(e.clientX, e.clientY);
      c.style.cursor = corner ? corner.cursor : 'move';
    });

    c.addEventListener('mousedown',  (e) => this._onPointerDown(e.clientX, e.clientY, e));
    window.addEventListener('mousemove', (e) => { if (this._drag) this._onPointerMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup',   ()  => {
      if (this._drag) { this._drag = null; this._emitChangeEnd(); }
    });

    // Touch — single finger
    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        this._onPointerDown(e.touches[0].clientX, e.touches[0].clientY, e);
      } else if (e.touches.length === 2) {
        this._drag = null;   // cancel any single-finger drag before entering pinch
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._pinch = { startDist: Math.hypot(dx, dy), startW: this.cropW, startH: this.cropH };
      }
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this._drag) {
        this._onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        this._onPinchMove(e);
      }
    }, { passive: false });

    c.addEventListener('touchend', (e) => {
      const wasDragging = !!this._drag;
      const wasPinching = !!this._pinch;
      if (e.touches.length < 2) this._pinch = null;
      if (e.touches.length === 0) this._drag = null;
      if ((wasDragging || wasPinching) && e.touches.length === 0) this._emitChangeEnd();
    });
  }

  _onPointerDown(clientX, clientY, e) {
    if (!this.img) return;
    e.preventDefault();
    const corner = this._hitCorner(clientX, clientY);
    if (corner) {
      // Resize mode: anchor the opposite corner
      this._drag = {
        mode:       'resize',
        anchorImgX: corner.anchorImgX,
        anchorImgY: corner.anchorImgY,
        xMode:      corner.xMode,
        yMode:      corner.yMode,
      };
    } else {
      // Move mode
      const pos = this._clientToImage(clientX, clientY);
      this._drag = {
        mode:       'move',
        startCropX: this.cropX,
        startCropY: this.cropY,
        imgX:       pos.x,
        imgY:       pos.y,
      };
    }
  }

  _onPointerMove(clientX, clientY) {
    if (!this._drag || !this.img) return;
    if (this._drag.mode === 'resize') {
      this._doResize(clientX, clientY);
    } else {
      this._doMove(clientX, clientY);
    }
  }

  _doMove(clientX, clientY) {
    const pos = this._clientToImage(clientX, clientY);
    const dx  = pos.x - this._drag.imgX;
    const dy  = pos.y - this._drag.imgY;
    this.cropX = Math.max(0, Math.min(this.img.width  - this.cropW, Math.round(this._drag.startCropX + dx)));
    this.cropY = Math.max(0, Math.min(this.img.height - this.cropH, Math.round(this._drag.startCropY + dy)));
    this._draw();
    this._emitChange();
  }

  _doResize(clientX, clientY) {
    const pos = this._clientToImage(clientX, clientY);
    const { anchorImgX, anchorImgY, xMode, yMode } = this._drag;

    if (this.aspectLocked) {
      // 1:1 — constrain by whichever axis moved further
      const minDim  = Math.min(this.img.width, this.img.height);
      const rawSize = Math.max(Math.abs(pos.x - anchorImgX), Math.abs(pos.y - anchorImgY));
      const newSize = Math.max(16, Math.min(minDim, Math.round(rawSize)));
      this.cropW = newSize;
      this.cropH = newSize;
      this.cropX = Math.max(0, Math.min(this.img.width  - newSize, xMode === 'offset' ? anchorImgX - newSize : anchorImgX));
      this.cropY = Math.max(0, Math.min(this.img.height - newSize, yMode === 'offset' ? anchorImgY - newSize : anchorImgY));
    } else {
      // Free-form — each axis independent
      const newW = Math.max(16, Math.min(this.img.width,  Math.round(Math.abs(pos.x - anchorImgX))));
      const newH = Math.max(16, Math.min(this.img.height, Math.round(Math.abs(pos.y - anchorImgY))));
      this.cropW = newW;
      this.cropH = newH;
      this.cropX = Math.max(0, Math.min(this.img.width  - newW, xMode === 'offset' ? anchorImgX - newW : anchorImgX));
      this.cropY = Math.max(0, Math.min(this.img.height - newH, yMode === 'offset' ? anchorImgY - newH : anchorImgY));
    }
    this._draw();
    this._emitChange();
  }

  _onPinchMove(e) {
    if (!this._pinch || !this.img) return;
    const dx    = e.touches[0].clientX - e.touches[1].clientX;
    const dy    = e.touches[0].clientY - e.touches[1].clientY;
    const dist  = Math.hypot(dx, dy);
    const ratio = dist / this._pinch.startDist;
    if (this.aspectLocked) {
      const minDim  = Math.min(this.img.width, this.img.height);
      const newSize = Math.max(16, Math.min(minDim, Math.round(this._pinch.startW * ratio)));
      this.cropW = newSize;
      this.cropH = newSize;
    } else {
      this.cropW = Math.max(16, Math.min(this.img.width,  Math.round(this._pinch.startW * ratio)));
      this.cropH = Math.max(16, Math.min(this.img.height, Math.round(this._pinch.startH * ratio)));
    }
    this._clampCrop();
    this._draw();
    this._emitChange();
  }
}

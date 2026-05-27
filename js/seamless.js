/**
 * seamless.js
 */

/**
 * Extract a cropped region from a source image into a new canvas.
 *
 * @param {HTMLImageElement} img
 * @param {number} x   crop origin X in image pixels
 * @param {number} y   crop origin Y in image pixels
 * @param {number} w   crop width in image pixels
 * @param {number} h   crop height in image pixels (defaults to w)
 * @returns {HTMLCanvasElement}
 */
export function extractCrop(img, x, y, w, h = w) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
  return c;
}
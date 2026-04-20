/**
 * toast.js — lightweight toast notification helper (shared)
 */

let _container = null;
let _alert     = null;
let _msg       = null;
let _timer     = null;

function _ensure() {
  if (_container) return;
  _container = document.createElement('div');
  _container.className = 'toast toast-top toast-center z-50';
  _container.style.display = 'none';
  _alert = document.createElement('div');
  _alert.className = 'alert';
  _msg = document.createElement('span');
  _alert.appendChild(_msg);
  _container.appendChild(_alert);
  document.body.appendChild(_container);
}

/**
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} duration ms
 */
export function showToast(message, type = 'info', duration = 3000) {
  _ensure();
  _msg.textContent = message;
  _alert.className = `alert alert-${type}`;
  _container.style.display = '';
  clearTimeout(_timer);
  _timer = setTimeout(() => { _container.style.display = 'none'; }, duration);
}

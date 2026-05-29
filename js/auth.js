/**
 * auth.js — Shared session management for SNAPBRIFY
 *
 * - 10-minute idle auto-logout (calls backend /logout + clears storage)
 * - 4-minute heartbeat to keep server-side session alive
 * - Exposes window._wpDoLogout(redirectUrl) for manual logout buttons
 */
(function () {
  'use strict';

  var BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? window.location.protocol + '//' + window.location.host
    : 'https://webphoto-lidl.onrender.com';

  var IDLE_MS = 10 * 60 * 1000; //  10 minutes
  var HB_MS   =  4 * 60 * 1000; //   4 minutes

  function getSessionId() {
    return sessionStorage.getItem('wp_sessionId') || localStorage.getItem('wp_sessionId') || null;
  }

  function clearAuth() {
    ['wp_auth', 'wp_token', 'wp_sessionId', 'wp_user'].forEach(function (k) {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  }

  var isLoggedIn = !!(sessionStorage.getItem('wp_auth') || localStorage.getItem('wp_auth'));

  // Always expose _wpDoLogout; no-op when not logged in
  window._wpDoLogout = function (redirectUrl) {
    var sid = getSessionId();
    clearAuth();
    if (sid) {
      try {
        navigator.sendBeacon(
          BASE_URL + '/logout',
          new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' })
        );
      } catch (e) {}
    }
    // Default redirect: login page with ref so it doesn't bounce back to index
    window.location.replace(redirectUrl !== undefined ? redirectUrl : './login.html?ref=app');
  };

  if (!isLoggedIn) return;

  // ── Heartbeat: keeps server-side session alive while page is open ──────────
  function heartbeat() {
    var sid = getSessionId();
    if (!sid) return;
    fetch(BASE_URL + '/session/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
      keepalive: true
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.ok) {
        // Server says session is gone – force logout
        clearAuth();
        window.location.replace('./login.html?ref=app');
      }
    }).catch(function () { /* ignore transient network errors */ });
  }

  setInterval(heartbeat, HB_MS);

  // ── Idle timer: auto-logout after 10 minutes without activity ─────────────
  var idleTimer;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      window._wpDoLogout('./login.html?ref=app');
    }, IDLE_MS);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function (ev) {
    document.addEventListener(ev, resetIdle, { passive: true });
  });
  resetIdle();

})();

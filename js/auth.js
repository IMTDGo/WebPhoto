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
        // Server says session is gone – show modal, wait for user to dismiss
        clearAuth();
        try { clearInterval(window._wpHbInterval); } catch (e) {}
        showIdleLogoutModal(function () {
          window.location.replace('./login.html?ref=app');
        });
      }
    }).catch(function () { /* ignore transient network errors */ });
  }

  window._wpHbInterval = setInterval(heartbeat, HB_MS);

  // ── Idle modal: shown before auto-logout so user knows what happened ──────
  function showIdleLogoutModal(onConfirm) {
    // Inject one-time styles
    if (!document.getElementById('_wp_idle_style')) {
      var s = document.createElement('style');
      s.id = '_wp_idle_style';
      s.textContent = [
        '#_wp_idle_overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
        'opacity:0;transition:opacity .25s ease;}',
        '#_wp_idle_overlay.show{opacity:1;}',
        '#_wp_idle_card{background:#18181B;border:1px solid rgba(232,200,84,0.2);border-radius:12px;',
        'padding:40px 36px;max-width:380px;width:90%;text-align:center;',
        'transform:scale(0.94) translateY(12px);transition:transform .3s ease;',
        'box-shadow:0 0 60px rgba(0,0,0,0.6);}',
        '#_wp_idle_overlay.show #_wp_idle_card{transform:scale(1) translateY(0);}',
        '#_wp_idle_icon{font-size:48px;color:#E8C854;margin-bottom:16px;display:block;',
        'font-family:"Material Symbols Outlined";font-variation-settings:"FILL" 1,"wght" 400,"GRAD" 0,"opsz" 48;}',
        '#_wp_idle_title{color:#F4F4F5;font-size:20px;font-weight:600;letter-spacing:0.05em;',
        'font-family:Cinzel,serif;margin-bottom:10px;}',
        '#_wp_idle_msg{color:#A1A1AA;font-size:15px;line-height:1.6;margin-bottom:28px;font-family:"Cormorant Garamond",serif;}',
        '#_wp_idle_btn{display:inline-block;padding:12px 40px;background:#E8C854;color:#18181B;',
        'border:none;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.15em;',
        'text-transform:uppercase;cursor:pointer;font-family:"Cormorant Garamond",serif;',
        'transition:background .2s,transform .15s;outline:none;}',
        '#_wp_idle_btn:hover{background:#C9A630;}',
        '#_wp_idle_btn:active{transform:scale(0.96);}'
      ].join('');
      document.head.appendChild(s);
    }

    var overlay = document.createElement('div');
    overlay.id = '_wp_idle_overlay';
    overlay.innerHTML = [
      '<div id="_wp_idle_card">',
      '  <span id="_wp_idle_icon">lock_clock</span>',
      '  <div id="_wp_idle_title">Session Expired</div>',
      '  <div id="_wp_idle_msg">You have been signed out due to inactivity.<br>Please log in again to continue.</div>',
      '  <button id="_wp_idle_btn">Got It</button>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);

    // Trigger transition on next frame
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { overlay.classList.add('show'); });
    });

    document.getElementById('_wp_idle_btn').addEventListener('click', function () {
      overlay.classList.remove('show');
      setTimeout(onConfirm, 280);
    });
  }

  // ── Idle timer: auto-logout after 10 minutes without activity ─────────────
  var idleTimer;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      // Clear auth first so heartbeat stops, then show modal
      clearAuth();
      try { clearInterval(window._wpHbInterval); } catch (e) {}
      showIdleLogoutModal(function () {
        window.location.replace('./login.html?ref=idle');
      });
    }, IDLE_MS);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function (ev) {
    document.addEventListener(ev, resetIdle, { passive: true });
  });
  resetIdle();

})();

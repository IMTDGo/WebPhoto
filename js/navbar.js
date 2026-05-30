/**
 * SNAPBRIFY — Shared Navbar
 * Injects the top navigation bar into every page that loads this script.
 * Requires: auth.js (provides _wpIsLoggedIn, _wpGoToApp, _wpDoLogout)
 * Pairs with: i18n.js (for language switching)
 *
 * Usage: <script src="./js/navbar.js"></script>  (in <head>, after auth.js)
 * The nav is appended as the FIRST child of <body> automatically.
 */
(function () {
  /* ─────────────────────────────────────────────────────────────
     1. INJECT STYLES
  ───────────────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.id = 'snap-nav-styles';
  style.textContent = `
    #global-nav {
      position: fixed !important;
      top: 0;
      left: 0;
      right: 0;
      z-index: 50;
       display: block !important;
    }
    #global-nav .nav-shell {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      column-gap: clamp(10px, 2vw, 28px);
       width: 100%;
      height: 56px;
    }
    @media (min-width: 768px) {
      #global-nav .nav-shell { height: 80px; }
    }
    #desktopCenterNav {
      display: flex;
      align-items: center;
      justify-self: center;
      gap: clamp(10px, 2.2vw, 32px);
      min-width: 0;
    }
    #desktopCenterNav > a {
      font-size: clamp(10px, 0.82vw, 12px);
      white-space: nowrap;
    }
    #desktopAuthControls {
      display: flex;
      align-items: center;
      justify-self: end;
      gap: clamp(8px, 1.6vw, 16px);
      min-width: fit-content;
    }
    .snap-lang-select {
      appearance: none !important;
      -webkit-appearance: none !important;
      -moz-appearance: none !important;
      padding-right: 2rem !important;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23A1A1AA' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
      background-repeat: no-repeat !important;
      background-position: right 0.6rem center !important;
      background-size: 0.7rem !important;
      cursor: pointer;
    }
    .snap-lang-select::-ms-expand { display: none; }

    @media (max-width: 1024px) {
      #desktopCenterNav,
      #desktopAuthControls { display: none !important; }
      #navMobileMenuBtn { display: inline-flex !important; }
    }
    @media (min-width: 1025px) {
      #navMobileMenuBtn { display: none !important; }
      #navMobilePanel, #navMobileBackdrop { display: none !important; }
    }
    @media (max-width: 1200px) {
      #desktopCenterNav { gap: clamp(8px, 1.3vw, 14px); }
      #desktopAuthControls { gap: clamp(8px, 1vw, 12px); }
    }
  `;
  document.head.appendChild(style);

  /* ─────────────────────────────────────────────────────────────
     2. BUILD HTML
  ───────────────────────────────────────────────────────────── */
  const nav = document.createElement('nav');
  nav.id = 'global-nav';
  nav.setAttribute('style', 'position:fixed');
  nav.className = 'w-full bg-surface/80 backdrop-blur-xl border-b border-on-surface/10 px-6 md:px-16 transition-all duration-300';

  // Detect current page for active link highlighting
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  function navLink(href, key, label) {
    const isActive = currentPath === href;
    const activeClass = isActive ? 'text-primary' : 'text-on-surface-variant hover:text-primary';
    return `<a href="./${href}" class="font-label-sm text-label-sm ${activeClass} transition-colors duration-250 uppercase tracking-widest" data-i18n="${key}">${label}</a>`;
  }
  function mobileNavLink(href, key, label) {
    const isActive = currentPath === href;
    const activeClass = isActive ? 'text-primary bg-surface-container' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container';
    return `<a href="./${href}" class="mobile-menu-link px-3 py-2 rounded-lg font-label-sm text-label-sm ${activeClass} transition-colors uppercase tracking-widest" data-i18n="${key}">${label}</a>`;
  }

  nav.innerHTML = `
    <div class="nav-shell">
      <!-- Logo -->
      <a href="./" class="font-headline-lg text-[26px] md:text-headline-lg tracking-tighter text-primary hover:text-primary-fixed transition-colors duration-250 select-none shrink-0"
         style="font-family:'Cinzel',serif">SNAPBRIFY</a>

      <!-- Centre nav links (desktop) -->
      <div id="desktopCenterNav">
        ${navLink('projects.html',   'nav_projects', 'Projects')}
        ${navLink('contact.html',    'nav_contact',  'Contact Us')}
        ${navLink('manage-plan.html','nav_manage',   'Manage Plan')}
        ${navLink('beta-notice.html','nav_beta',     'Beta Notice')}
      </div>

      <!-- Right side: auth + language (desktop) and hamburger (mobile) -->
      <div style="display:flex;align-items:center;justify-self:end;gap:8px">

        <!-- Desktop auth + language controls -->
        <div id="desktopAuthControls">
          <!-- Language selector -->
          <select id="navDesktopLang"
            class="snap-lang-select px-3 py-1.5 rounded-full border border-outline-variant/40 bg-surface-container/50 text-on-surface-variant hover:text-primary hover:border-primary/40 text-[12px] outline-none transition-colors font-label-sm leading-none">
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>

          <!-- Logged-out state -->
          <a href="./signup.html" id="navSignUp"
            class="font-label-sm text-label-sm text-on-surface-variant hover:text-primary transition-colors duration-250 uppercase tracking-widest"
            data-i18n="sign_up">Sign Up</a>
          <a href="./login.html?ref=app" id="navLogin"
            class="bg-primary text-on-primary font-label-sm text-label-sm px-4 md:px-6 py-2 md:py-2.5 rounded-full hover:bg-primary-container hover:shadow-[0_4px_12px_rgba(242,202,80,0.3)] transition-all duration-250 ease-out active:scale-95"
            data-i18n="login">Login</a>

          <!-- Logged-in state -->
          <div id="navUserGroup" class="hidden items-center gap-2 md:gap-3">
            <div class="flex items-center gap-1.5 md:gap-2 bg-primary/10 border border-primary/25 rounded-full px-2.5 md:px-3 py-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0"></span>
              <span class="material-symbols-outlined text-primary/80"
                style="font-size:14px;font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 20">person</span>
              <span id="navUsername"
                class="font-label-sm text-[10px] md:text-label-sm text-primary uppercase tracking-widest max-w-[88px] md:max-w-[120px] truncate"></span>
            </div>
            <button id="btnNavOpenApp"
              class="bg-primary text-on-primary font-label-sm text-label-sm px-3 md:px-5 py-1.5 md:py-2 rounded-full hover:bg-primary-container hover:shadow-[0_4px_12px_rgba(242,202,80,0.3)] transition-all duration-250 ease-out active:scale-95">
              <span data-i18n="start_creating">Start Creating</span>
            </button>
            <button id="btnNavLogout"
              class="font-label-sm text-label-sm text-on-surface-variant/50 hover:text-error/80 transition-colors duration-250 uppercase tracking-widest text-[10px] px-1"
              data-i18n="logout">Log Out</button>
          </div>
        </div>

        <!-- Mobile hamburger -->
        <button id="navMobileMenuBtn"
          class="hidden w-10 h-10 rounded-full border border-outline-variant/40 text-on-surface-variant hover:text-primary hover:border-primary/50 transition-colors items-center justify-center"
          aria-label="Open menu" aria-expanded="false">
          <span class="material-symbols-outlined" style="font-size:20px">menu</span>
        </button>
      </div>
    </div>

    <!-- Mobile backdrop -->
    <div id="navMobileBackdrop" class="hidden fixed inset-0 bg-black/55" style="z-index:49"></div>

    <!-- Mobile dropdown panel -->
    <div id="navMobilePanel"
      class="hidden absolute right-0 top-full mt-2 w-[min(88vw,320px)] rounded-xl border border-outline-variant/30 bg-surface/95 backdrop-blur-xl shadow-[0_12px_32px_rgba(0,0,0,0.45)] p-3"
      style="z-index:51">

      <!-- User row (logged-in) -->
      <div id="mobileMenuUserRow" class="hidden mb-3 pb-3 border-b border-outline-variant/20">
        <p class="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-widest mb-1"
           data-i18n="signed_in_as">Signed In As</p>
        <p id="mobileMenuUsername"
           class="font-label-sm text-label-sm text-primary uppercase tracking-widest truncate"></p>
      </div>

      <!-- Page links -->
      <div class="flex flex-col gap-1 mb-3">
        ${mobileNavLink('projects.html',   'nav_projects', 'Projects')}
        ${mobileNavLink('contact.html',    'nav_contact',  'Contact Us')}
        ${mobileNavLink('manage-plan.html','nav_manage',   'Manage Plan')}
        ${mobileNavLink('beta-notice.html','nav_beta',     'Beta Notice')}
      </div>

      <div class="mb-3 border-t border-outline-variant/20"></div>

      <!-- Language selector (mobile) -->
      <div class="mb-3 px-3 py-2 rounded-lg border border-outline-variant/25 bg-surface-container/40">
        <p class="mb-2 font-label-xs text-label-xs text-on-surface-variant uppercase tracking-widest"
           data-i18n="language_label">Language</p>
        <select id="navMobileLang"
          class="snap-lang-select w-full px-2 py-1 rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface text-sm outline-none hover:border-primary/40 transition-colors font-label-sm">
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </div>

      <!-- Auth buttons (mobile) -->
      <div class="flex flex-col gap-2">
        <a href="./login.html?ref=app" id="mobileMenuLogin"
          class="mobile-menu-link px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest text-center"
          data-i18n="login">Login</a>
        <a href="./signup.html" id="mobileMenuSignUp"
          class="mobile-menu-link px-3 py-2 rounded-lg border border-outline-variant/30 text-on-surface-variant font-label-sm text-label-sm uppercase tracking-widest text-center hover:border-primary/40 hover:text-primary transition-colors"
          data-i18n="sign_up">Sign Up</a>
        <button id="mobileMenuStart"
          class="hidden px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest"
          data-i18n="start_creating">Start Creating</button>
        <button id="mobileMenuLogout"
          class="hidden px-3 py-2 rounded-lg border border-outline-variant/30 text-on-surface-variant font-label-sm text-label-sm uppercase tracking-widest hover:text-error/80 transition-colors"
          data-i18n="logout">Log Out</button>
      </div>
    </div>
  `;

  /* ─────────────────────────────────────────────────────────────
     3. MOUNT: insert as first child of <body>
  ───────────────────────────────────────────────────────────── */
  function mount() {
    document.body.insertBefore(nav, document.body.firstChild);
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* ─────────────────────────────────────────────────────────────
     4. INITIALISE LOGIC
  ───────────────────────────────────────────────────────────── */
  function init() {
    /* ── Mobile menu ── */
    const menuBtn      = document.getElementById('navMobileMenuBtn');
    const menuPanel    = document.getElementById('navMobilePanel');
    const menuBackdrop = document.getElementById('navMobileBackdrop');

    function openMenu() {
      menuPanel.classList.remove('hidden');
      menuBackdrop.classList.remove('hidden');
      menuBtn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      menuPanel.classList.add('hidden');
      menuBackdrop.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
    }

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuPanel.classList.contains('hidden') ? openMenu() : closeMenu();
    });
    menuBackdrop.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 1024) closeMenu(); });

    menuPanel.querySelectorAll('.mobile-menu-link').forEach(el => {
      el.addEventListener('click', closeMenu);
    });

    /* ── Language selectors ── */
    // Read saved language directly from localStorage (works regardless of i18n.js load order)
    const LANG_KEY = 'wp_lang_pref';
    const savedLang = localStorage.getItem(LANG_KEY) || 'en';

    // Set initial value immediately after nav is mounted
    const dLang = document.getElementById('navDesktopLang');
    const mLang = document.getElementById('navMobileLang');
    if (dLang) dLang.value = savedLang;
    if (mLang) mLang.value = savedLang;

    function onLangChange(lang) {
      const next = (lang === 'zh' || lang === 'en') ? lang : 'en';
      localStorage.setItem(LANG_KEY, next);
      // Sync all selectors on this page
      if (dLang) dLang.value = next;
      if (mLang) mLang.value = next;
      // Delegate to i18n.js
      if (typeof I18N_SYSTEM !== 'undefined' && I18N_SYSTEM.applyI18n) {
        I18N_SYSTEM.applyI18n(next);
        I18N_SYSTEM.syncLangSelects(next);
      }
    }

    if (dLang) dLang.addEventListener('change', (e) => onLangChange(e.target.value));
    if (mLang) mLang.addEventListener('change', (e) => onLangChange(e.target.value));

    // Apply saved language to the just-injected nav elements
    if (typeof I18N_SYSTEM !== 'undefined' && I18N_SYSTEM.applyI18n) {
      I18N_SYSTEM.applyI18n(savedLang);
    }

    /* ── Auth state ── */
    const isLoggedIn = !!(
      window._wpIsLoggedIn ||
      sessionStorage.getItem('wp_auth') ||
      localStorage.getItem('wp_auth')
    );

    function doLogout() {
      const sid = sessionStorage.getItem('wp_sessionId') || localStorage.getItem('wp_sessionId');
      ['wp_auth', 'wp_token', 'wp_sessionId', 'wp_user'].forEach(k => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
      if (sid) {
        const base = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
          ? location.protocol + '//' + location.host
          : 'https://webphoto-lidl.onrender.com';
        try {
          navigator.sendBeacon(base + '/logout',
            new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' }));
        } catch (_) {}
      }
      window.location.href = './';
    }

    function goToApp() {
      if (typeof window._wpGoToApp === 'function') {
        window._wpGoToApp();
      } else {
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
        window.location.href = isMobile ? './mobile.html' : './desktop.html';
      }
    }

    if (isLoggedIn) {
      // Hide sign-up / login
      const signUp = document.getElementById('navSignUp');
      const login  = document.getElementById('navLogin');
      if (signUp) signUp.style.display = 'none';
      if (login)  login.style.display  = 'none';

      // Show user group
      const userGroup = document.getElementById('navUserGroup');
      if (userGroup) { userGroup.classList.remove('hidden'); userGroup.style.display = 'flex'; }

      // Fill username
      try {
        const raw = sessionStorage.getItem('wp_user') || localStorage.getItem('wp_user');
        if (raw) {
          const u = JSON.parse(raw);
          const name = u.name || u.id || '';
          const navUN = document.getElementById('navUsername');
          const mobUN = document.getElementById('mobileMenuUsername');
          if (navUN) navUN.textContent = name;
          if (mobUN) mobUN.textContent = name;
        }
      } catch (_) {}

      // Wire "Start Creating" and "Log Out"
      const btnOpen   = document.getElementById('btnNavOpenApp');
      const btnLogout = document.getElementById('btnNavLogout');
      if (btnOpen)   btnOpen.addEventListener('click', goToApp);
      if (btnLogout) btnLogout.addEventListener('click', doLogout);

      // Mobile menu: logged-in state
      const mUserRow = document.getElementById('mobileMenuUserRow');
      const mLogin   = document.getElementById('mobileMenuLogin');
      const mSignUp  = document.getElementById('mobileMenuSignUp');
      const mStart   = document.getElementById('mobileMenuStart');
      const mLogout  = document.getElementById('mobileMenuLogout');
      if (mUserRow) mUserRow.classList.remove('hidden');
      if (mLogin)   mLogin.classList.add('hidden');
      if (mSignUp)  mSignUp.classList.add('hidden');
      if (mStart) {
        mStart.classList.remove('hidden');
        mStart.addEventListener('click', goToApp);
      }
      if (mLogout) {
        mLogout.classList.remove('hidden');
        mLogout.addEventListener('click', doLogout);
      }

      // Also hide hero/footer sign-up links if present
      ['heroSignUp', 'footerSignUp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    } else {
      // Logged-out: make sure mobile shows login/signup
      const mUserRow = document.getElementById('mobileMenuUserRow');
      const mStart   = document.getElementById('mobileMenuStart');
      const mLogout  = document.getElementById('mobileMenuLogout');
      if (mUserRow) mUserRow.classList.add('hidden');
      if (mStart)   mStart.classList.add('hidden');
      if (mLogout)  mLogout.classList.add('hidden');
    }
  }
})();

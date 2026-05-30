/**
 * Global i18n system for WebPhoto
 * Handles language detection, switching, persistence, and cross-page sync via localStorage
 */

const I18N_SYSTEM = (() => {
  const LANG_PREF_KEY = 'wp_lang_pref';

  // Complete i18n dictionary
  const I18N = {
    en: {
      meta_title: 'SNAPBRIFY — Transform Reality into Texture',
      nav_projects: 'Projects',
      nav_contact: 'Contact Us',
      nav_manage: 'Manage Plan',
      nav_beta: 'Beta Notice',
      language_label: 'Language',
      sign_up: 'Sign Up',
      login: 'Login',
      start_short: 'Start',
      start_creating: 'Start Creating',
      logout: 'Log Out',
      hero_badge: 'Material Texture Intelligence',
      hero_title_html: 'Transform Reality<br />into Texture',
      hero_desc: 'The most sophisticated image-to-3D material generator for modern creators. Capture, refine, and deploy stunning PBR textures — straight from your phone.',
      create_account: 'Create Account',
      created_by: 'Created By',
      signed_in_as: 'Signed In As'
    },
    zh: {
      meta_title: 'SNAPBRIFY — 將真實轉化為材質',
      nav_projects: '專案列表',
      nav_contact: '聯絡我們',
      nav_manage: '方案管理',
      nav_beta: '測試須知',
      language_label: '語言',
      sign_up: '註冊',
      login: '登入',
      start_short: '開始',
      start_creating: '開始製作',
      logout: '登出',
      hero_badge: '材質智慧引擎',
      hero_title_html: '將真實世界<br />轉化為材質',
      hero_desc: '為現代創作者打造的影像轉 3D 材質平台。拍攝、微調並部署高品質 PBR 貼圖，直接在你的手機完成。',
      create_account: '建立帳號',
      created_by: '創作者',
      signed_in_as: '已登入帳號'
    }
  };

  const browserLocales = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || 'en'];

  // Detect Chinese from browser locale
  function resolveLang(locales) {
    for (const locale of locales) {
      const normalized = String(locale || '').toLowerCase();
      if (normalized.startsWith('zh')) return 'zh';
    }
    return 'en';
  }

  // Get saved language preference, or detect & save on first visit
  function getLanguagePreference() {
    const saved = localStorage.getItem(LANG_PREF_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
    // First visit: detect from browser
    const detected = resolveLang(browserLocales);
    localStorage.setItem(LANG_PREF_KEY, detected);
    return detected;
  }

  // Apply i18n to DOM
  function applyI18n(activeLang) {
    const dict = I18N[activeLang] || I18N.en;
    document.documentElement.lang = activeLang === 'zh' ? 'zh-Hant' : 'en';
    document.title = dict.meta_title || I18N.en.meta_title;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      if (dict[key]) el.innerHTML = dict[key];
    });
  }

  // Sync language selectors on page
  function syncLangSelects(lang) {
    document.querySelectorAll('.lang-select').forEach(select => {
      select.value = lang;
    });
  }

  // Call when user changes language
  function changeLanguage(lang) {
    const nextLang = (lang === 'zh' || lang === 'en') ? lang : 'en';
    localStorage.setItem(LANG_PREF_KEY, nextLang);
    applyI18n(nextLang);
    syncLangSelects(nextLang);
  }

  // Initialize i18n on page load
  function init() {
    const currentLang = getLanguagePreference();
    applyI18n(currentLang);
    syncLangSelects(currentLang);

    // Setup event listeners on all language selectors
    document.querySelectorAll('.lang-select').forEach(select => {
      select.addEventListener('change', (e) => changeLanguage(e.target.value));
    });

    // Cross-page sync: listen to localStorage changes from other tabs/windows
    window.addEventListener('storage', (e) => {
      if (e.key === LANG_PREF_KEY && e.newValue) {
        applyI18n(e.newValue);
        syncLangSelects(e.newValue);
      }
    });
  }

  return {
    I18N,
    init,
    changeLanguage,
    getLanguagePreference,
    applyI18n,
    syncLangSelects
  };
})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => I18N_SYSTEM.init());
} else {
  I18N_SYSTEM.init();
}

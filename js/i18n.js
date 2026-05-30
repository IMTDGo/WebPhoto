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
      signed_in_as: 'Signed In As',
      // projects.html
      projects_badge: 'Material Archive',
      projects_title: 'Project History',
      projects_desc: 'All your uploaded PBR material sets. Download ZIPs or revisit individual channels.',
      projects_filter_date: 'Date: Newest First',
      projects_th_thumb: 'Thumb',
      projects_th_name: 'Project Name',
      projects_th_channels: 'Channels',
      projects_th_uploaded: 'Uploaded',
      projects_th_actions: 'Actions',
      projects_empty_title: 'No projects yet',
      projects_empty_desc: 'Upload your first texture set to see it here.',
      projects_login_title: 'Sign in to view your projects',
      projects_login_desc: 'Your upload history is tied to your account.',
      // contact.html
      contact_badge: 'Get in Touch',
      contact_title: 'Contact Us',
      contact_desc: 'Have a question or need support? Our team is here to help you create better textures.',
      contact_name_label: 'Name',
      contact_email_label: 'Email',
      contact_subject_label: 'Subject',
      contact_message_label: 'Message',
      contact_send_btn: 'Send Message',
      contact_response_time: 'Response Time',
      contact_response_val: 'Usually within 24 hours',
      // manage-plan.html
      plan_title: 'Manage Your Plan',
      plan_desc: 'Review available tiers and manage your subscription preferences. Billing is not yet active.',
      // beta-notice.html
      beta_badge: 'Open Beta — Build 1.0',
      beta_title: 'Beta Testing Notice',
      beta_desc: 'Please read the following information before using SNAPBRIFY. This document outlines what the platform does, how your data is handled, and the current limitations of the beta environment.',
      // editor pages
      editor_label: 'Editor'
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
      signed_in_as: '已登入帳號',
      // projects.html
      projects_badge: '材質資料庫',
      projects_title: '專案歷史',
      projects_desc: '所有已上傳的 PBR 材質集。下載 ZIP 或重新查看各通道。',
      projects_filter_date: '日期：最新優先',
      projects_th_thumb: '縮圖',
      projects_th_name: '專案名稱',
      projects_th_channels: '通道',
      projects_th_uploaded: '上傳日期',
      projects_th_actions: '操作',
      projects_empty_title: '尚無專案',
      projects_empty_desc: '上傳第一個材質集，就可以在這裡看到。',
      projects_login_title: '請登入查看您的專案',
      projects_login_desc: '上傳紀錄與您的帳號綁定。',
      // contact.html
      contact_badge: '與我們聯繫',
      contact_title: '聯絡我們',
      contact_desc: '有任何問題或需要支援？我們的團隊隨時為您提供協助。',
      contact_name_label: '姓名',
      contact_email_label: '電子郵件',
      contact_subject_label: '主旨',
      contact_message_label: '訊息',
      contact_send_btn: '送出訊息',
      contact_response_time: '回覆時間',
      contact_response_val: '通常 24 小時內回覆',
      // manage-plan.html
      plan_title: '管理方案',
      plan_desc: '查看可用方案並管理訂閱偏好。目前尚未開放付款。',
      // beta-notice.html
      beta_badge: '公開測試版 — Build 1.0',
      beta_title: '測試須知',
      beta_desc: '使用 SNAPBRIFY 前，請詳閱以下資訊。本文說明平台功能、資料處理方式及測試版目前的限制。',
      // editor pages
      editor_label: '編輯器'
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

  // Sync language selectors on page (covers both .lang-select and .snap-lang-select)
  function syncLangSelects(lang) {
    document.querySelectorAll('.lang-select, .snap-lang-select').forEach(select => {
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

    // Re-sync after a short delay to catch selectors injected by navbar.js
    // Re-sync and re-apply after navbar.js DOMContentLoaded fires (setTimeout fires after all sync listeners)
    setTimeout(() => {
      syncLangSelects(currentLang);
      applyI18n(currentLang);
    }, 0);

    // Setup event listeners on all language selectors (both classes)
    document.querySelectorAll('.lang-select, .snap-lang-select').forEach(select => {
      select.addEventListener('change', (e) => changeLanguage(e.target.value));
    });

    // Cross-page sync: listen to localStorage changes from other tabs/windows
    window.addEventListener('storage', (e) => {
      if (e.key === LANG_PREF_KEY && e.newValue && (e.newValue === 'zh' || e.newValue === 'en')) {
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
// Expose on window so other scripts can reference window.I18N_SYSTEM
window.I18N_SYSTEM = I18N_SYSTEM;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => I18N_SYSTEM.init());
} else {
  I18N_SYSTEM.init();
}

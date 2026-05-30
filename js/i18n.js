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
      editor_label: 'Editor',
      // projects.html modal
      projects_ch_maps: 'Channel Maps',
      // contact.html subject options
      contact_opt_support: 'Technical Support',
      contact_opt_billing: 'Account & Billing',
      contact_opt_feature: 'Feature Request',
      contact_opt_partner: 'Partnership',
      contact_opt_other: 'Other',
      // desktop.html
      editor_subtitle: 'Material Editor · PBR Channel Generator',
      editor_upload_title: 'Upload Source Image',
      editor_drop_desc: 'Drop a texture to generate Base Color, Roughness, AO, Height, Metallic and Normal maps',
      editor_drop_hint: 'Drop image here',
      editor_browse_or: 'or <span class="text-secondary">browse files</span>',
      editor_browse_btn: 'BROWSE FILES',
      editor_generate_btn: 'Generate Channels',
      editor_confirm_title: 'Confirm Channel Maps',
      editor_confirm_desc: 'Review each channel before uploading to Cloudflare',
      editor_cancel: 'Cancel',
      editor_confirm_upload: 'Confirm Upload',
      editor_success_title: 'Upload Successful',
      editor_success_desc: 'All 6 channel maps have been generated and saved to Cloudflare.',
      editor_back_home: 'Back to Homepage',
      editor_new_material: 'Create Another',
      editor_upload_cloud: 'Uploading to Cloud',
      // mobile.html
      mobile_get_started: 'Get Started',
      mobile_take_desc: 'Take a photo or choose one from your gallery, then adjust the crop area.',
      mobile_take_photo: 'Take a Photo',
      mobile_gallery: 'Choose from Gallery',
      mobile_tip: 'Tip: Drag to reposition · pinch to resize crop area',
      mobile_retake: 'Retake',
      mobile_reselect: 'Reselect',
      mobile_next: 'Next →',
      mobile_confirm_maps: 'Confirm Channel Maps',
      mobile_review_desc: 'Review each channel before uploading',
      mobile_upload_btn: 'Confirm Upload',
      mobile_back: '← Back',
      mobile_generating: 'Generating channels...',
      mobile_upload_cloud: 'Uploading to Cloud',
      mobile_name_upload: 'Name & Upload',
      mobile_folder_name: 'Folder Name',
      mobile_email_done: 'Email material links when done'
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
      editor_label: '編輯器',
      // projects.html modal
      projects_ch_maps: '通道圖',
      // contact.html subject options
      contact_opt_support: '技術支援',
      contact_opt_billing: '帳號與付款',
      contact_opt_feature: '功能建議',
      contact_opt_partner: '合作洽談',
      contact_opt_other: '其他',
      // desktop.html
      editor_subtitle: '材質編輯器 · PBR 通道生成器',
      editor_upload_title: '上傳來源圖片',
      editor_drop_desc: '拖放材質圖片，自動生成 Base Color、Roughness、AO、Height、Metallic 及 Normal 通道',
      editor_drop_hint: '拖放圖片至此',
      editor_browse_or: '或 <span class="text-secondary">選擇檔案</span>',
      editor_browse_btn: '選擇檔案',
      editor_generate_btn: '生成通道',
      editor_confirm_title: '確認通道圖',
      editor_confirm_desc: '上傳至 Cloudflare 前，請先確認各通道',
      editor_cancel: '取消',
      editor_confirm_upload: '確認上傳',
      editor_success_title: '上傳成功',
      editor_success_desc: '已成功生成 6 個通道圖並儲存至 Cloudflare。',
      editor_back_home: '返回主頁',
      editor_new_material: '繼續製作',
      editor_upload_cloud: '上傳至雲端',
      // mobile.html
      mobile_get_started: '開始使用',
      mobile_take_desc: '拍攝照片或從相簿選擇，再調整裁切範圍。',
      mobile_take_photo: '拍攝照片',
      mobile_gallery: '從相簿選擇',
      mobile_tip: '提示：拖動以移動 · 捏合以調整裁切範圍',
      mobile_retake: '重新拍攝',
      mobile_reselect: '重新選擇',
      mobile_next: '下一步 →',
      mobile_confirm_maps: '確認通道圖',
      mobile_review_desc: '上傳前請確認各通道',
      mobile_upload_btn: '確認上傳',
      mobile_back: '← 返回',
      mobile_generating: '生成通道中…',
      mobile_upload_cloud: '上傳至雲端',
      mobile_name_upload: '命名並上傳',
      mobile_folder_name: '資料夾名稱',
      mobile_email_done: '完成後以電子郵件傳送材質連結'
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

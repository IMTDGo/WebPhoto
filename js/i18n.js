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
      mobile_email_done: 'Email material links when done',
      // beta-notice.html full content
      beta_s1_title: '01. What is SNAPBRIFY?',
      beta_s1_p: 'SNAPBRIFY is a browser-based PBR (Physically Based Rendering) texture generation tool. Upload any photograph and the engine automatically derives a complete set of material maps \u2014 Base Color, Roughness, Ambient Occlusion, Height, Metallic, and Normal \u2014 ready to use in any 3D application, game engine, or design pipeline. No software installation is required; everything runs in your browser.',
      beta_s2_title: '02. Beta Status',
      beta_s2_p: 'The platform is currently in open beta. You may encounter unexpected behaviour, performance inconsistencies, or temporary downtime as we continue development. We appreciate your patience and welcome any feedback sent through the Contact page.',
      beta_info_version: 'Version',
      beta_info_platform: 'Platform',
      beta_info_status: 'Status',
      beta_info_live: 'Live',
      beta_s3_title: '03. Privacy & Data Collection',
      beta_s3_p: 'We are committed to keeping this tool lightweight and non-intrusive. During the beta period:',
      beta_priv1_title: 'No user data is collected.',
      beta_priv1_desc: 'We do not collect, sell, or share personal data. Your email address is used only to deliver your download link and is not stored beyond that session.',
      beta_priv2_title: 'Uploaded images are temporary.',
      beta_priv2_desc: 'All uploaded files and generated texture sets are automatically deleted from our servers 24 hours after the project is created. Do not rely on SNAPBRIFY as a permanent storage solution.',
      beta_s4_title: '04. Current Limits & Fair Use',
      beta_s4_p: 'To ensure fair access for all users during the beta period, the following limits are in effect:',
      beta_lim1_label: 'Max Image Size',
      beta_lim1_val: '2 MB per upload',
      beta_lim1_desc: 'Images larger than 2 MB will be automatically compressed before processing.',
      beta_lim2_label: 'Project Retention',
      beta_lim2_val: '24 hours',
      beta_lim2_desc: 'All projects and generated files are permanently deleted 24 hours after creation.',
      beta_lim3_label: 'Per-Account Daily Quota',
      beta_lim3_val: '3 uploads per account',
      beta_lim3_desc: 'Each account may submit up to 3 texture generation jobs per day.',
      beta_lim4_label: 'Global Daily Capacity',
      beta_lim4_val: '200 accounts per day',
      beta_lim4_desc: 'A maximum of 200 unique accounts may upload per day across the entire platform. Once the cap is reached, uploads are paused until the daily reset.',
      beta_s5_title: '05. Daily Reset',
      beta_reset_p1: 'All quotas reset daily at 23:59 Taiwan Standard Time (UTC+8).',
      beta_reset_p2: 'This includes both the per-account upload count and the platform-wide 200-account capacity. If uploads are unavailable, please check back after the daily reset.',
      beta_s6_title: '06. Disclaimer',
      beta_disclaimer: 'SNAPBRIFY is provided as-is during the beta period. We do not guarantee continuous availability, accuracy of generated materials, or preservation of uploaded files beyond the stated 24-hour window. By using the platform, you acknowledge these limitations and agree not to use it for storing irreplaceable assets.',
      beta_last_updated: 'Last updated \u2014 May 2026',
      beta_send_feedback: 'Send Feedback',
      beta_back_home: 'Back to Home',
      // login.html
      login_welcome: 'Welcome Back',
      login_desc: 'Sign in to access your workspace.',
      login_account_label: 'Account',
      login_password_label: 'Password',
      login_remember: 'Remember Me',
      login_remember_hint: '(Do not use on public computers)',
      login_btn: 'Log In',
      login_no_account: "Don't have an account?",
      // manage-plan.html
      plan_status_notice: 'Status Notice',
      plan_wip_title: 'Pricing \u2014 Needs Further Discussion',
      plan_wip_desc_html: 'The subscription tiers and pricing below are <strong class="text-on-surface">not yet finalized</strong>. Plans are currently being evaluated and are subject to change. Please <a href="./contact.html" class="text-primary hover:text-primary-fixed underline">contact us</a> for the latest information.',
      plan_tbd_badge: 'TBD',
      plan_current_badge: 'Current Plan',
      plan_free_tier: 'Free Tier',
      plan_per_month: '/ month',
      plan_feat_pbr: 'PBR Channel Generation',
      plan_feat_mobile_cap: 'Mobile Capture',
      plan_feat_seamless: 'Seamless Tiling',
      plan_feat_storage: 'Cloudflare R2 Storage',
      plan_billing_inactive: 'Billing Not Active',
      plan_contact_us: 'Contact Us',
      plan_quota_title: 'Upload Quota',
      plan_quota_desc: 'Your current daily upload allowance.',
      plan_uploads_today: 'Uploads Today',
      plan_daily_uploaders: 'Daily Uploaders',
      plan_200_max: '200 max',
      plan_platform_cap: 'Platform-wide daily unique uploader cap',
      plan_tiers_title: 'Available Tiers',
      plan_pricing_tbd_badge: 'Pricing TBD',
      plan_tiers_desc: 'The following plans are conceptual and subject to further discussion.',
      plan_starter_title: 'Starter',
      plan_starter_desc: 'For individual creators just getting started.',
      plan_feat_5uploads: 'Up to 5 uploads / day',
      plan_feat_standard_res: 'Standard resolution export',
      plan_feat_email: 'Email delivery',
      plan_coming_soon: 'Coming Soon',
      plan_pro_title: 'Professional',
      plan_pro_desc: 'For studios and professional 3D artists.',
      plan_feat_unlimited: 'Unlimited uploads',
      plan_feat_4k8k: '4K / 8K export support',
      plan_feat_priority: 'Priority processing',
      plan_feat_dedicated: 'Dedicated storage quota',
      plan_under_discussion: 'Under Discussion',
      plan_enterprise_title: 'Enterprise',
      plan_enterprise_desc: 'Custom solutions for large teams and studios.',
      plan_enterprise_price: 'Contact Us',
      plan_feat_custom_quotas: 'Custom quotas',
      plan_feat_infra: 'Dedicated infrastructure',
      plan_feat_sla: 'SLA support',
      plan_get_in_touch: 'Get in Touch',
      plan_discuss_title: 'Want to help shape the pricing?',
      plan_discuss_desc: "We're actively gathering feedback from early users. If you have thoughts on what a fair pricing model looks like, we'd love to hear from you.",
      plan_share_feedback: 'Share Feedback',
      // page footer shared
      footer_contact: 'Contact',
      footer_manage_plan: 'Manage Plan',
      // index.html feature chips
      chip_mobile_cap: 'Mobile Capture',
      chip_hdr: 'HDR Merge',
      chip_awb: 'Auto White Balance',
      chip_pbr_maps: 'PBR Channel Maps',
      chip_seamless: 'Seamless Tiling',
      // signup.html
      signup_create_title: 'Create Your Account',
      signup_subtitle: 'Join SNAPBRIFY and start creating',
      signup_username_label: 'Username',
      signup_username_hint: 'Letters, numbers or underscore · 3–30 chars',
      signup_password_label: 'Password',
      signup_password_hint: 'Minimum 8 characters',
      signup_confirm_label: 'Confirm Password',
      signup_email_label: 'Email Address',
      signup_email_hint: 'A 6-digit code will be sent to your inbox · valid 10 min',
      signup_send_otp: 'Send OTP',
      signup_already: "Already have an account?",
      signup_verify_title: 'Verify Email',
      signup_verify_sent: 'Verification code sent to',
      signup_otp_label: 'Verification Code',
      signup_otp_hint: 'Enter the 6-digit verification code',
      signup_no_code: "Didn't receive it?",
      signup_resend: 'Resend',
      signup_verify_btn: 'Verify',
      signup_back: 'Back',
      // contact.html sidebar
      contact_support_label: 'Support',
      contact_platform_tagline_html: 'PBR Material Generation Platform<br/>AI-powered texture intelligence',
      contact_what_support: 'What we support',
      contact_tag_pbr: 'PBR Generation',
      contact_tag_hdr: 'HDR Capture',
      contact_tag_billing: 'Account & Billing',
      contact_tag_r2: 'Cloudflare R2',
      // manage-plan.html
      plan_focus_badge: 'Focus',
      // placeholders
      ph_your_name: 'Your Name',
      ph_message: 'Tell us about your issue or question...',
      ph_search_projects: 'Search projects...'
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
      mobile_email_done: '完成後以電子郵件傳送材質連結',
      // beta-notice.html full content
      beta_s1_title: '01. 什麼是 SNAPBRIFY？',
      beta_s1_p: 'SNAPBRIFY 是一款基於瀏覽器的 PBR（物理基礎渲染）材質生成工具。上傳任意照片，引擎即可自動生成完整的材質貼圖套組——Base Color、Roughness、Ambient Occlusion、Height、Metallic 及 Normal——可直接用於任何 3D 應用程式、遊戲引擎或設計流程。無需安裝任何軟體；一切皆在瀏覽器中執行。',
      beta_s2_title: '02. 測試版狀態',
      beta_s2_p: '本平台目前正處於公開測試階段。隨著我們持續開發，您可能會遇到非預期行為、效能不穩或暫時性中斷。感謝您的耐心等候，歡迎透過聯絡頁面向我們提供意見回饋。',
      beta_info_version: '版本',
      beta_info_platform: '平台',
      beta_info_status: '狀態',
      beta_info_live: '運行中',
      beta_s3_title: '03. 隱私與資料收集',
      beta_s3_p: '我們致力於讓本工具保持輕量且不干擾使用者。在測試期間：',
      beta_priv1_title: '不收集使用者資料。',
      beta_priv1_desc: '我們不收集、出售或分享個人資料。您的電子郵件地址僅用於傳送下載連結，不會在該工作階段結束後保留。',
      beta_priv2_title: '上傳的圖片為暫存性質。',
      beta_priv2_desc: '所有上傳的檔案和生成的材質套組，將在專案建立後 24 小時內自動從伺服器刪除。請勿將 SNAPBRIFY 視為永久儲存方案。',
      beta_s4_title: '04. 目前限制與公平使用',
      beta_s4_p: '為確保測試期間所有使用者均可公平存取，以下限制目前有效：',
      beta_lim1_label: '最大圖片大小',
      beta_lim1_val: '每次上傳 2 MB',
      beta_lim1_desc: '超過 2 MB 的圖片將在處理前自動壓縮。',
      beta_lim2_label: '專案保留期限',
      beta_lim2_val: '24 小時',
      beta_lim2_desc: '所有專案及生成的檔案，將在建立後 24 小時內永久刪除。',
      beta_lim3_label: '每帳號每日配額',
      beta_lim3_val: '每帳號 3 次上傳',
      beta_lim3_desc: '每個帳號每日最多可提交 3 次材質生成任務。',
      beta_lim4_label: '全球每日上限',
      beta_lim4_val: '每日 200 個帳號',
      beta_lim4_desc: '每日全平台最多允許 200 個不重複帳號上傳。一旦達到上限，上傳功能將暫停至每日重置。',
      beta_s5_title: '05. 每日重置',
      beta_reset_p1: '所有配額每日於台灣標準時間（UTC+8）23:59 重置。',
      beta_reset_p2: '此重置包含每帳號的上傳次數及全平台 200 帳號容量。若上傳功能暫時無法使用，請於每日重置後再試。',
      beta_s6_title: '06. 免責聲明',
      beta_disclaimer: 'SNAPBRIFY 在測試期間按現狀提供。我們不保證持續可用性、生成材質的準確性，或在規定 24 小時保留窗口之外保留上傳的檔案。使用本平台即表示您認知並接受上述限制，並同意不將其用於儲存不可替代的資產。',
      beta_last_updated: '最後更新 — 2026 年 5 月',
      beta_send_feedback: '送出意見',
      beta_back_home: '返回主頁',
      // login.html
      login_welcome: '歡迎回來',
      login_desc: '登入以存取您的工作空間。',
      login_account_label: '帳號',
      login_password_label: '密碼',
      login_remember: '記住我',
      login_remember_hint: '（請勿在公用電腦上勾選）',
      login_btn: '登入',
      login_no_account: '還沒有帳號？',
      // manage-plan.html
      plan_status_notice: '狀態公告',
      plan_wip_title: '定價方案 — 待進一步討論',
      plan_wip_desc_html: '以下訂閱方案與定價尚<strong class="text-on-surface">未確定</strong>。目前正在評估方案，內容可能有所更動。如需最新資訊，請<a href="./contact.html" class="text-primary hover:text-primary-fixed underline">聯絡我們</a>。',
      plan_tbd_badge: '待定',
      plan_current_badge: '目前方案',
      plan_free_tier: '免費版',
      plan_per_month: '/ 月',
      plan_feat_pbr: 'PBR 通道生成',
      plan_feat_mobile_cap: '行動裝置拍攝',
      plan_feat_seamless: '無縫貼圖',
      plan_feat_storage: 'Cloudflare R2 儲存',
      plan_billing_inactive: '付款功能尚未啟用',
      plan_contact_us: '聯絡我們',
      plan_quota_title: '上傳配額',
      plan_quota_desc: '您今日的上傳額度。',
      plan_uploads_today: '今日上傳次數',
      plan_daily_uploaders: '每日上傳用戶數',
      plan_200_max: '上限 200',
      plan_platform_cap: '全平台每日不重複上傳用戶上限',
      plan_tiers_title: '可用方案',
      plan_pricing_tbd_badge: '定價待定',
      plan_tiers_desc: '以下方案為構想中的方案，內容仍在討論中。',
      plan_starter_title: 'Starter',
      plan_starter_desc: '適合個人創作者入門使用。',
      plan_feat_5uploads: '每日最多 5 次上傳',
      plan_feat_standard_res: '標準解析度匯出',
      plan_feat_email: '電子郵件通知',
      plan_coming_soon: '即將推出',
      plan_pro_title: '專業版',
      plan_pro_desc: '適合工作室及專業 3D 藝術家。',
      plan_feat_unlimited: '無限次上傳',
      plan_feat_4k8k: '4K / 8K 匯出支援',
      plan_feat_priority: '優先處理',
      plan_feat_dedicated: '專屬儲存配額',
      plan_under_discussion: '討論中',
      plan_enterprise_title: '企業版',
      plan_enterprise_desc: '為大型團隊與工作室提供客製化方案。',
      plan_enterprise_price: '聯絡我們',
      plan_feat_custom_quotas: '客製化配額',
      plan_feat_infra: '專屬基礎設施',
      plan_feat_sla: 'SLA 服務等級協議',
      plan_get_in_touch: '立即聯繫',
      plan_discuss_title: '想協助制定定價策略嗎？',
      plan_discuss_desc: '我們正積極蒐集早期使用者的意見。如果您對合理定價模式有想法，歡迎告訴我們。',
      plan_share_feedback: '提供意見',
      // page footer shared
      footer_contact: '聯絡我們',
      footer_manage_plan: '方案管理',
      // index.html feature chips
      chip_mobile_cap: '行動裝置拍攝',
      chip_hdr: 'HDR 合併',
      chip_awb: '自動白平衡',
      chip_pbr_maps: 'PBR 通道圖',
      chip_seamless: '無縫貼圖',
      // signup.html
      signup_create_title: '建立帳號',
      signup_subtitle: '加入 SNAPBRIFY，開始創作',
      signup_username_label: '使用者名稱',
      signup_username_hint: '字母、數字或底線 · 3–30 字元',
      signup_password_label: '密碼',
      signup_password_hint: '至少 8 個字元',
      signup_confirm_label: '確認密碼',
      signup_email_label: 'Email 信筱',
      signup_email_hint: '一組 6 位數驗證碼將寄送至您的信箱 · 有效期 10 分鐘',
      signup_send_otp: '發送驗證碼',
      signup_already: '已經有帳號？',
      signup_verify_title: '驗證電子郵件',
      signup_verify_sent: '驗證碼已寄送至',
      signup_otp_label: '驗證碼',
      signup_otp_hint: '請輸入 6 位數驗證碼',
      signup_no_code: '沒有收到驗證碼？',
      signup_resend: '重新發送',
      signup_verify_btn: '驗證',
      signup_back: '返回',
      // contact.html sidebar
      contact_support_label: '支援',
      contact_platform_tagline_html: 'PBR 材質生成平台<br/>AI 驅動的材質智慧引擎',
      contact_what_support: '我們支援的功能',
      contact_tag_pbr: 'PBR 生成',
      contact_tag_hdr: 'HDR 拍攝',
      contact_tag_billing: '帳號與付款',
      contact_tag_r2: 'Cloudflare R2',
      // manage-plan.html
      plan_focus_badge: '主要方案',
      // placeholders
      ph_your_name: '您的姓名',
      ph_message: '請告訴我們您的問題或疑問…',
      ph_search_projects: '搜尋專案…'
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
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (dict[key]) el.placeholder = dict[key];
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

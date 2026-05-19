// config.js — 靜態版（給 GitHub Pages 使用）
// 本機開發時，server.js 會動態產生這個路由並覆蓋此檔案的值
//
// ⚠️ 請把下方 __BACKEND_URL__ 改成你部署 server.js 的實際網址
//    例如：https://your-app.railway.app
//    如果還沒部署後端，登入功能在 GitHub Pages 上無法使用

window.__API_BASE__   = "https://designhubus.com";   // 外部 design API（專案/材質）
window.__BACKEND_URL__ = "";                          // ← 填入你的 server.js 部署網址

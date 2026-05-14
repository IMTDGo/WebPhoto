/**
 * WebPhoto Upload Server
 *
 * Endpoints:
 *   GET  /            → serves index.html (device-redirect)
 *   GET  /mobile.html → serves mobile.html
 *   GET  /desktop.html→ serves desktop.html
 *   POST /upload      → accepts multipart/form-data { image: File, name: string }
 *                       saves to ./upload/<name>.png
 *   POST /login       → accepts JSON { username, password, rememberMe }
 *                       validates against MongoDB (bcrypt hash)
 *                       returns { ok: bool, message: string }
 *
 * Environment variables (set in .env or Render dashboard):
 *   MONGODB_URI  — MongoDB Atlas connection string
 *   PORT         — server port (default 3000)
 */

'use strict';

require('dotenv').config();

const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const multer    = require('multer');
const mongoose  = require('mongoose');
const bcrypt    = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto    = require('crypto');
const AdmZip    = require('adm-zip');

// ─── In-memory ZIP store (TTL 24 h) ──────────────────────────────────────────
const zipStore = new Map(); // id → { name, buffer, createdAt }
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, e] of zipStore) { if (e.createdAt < cutoff) zipStore.delete(id); }
}, 60 * 60 * 1000).unref();

const PORT       = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'upload');
const LOGIN_LOG  = path.join(__dirname, 'login_log.txt');

// ─── MongoDB connection ───────────────────────────────────────────────────────
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('[db] Connected to MongoDB Atlas'))
    .catch(err => console.error('[db] Connection error:', err.message));
} else {
  console.warn('[db] MONGODB_URI not set — login will use fallback mode');
}

// ─── User schema ──────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // bcrypt hash
  email:    { type: String, unique: true, sparse: true }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

// ─── OTP schema (temporary records for email verification) ───────────────────
const otpSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true },
  username: { type: String, required: true },
  password: { type: String, required: true }, // pre-hashed with bcrypt
  otp:      { type: String, required: true },
  expiresAt:{ type: Date,   required: true }
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB TTL auto-delete
const OtpRecord = mongoose.models.OtpRecord || mongoose.model('OtpRecord', otpSchema);

// ─── Dev accounts (local testing without MongoDB) ────────────────────────────
const DEV_ACCOUNTS_FILE = path.join(__dirname, 'dev-accounts.json');
let devAccounts = {};
if (fs.existsSync(DEV_ACCOUNTS_FILE)) {
  try {
    devAccounts = JSON.parse(fs.readFileSync(DEV_ACCOUNTS_FILE, 'utf8'));
    console.log(`[dev] Loaded ${Object.keys(devAccounts).length} dev account(s) from dev-accounts.json`);
  } catch (e) {
    console.warn('[dev] Failed to load dev-accounts.json:', e.message);
  }
}

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Multer storage ──────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Use the "name" field from the form body (already provided by frontend),
    // sanitise it to prevent path-traversal attacks
    const rawName = (req.body && req.body.name) || file.originalname;
    const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
    const ext = path.extname(file.originalname) || '.png';
    const finalName = safeName.endsWith(ext) ? safeName : safeName + ext;
    cb(null, finalName);
  }
});

const fileFilter = (_req, file, cb) => {
  // Accept only images
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB max
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'name',  maxCount: 1 }
]);

// ─── Static file helper ───────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ─── JSON body parser helper ─────────────────────────────────────────────────
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 4096) reject(new Error('Payload too large')); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ─── Append login attempt to login_log.txt ───────────────────────────────────
function appendLoginLog(username, success) {
  const timestamp = new Date().toISOString();
  const status    = success ? 'SUCCESS' : 'FAILED';
  const line = `[${timestamp}] ${status} | user=${username}\n`;
  fs.appendFile(LOGIN_LOG, line, () => {});
}

// ─── In-memory fallback stores (used when MongoDB is not connected) ─────────
const memOtp   = new Map(); // email → { username, password, otp, expiresAt }
const memUsers = new Map(); // username → { username, password, email }

// ─── Send OTP email ───────────────────────────────────────────────────────────
// 優先順序：Brevo → Resend → SendGrid → Gmail SMTP (本機 fallback)
async function sendOtpEmail(to, otp, custom = null) {
  const subject = custom?.subject || 'WebPhoto 驗證碼';
  const html    = custom?.html    || `<p>您的 WebPhoto 註冊驗證碼是：</p><h2 style="letter-spacing:0.3em">${otp}</h2><p>此驗證碼 10 分鐘內有效，請勿分享給他人。</p>`;
  const text    = custom?.text    || `您的驗證碼是：${otp}，10 分鐘內有效。`;

  // ── Brevo HTTPS ───────────────────────────────────────────────────────────
  if (process.env.BREVO_API_KEY) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: {
        'api-key':      process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender:      { name: 'WebPhoto', email: process.env.BREVO_FROM || process.env.GMAIL_USER },
        to:          [{ email: to }],
        subject:     subject,
        htmlContent: html,
        textContent: text
      })
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Brevo ${r.status}: ${errText}`);
    }
    return;
  }

  // ── Resend HTTPS ──────────────────────────────────────────────────────────
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:    process.env.RESEND_FROM || 'WebPhoto <onboarding@resend.dev>',
        to:      [to],
        subject,
        text,
        html
      })
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return;
  }

  // ── Gmail SMTP（本機開發 fallback）────────────────────────────────────────
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    await transport.sendMail({
      from: `"WebPhoto" <${process.env.GMAIL_USER}>`,
      to, subject, text, html
    });
    return;
  }

  throw new Error('NO_MAIL_SERVICE');
}

// ─── Request handler ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const rawUrl = decodeURIComponent(req.url.split('?')[0]);
  const reqFile = rawUrl === '/' ? 'index.html' : rawUrl.replace(/^\/+/, '');
  const filePath = path.resolve(__dirname, reqFile);
  const isInProject = filePath.startsWith(__dirname + path.sep) || filePath === __dirname;

  // ── CORS preflight ─────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /login ────────────────────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/login') {
    readJsonBody(req)
      .then(async body => {
        const username = String(body.username || '').trim();
        const password = String(body.password || '');

        let success = false;
        let userEmail = null;

        if (mongoose.connection.readyState === 1) {
          // ── MongoDB path ─────────────────────────────────────────────────
          const user = await User.findOne({ username }).lean();
          if (user) {
            success = await bcrypt.compare(password, user.password);
            if (success) userEmail = user.email || null;
          }
        } else {
          // ── Fallback: no DB ──────────────────────────────────────────────
          const devUser = devAccounts[username];
          if (devUser) {
            success = await bcrypt.compare(password, devUser.password);
          } else {
            console.warn('[login] No DB — using hardcoded fallback');
            success = (username === '123456' && password === '123456');
          }
        }

        appendLoginLog(username, success);
        console.log(`[login] user=${username} → ${success ? 'SUCCESS' : 'FAILED'}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(
          success
            ? { ok: true,  message: '登入成功，歡迎回來！', username, email: userEmail }
            : { ok: false, message: '帳號或密碼錯誤，請重試' }
        ));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      });
    return;
  }

  // ── POST /register/send-otp ──────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/register/send-otp') {
    readJsonBody(req)
      .then(async body => {
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const email    = String(body.email    || '').trim().toLowerCase();

        const fail = (code, msg) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: msg }));
        };

        if (!username || !password || !email) return fail(400, '請填寫所有欄位');
        if (!/^[^\s@]+@gmail\.com$/i.test(email)) return fail(400, '請輸入有效的 Gmail 地址');

        const dbReady = mongoose.connection.readyState === 1;

        if (dbReady) {
          const [existingUser, existingEmail] = await Promise.all([
            User.findOne({ username }).lean(),
            User.findOne({ email }).lean()
          ]);
          if (existingUser)  return fail(409, '此帳號名稱已被使用');
          if (existingEmail) return fail(409, '此 Gmail 已被註冊');
        } else {
          // In-memory fallback
          if (memUsers.has(username)) return fail(409, '此帳號名稱已被使用（測試模式）');
          const emailUsed = [...memUsers.values()].some(u => u.email === email);
          if (emailUsed) return fail(409, '此 Gmail 已被註冊（測試模式）');
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const otp       = String(crypto.randomInt(100000, 1000000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        if (dbReady) {
          await OtpRecord.findOneAndUpdate(
            { email },
            { username, password: hashedPassword, otp, expiresAt },
            { upsert: true, new: true }
          );
        } else {
          memOtp.set(email, { username, password: hashedPassword, otp, expiresAt });
        }

        try {
          await sendOtpEmail(email, otp);
          writeLastSent(); // 更新 keepalive 時間戳
        } catch (mailErr) {
          if (mailErr.message === 'NO_MAIL_SERVICE') return fail(503, '郵件服務未設定，請聯繫管理員');
          throw mailErr;
        }

        console.log(`[register] OTP sent to ${email} for user "${username}" (${dbReady ? 'DB' : 'memory'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: '驗證碼已寄出' }));
      })
      .catch(err => {
        console.error('[register/send-otp]', err.message);
        const msg = process.env.NODE_ENV !== 'production'
          ? err.message
          : '伺服器錯誤，請稍後再試';
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: msg }));
      });
    return;
  }

  // ── POST /register/verify ────────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/register/verify') {
    readJsonBody(req)
      .then(async body => {
        const email = String(body.email || '').trim().toLowerCase();
        const otp   = String(body.otp   || '').trim();

        if (!email || !otp) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '請提供 email 與驗證碼' }));
          return;
        }

        const dbReady = mongoose.connection.readyState === 1;
        const record  = dbReady
          ? await OtpRecord.findOne({ email }).lean()
          : memOtp.get(email);

        if (!record) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '找不到驗證請求，請重新發送' }));
          return;
        }
        if (new Date() > record.expiresAt) {
          if (dbReady) await OtpRecord.deleteOne({ email }); else memOtp.delete(email);
          res.writeHead(410, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '驗證碼已過期，請重新發送' }));
          return;
        }
        if (record.otp !== otp) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '驗證碼錯誤，請重試' }));
          return;
        }

        if (dbReady) {
          await User.create({ username: record.username, password: record.password, email });
          await OtpRecord.deleteOne({ email });
        } else {
          memUsers.set(record.username, { username: record.username, password: record.password, email });
          memOtp.delete(email);
        }
        console.log(`[register] User created: "${record.username}" (${email}) (${dbReady ? 'DB' : 'memory'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: '註冊成功！歡迎加入 WebPhoto' + (dbReady ? '' : '（測試模式，重啟後清除）') }));
      })
      .catch(err => {
        console.error('[register/verify]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '伺服器錯誤，請稍後再試' }));
      });
    return;
  }

  // ── POST /send-upload-report ───────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/send-upload-report') {
    readJsonBody(req)
      .then(async body => {
        const email  = String(body.email  || '').trim().toLowerCase();
        const name   = String(body.name   || '').trim();
        const maps   = body.maps; // { basecolor: url, roughness: url, ... }

        if (!email || !name || !maps || typeof maps !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: '缺少必要欄位' }));
          return;
        }

        const CHANNEL_LABELS = {
          basecolor: 'Base Color',
          roughness: 'Roughness',
          ao:        'Ambient Occlusion',
          height:    'Height',
          metallic:  'Metallic',
          normal:    'Normal'
        };

        // ── Build ZIP from Cloudinary URLs ───────────────────────────────
        let zipUrl = null;
        try {
          const zip = new AdmZip();
          const fetches = await Promise.allSettled(
            Object.entries(maps).map(async ([ch, url]) => {
              const r = await fetch(url);
              if (!r.ok) throw new Error(`HTTP ${r.status} for ${ch}`);
              const buf = Buffer.from(await r.arrayBuffer());
              return { ch, buf };
            })
          );
          for (const r of fetches) {
            if (r.status === 'fulfilled') {
              zip.addFile(`${name}_${r.value.ch}.png`, r.value.buf);
            } else {
              console.warn(`[upload-report] ZIP fetch failed: ${r.reason?.message}`);
            }
          }
          const zipBuffer = zip.toBuffer();
          const zipId     = crypto.randomUUID();
          zipStore.set(zipId, { name, buffer: zipBuffer, createdAt: Date.now() });
          const serverUrl = (process.env.SERVER_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
          zipUrl = `${serverUrl}/download-zip/${zipId}`;
          console.log(`[upload-report] ZIP ready: ${zipId} (${(zipBuffer.length / 1024).toFixed(0)} KB)`);
        } catch (zipErr) {
          console.error('[upload-report] ZIP build failed:', zipErr.message);
        }

        const rows = Object.entries(maps).map(([ch, url]) => {
          const label = CHANNEL_LABELS[ch] || ch;
          return `<tr><td style="padding:6px 12px;font-weight:600;color:#94a3b8">${label}</td><td style="padding:6px 12px"><a href="${url}" style="color:#60a5fa">${name}_${ch}</a></td></tr>`;
        }).join('');

        const zipButton = zipUrl
          ? `<div style="margin:20px 0 4px"><a href="${zipUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">⬇ 一鍵下載全部 ZIP（24 小時有效）</a></div>`
          : '';

        const html = `<div style="font-family:sans-serif;background:#0d1117;color:#e0e6f0;padding:24px;border-radius:12px;max-width:560px">
<h2 style="margin:0 0 4px">📦 ${name}</h2>
<p style="color:#64748b;margin:0 0 16px;font-size:13px">WebPhoto 材質貼圖上傳完成</p>
${zipButton}
<table style="width:100%;border-collapse:collapse;background:#1c2333;border-radius:8px;overflow:hidden;margin-top:16px">
<thead><tr style="background:#252d3d"><th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">通道</th><th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">個別下載</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#374151;font-size:11px;margin-top:16px">此信由 WebPhoto 系統自動寄出</p></div>`;

        const text = (zipUrl ? `下載全部 ZIP：${zipUrl}\n\n` : '') +
          Object.entries(maps).map(([ch, url]) => `${name}_${ch}: ${url}`).join('\n');

        await sendOtpEmail(email, null, { subject: `[WebPhoto] ${name} 上傳完成`, html, text });
        console.log(`[upload-report] Sent to ${email} for "${name}"`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, zipUrl }));
      })
      .catch(err => {
        console.error('[upload-report]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      });
    return;
  }

  // ── GET /download-zip/:id ─────────────────────────────────────────────────
  if (req.method === 'GET' && rawUrl.startsWith('/download-zip/')) {
    const id    = rawUrl.slice('/download-zip/'.length).split('?')[0];
    const entry = zipStore.get(id);
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ZIP 已過期或不存在（有效期 24 小時）');
      return;
    }
    const filename = encodeURIComponent(`${entry.name}_textures.zip`);
    res.writeHead(200, {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Content-Length':       entry.buffer.length,
      'Cache-Control':       'no-store',
    });
    res.end(entry.buffer);
    return;
  }

  // POST /upload
  if (req.method === 'POST' && rawUrl === '/upload') {
    upload(req, res, (err) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(err.message);
        return;
      }
      if (!req.files || !req.files['image'] || req.files['image'].length === 0) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('No image file received');
        return;
      }
      const saved = req.files['image'][0];
      console.log(`[upload] Saved: ${saved.filename} (${(saved.size / 1024).toFixed(1)} KB)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, filename: saved.filename }));
    });
    return;
  }

  // GET static files
  if (req.method === 'GET') {
    // Only serve files within the project directory
    if (!isInProject) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    serveStatic(res, filePath);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`\nWebPhoto server running at http://localhost:${PORT}`);
  console.log(`Upload directory: ${UPLOAD_DIR}\n`);
  checkBrevoKeepalive();
});

// ─── Brevo API key keepalive ──────────────────────────────────────────────────
// 每次 server 啟動時檢查：若距離上次寄信已超過 89 天，自動寄一封保活信
// 同時每 24 小時再檢查一次（以防 server 長時間不重啟）
const KEEPALIVE_FILE = path.join(__dirname, '.brevo-keepalive');
const KEEPALIVE_DAYS = 89;
const KEEPALIVE_TO   = process.env.BREVO_KEEPALIVE_TO || process.env.BREVO_FROM;

function readLastSent() {
  try {
    if (fs.existsSync(KEEPALIVE_FILE)) {
      return new Date(fs.readFileSync(KEEPALIVE_FILE, 'utf8').trim());
    }
  } catch {}
  return null;
}

function writeLastSent() {
  try { fs.writeFileSync(KEEPALIVE_FILE, new Date().toISOString()); } catch {}
}

async function checkBrevoKeepalive() {
  if (!process.env.BREVO_API_KEY || !KEEPALIVE_TO) return;

  const last     = readLastSent();
  const daysSince = last ? (Date.now() - last.getTime()) / 86400000 : Infinity;

  if (daysSince >= KEEPALIVE_DAYS) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method:  'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender:      { name: 'WebPhoto', email: process.env.BREVO_FROM || process.env.GMAIL_USER },
          to:          [{ email: KEEPALIVE_TO }],
          subject:     '[WebPhoto] 系統保活通知',
          textContent: `此信由 WebPhoto 系統自動寄出以維持 Brevo API Key 活躍狀態。\n時間：${new Date().toISOString()}`
        })
      });
      if (r.ok) {
        writeLastSent();
        console.log(`[keepalive] Brevo keepalive email sent to ${KEEPALIVE_TO}`);
      } else {
        console.warn('[keepalive] Failed:', await r.text());
      }
    } catch (e) {
      console.warn('[keepalive] Error:', e.message);
    }
  } else {
    console.log(`[keepalive] Last email: ${Math.floor(daysSince)}d ago — OK`);
  }

  // 每 24 小時重新檢查一次
  setTimeout(checkBrevoKeepalive, 24 * 60 * 60 * 1000);
}


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

// ─── Email transporter (lazy creation) ──────────────────────────────────────
function getMailTransport() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
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

        if (mongoose.connection.readyState === 1) {
          // ── MongoDB path ─────────────────────────────────────────────────
          const user = await User.findOne({ username }).lean();
          if (user) {
            success = await bcrypt.compare(password, user.password);
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
            ? { ok: true,  message: '登入成功，歡迎回來！', username }
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

        const transport = getMailTransport();
        if (!transport) return fail(503, '郵件服務未設定，請先在 .env 填入 GMAIL_USER 和 GMAIL_APP_PASSWORD');

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

        await transport.sendMail({
          from: `"WebPhoto" <${process.env.GMAIL_USER}>`,
          to: email,
          subject: 'WebPhoto 驗證碼',
          text: `您的驗證碼是：${otp}，10 分鐘內有效。`,
          html: `<p>您的 WebPhoto 驗證碼是：</p><h2 style="letter-spacing:0.3em">${otp}</h2><p>此驗證碼 10 分鐘內有效，請勿分享給他人。</p>`
        });

        console.log(`[register] OTP sent to ${email} for user "${username}" (${dbReady ? 'DB' : 'memory'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: '驗證碼已寄出' }));
      })
      .catch(err => {
        console.error('[register/send-otp]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: '伺服器錯誤，請稍後再試' }));
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
});

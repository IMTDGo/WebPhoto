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
const multer   = require('multer');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

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
  password: { type: String, required: true } // bcrypt hash
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

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
          // ── Fallback: no DB configured (local dev without .env) ──────────
          console.warn('[login] No DB — using hardcoded fallback');
          success = (username === '123456' && password === '123456');
        }

        appendLoginLog(username, success);
        console.log(`[login] user=${username} → ${success ? 'SUCCESS' : 'FAILED'}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(
          success
            ? { ok: true,  message: '登入成功，歡迎回來！' }
            : { ok: false, message: '帳號或密碼錯誤，請重試' }
        ));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
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

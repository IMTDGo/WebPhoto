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
  username:   { type: String, required: true, unique: true },
  password:   { type: String, required: true }, // bcrypt hash
  name:       { type: String, default: '' },
  email:      { type: String, unique: true, sparse: true },
  permission:    { type: String, default: 'viewer' },
  currentToken:  { type: String, default: null },
  lastLoginAt:   { type: Date,   default: null },
  lastLogoutAt:  { type: Date,   default: null }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

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
// username → { username, password, name, email, permission, currentToken, lastLoginAt, lastLogoutAt }
const memUsers = new Map();
// token → { username, sessionId, createdAt }  (active sessions, both DB and memory modes)
const sessions = new Map();

// ─── Send email ─────────────────────────────────────────────────────────────
// Priority: Resend → SendGrid → Gmail SMTP (local fallback)
async function sendOtpEmail(to, otp, custom = null) {
  const subject = custom?.subject || 'WebPhoto Verification Code';
  const html    = custom?.html    || `<p>Your WebPhoto registration verification code is:</p><h2 style="letter-spacing:0.3em">${otp}</h2><p>This code is valid for 10 minutes. Do not share it with anyone.</p>`;
  const text    = custom?.text    || `Your verification code is: ${otp}. Valid for 10 minutes.`;

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

  // ── Gmail SMTP (local development fallback) ──────────────────────────────
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

  // ── POST /api/auth/login ──────────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/api/auth/login') {
    readJsonBody(req)
      .then(async body => {
        const account  = String(body.account  || '').trim();
        const password = String(body.password || '');

        let success    = false;
        let userRecord = null; // { username, name, email, permission }

        if (mongoose.connection.readyState === 1) {
          // ── MongoDB path ─────────────────────────────────────────────────
          const user = await User.findOne({ username: account }).lean();
          if (user) {
            success = await bcrypt.compare(password, user.password);
            if (success) userRecord = { username: user.username, name: user.name, email: user.email || null, permission: user.permission };
          }
        } else {
          // ── Fallback: dev accounts then memUsers ─────────────────────────
          const devUser = devAccounts[account];
          if (devUser) {
            success = await bcrypt.compare(password, devUser.password);
            if (success) userRecord = { username: account, name: devUser.name || account, email: devUser.email || null, permission: devUser.permission || 'viewer' };
          } else if (memUsers.has(account)) {
            const mu = memUsers.get(account);
            success  = await bcrypt.compare(password, mu.password);
            if (success) userRecord = { username: account, name: mu.name, email: mu.email, permission: mu.permission };
          }
        }

        appendLoginLog(account, success);
        console.log(`[login] user=${account} → ${success ? 'SUCCESS' : 'FAILED'}`);

        if (!success) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Incorrect username or password, please try again' }));
          return;
        }

        // ── Generate token + sessionId ────────────────────────────────────
        const token     = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        const now       = new Date();
        sessions.set(token, { username: userRecord.username, sessionId, createdAt: now });

        if (mongoose.connection.readyState === 1) {
          await User.updateOne({ username: userRecord.username }, { currentToken: token, lastLoginAt: now });
        } else {
          const mu = memUsers.get(userRecord.username) || {};
          memUsers.set(userRecord.username, { ...mu, currentToken: token, lastLoginAt: now });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Login successful, welcome back!',
          data: {
            token,
            sessionId,
            user: {
              id:    userRecord.username,
              name:  userRecord.name,
              email: userRecord.email,
              role:  userRecord.permission,
              plan:  'free'
            }
          }
        }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: err.message }));
      });
    return;
  }

  // ── POST /api/auth/logout ─────────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/api/auth/logout') {
    const authHeader = req.headers['authorization'] || '';
    const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token || !sessions.has(token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, data: null, message: 'Invalid or expired token' }));
      return;
    }

    readJsonBody(req)
      .then(async () => {
        const sessionEntry = sessions.get(token);
        sessions.delete(token);
        const now = new Date();

        if (mongoose.connection.readyState === 1) {
          await User.updateOne(
            { username: sessionEntry.username, currentToken: token },
            { currentToken: null, lastLogoutAt: now }
          );
        } else {
          const mu = memUsers.get(sessionEntry.username);
          if (mu) memUsers.set(sessionEntry.username, { ...mu, currentToken: null, lastLogoutAt: now });
        }

        console.log(`[logout] user=${sessionEntry.username}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: null, message: 'Logged out' }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, data: null, message: err.message }));
      });
    return;
  }

  // ── POST /api/auth/register ──────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/api/auth/register') {
    readJsonBody(req)
      .then(async body => {
        const account    = String(body.account    || '').trim();
        const password   = String(body.password   || '');
        const name       = String(body.name       || '').trim();
        const email      = String(body.email      || '').trim().toLowerCase();
        const permission = String(body.permission || 'viewer').trim();

        const fail = (code, msg) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: msg }));
        };

        if (!account || !password || !name || !email) return fail(400, 'Please fill in all fields');
        if (!/^[a-zA-Z0-9_]{3,30}$/.test(account)) return fail(400, 'Username must be alphanumeric or underscore, 3–30 characters');
        if (password.length < 8) return fail(400, 'Password must be at least 8 characters');

        const dbReady = mongoose.connection.readyState === 1;

        if (dbReady) {
          const [existingUser, existingEmail] = await Promise.all([
            User.findOne({ username: account }).lean(),
            User.findOne({ email }).lean()
          ]);
          if (existingUser || existingEmail) return fail(400, 'Username or email already exists');
        } else {
          if (memUsers.has(account)) return fail(400, 'Username or email already exists');
          const emailUsed = [...memUsers.values()].some(u => u.email === email);
          if (emailUsed) return fail(400, 'Username or email already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        if (dbReady) {
          await User.create({ username: account, password: hashedPassword, name, email, permission });
        } else {
          memUsers.set(account, { username: account, password: hashedPassword, name, email, permission });
        }

        console.log(`[register] User created: "${account}" (${email}) permission=${permission} (${dbReady ? 'DB' : 'memory'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Registration successful! Welcome to WebPhoto' + (dbReady ? '' : ' (test mode, cleared on restart)') }));
      })
      .catch(err => {
        console.error('[api/auth/register]', err.message);
        const msg = process.env.NODE_ENV !== 'production' ? err.message : 'Server error, please try again later';
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: msg }));
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
          res.end(JSON.stringify({ ok: false, message: 'Missing required fields' }));
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
          ? `<div style="margin:20px 0 4px"><a href="${zipUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">⬇ Download All ZIP (valid 24 hours)</a></div>`
          : '';

        const html = `<div style="font-family:sans-serif;background:#0d1117;color:#e0e6f0;padding:24px;border-radius:12px;max-width:560px">
<h2 style="margin:0 0 4px">📦 ${name}</h2>
<p style="color:#64748b;margin:0 0 16px;font-size:13px">WebPhoto texture upload complete</p>
${zipButton}
<table style="width:100%;border-collapse:collapse;background:#1c2333;border-radius:8px;overflow:hidden;margin-top:16px">
<thead><tr style="background:#252d3d"><th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">Channel</th><th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">Individual Download</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#374151;font-size:11px;margin-top:16px">This message was sent automatically by the WebPhoto system</p></div>`;

        const text = (zipUrl ? `Download all ZIP: ${zipUrl}\n\n` : '') +
          Object.entries(maps).map(([ch, url]) => `${name}_${ch}: ${url}`).join('\n');

        await sendOtpEmail(email, null, { subject: `[WebPhoto] ${name} upload complete`, html, text });
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
      res.end('ZIP has expired or does not exist (valid for 24 hours)');
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
    // ── /config.js — expose env vars to frontend ──────────────────────────
    if (rawUrl === '/config.js') {
      const apiBase     = process.env.API_BASE     || '';
      const backendUrl  = process.env.BACKEND_URL  || '';
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(
        `window.__API_BASE__    = ${JSON.stringify(apiBase)};\n` +
        `window.__BACKEND_URL__ = ${JSON.stringify(backendUrl || apiBase)};\n`
      );
      return;
    }

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


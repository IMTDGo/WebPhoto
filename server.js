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
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function _getS3Client() {
  return new S3Client({
    region: 'auto',
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  });
}

// ─── In-memory ZIP store (TTL 48 h, matches UPLOAD_RETENTION_MS) ─────────────
const zipStore = new Map(); // id → { name, buffer, createdAt }
setInterval(() => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  for (const [id, e] of zipStore) { if (e.createdAt < cutoff) zipStore.delete(id); }
}, 60 * 60 * 1000).unref();

// ─── Active session store (TTL 10 min, server-enforced) ──────────────────────
const activeSessions = new Map(); // sessionId → { username, lastActivity }
const SESSION_TTL_MS  = 10 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of activeSessions) {
    if (s.lastActivity < cutoff) activeSessions.delete(id);
  }
}, 60 * 1000).unref();

const PORT       = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'upload');
const LOGIN_LOG  = path.join(__dirname, 'login_log.txt');
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_URL = process.env.R2_BUCKET_URL || '';


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
  // Core
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // bcrypt hash
  email:    { type: String, unique: true, sparse: true },

  // Account status
  isActive:        { type: Boolean, default: true },
  role:            { type: String, enum: ['user', 'admin'], default: 'user' },
  isEmailVerified: { type: Boolean, default: false },

  // Password management
  passwordChangedAt:    { type: Date },
  passwordResetToken:   { type: String },  // store HASHED token
  passwordResetExpires: { type: Date },

  // Email verification
  emailVerifyToken:   { type: String },  // store HASHED token
  emailVerifyExpires: { type: Date },

  // Brute-force / account lock
  loginAttempts: { type: Number, default: 0 },
  lockUntil:     { type: Date },

  // Refresh tokens (array of opaque tokens for multi-device support)
  refreshTokens: [{ type: String }],
}, { timestamps: true });

// Maximum failed attempts before locking account (configurable via env)
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCK_DURATION_MS   = parseInt(process.env.LOCK_DURATION_MS   || String(15 * 60 * 1000), 10); // 15 min default

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

// ─── Upload record (for Cloudflare Images auto-cleanup) ─────────────────────
const uploadRecordSchema = new mongoose.Schema({
  username:   { type: String },
  folderName: { type: String },
  publicIds:  [{ type: String }],
  uploadedAt: { type: Date, default: Date.now, index: true }
});
const UploadRecord = mongoose.models.UploadRecord || mongoose.model('UploadRecord', uploadRecordSchema);

const DAILY_TOTAL_GROUPS_LIMIT = 600;            // site-wide project groups per day
const DAILY_UPLOADS_PER_ACCOUNT = 3;             // project groups per account per day
const EXEMPT_UPLOAD_ACCOUNT = 'testestest';
const UPLOAD_RETENTION_MS = 48 * 60 * 60 * 1000; // auto-delete from Cloudflare after 48 h

// Fallback upload records when MongoDB is unavailable
const memUploadRecords = [];
setInterval(() => {
  const cutoff = Date.now() - UPLOAD_RETENTION_MS;
  for (let i = memUploadRecords.length - 1; i >= 0; i--) {
    if (new Date(memUploadRecords[i].uploadedAt).getTime() < cutoff) {
      memUploadRecords.splice(i, 1);
    }
  }
}, 60 * 60 * 1000).unref();

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
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB max per image
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'name',  maxCount: 1 }
]);

const uploadMapParser = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB max per image (frontend compresses to fit)
}).single('file');

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
// Priority order: Brevo → Resend → SendGrid → Gmail SMTP (local fallback)
async function sendOtpEmail(to, otp, custom = null) {
  const subject = custom?.subject || 'SNAPBRIFY — Verification Code';
  const html    = custom?.html    || `<p>Your SNAPBRIFY registration code is:</p><h2 style="letter-spacing:0.3em">${otp}</h2><p>This code is valid for 10 minutes. Do not share it with anyone.</p>`;
  const text    = custom?.text    || `Your verification code is: ${otp}. Valid for 10 minutes.`;

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
    writeLastSystemUse();
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

  // ── Gmail SMTP (local dev fallback) ──────────────────────────────────────
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

function isR2Configured() {
  return !!(R2_BUCKET_NAME && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_URL);
}

function _sanitizeSlug(input, fallback = 'asset') {
  const raw = String(input || '').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function _extensionFromMime(mimeType) {
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'bin';
}

async function r2UploadBuffer(fileBuffer, objectKey, metadata = {}) {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured on server');
  }

  try {
    const { contentType: ct, ...metaRest } = metadata;
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: fileBuffer,
      ContentType: ct || 'application/octet-stream',
      Metadata: Object.fromEntries(Object.entries(metaRest).map(([k, v]) => [k, String(v)]))
    });
    await _getS3Client().send(cmd);
    const url = `${R2_BUCKET_URL}/${objectKey}`;
    return { url, public_id: objectKey, bytes: fileBuffer.length };
  } catch (err) {
    throw new Error(`R2 upload failed: ${err.message}`);
  }
}

async function r2DeleteObject(objectKey) {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured on server');
  }

  try {
    const cmd = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey
    });
    await _getS3Client().send(cmd);
    return 'ok';
  } catch (err) {
    if (err.name === 'NoSuchKey') return 'not found';
    throw new Error(`R2 delete failed: ${err.message}`);
  }
}

// Daily quota window is anchored to Taiwan Standard Time (UTC+8) and the
// counters reset at 23:59 TST — i.e. a "day" runs [23:59, next-day 23:59).
const TST_OFFSET_MS = 8 * 60 * 60 * 1000;       // UTC+8
const DAY_RESET_OFFSET_MS = 60 * 1000;          // reset 1 minute before midnight (23:59)

function startOfTodayTST() {
  const now = new Date();
  // Shift the clock so that 23:59 TST lands exactly on a calendar-date boundary,
  // take the date there, then shift back to real UTC.
  const shifted = new Date(now.getTime() + TST_OFFSET_MS + DAY_RESET_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
    - TST_OFFSET_MS - DAY_RESET_OFFSET_MS
  );
}

function endOfTodayTST() {
  return new Date(startOfTodayTST().getTime() + 24 * 60 * 60 * 1000);
}

// Keep old names as aliases so nothing else needs changing
const startOfTodayUTC = startOfTodayTST;
const endOfTodayUTC   = endOfTodayTST;

function purgeMemUploadRecords() {
  const cutoff = Date.now() - UPLOAD_RETENTION_MS;
  for (let i = memUploadRecords.length - 1; i >= 0; i--) {
    if (new Date(memUploadRecords[i].uploadedAt).getTime() < cutoff) {
      memUploadRecords.splice(i, 1);
    }
  }
}

async function getTodayUploadStats(username) {
  const start = startOfTodayUTC();
  const end = endOfTodayUTC();

  // One upload produces multiple records (images via /record-upload, ZIP via
  // /send-upload-report) — count distinct (user, folder) groups so quota
  // isn't double-charged
  const computeStats = (records) => {
    const groupKey = r =>
      `${String(r.username || '').trim().toLowerCase()}/${String(r.folderName || '').trim().toLowerCase()}`;
    const named   = records.filter(r => String(r.folderName || '').trim());
    const unnamed = records.length - named.length;
    const totalGroupsToday = new Set(named.map(groupKey)).size + unnamed;

    const userRecords = records.filter(r => String(r.username || '').trim() === username);
    const userFolders = new Set(userRecords.map(r => String(r.folderName || '').trim().toLowerCase()).filter(Boolean));
    const userUnnamed = userRecords.filter(r => !String(r.folderName || '').trim()).length;
    return { totalGroupsToday, userUploadsToday: userFolders.size + userUnnamed };
  };

  if (mongoose.connection.readyState === 1) {
    const todayRecords = await UploadRecord.find({ uploadedAt: { $gte: start, $lt: end } }, { username: 1, folderName: 1 }).lean();
    return computeStats(todayRecords);
  }

  purgeMemUploadRecords();
  const todayRecords = memUploadRecords.filter(r => {
    const t = new Date(r.uploadedAt).getTime();
    return t >= start.getTime() && t < end.getTime();
  });
  return computeStats(todayRecords);
}

async function checkUploadQuotaForUser(username) {
  const normalized = String(username || '').trim();
  if (!normalized) {
    return { ok: false, status: 401, message: 'Please login before uploading' };
  }
  if (normalized.toLowerCase() === EXEMPT_UPLOAD_ACCOUNT) {
    return { ok: true, status: 200, message: 'Quota exempt account' };
  }

  const stats = await getTodayUploadStats(normalized);
  if (stats.userUploadsToday >= DAILY_UPLOADS_PER_ACCOUNT) {
    return {
      ok: false,
      status: 429,
      message: `Daily upload limit reached (${DAILY_UPLOADS_PER_ACCOUNT} groups per account). Resets at 23:59 (UTC+8).`
    };
  }

  if (stats.totalGroupsToday >= DAILY_TOTAL_GROUPS_LIMIT) {
    return {
      ok: false,
      status: 429,
      message: `Daily site-wide upload limit reached (${DAILY_TOTAL_GROUPS_LIMIT} groups). Resets at 23:59 (UTC+8).`
    };
  }

  return { ok: true, status: 200, message: 'Quota available', stats };
}

// ─── Always bundle a project's channel maps into a ZIP on R2 ─────────────────
// Called fire-and-forget after /record-upload so every project gets a ZIP,
// not only the ones that request an email report.
async function buildProjectZip(username, folderName, publicIds, recordId = null) {
  if (!isR2Configured() || !folderName) return;
  const imgKeys = (publicIds || []).filter(k => !String(k).endsWith('.zip'));
  if (!imgKeys.length) return;

  const zip = new AdmZip();
  const fetches = await Promise.allSettled(
    imgKeys.map(async key => {
      const r = await fetch(`${R2_BUCKET_URL}/${key}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${key}`);
      return { key, buf: Buffer.from(await r.arrayBuffer()) };
    })
  );
  let added = 0;
  for (const f of fetches) {
    if (f.status === 'fulfilled') {
      zip.addFile(String(f.value.key).split('/').pop(), f.value.buf);
      added++;
    } else {
      console.warn(`[project-zip] fetch failed: ${f.reason?.message}`);
    }
  }
  if (!added) return;

  const zipKey = `${folderName}/${folderName}_textures.zip`;
  await r2UploadBuffer(zip.toBuffer(), zipKey, {
    contentType: 'application/zip',
    username: username || '',
    folder: folderName,
    uploadedAt: new Date().toISOString(),
  });

  // Attach the zip key to the upload record so /projects lists it and the
  // 48 h cleanup deletes it together with the images
  if (recordId && mongoose.connection.readyState === 1) {
    await UploadRecord.updateOne({ _id: recordId }, { $addToSet: { publicIds: zipKey } }).catch(() => {});
  } else {
    const rec = memUploadRecords.find(r => r.username === username && r.folderName === folderName);
    if (rec && !rec.publicIds.includes(zipKey)) rec.publicIds.push(zipKey);
  }
  console.log(`[project-zip] ${zipKey} built from ${added} map(s)`);
}

// ─── Scheduled R2 cleanup (every 24 h, delete objects > 48 hours old) ───
async function runR2Cleanup() {
  purgeMemUploadRecords();
  if (!isR2Configured()) return;
  if (mongoose.connection.readyState !== 1) return;

  const cutoff = new Date(Date.now() - UPLOAD_RETENTION_MS);
  let records;
  try {
    records = await UploadRecord.find({ uploadedAt: { $lt: cutoff } }).lean();
  } catch (e) {
    console.error('[cleanup] DB query failed:', e.message);
    return;
  }

  if (!records.length) {
    console.log('[cleanup] No expired uploads');
    return;
  }

  let deleted = 0;
  for (const record of records) {
    for (const objectKey of (record.publicIds || [])) {
      try {
        const res = await r2DeleteObject(objectKey);
        console.log(`[cleanup] ${objectKey} → ${res}`);
        deleted++;
      } catch (err) {
        console.error(`[cleanup] Failed ${objectKey}:`, err.message);
      }
    }
    await UploadRecord.deleteOne({ _id: record._id }).catch(() => {});
  }
  console.log(`[cleanup] Removed ${deleted} object(s) across ${records.length} upload record(s)`);
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
          const user = await User.findOne({ username });
          if (user) {
            // Check account is active
            if (!user.isActive) {
              appendLoginLog(username, false);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, message: 'Account disabled. Contact support.' }));
              return;
            }

            // Check lockout
            if (user.lockUntil && user.lockUntil > new Date()) {
              const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
              appendLoginLog(username, false);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, message: `Account locked. Try again in ${mins} min.` }));
              return;
            }

            success = await bcrypt.compare(password, user.password);

            if (success) {
              // Reset login attempts on success
              if (user.loginAttempts > 0 || user.lockUntil) {
                await User.updateOne({ _id: user._id }, {
                  $set:   { loginAttempts: 0 },
                  $unset: { lockUntil: '' }
                });
              }
              userEmail = user.email || null;
            } else {
              // Increment attempts and possibly lock
              const attempts = (user.loginAttempts || 0) + 1;
              const update = { loginAttempts: attempts };
              if (attempts >= MAX_LOGIN_ATTEMPTS) {
                update.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
              }
              await User.updateOne({ _id: user._id }, { $set: update });
            }
          }
        } else {
          // ── Fallback: no DB ──────────────────────────────────────────────
          const devUser = devAccounts[username];
          if (devUser) {
            success = await bcrypt.compare(password, devUser.password);
          } else {
            console.warn(`[login] No DB connection and no matching dev account for "${username}"`);
            success = false;
          }
        }

        appendLoginLog(username, success);
        console.log(`[login] user=${username} → ${success ? 'SUCCESS' : 'FAILED'}`);

        let sessionId = null;
        if (success) {
          sessionId = crypto.randomUUID();
          activeSessions.set(sessionId, { username, lastActivity: Date.now() });
          writeLastSystemUse();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(
          success
            ? { ok: true,  message: 'Login successful. Welcome back!', username, email: userEmail, sessionId }
            : { ok: false, message: 'Incorrect username or password.' }
        ));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      });
    return;
  }

  // ── POST /session/heartbeat ───────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/session/heartbeat') {
    readJsonBody(req)
      .then(body => {
        const sessionId = String(body.sessionId || '').trim();
        if (!sessionId || !activeSessions.has(sessionId)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Session expired or not found' }));
          return;
        }
        activeSessions.get(sessionId).lastActivity = Date.now();
        writeLastSystemUse();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      });
    return;
  }

  // ── POST /logout ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/logout') {
    readJsonBody(req)
      .then(body => {
        const sessionId = String(body.sessionId || '').trim();
        if (sessionId) {
          activeSessions.delete(sessionId);
          console.log(`[logout] session ${sessionId} invalidated`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
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

if (!username || !password || !email) return fail(400, 'Please fill in all fields');
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) return fail(400, 'Please enter a valid Gmail address');

        const dbReady = mongoose.connection.readyState === 1;

        if (dbReady) {
          const [existingUser, existingEmail] = await Promise.all([
            User.findOne({ username }).lean(),
            User.findOne({ email }).lean()
          ]);
          if (existingUser)  return fail(409, 'Username already taken');
          if (existingEmail) return fail(409, 'Email already registered');
        } else {
          // In-memory fallback
          if (memUsers.has(username)) return fail(409, 'Username already taken (test mode)');
          const emailUsed = [...memUsers.values()].some(u => u.email === email);
          if (emailUsed) return fail(409, 'Email already registered (test mode)');
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
          writeLastSent(); // update keepalive timestamp
        } catch (mailErr) {
          if (mailErr.message === 'NO_MAIL_SERVICE') return fail(503, 'Email service not configured. Contact support.');
          throw mailErr;
        }

        console.log(`[register] OTP sent to ${email} for user "${username}" (${dbReady ? 'DB' : 'memory'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Verification code sent' }));
      })
      .catch(err => {
        console.error('[register/send-otp]', err.message);
        const msg = process.env.NODE_ENV !== 'production'
          ? err.message
          : 'Server error. Please try again later.';
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
          res.end(JSON.stringify({ ok: false, message: 'Please provide email and verification code' }));
          return;
        }

        const dbReady = mongoose.connection.readyState === 1;
        const record  = dbReady
          ? await OtpRecord.findOne({ email }).lean()
          : memOtp.get(email);

        if (!record) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Verification request not found. Please resend.' }));
          return;
        }
        if (new Date() > record.expiresAt) {
          if (dbReady) await OtpRecord.deleteOne({ email }); else memOtp.delete(email);
          res.writeHead(410, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Code expired. Please resend.' }));
          return;
        }
        if (record.otp !== otp) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Invalid verification code.' }));
          return;
        }

        if (dbReady) {
          await User.create({ username: record.username, password: record.password, email, isEmailVerified: true });
          await OtpRecord.deleteOne({ email });
        } else {
          memUsers.set(record.username, { username: record.username, password: record.password, email });
          memOtp.delete(email);
        }
        console.log(`[register] User created: "${record.username}" (${email}) (${dbReady ? 'DB' : 'memory'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Registration successful! Welcome to SNAPBRIFY.' + (dbReady ? '' : ' (Test mode — data cleared on restart)') }));
      })
      .catch(err => {
        console.error('[register/verify]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Server error. Please try again later.' }));
      });
    return;
  }

  // ── POST /upload-map (multipart) ─────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/upload-map') {
    uploadMapParser(req, res, async (err) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
        return;
      }
      if (!req.file || !req.file.buffer) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'No image file received' }));
        return;
      }

      const username = String(req.body?.username || '').trim();
      const folder = _sanitizeSlug(req.body?.folder, 'material');
      const suffix = _sanitizeSlug(req.body?.suffix, 'map');

      try {
        const quota = await checkUploadQuotaForUser(username);
        if (!quota.ok) {
          res.writeHead(quota.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: quota.message }));
          return;
        }

        const mime = req.file.mimetype || 'image/jpeg';
        const ext = _extensionFromMime(mime);
        const filename = `${folder}_${suffix}.${ext}`;
        const uploaded = await r2UploadBuffer(req.file.buffer, filename, {
          contentType: mime,
          username: username || null,
          folder,
          suffix,
          uploadedAt: new Date().toISOString(),
        });

        writeLastSystemUse();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...uploaded }));
      } catch (uploadErr) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: uploadErr.message }));
      }
    });
    return;
  }

  // ── POST /upload-quota/check ─────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/upload-quota/check') {
    readJsonBody(req)
      .then(async body => {
        const username = String(body.username || '').trim();
        const quota = await checkUploadQuotaForUser(username);
        res.writeHead(quota.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: quota.ok,
          message: quota.message,
          totalGroupsToday: quota.stats?.totalGroupsToday ?? null,
          userUploadsToday: quota.stats?.userUploadsToday ?? null,
          dailyTotalLimit: DAILY_TOTAL_GROUPS_LIMIT,
          dailyPerUserLimit: DAILY_UPLOADS_PER_ACCOUNT,
          resetsAt: '23:59 UTC+8',
        }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      });
    return;
  }

  // ── POST /send-upload-report ───────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/send-upload-report') {
    readJsonBody(req)
      .then(async body => {
        const email    = String(body.email    || '').trim().toLowerCase();
        const name     = String(body.name     || '').trim();
        const maps     = body.maps; // { basecolor: url, roughness: url, ... }
        const username = String(body.username || '').trim() || null;
        const folder   = _sanitizeSlug(body.folder || name, 'material');

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

        // ── Build ZIP from Cloudflare R2 delivery URLs ───────────────────
        let zipUrl = null;
        let zipKey = null;
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
              const ext = (String(maps[r.value.ch]).split('?')[0].split('.').pop() || 'jpg').toLowerCase();
              zip.addFile(`${name}_${r.value.ch}.${ext}`, r.value.buf);
            } else {
              console.warn(`[upload-report] ZIP fetch failed: ${r.reason?.message}`);
            }
          }
          const zipBuffer = zip.toBuffer();
          console.log(`[upload-report] ZIP built: ${(zipBuffer.length / 1024).toFixed(0)} KB`);

          // ── Try uploading ZIP to R2 (preferred: no server memory used) ──
          if (isR2Configured()) {
            try {
              zipKey = `${folder}/${folder}_textures.zip`;
              const uploaded = await r2UploadBuffer(zipBuffer, zipKey, {
                contentType: 'application/zip',
                username: username || '',
                folder,
                uploadedAt: new Date().toISOString(),
              });
              zipUrl = uploaded.url;
              // Register zip key for 48h R2 cleanup alongside the image files
              const record = { username, folderName: folder, publicIds: [zipKey], uploadedAt: new Date() };
              if (mongoose.connection.readyState === 1) {
                await UploadRecord.create(record).catch(() => {});
              } else {
                memUploadRecords.push(record);
              }
              console.log(`[upload-report] ZIP uploaded to R2: ${zipKey}`);
            } catch (r2Err) {
              console.warn(`[upload-report] R2 zip upload failed (${r2Err.message}), falling back to memory`);
              zipKey = null;
            }
          }

          // ── Fallback: store ZIP in server memory if R2 unavailable ──────
          if (!zipUrl) {
            const zipId = crypto.randomUUID();
            zipStore.set(zipId, { name, buffer: zipBuffer, createdAt: Date.now() });
            const serverUrl = (process.env.SERVER_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
            zipUrl = `${serverUrl}/download-zip/${zipId}`;
            console.log(`[upload-report] ZIP stored in memory (fallback): ${zipId}`);
          }
        } catch (zipErr) {
          console.error('[upload-report] ZIP build failed:', zipErr.message);
        }

        const rows = Object.entries(maps).map(([ch, url]) => {
          const label = CHANNEL_LABELS[ch] || ch;
          return `<tr><td style="padding:6px 12px;font-weight:600;color:#94a3b8">${label}</td><td style="padding:6px 12px"><a href="${url}" style="color:#e8c854">${name}_${ch}</a></td></tr>`;
        }).join('');

        const zipButton = zipUrl
          ? `<div style="margin:20px 0 4px"><a href="${zipUrl}" style="display:inline-block;background:#E8C854;color:#18181B;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">⬇ Download All as ZIP (valid 48 h)</a></div>`
          : '';

        const html = `<div style="font-family:sans-serif;background:#0d1117;color:#e0e6f0;padding:24px;border-radius:12px;max-width:560px">
<h2 style="margin:0 0 4px">📦 ${name}</h2>
<p style="color:#64748b;margin:0 0 16px;font-size:13px">SNAPBRIFY — Texture upload complete</p>
${zipButton}
<table style="width:100%;border-collapse:collapse;background:#1c2333;border-radius:8px;overflow:hidden;margin-top:16px">
<thead><tr style="background:#252d3d"><th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">Channel</th><th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">Download</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#374151;font-size:11px;margin-top:16px">This message was sent automatically by SNAPBRIFY.</p></div>`;

        const text = (zipUrl ? `Download all as ZIP: ${zipUrl}\n\n` : '') +
          Object.entries(maps).map(([ch, url]) => `${name}_${ch}: ${url}`).join('\n');

        await sendOtpEmail(email, null, { subject: `[SNAPBRIFY] ${name} upload complete`, html, text });
        console.log(`[upload-report] Sent to ${email} for "${name}"`);
        writeLastSystemUse();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, zipUrl, zipKey }));
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
      res.end('ZIP not found or has expired (valid 48 hours)');
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

  // ── GET /projects ─────────────────────────────────────────────────────────
  // Exact match only — '/projects.html' must fall through to the static handler
  if (req.method === 'GET' && rawUrl === '/projects') {
    const qs       = new URL(req.url, `http://localhost`).searchParams;
    const username = String(qs.get('username') || '').trim();
    if (!username) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'username required' }));
      return;
    }
    const recordsPromise = (mongoose.connection.readyState === 1)
      ? UploadRecord.find({ username }).sort({ uploadedAt: -1 }).lean()
      : Promise.resolve(
          memUploadRecords
            .filter(r => r.username === username)
            .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
        );

    recordsPromise
      .then(records => {
        const bucketUrl = (process.env.R2_BUCKET_URL || '').replace(/\/$/, '');
        // Images and the ZIP are stored as separate UploadRecords for the same
        // folder — merge them so each project shows as a single row
        const byFolder = new Map();
        records.forEach((r, i) => {
          const key = String(r.folderName || `__unnamed_${i}`).trim().toLowerCase();
          const cur = byFolder.get(key);
          if (cur) {
            cur.publicIds.push(...(r.publicIds || []));
            if (new Date(r.uploadedAt) > new Date(cur.uploadedAt)) cur.uploadedAt = r.uploadedAt;
          } else {
            byFolder.set(key, {
              folderName: r.folderName,
              publicIds:  [...(r.publicIds || [])],
              uploadedAt: r.uploadedAt,
            });
          }
        });
        const projects = [...byFolder.values()]
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
          .map(r => {
            const publicIds = [...new Set(r.publicIds)];
            const bcKey = publicIds.find(id => id.includes('_basecolor'));
            return {
              folderName: r.folderName,
              publicIds,
              uploadedAt: r.uploadedAt,
              bucketUrl,
              thumbUrl: bcKey && bucketUrl ? `${bucketUrl}/${bcKey}` : null,
            };
          });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, projects }));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      });
    return;
  }

  // ── POST /record-upload ──────────────────────────────────────────────────
  if (req.method === 'POST' && rawUrl === '/record-upload') {
    readJsonBody(req).then(async body => {
      const username   = String(body.username   || '').trim() || null;
      // Same slug rules as /upload-map and /send-upload-report, so records
      // for one upload share an identical folderName and merge in /projects
      const folderName = String(body.folderName || '').trim() ? _sanitizeSlug(body.folderName) : null;
      const publicIds  = Array.isArray(body.publicIds) ? body.publicIds.map(String) : [];
      if (!publicIds.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'No publicIds provided' }));
        return;
      }

      const quota = await checkUploadQuotaForUser(username);
      if (!quota.ok) {
        res.writeHead(quota.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: quota.message }));
        return;
      }

      const record = { username, folderName, publicIds, uploadedAt: new Date() };
      let recordId = null;
      if (mongoose.connection.readyState === 1) {
        const created = await UploadRecord.create(record);
        recordId = created._id;
      } else {
        memUploadRecords.push(record);
      }
      console.log(`[record-upload] Saved ${publicIds.length} id(s) for "${folderName || 'unnamed'}" (${username || 'anon'})`);

      // Bundle the channel maps into a ZIP on R2 (fire-and-forget)
      buildProjectZip(username, folderName, publicIds, recordId)
        .catch(e => console.warn('[project-zip]', e.message));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }).catch(err => {
      console.error('[record-upload]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
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
  checkBrevoKeepalive();
});

// Run R2 cleanup 30 s after startup (allow DB to connect), then every 24 h
setTimeout(runR2Cleanup, 30_000);
setInterval(runR2Cleanup, 24 * 60 * 60 * 1000).unref();

// ─── Brevo API key keepalive ──────────────────────────────────────────────────
// Keepalive strategy:
// 1) Track last system activity in a file.
// 2) Assume API expires after BREVO_API_EXPIRY_DAYS (default 90).
// 3) Send keepalive at (expiryDays - 1) since last activity.
const KEEPALIVE_FILE = path.join(__dirname, '.brevo-keepalive');
const LAST_USE_FILE  = path.join(__dirname, '.system-last-use');
const BREVO_API_EXPIRY_DAYS = Math.max(2, Number(process.env.BREVO_API_EXPIRY_DAYS || 90));
const KEEPALIVE_DAYS = BREVO_API_EXPIRY_DAYS - 1;
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

function readLastSystemUse() {
  try {
    if (fs.existsSync(LAST_USE_FILE)) {
      return new Date(fs.readFileSync(LAST_USE_FILE, 'utf8').trim());
    }
  } catch {}
  return null;
}

function writeLastSystemUse() {
  try { fs.writeFileSync(LAST_USE_FILE, new Date().toISOString()); } catch {}
}

async function checkBrevoKeepalive() {
  if (!process.env.BREVO_API_KEY || !KEEPALIVE_TO) return;

  const last     = readLastSystemUse() || readLastSent();
  const daysSince = last ? (Date.now() - last.getTime()) / 86400000 : Infinity;

  if (daysSince >= KEEPALIVE_DAYS) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method:  'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender:      { name: 'WebPhoto', email: process.env.BREVO_FROM || process.env.GMAIL_USER },
          to:          [{ email: KEEPALIVE_TO }],
          subject:     '[SNAPBRIFY] System keepalive',
          textContent: `This message was sent automatically by SNAPBRIFY to keep the Brevo API key active.\nTimestamp: ${new Date().toISOString()}`
        })
      });
      if (r.ok) {
        writeLastSent();
        writeLastSystemUse();
        console.log(`[keepalive] Brevo keepalive email sent to ${KEEPALIVE_TO}`);
      } else {
        console.warn('[keepalive] Failed:', await r.text());
      }
    } catch (e) {
      console.warn('[keepalive] Error:', e.message);
    }
  } else {
    console.log(`[keepalive] Last system use: ${Math.floor(daysSince)}d ago — next keepalive at ${KEEPALIVE_DAYS}d`);
  }

  // Re-check every 24 hours
  setTimeout(checkBrevoKeepalive, 24 * 60 * 60 * 1000);
}


/**
 * WebPhoto Upload Server
 * Pure Node.js + multer — no extra framework required
 *
 * Usage:
 *   npm install
 *   npm start
 *
 * Endpoints:
 *   GET  /            → serves index.html (device-redirect)
 *   GET  /mobile.html → serves mobile.html
 *   GET  /desktop.html→ serves desktop.html
 *   POST /upload      → accepts multipart/form-data { image: File, name: string }
 *                       saves to ./upload/<name>.png
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const multer = require('multer');

const PORT       = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'upload');

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

// ─── Request handler ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Use raw URL path for routing (avoid Windows path.normalize issues with '/')
  const rawUrl = decodeURIComponent(req.url.split('?')[0]);

  // Strip any path-traversal sequences, then resolve against __dirname
  const reqFile = rawUrl === '/' ? 'index.html' : rawUrl.replace(/^\/+/, '');
  const filePath = path.resolve(__dirname, reqFile);

  // Security: ensure resolved path stays within project directory
  const isInProject = filePath.startsWith(__dirname + path.sep) || filePath === __dirname;

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

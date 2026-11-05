'use strict';
require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const cfg = require('./lib/config');
require('./lib/db');
const jobs = require('./lib/jobs');
const drive = require('./lib/drive');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  // YouTube embed mewajibkan Referer (tanpa ini player menampilkan "Error 153")
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
      mediaSrc: ["'self'", 'blob:'],
      frameSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      // Hanya paksa HTTPS bila server memang di-HTTPS-kan (agar akses via IP LAN http tetap jalan)
      upgradeInsecureRequests: cfg.SECURE_COOKIE ? [] : null,
    },
  },
}));
app.use(cookieParser());
// /api/voice punya parser sendiri (batas lebih besar untuk daftar lagu lokal)
const jsonBody = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path.startsWith('/api/voice') ? next() : jsonBody(req, res, next)));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/drive', require('./routes/drive'));
app.use('/api/library', require('./routes/library'));
app.use('/api/voice', require('./routes/voice'));
app.use('/api', require('./routes/media'));

/**
 * Halaman pembungkus player YouTube untuk aplikasi mobile (WebView).
 * Dimuat dari domain server agar iframe YouTube menerima Referer yang valid.
 */
app.get('/embed/:videoId', (req, res) => {
  const id = String(req.params.videoId);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return res.status(400).send('ID tidak valid');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube-nocookie.com https://www.youtube.com");
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
</head><body><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1"
allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`);
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Penanganan error terpusat
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err.message);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: status >= 500 && !err.code ? 'Terjadi kesalahan di server.' : err.message, code: err.code });
});

app.listen(cfg.PORT, () => {
  console.log(`SoundWave berjalan di ${cfg.PUBLIC_URL} (port ${cfg.PORT})`);
  console.log(`Folder sementara : ${jobs.DOWNLOAD_DIR}`);
  console.log(`Basis data       : ${process.env.DB_FILE || path.join(cfg.DATA_DIR, 'soundwave.db')}`);
  console.log(`Google Drive     : ${drive.isConfigured() ? `aktif (redirect URI: ${cfg.PUBLIC_URL}/api/drive/callback)` : 'nonaktif — isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET'}`);
});

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
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'], // https: untuk logo stasiun radio
      // https: untuk murottal Al-Qur'an yang di-stream langsung dari CDN equran.id
      // http: hanya bila server sendiri belum https (siaran TV/radio http tetap bisa diputar di jaringan lokal)
      mediaSrc: ["'self'", 'blob:', 'https:', ...(cfg.SECURE_COOKIE ? [] : ['http:'])],
      frameSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
      // https: untuk siaran TV HLS (hls.js mengambil playlist & potongan video langsung dari penyedia siaran)
      connectSrc: ["'self'", 'https:', ...(cfg.SECURE_COOKIE ? [] : ['http:'])],
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
// Batas permintaan dihitung PER AKUN (token login), bukan per IP: pengguna di jaringan kampus/kantor sering
// keluar lewat satu IP publik yang sama, sehingga batas per IP membuat permintaan mereka ditolak (429).
const crypto = require('crypto');
const rateKey = (req) => {
  const tok = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.cookies?.sw_session || req.cookies?.sw_admin || req.query?.t;
  if (tok) return `u:${crypto.createHash('sha1').update(String(tok)).digest('hex').slice(0, 20)}`;
  const ip = req.ip || '';
  return `ip:${ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip}`; // IPv6: per /64
};
// Router API (mendukung akses langsung /api maupun dengan subpath prefix seperti /soundwave/api)
const apiRouter = express.Router();
apiRouter.use(rateLimit({
  windowMs: 60 * 1000, limit: Number(process.env.RATE_LIMIT_PER_MIN || 600), standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: rateKey,
  // Streaming (Range request lagu/radio) tidak dihitung: satu lagu bisa memicu banyak permintaan potongan
  skip: (req) => /^\/(library\/stream|radio\/stream|sholat\/adzan\/)/.test(req.path),
  message: { error: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', code: 'RATE_LIMITED' },
}));

apiRouter.use('/auth', require('./routes/auth'));
apiRouter.use('/drive', require('./routes/drive'));
apiRouter.use('/library', require('./routes/library'));
apiRouter.use('/voice', require('./routes/voice'));
apiRouter.use('/lyrics', require('./routes/lyrics'));
apiRouter.use('/sholat', require('./routes/sholat'));
apiRouter.use('/quran', require('./routes/quran'));
apiRouter.use('/radio', require('./routes/radio'));
apiRouter.use('/pengumuman', require('./routes/pengumuman'));
apiRouter.use('/admin', require('./routes/admin'));
apiRouter.use('/tv', require('./routes/tv'));
apiRouter.use('/', require('./routes/media'));
apiRouter.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

app.use('/api', apiRouter);
if (cfg.BASE_PATH) {
  app.use(`${cfg.BASE_PATH}/api`, apiRouter);
}

// Pemutar HLS untuk browser selain Safari (disajikan dari server sendiri, bukan CDN)
const sendHls = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(require.resolve('hls.js/dist/hls.min.js'));
};
app.get('/vendor/hls.min.js', sendHls);
if (cfg.BASE_PATH) {
  app.get(`${cfg.BASE_PATH}/vendor/hls.min.js`, sendHls);
}

// Panel superadmin (halaman login terpisah dari pengguna biasa)
const sendAdmin = (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
};
app.get(['/admin', '/admin/'], sendAdmin);
if (cfg.BASE_PATH) {
  app.get([`${cfg.BASE_PATH}/admin`, `${cfg.BASE_PATH}/admin/`], sendAdmin);
}

/**
 * Halaman pembungkus player YouTube untuk aplikasi mobile (WebView).
 * Dimuat dari domain server agar iframe YouTube menerima Referer yang valid.
 */
function sendEmbed(req, res) {
  const id = String(req.params.videoId);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return res.status(400).send('ID tidak valid');
  // ?bridge=1: teruskan status/galat player ke aplikasi (mis. "pemutaran di luar YouTube tidak diizinkan")
  const bridge = req.query.bridge === '1';
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; style-src 'unsafe-inline'; ${bridge ? "script-src 'unsafe-inline'; " : ''}frame-src https://www.youtube-nocookie.com https://www.youtube.com`);
  const origin = encodeURIComponent(cfg.PUBLIC_URL);
  const script = bridge ? `<script>
(function(){var f=document.getElementById('p');function send(o){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}}
function listen(){try{f.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*')}catch(e){}}
f.addEventListener('load',function(){listen();setTimeout(listen,800);setTimeout(listen,2500)});
window.addEventListener('message',function(e){if(!/youtube/.test(e.origin))return;var d;try{d=typeof e.data==='string'?JSON.parse(e.data):e.data}catch(x){return}
if(!d)return;if(d.event==='onError')send({type:'error',code:d.info});else if(d.event==='onStateChange')send({type:'state',state:d.info});
else if(d.event==='infoDelivery'&&d.info&&typeof d.info.playerState==='number')send({type:'state',state:d.info.playerState});else if(d.event==='onReady')send({type:'ready'})});})();
</script>` : '';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
</head><body><iframe id="p" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1${bridge ? `&enablejsapi=1&origin=${origin}` : ''}"
allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
referrerpolicy="strict-origin-when-cross-origin"></iframe>${script}</body></html>`);
}

app.get('/embed/:videoId', sendEmbed);
if (cfg.BASE_PATH) {
  app.get(`${cfg.BASE_PATH}/embed/:videoId`, sendEmbed);
}

const staticMiddleware = express.static(path.join(__dirname, 'public'), { maxAge: '1h', extensions: ['html'] });
app.use(staticMiddleware);
if (cfg.BASE_PATH) {
  app.use(cfg.BASE_PATH, staticMiddleware);
}

// Fallback 404 untuk semua route API agar tidak pernah mengembalikan HTML index.html
app.use((req, res, next) => {
  if (req.path.includes('/api/')) {
    return res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  }
  next();
});

// Fallback index.html (SPA routing)
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Penanganan error terpusat
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err.message);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: status >= 500 && !err.code ? 'Terjadi kesalahan di server.' : err.message, code: err.code });
});

require('./lib/admin').bootstrap();
require('./lib/tv').warmup();

app.listen(cfg.PORT, () => {
  console.log(`SoundWave berjalan di ${cfg.PUBLIC_URL} (port ${cfg.PORT})`);
  console.log(`Folder sementara : ${jobs.DOWNLOAD_DIR}`);
  console.log(`Basis data       : ${process.env.DB_FILE || path.join(cfg.DATA_DIR, 'soundwave.db')}`);
  console.log(`Google Drive     : ${drive.isConfigured() ? `aktif (redirect URI: ${cfg.PUBLIC_URL}/api/drive/callback)` : 'nonaktif — isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET'}`);
});

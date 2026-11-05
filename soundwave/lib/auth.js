'use strict';
/**
 * Autentikasi:
 *  - Web   : JWT di cookie httpOnly "sw_session" + header X-SW-CSRF untuk request yang mengubah data.
 *  - Mobile: JWT di header "Authorization: Bearer <token>".
 *  - Media : token pendek "?t=" khusus untuk streaming/unduh (dipakai <audio> & aplikasi mobile).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const cfg = require('./config');

const COOKIE = 'sw_session';
const SESSION_TTL = 30 * 24 * 3600; // 30 hari
const MEDIA_TTL = 12 * 3600; // 12 jam

/* ---------- Password (scrypt) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}
// Hash palsu agar waktu respons login sama untuk email yang tidak terdaftar
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

/* ---------- Enkripsi refresh token Google (AES-256-GCM) ---------- */
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cfg.ENC_KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decrypt(payload) {
  const [iv, tag, enc] = String(payload).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', cfg.ENC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/* ---------- Token ---------- */
const sign = (payload, ttl) => jwt.sign(payload, cfg.JWT_KEY, { algorithm: 'HS256', expiresIn: ttl });
const verify = (token) => jwt.verify(token, cfg.JWT_KEY, { algorithms: ['HS256'] });

const sessionToken = (u) => sign({ sub: u.id, v: u.token_version, typ: 'session' }, SESSION_TTL);
const mediaToken = (u) => sign({ sub: u.id, v: u.token_version, typ: 'media' }, MEDIA_TTL);
const stateToken = (u, client) => sign({ sub: u.id, typ: 'gstate', client, n: crypto.randomBytes(8).toString('hex') }, 600);

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: cfg.SECURE_COOKIE, maxAge: SESSION_TTL * 1000, path: '/',
  });
}
function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: cfg.SECURE_COOKIE, path: '/' });
}

const getUser = db.prepare('SELECT * FROM users WHERE id = ?');

/** Validasi token dan kembalikan baris user, atau null. */
function userFromToken(token, typ) {
  try {
    const p = verify(token);
    if (p.typ !== typ) return null;
    const u = getUser.get(p.sub);
    return u && u.token_version === p.v ? u : null;
  } catch { return null; }
}

/**
 * Middleware. opts.media = true mengizinkan token "?t=" (untuk streaming & unduh file).
 */
function requireAuth(opts = {}) {
  return (req, res, next) => {
    let user = null;
    let via = null;
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) { user = userFromToken(h.slice(7), 'session'); via = 'bearer'; }
    else if (req.cookies?.[COOKIE]) { user = userFromToken(req.cookies[COOKIE], 'session'); via = 'cookie'; }
    if (!user && opts.media && typeof req.query.t === 'string') { user = userFromToken(req.query.t, 'media'); via = 'media'; }
    if (!user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.', code: 'UNAUTHENTICATED' });

    // Perlindungan CSRF untuk sesi cookie: header kustom tidak bisa dikirim lintas situs tanpa CORS
    if (via === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-SW-CSRF') !== '1') {
      return res.status(403).json({ error: 'Permintaan ditolak (CSRF).' });
    }
    req.user = user;
    next();
  };
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    drive: {
      configured: Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET),
      connected: Boolean(u.google_refresh_enc),
      googleEmail: u.google_email || null,
      folderId: u.drive_folder_id || null,
      folderName: u.drive_folder_name || null,
      folderUrl: u.drive_folder_id ? `https://drive.google.com/drive/folders/${u.drive_folder_id}` : null,
    },
  };
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, encrypt, decrypt,
  sessionToken, mediaToken, stateToken, verify, MEDIA_TTL,
  setSessionCookie, clearSessionCookie, requireAuth, publicUser, getUser,
};

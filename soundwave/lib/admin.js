'use strict';
/**
 * Superadmin: akun TERPISAH dari pengguna biasa (tabel admins), login di /admin.
 * Sesi: cookie httpOnly "sw_admin" (path /api/admin, 8 jam) + header X-SW-CSRF untuk perubahan data.
 * Akun pertama dibuat dari SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD di .env, atau `npm run admin -- <email> <sandi>`.
 */
const { db } = require('./db');
const cfg = require('./config');
const A = require('./auth');
const jwt = require('jsonwebtoken');

const COOKIE = 'sw_admin';
const TTL = 8 * 3600;

const byEmail = db.prepare('SELECT * FROM admins WHERE email = ?');
const byId = db.prepare('SELECT * FROM admins WHERE id = ?');
const insert = db.prepare('INSERT INTO admins (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)');
const setPass = db.prepare('UPDATE admins SET password_hash = ?, token_version = token_version + 1 WHERE id = ?');
const setLogin = db.prepare('UPDATE admins SET last_login = ? WHERE id = ?');
const count = db.prepare('SELECT COUNT(*) AS n FROM admins');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function createAdmin(email, password, name = 'Superadmin') {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new Error('Email admin tidak valid.');
  if (String(password || '').length < 10) throw new Error('Kata sandi admin minimal 10 karakter.');
  const ex = byEmail.get(e);
  if (ex) { setPass.run(A.hashPassword(password), ex.id); return byId.get(ex.id); }
  const r = insert.run(e, String(name).slice(0, 80), A.hashPassword(password), Date.now());
  return byId.get(Number(r.lastInsertRowid));
}

/** Buat superadmin dari .env saat server pertama kali jalan (tidak menimpa sandi admin yang sudah ada). */
function bootstrap() {
  const email = process.env.SUPERADMIN_EMAIL;
  const pass = process.env.SUPERADMIN_PASSWORD;
  if (!email || !pass) {
    if (!count.get().n) console.log('[admin] Belum ada superadmin. Isi SUPERADMIN_EMAIL & SUPERADMIN_PASSWORD di .env, atau jalankan: npm run admin -- email@domain sandi');
    return;
  }
  if (byEmail.get(String(email).trim().toLowerCase())) return;
  try { createAdmin(email, pass); console.log(`[admin] Superadmin ${email} dibuat. Masuk di <PUBLIC_URL>/admin`); } catch (e) { console.error('[admin]', e.message); }
}

function login(email, password) {
  const a = byEmail.get(String(email || '').trim().toLowerCase());
  const ok = A.verifyPassword(String(password || ''), a ? a.password_hash : A.DUMMY_HASH);
  if (!a || !ok) return null;
  setLogin.run(Date.now(), a.id);
  return a;
}

const tokenFor = (a) => jwt.sign({ sub: a.id, v: a.token_version, typ: 'admin' }, cfg.JWT_KEY, { algorithm: 'HS256', expiresIn: TTL });

const COOKIE_PATH = cfg.BASE_PATH ? `${cfg.BASE_PATH}/` : '/';

function setCookie(res, a) {
  const token = tokenFor(a);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cfg.SECURE_COOKIE, maxAge: TTL * 1000, path: COOKIE_PATH });
  return token;
}
function clearCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: cfg.SECURE_COOKIE, path: COOKIE_PATH });
}

/** Middleware: hanya superadmin. Token pengguna biasa TIDAK diterima di sini. */
function requireAdmin() {
  return (req, res, next) => {
    let a = null;
    let via = null;
    const h = req.headers.authorization || '';
    let rawToken = '';
    if (h.startsWith('Bearer ')) { rawToken = h.slice(7); via = 'bearer'; }
    else if (req.cookies?.[COOKIE]) { rawToken = req.cookies[COOKIE]; via = 'cookie'; }

    try {
      const p = jwt.verify(rawToken, cfg.JWT_KEY, { algorithms: ['HS256'] });
      if (p.typ === 'admin') { const row = byId.get(p.sub); if (row && row.token_version === p.v) a = row; }
    } catch { /* tidak sah */ }

    if (!a) return res.status(401).json({ error: 'Sesi admin berakhir. Silakan masuk lagi.', code: 'ADMIN_UNAUTHENTICATED' });
    if (via === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-SW-CSRF') !== '1') {
      return res.status(403).json({ error: 'Permintaan ditolak (CSRF).' });
    }
    req.admin = a;
    next();
  };
}

const publicAdmin = (a) => ({ id: a.id, email: a.email, name: a.name, lastLogin: a.last_login });

module.exports = { bootstrap, createAdmin, login, setCookie, clearCookie, requireAdmin, publicAdmin, setPass, byId };

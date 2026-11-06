'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../lib/db');
const cfg = require('../lib/config');
const A = require('../lib/auth');

const r = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)');

/** Kirim sesi: cookie untuk web, token di body untuk mobile. */
function issue(res, user, status = 200) {
  const token = A.sessionToken(user);
  A.setSessionCookie(res, token);
  res.status(status).json({ user: A.publicUser(user), token, mediaToken: A.mediaToken(user) });
}

r.get('/config', (req, res) => {
  res.json({
    registration: cfg.ALLOW_REGISTRATION,
    emailDomains: cfg.ALLOWED_EMAIL_DOMAINS,
    driveConfigured: Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET),
    driveLink: Boolean(cfg.GOOGLE_API_KEY),
  });
});

r.post('/register', loginLimiter, (req, res) => {
  if (!cfg.ALLOW_REGISTRATION) return res.status(403).json({ error: 'Pendaftaran akun baru sedang ditutup.' });
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!name) return res.status(400).json({ error: 'Nama wajib diisi.' });
  if (!EMAIL_RE.test(email) || email.length > 160) return res.status(400).json({ error: 'Format email tidak valid.' });
  if (cfg.ALLOWED_EMAIL_DOMAINS.length && !cfg.ALLOWED_EMAIL_DOMAINS.includes(email.split('@')[1])) {
    return res.status(400).json({ error: `Pendaftaran hanya untuk email @${cfg.ALLOWED_EMAIL_DOMAINS.join(', @')}.` });
  }
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Kata sandi minimal 8 karakter.' });
  if (findByEmail.get(email)) return res.status(409).json({ error: 'Email sudah terdaftar. Silakan masuk.' });
  const info = insertUser.run(email, name, A.hashPassword(password), Date.now());
  issue(res, A.getUser.get(info.lastInsertRowid), 201);
});

r.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = findByEmail.get(email);
  const ok = A.verifyPassword(password, user ? user.password_hash : A.DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Email atau kata sandi salah.' });
  if (user.disabled) return res.status(403).json({ error: 'Akun Anda dinonaktifkan administrator. Hubungi admin SoundWave.', code: 'ACCOUNT_DISABLED' });
  issue(res, user);
});

r.post('/logout', (req, res) => {
  A.clearSessionCookie(res);
  res.json({ ok: true });
});

r.get('/me', A.requireAuth(), (req, res) => res.json({ user: A.publicUser(req.user) }));

/** Token pendek untuk URL streaming/unduh (<audio src>, aplikasi mobile). */
r.get('/media-token', A.requireAuth(), (req, res) => {
  res.json({ token: A.mediaToken(req.user), expiresIn: A.MEDIA_TTL });
});

r.patch('/me', A.requireAuth(), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Nama wajib diisi.' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: A.publicUser(A.getUser.get(req.user.id)) });
});

/** Ganti kata sandi — semua sesi lain otomatis keluar (token_version naik). */
r.post('/password', A.requireAuth(), loginLimiter, (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  if (!A.verifyPassword(current, req.user.password_hash)) return res.status(400).json({ error: 'Kata sandi lama salah.' });
  if (next.length < 8 || next.length > 200) return res.status(400).json({ error: 'Kata sandi baru minimal 8 karakter.' });
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(A.hashPassword(next), req.user.id);
  issue(res, A.getUser.get(req.user.id));
});

/** Keluar dari semua perangkat. */
r.post('/logout-all', A.requireAuth(), (req, res) => {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  A.clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = r;

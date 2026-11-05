'use strict';
/** Konfigurasi terpusat + kunci rahasia yang dibuat otomatis bila belum ada. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 32) return process.env.APP_SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, s, { mode: 0o600 });
  console.warn(`[config] APP_SECRET tidak diisi — kunci baru dibuat di ${file}. Simpan file ini (jangan dihapus).`);
  return s;
}

const SECRET = loadSecret();
const derive = (label) => crypto.createHmac('sha256', SECRET).update(label).digest();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

module.exports = {
  DATA_DIR,
  PORT,
  PUBLIC_URL,
  SECURE_COOKIE: PUBLIC_URL.startsWith('https://'),
  JWT_KEY: derive('soundwave:jwt'),
  ENC_KEY: derive('soundwave:enc'), // 32 byte untuk AES-256-GCM
  ALLOW_REGISTRATION: String(process.env.ALLOW_REGISTRATION ?? 'true').toLowerCase() !== 'false',
  ALLOWED_EMAIL_DOMAINS: String(process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
  MOBILE_SCHEME: process.env.MOBILE_SCHEME || 'soundwave',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_API_BASE: process.env.GOOGLE_API_BASE || 'https://www.googleapis.com', // bisa diarahkan ke mock saat pengujian
};

'use strict';
/** Basis data SQLite bawaan Node.js (node:sqlite, Node >= 22.13). */
const path = require('path');

// Sembunyikan peringatan "experimental" khusus untuk modul SQLite
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : warning?.message;
  if (msg && msg.includes('SQLite')) return;
  return origEmit.call(this, warning, ...args);
};
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = origEmit;

const { DATA_DIR } = require('./config');

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'soundwave.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  google_refresh_enc TEXT,
  google_email TEXT,
  drive_folder_id TEXT,
  drive_folder_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

CREATE TABLE IF NOT EXISTS playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  meta TEXT NOT NULL,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_playlist ON playlist_items(playlist_id, position);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  meta TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, file_id)
);

CREATE TABLE IF NOT EXISTS track_meta (
  file_id TEXT PRIMARY KEY,
  genre TEXT,
  source TEXT NOT NULL,           -- itunes | user | none
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lyrics (
  key TEXT PRIMARY KEY,            -- yt:<videoId> | m:<artis>|<judul>
  found INTEGER NOT NULL,
  data TEXT,                       -- JSON { source, synced, lines, plain, lang, auto }
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_cache (
  key TEXT PRIMARY KEY,            -- cache data eksternal (jadwal sholat, daftar kota, surat Al-Qur'an)
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,              -- JSON pengaturan (wilayah sholat, adzan, qari)
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_plays (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  meta TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, file_id)
);
`);

// Migrasi ringan: kolom baru pada tabel lama
{
  const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  // drive_mode: 'oauth' (login Google, baca+tulis) | 'link' (link folder publik + API key, hanya baca)
  if (!cols.has('drive_mode')) db.exec('ALTER TABLE users ADD COLUMN drive_mode TEXT');
  // Dinonaktifkan superadmin (1) & terakhir aktif (ms) untuk panel admin
  if (!cols.has('disabled')) db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('last_seen')) db.exec('ALTER TABLE users ADD COLUMN last_seen INTEGER');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login INTEGER
  );
  CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    level TEXT NOT NULL DEFAULT 'info',
    created_at INTEGER NOT NULL,
    created_by INTEGER,
    push_ok INTEGER NOT NULL DEFAULT 0,
    push_fail INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS announcement_reads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ann_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, ann_id)
  );
  -- Database lirik bersama lintas pengguna: sekali ditemukan (LRCLIB / subtitle YouTube), dipakai semua akun & HP
  CREATE TABLE IF NOT EXISTS lyrics_db (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_norm TEXT NOT NULL,
    title_norm TEXT NOT NULL,
    artist TEXT,
    title TEXT,
    duration INTEGER,               -- detik (versi lagu yang cocok dengan timing lirik)
    yt_id TEXT,
    source TEXT NOT NULL,           -- lrclib | youtube | youtube-auto
    synced INTEGER NOT NULL,
    instrumental INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,             -- JSON { source, synced, lines, plain, lang, auto, instrumental }
    hits INTEGER NOT NULL DEFAULT 0, -- berapa kali dipakai tanpa mencari ke luar
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_hit_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_lyrics_db_title ON lyrics_db (title_norm);
  CREATE INDEX IF NOT EXISTS idx_lyrics_db_yt ON lyrics_db (yt_id);
  CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);


/** Jalankan fungsi dalam transaksi. */
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const getKv = db.prepare('SELECT data, updated_at FROM kv_cache WHERE key = ?');
const putKv = db.prepare(`INSERT INTO kv_cache (key, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);

/**
 * Ambil dari cache atau jalankan loader. Bila loader gagal, data lama (kedaluwarsa) tetap dipakai.
 * @param {string} key @param {number} ttlMs @param {() => Promise<any>} loader
 */
async function cached(key, ttlMs, loader) {
  const row = getKv.get(key);
  if (row && Date.now() - row.updated_at < ttlMs) return JSON.parse(row.data);
  try {
    const data = await loader();
    putKv.run(key, JSON.stringify(data), Date.now());
    return data;
  } catch (e) {
    if (row) return JSON.parse(row.data);
    throw e;
  }
}

module.exports = { db, tx, cached };

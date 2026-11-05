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

CREATE TABLE IF NOT EXISTS recent_plays (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  meta TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, file_id)
);
`);

/** Jalankan fungsi dalam transaksi. */
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx };

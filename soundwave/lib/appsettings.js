'use strict';
/** Pengaturan global aplikasi (diatur superadmin), disimpan sebagai JSON per kunci. */
const { db } = require('./db');

const getRow = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const putRow = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const delRow = db.prepare('DELETE FROM app_settings WHERE key = ?');

function get(key, fallback = null) {
  const r = getRow.get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
function set(key, value) {
  if (value == null) delRow.run(key); else putRow.run(key, JSON.stringify(value));
}
module.exports = { get, set };

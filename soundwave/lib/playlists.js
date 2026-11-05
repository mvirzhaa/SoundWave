'use strict';
/** Operasi playlist yang dipakai bersama oleh route pustaka dan perintah suara. */
const { db, tx } = require('./db');

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
/** ID lagu lokal: local-w-… (folder di browser) atau local-m-… (penyimpanan HP). File-nya tetap di perangkat. */
const LOCAL_ID_RE = /^local-[wm]-[A-Za-z0-9_-]{4,120}$/;
const isLocalId = (id) => LOCAL_ID_RE.test(String(id || ''));

/** Snapshot metadata yang disimpan di DB agar playlist tetap tampil walau cache kosong. */
function snapshot(t) {
  return {
    name: str(t.name, 300),
    title: str(t.title, 300) || str(t.name, 300) || 'Tanpa judul',
    artist: str(t.artist, 200) || 'Tidak diketahui',
    mime: str(t.mime, 80),
    isVideo: Boolean(t.isVideo),
    ytId: /^[A-Za-z0-9_-]{11}$/.test(t.ytId || '') ? t.ytId : null,
    duration: Number.isFinite(Number(t.duration)) && t.duration ? Math.round(Number(t.duration)) : null,
    album: str(t.album, 200) || null,
    genre: str(t.genre, 60) || null,
  };
}

function listForUser(userId) {
  return db.prepare('SELECT id, name FROM playlists WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId);
}

function create(userId, name) {
  const now = Date.now();
  const n = String(name).trim().slice(0, 100);
  const info = db.prepare('INSERT INTO playlists (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(userId, n, now, now);
  return { id: Number(info.lastInsertRowid), name: n };
}

/** Tambahkan lagu (objek track lengkap atau {id}) ke playlist; duplikat dilewati. */
function addTracks(playlistId, tracks, liveMap = new Map()) {
  const existing = new Set(db.prepare('SELECT file_id FROM playlist_items WHERE playlist_id = ?').all(playlistId).map((x) => x.file_id));
  let pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM playlist_items WHERE playlist_id = ?').get(playlistId).m;
  const ins = db.prepare('INSERT INTO playlist_items (playlist_id, file_id, meta, position, added_at) VALUES (?, ?, ?, ?, ?)');
  let added = 0;
  tx(() => {
    for (const t of tracks) {
      const fid = String(t?.id || '');
      if (!FILE_ID_RE.test(fid) || existing.has(fid)) continue;
      ins.run(playlistId, fid, JSON.stringify(snapshot(liveMap.get(fid) || t)), ++pos, Date.now());
      existing.add(fid);
      added++;
    }
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId);
  });
  return added;
}

function itemsOf(playlistId) {
  return db.prepare('SELECT id, file_id, meta FROM playlist_items WHERE playlist_id = ? ORDER BY position, id').all(playlistId);
}

module.exports = { snapshot, listForUser, create, addTracks, itemsOf, FILE_ID_RE, LOCAL_ID_RE, isLocalId };

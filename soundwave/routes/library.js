'use strict';
/**
 * Pustaka musik dari Google Drive: daftar lagu, streaming, favorit,
 * terakhir diputar, dan playlist buatan pengguna.
 */
const express = require('express');
const { db, tx } = require('../lib/db');
const A = require('../lib/auth');
const D = require('../lib/drive');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = A.requireAuth();
const RECENT_MAX = 50;

const P = require('../lib/playlists');
const G = require('../lib/genre');
const { snapshot } = P;
const Q = require('../lib/quran');
const Prefs = require('../lib/prefs');

async function trackMap(user) {
  try { return new Map(G.attach(await D.listTracks(user)).map((t) => [t.id, t])); } catch { return new Map(); }
}

/** Gabungkan snapshot DB dengan data terbaru dari Drive (jika ada). */
function hydrate(fileId, metaJson, map) {
  // Lagu lokal: hanya perangkat pemiliknya yang tahu apakah file masih ada
  if (P.isLocalId(fileId)) return { id: fileId, ...JSON.parse(metaJson), local: true, cover: null, available: true };
  if (Q.isQuranId(fileId)) { const m = JSON.parse(metaJson); return { id: fileId, ...m, cover: null, available: Boolean(m.url) }; }
  const live = map.get(fileId);
  if (live) return { ...live, available: true };
  const m = JSON.parse(metaJson);
  return {
    id: fileId, ...m,
    cover: m.ytId ? `https://i.ytimg.com/vi/${m.ytId}/hqdefault.jpg` : null,
    // Jika daftar Drive berhasil dimuat tapi file tidak ada, berarti sudah dihapus/dipindah
    available: map.size === 0 ? true : false,
  };
}

async function resolveMeta(user, fileId, body) {
  if (!D.FILE_ID_RE.test(String(fileId))) throw Object.assign(new Error('ID file tidak valid.'), { status: 400 });
  if (P.isLocalId(fileId)) return snapshot(body || {});
  const map = await trackMap(user);
  return snapshot(map.get(fileId) || body || {});
}

/* ---------- Lagu ---------- */
r.get('/tracks', auth, wrap(async (req, res) => {
  const tracks = G.attach(await D.listTracks(req.user, { refresh: req.query.refresh === '1' }));
  const favs = new Set(db.prepare('SELECT file_id FROM favorites WHERE user_id = ?').all(req.user.id).map((x) => x.file_id));
  res.json({ tracks: tracks.map((t) => ({ ...t, favorite: favs.has(t.id) })) });
}));

r.get('/stream/:fileId', A.requireAuth({ media: true }), wrap(async (req, res) => {
  await D.stream(req.user, req.params.fileId, req, res);
}));

/** Ubah genre lagu secara manual. Body: { genre } */
r.put('/tracks/:fileId/genre', auth, (req, res) => {
  if (!D.FILE_ID_RE.test(req.params.fileId)) return res.status(400).json({ error: 'ID file tidak valid.' });
  res.json({ genre: G.setGenre(req.params.fileId, req.body?.genre) });
});

/** Ganti nama file lagu di Google Drive. Body: { name } */
r.patch('/tracks/:fileId', auth, wrap(async (req, res) => {
  const t = await D.renameFile(req.user, req.params.fileId, req.body?.name);
  const [track] = G.attach([t]);
  // Perbarui salinan judul di favorit / terakhir diputar / playlist pengguna ini
  const meta = JSON.stringify(snapshot(track));
  tx(() => {
    db.prepare('UPDATE favorites SET meta = ? WHERE user_id = ? AND file_id = ?').run(meta, req.user.id, t.id);
    db.prepare('UPDATE recent_plays SET meta = ? WHERE user_id = ? AND file_id = ?').run(meta, req.user.id, t.id);
    db.prepare(`UPDATE playlist_items SET meta = ? WHERE file_id = ? AND playlist_id IN
      (SELECT id FROM playlists WHERE user_id = ?)`).run(meta, t.id, req.user.id);
  });
  res.json({ track });
}));

r.delete('/tracks/:fileId', auth, wrap(async (req, res) => {
  await D.trashFile(req.user, req.params.fileId);
  const fid = req.params.fileId;
  tx(() => {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND file_id = ?').run(req.user.id, fid);
    db.prepare('DELETE FROM recent_plays WHERE user_id = ? AND file_id = ?').run(req.user.id, fid);
    db.prepare(`DELETE FROM playlist_items WHERE file_id = ? AND playlist_id IN
      (SELECT id FROM playlists WHERE user_id = ?)`).run(fid, req.user.id);
  });
  res.json({ ok: true });
}));

/* ---------- Favorit ---------- */
r.put('/favorites/:fileId', auth, wrap(async (req, res) => {
  const meta = await resolveMeta(req.user, req.params.fileId, req.body?.track);
  db.prepare(`INSERT INTO favorites (user_id, file_id, meta, added_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, file_id) DO UPDATE SET meta = excluded.meta`)
    .run(req.user.id, req.params.fileId, JSON.stringify(meta), Date.now());
  res.json({ favorite: true });
}));

r.delete('/favorites/:fileId', auth, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND file_id = ?').run(req.user.id, req.params.fileId);
  res.json({ favorite: false });
});

/* ---------- Terakhir diputar ---------- */
r.post('/recent/:fileId', auth, wrap(async (req, res) => {
  const meta = await resolveMeta(req.user, req.params.fileId, req.body?.track);
  tx(() => {
    db.prepare(`INSERT INTO recent_plays (user_id, file_id, meta, played_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, file_id) DO UPDATE SET meta = excluded.meta, played_at = excluded.played_at`)
      .run(req.user.id, req.params.fileId, JSON.stringify(meta), Date.now());
    db.prepare(`DELETE FROM recent_plays WHERE user_id = ? AND file_id NOT IN
      (SELECT file_id FROM recent_plays WHERE user_id = ? ORDER BY played_at DESC LIMIT ${RECENT_MAX})`)
      .run(req.user.id, req.user.id);
  });
  res.json({ ok: true });
}));

/* ---------- Playlist ---------- */
const ownPlaylist = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?');
function getOwned(req) {
  const p = ownPlaylist.get(Number(req.params.id), req.user.id);
  if (!p) throw Object.assign(new Error('Playlist tidak ditemukan.'), { status: 404 });
  return p;
}
const touch = (id) => db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
const coversOf = (rows) => rows.map((x) => JSON.parse(x.meta).ytId).filter(Boolean).slice(0, 4);

/**
 * Penanda di Pustaka: lagu mana sudah masuk playlist mana.
 * → { playlists: [{ id, name, initials, hue }], map: { fileId: [playlistId, …] } }
 */
function initialsOf(name) {
  const words = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '♪';
  if (words.length === 1) return words[0].slice(0, 2).replace(/^(.)(.*)$/, (m, a, b) => a.toUpperCase() + b.toLowerCase());
  return (words[0][0] + words[1][0]).toUpperCase();
}
r.get('/playlists/membership', auth, (req, res) => {
  const uid = req.user.id;
  const pls = db.prepare('SELECT id, name FROM playlists WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(uid);
  const rows = db.prepare(`SELECT i.file_id, i.playlist_id FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id
    WHERE p.user_id = ?`).all(uid);
  const map = {};
  for (const r0 of rows) (map[r0.file_id] ||= []).includes(r0.playlist_id) || map[r0.file_id].push(r0.playlist_id);
  const order = new Map(pls.map((p, i) => [p.id, i])); // urutan lingkaran = urutan nama playlist
  for (const k of Object.keys(map)) map[k].sort((a, b) => order.get(a) - order.get(b));
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    // Warna tetap per playlist; "sudut emas" membuat playlist yang berurutan dibuat tetap berbeda jelas warnanya
    playlists: pls.map((p) => ({ id: p.id, name: p.name, initials: initialsOf(p.name), hue: Math.round((p.id * 137.508 + 20) % 360) })),
    map,
  });
});

r.get('/playlists', auth, (req, res) => {
  const uid = req.user.id;
  const favRows = db.prepare('SELECT meta FROM favorites WHERE user_id = ? ORDER BY added_at DESC').all(uid);
  const recRows = db.prepare('SELECT meta FROM recent_plays WHERE user_id = ? ORDER BY played_at DESC').all(uid);
  const lists = db.prepare(`SELECT p.id, p.name, p.updated_at, COUNT(i.id) AS count
    FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id
    WHERE p.user_id = ? GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all(uid);
  const coverStmt = db.prepare('SELECT meta FROM playlist_items WHERE playlist_id = ? ORDER BY position LIMIT 12');
  res.json({
    special: [
      { id: 'recent', name: 'Terakhir Diputar', count: recRows.length, covers: coversOf(recRows), special: true },
      { id: 'favorites', name: 'Favorit', count: favRows.length, covers: coversOf(favRows), special: true },
      { id: 'quran', name: 'Hapalan Quran', count: Q.JUZ30.length, covers: [], special: true, quran: true },
    ],
    playlists: lists.map((p) => ({ id: p.id, name: p.name, count: p.count, updatedAt: p.updated_at, covers: coversOf(coverStmt.all(p.id)) })),
  });
});

r.post('/playlists', auth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Nama playlist wajib diisi.' });
  const pl = P.create(req.user.id, name);
  res.status(201).json({ ...pl, count: 0, covers: [] });
});

r.get('/playlists/:id', auth, wrap(async (req, res) => {
  if (req.params.id === 'quran') {
    // Playlist bawaan: murottal Juz 30 (+ Al-Fatihah) atau seluruh 114 surat
    const pref = Prefs.get(req.user.id).quran;
    const qari = /^\d{2}$/.test(String(req.query.qari || '')) ? String(req.query.qari) : pref.qari;
    const semua = req.query.semua != null ? req.query.semua === '1' : pref.semua;
    const pl = await Q.playlist({ qari, semua });
    return res.json({ id: 'quran', name: 'Hapalan Quran', special: true, quran: true, semua, ...pl,
      items: pl.items.map((t) => ({ ...t, itemId: t.id })) });
  }
  const map = await trackMap(req.user);
  const uid = req.user.id;
  if (req.params.id === 'favorites' || req.params.id === 'recent') {
    const rows = req.params.id === 'favorites'
      ? db.prepare('SELECT file_id, meta FROM favorites WHERE user_id = ? ORDER BY added_at DESC').all(uid)
      : db.prepare('SELECT file_id, meta FROM recent_plays WHERE user_id = ? ORDER BY played_at DESC').all(uid);
    return res.json({
      id: req.params.id,
      name: req.params.id === 'favorites' ? 'Favorit' : 'Terakhir Diputar',
      special: true,
      items: rows.map((x) => ({ itemId: x.file_id, ...hydrate(x.file_id, x.meta, map) })),
    });
  }
  const p = getOwned(req);
  const rows = db.prepare('SELECT id, file_id, meta FROM playlist_items WHERE playlist_id = ? ORDER BY position, id').all(p.id);
  res.json({ id: p.id, name: p.name, special: false, items: rows.map((x) => ({ itemId: x.id, ...hydrate(x.file_id, x.meta, map) })) });
}));

r.patch('/playlists/:id', auth, (req, res) => {
  const p = getOwned(req);
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Nama playlist wajib diisi.' });
  db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), p.id);
  res.json({ id: p.id, name });
});

r.delete('/playlists/:id', auth, (req, res) => {
  const p = getOwned(req);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

/** Tambah lagu. Body: { tracks: [{ id, ...meta }] } atau { fileIds: [...] } */
r.post('/playlists/:id/items', auth, wrap(async (req, res) => {
  const p = getOwned(req);
  const input = Array.isArray(req.body?.tracks) ? req.body.tracks
    : Array.isArray(req.body?.fileIds) ? req.body.fileIds.map((id) => ({ id })) : [];
  if (!input.length || input.length > 500) return res.status(400).json({ error: 'Tidak ada lagu yang ditambahkan.' });
  const map = await trackMap(req.user);
  const added = P.addTracks(p.id, input, map);
  res.json({ added, skipped: input.length - added });
}));

r.delete('/playlists/:id/items/:itemId', auth, (req, res) => {
  const p = getOwned(req);
  db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(Number(req.params.itemId), p.id);
  touch(p.id);
  res.json({ ok: true });
});

/** Ubah urutan. Body: { itemIds: [urutan baru] } */
r.put('/playlists/:id/order', auth, (req, res) => {
  const p = getOwned(req);
  const ids = Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(Number) : [];
  const upd = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?');
  tx(() => { ids.forEach((id, i) => upd.run(i, id, p.id)); touch(p.id); });
  res.json({ ok: true });
});

module.exports = r;

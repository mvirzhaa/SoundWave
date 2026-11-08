'use strict';
/** TV: daftar iptv-org, saluran pilihan (YouTube resmi/HLS dari admin), link M3U pengguna, favorit. */
const express = require('express');
const A = require('../lib/auth');
const TV = require('../lib/tv');
const P = require('../lib/prefs');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = A.requireAuth();

/** GET /api/tv?negara=ID&kategori=news&q=&offset=0   (negara kosong = semua negara) */
r.get('/', auth, wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.json(await TV.list({
    negara: req.query.negara == null ? 'ID' : String(req.query.negara).slice(0, 2),
    kategori: String(req.query.kategori || '').slice(0, 30),
    q: String(req.query.q || '').slice(0, 80),
    offset: req.query.offset,
  }));
}));

/** Daftar negara & kategori (dengan jumlah saluran) */
r.get('/meta', auth, wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.json(await TV.meta());
}));

/** Saluran pilihan: siaran resmi (YouTube Live) & saluran yang ditambahkan admin */
r.get('/pilihan', auth, (req, res) => res.json({ items: TV.pilihan() }));

/** Cari video siaran langsung kanal YouTube pilihan → { videoId, page } */
r.get('/yt/:id', auth, wrap(async (req, res) => {
  const id = Number(String(req.params.id).replace(/^tvc-/, ''));
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid.' });
  res.json(await TV.ytLive(id));
}));

/* ---------- Favorit (sama di web & HP) ---------- */
r.get('/favorit', auth, wrap(async (req, res) => res.json({ items: await TV.freshFavs(P.get(req.user.id).tv.favorit) })));
r.put('/favorit', auth, wrap(async (req, res) => {
  const it = TV.sanitizeFav(req.body?.item);
  if (!it) return res.status(400).json({ error: 'Data saluran tidak valid.' });
  const fav = P.get(req.user.id).tv.favorit.filter((x) => x.id !== it.id);
  const next = P.update(req.user.id, { tv: { favorit: [it, ...fav].slice(0, 100) } }).tv.favorit;
  res.json({ items: await TV.freshFavs(next) });
}));
r.delete('/favorit/:id', auth, wrap(async (req, res) => {
  const fav = P.get(req.user.id).tv.favorit.filter((x) => x.id !== req.params.id);
  res.json({ items: await TV.freshFavs(P.update(req.user.id, { tv: { favorit: fav } }).tv.favorit) });
}));

/* ---------- Link M3U milik pengguna (diatur di menu Akun) ---------- */
r.get('/m3u', auth, (req, res) => res.json({ links: TV.m3u.list(req.user.id) }));
r.post('/m3u', auth, wrap(async (req, res) => res.json({ link: await TV.m3u.add(req.user.id, req.body || {}) })));
r.patch('/m3u/:id', auth, (req, res) => { TV.m3u.rename(req.user.id, Number(req.params.id), req.body?.name); res.json({ links: TV.m3u.list(req.user.id) }); });
r.delete('/m3u/:id', auth, (req, res) => { TV.m3u.remove(req.user.id, Number(req.params.id)); res.json({ links: TV.m3u.list(req.user.id) }); });
r.get('/m3u/:id/saluran', auth, wrap(async (req, res) => {
  res.json(await TV.m3u.channels(req.user.id, Number(req.params.id), { q: String(req.query.q || '').slice(0, 80), offset: req.query.offset }));
}));

r.use((err, req, res, next) => {
  if (err instanceof TV.TvError) return res.status(err.status).json({ error: err.message, code: err.code });
  next(err);
});

module.exports = r;

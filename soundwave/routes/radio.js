'use strict';
/** Radio internet: cari stasiun / frekuensi, stasiun populer, favorit, proxy stream http. */
const express = require('express');
const A = require('../lib/auth');
const R = require('../lib/radio');
const P = require('../lib/prefs');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = A.requireAuth();
const authMedia = A.requireAuth({ media: true });

/** GET /api/radio?q=101.1&negara=ID  (q kosong = populer; negara kosong = semua negara) */
r.get('/', auth, wrap(async (req, res) => {
  const negara = req.query.negara == null ? 'ID' : String(req.query.negara);
  res.json({ stasiun: await R.cari(String(req.query.q || ''), negara) });
}));

/** Favorit radio (disimpan di akun, sama di web & HP) */
r.get('/favorit', auth, (req, res) => res.json({ stasiun: P.get(req.user.id).radio.favorit }));
r.put('/favorit/:uuid', auth, wrap(async (req, res) => {
  const s = R.sanitizeStation(req.body?.stasiun) || await R.byUuid(req.params.uuid);
  if (s.uuid !== req.params.uuid) return res.status(400).json({ error: 'ID stasiun tidak cocok.' });
  const fav = P.get(req.user.id).radio.favorit.filter((x) => x.uuid !== s.uuid);
  res.json({ stasiun: P.update(req.user.id, { radio: { favorit: [s, ...fav].slice(0, 100) } }).radio.favorit });
}));
r.delete('/favorit/:uuid', auth, (req, res) => {
  const fav = P.get(req.user.id).radio.favorit.filter((x) => x.uuid !== req.params.uuid);
  res.json({ stasiun: P.update(req.user.id, { radio: { favorit: fav } }).radio.favorit });
});

/** Catat klik (dipanggil saat stasiun mulai diputar) */
r.post('/klik/:uuid', auth, (req, res) => { R.catatKlik(req.params.uuid); res.json({ ok: true }); });

/** Proxy stream untuk stasiun http:// (browser memblokir audio http di halaman https). */
r.get('/stream/:uuid', authMedia, wrap(async (req, res) => { await R.proxy(req.params.uuid, req, res); }));

module.exports = r;

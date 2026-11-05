'use strict';
/** Al-Qur'an: daftar surat, teks ayat, antrean hafalan per ayat. */
const express = require('express');
const A = require('../lib/auth');
const Q = require('../lib/quran');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = A.requireAuth();

r.get('/surat', auth, wrap(async (req, res) => {
  const list = await Q.daftarSurat();
  res.json({ surat: list.map(({ audioFull, ...s }) => s), qari: Q.qariList(list) });
}));

r.get('/surat/:n', auth, wrap(async (req, res) => {
  res.json(await Q.detailSurat(req.params.n));
}));

/** Antrean hafalan: GET /api/quran/hafalan/:n?qari=05&ulang=3&dari=1&sampai=10 */
r.get('/hafalan/:n', auth, wrap(async (req, res) => {
  const q = req.query;
  res.json(await Q.ayatQueue(req.params.n, String(q.qari || '05'), Number(q.ulang) || 3, Number(q.dari) || 1, Number(q.sampai) || 9999));
}));

module.exports = r;

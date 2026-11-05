'use strict';
/** GET /api/lyrics — lirik tersinkron untuk lagu Drive, lokal, atau hasil YouTube. */
const express = require('express');
const A = require('../lib/auth');
const L = require('../lib/lyrics');

const r = express.Router();
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

r.get('/', A.requireAuth(), async (req, res, next) => {
  try {
    const q = req.query;
    const title = str(q.title, 300);
    if (!title) return res.status(400).json({ error: 'Judul lagu kosong.' });
    const ytId = /^[A-Za-z0-9_-]{11}$/.test(String(q.ytId || '')) ? String(q.ytId) : null;
    const duration = Number(q.duration) > 0 && Number(q.duration) < 6 * 3600 ? Number(q.duration) : null;
    const data = await L.find({ title, artist: str(q.artist, 200), album: str(q.album, 200), duration, ytId, refresh: q.refresh === '1' });
    if (!data) return res.json({ found: false });
    res.json({ found: true, ...data });
  } catch (e) { next(e); }
});

module.exports = r;

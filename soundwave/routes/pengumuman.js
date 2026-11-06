'use strict';
/** Pengumuman untuk pengguna (pop-up + daftar tersimpan) dan pendaftaran token push HP. */
const express = require('express');
const A = require('../lib/auth');
const Ann = require('../lib/announce');

const r = express.Router();
const auth = A.requireAuth();

r.get('/', auth, (req, res) => {
  const list = Ann.forUser(req.user.id);
  res.json({ pengumuman: list, belumDibaca: list.filter((a) => !a.read).length });
});
r.post('/dibaca', auth, (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  Ann.markRead(req.user.id, ids);
  res.json({ ok: true });
});

/** Token Expo push dari aplikasi mobile. */
r.post('/push-token', auth, (req, res) => {
  Ann.registerToken(req.user.id, req.body?.token, req.body?.platform);
  res.json({ ok: true });
});
r.delete('/push-token', auth, (req, res) => {
  Ann.unregisterToken(req.user.id, req.body?.token);
  res.json({ ok: true });
});

module.exports = r;

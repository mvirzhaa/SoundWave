'use strict';
const express = require('express');
const cfg = require('../lib/config');
const A = require('../lib/auth');
const D = require('../lib/drive');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Minta URL login Google. Body: { client: "web" | "mobile" } */
r.post('/connect', A.requireAuth(), (req, res) => {
  res.json({ url: D.authUrl(req.user, req.body?.client) });
});

/** Callback OAuth Google (tanpa sesi — identitas dibawa oleh "state" yang ditandatangani). */
r.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  let client = 'web';
  try { client = A.verify(String(state)).client === 'mobile' ? 'mobile' : 'web'; } catch { /* default web */ }
  const back = (status, msg) => {
    const q = new URLSearchParams({ status, ...(msg ? { message: msg } : {}) });
    res.redirect(client === 'mobile' ? `${cfg.MOBILE_SCHEME}://drive?${q}` : `${cfg.PUBLIC_URL}/#/akun?drive=${status}${msg ? `&message=${encodeURIComponent(msg)}` : ''}`);
  };
  if (error) return back('cancelled', 'Otorisasi dibatalkan.');
  try {
    await D.handleCallback(String(code || ''), String(state || ''));
    back('connected');
  } catch (e) {
    back('error', e.message);
  }
});

r.post('/disconnect', A.requireAuth(), wrap(async (req, res) => {
  await D.disconnect(req.user);
  res.json({ user: A.publicUser(A.getUser.get(req.user.id)) });
}));

/** Atur folder dari link/ID. Body: { folder } */
r.put('/folder', A.requireAuth(), wrap(async (req, res) => {
  await D.setFolder(req.user, req.body?.folder);
  res.json({ user: A.publicUser(A.getUser.get(req.user.id)) });
}));

/** Buat folder baru di root My Drive dan jadikan folder penyimpanan. */
r.post('/folder', A.requireAuth(), wrap(async (req, res) => {
  await D.createFolder(req.user, req.body?.name);
  res.json({ user: A.publicUser(A.getUser.get(req.user.id)) });
}));

module.exports = r;

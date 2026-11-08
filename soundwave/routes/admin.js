'use strict';
/** API superadmin: pengguna (aktif/nonaktif), suara adzan global, pengumuman + push. */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../lib/db');
const A = require('../lib/auth');
const ADM = require('../lib/admin');
const Adzan = require('../lib/adzan');
const settings = require('../lib/appsettings');
const Ann = require('../lib/announce');
const Lyr = require('../lib/lyrics');
const Y = require('../lib/ytdlp');
const TV = require('../lib/tv');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const admin = ADM.requireAdmin();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan masuk admin. Coba lagi 15 menit lagi.' } });

/* ---------- Sesi admin ---------- */
r.post('/login', loginLimiter, (req, res) => {
  const a = ADM.login(req.body?.email, req.body?.password);
  if (!a) return res.status(401).json({ error: 'Email atau kata sandi admin salah.' });
  const token = ADM.setCookie(res, a);
  res.json({ admin: ADM.publicAdmin(a), token });
});
r.post('/logout', (req, res) => { ADM.clearCookie(res); res.json({ ok: true }); });
r.get('/me', admin, (req, res) => res.json({ admin: ADM.publicAdmin(req.admin) }));
r.post('/password', admin, loginLimiter, (req, res) => {
  const { current, next } = req.body || {};
  if (!A.verifyPassword(String(current || ''), req.admin.password_hash)) return res.status(400).json({ error: 'Kata sandi lama salah.' });
  if (String(next || '').length < 10) return res.status(400).json({ error: 'Kata sandi baru minimal 10 karakter.' });
  ADM.setPass.run(A.hashPassword(next), req.admin.id);
  ADM.setCookie(res, ADM.byId.get(req.admin.id));
  res.json({ ok: true });
});

/* ---------- Ringkasan ---------- */
const qStats = db.prepare(`SELECT COUNT(*) AS total, SUM(disabled = 0) AS aktif, SUM(disabled = 1) AS nonaktif,
  SUM(last_seen > ?) AS aktif7, SUM(google_refresh_enc IS NOT NULL OR drive_mode = 'link') AS drive FROM users`);
r.get('/stats', admin, wrap(async (req, res) => {
  const s = qStats.get(Date.now() - 7 * 86400000);
  res.json({
    users: { total: s.total || 0, aktif: s.aktif || 0, nonaktif: s.nonaktif || 0, aktif7: s.aktif7 || 0, drive: s.drive || 0 },
    perangkat: Ann.tokenCount(),
    lirik: Lyr.admin.stats(),
    adzan: await Adzan.status(),
  });
}));

/* ---------- yt-dlp (mesin unduh YouTube) ---------- */
r.get('/ytdlp', admin, wrap(async (req, res) => res.json({ version: await Y.version() })));
let updating = false;
r.post('/ytdlp/update', admin, wrap(async (req, res) => {
  if (updating) return res.status(409).json({ error: 'Pembaruan sedang berjalan.' });
  updating = true;
  try {
    const before = await Y.version();
    const out = await Y.selfUpdate();
    const after = await Y.version();
    res.json({ ok: out.ok, before, after, output: out.output });
  } finally { updating = false; }
}));

/* ---------- TV: saluran pilihan & status daftar iptv-org ---------- */
const tvErr = (fn) => wrap(async (req, res) => {
  try { await fn(req, res); } catch (e) { if (e instanceof TV.TvError) return res.status(e.status).json({ error: e.message }); throw e; }
});
r.get('/tv', admin, (req, res) => res.json({ saluran: TV.admin.list(), iptv: TV.status() }));
r.post('/tv', admin, tvErr(async (req, res) => res.json({ saluran: TV.admin.create(req.body || {}) })));
r.patch('/tv/:id', admin, tvErr(async (req, res) => res.json({ saluran: TV.admin.update(Number(req.params.id), req.body || {}) })));
r.delete('/tv/:id', admin, (req, res) => { TV.admin.remove(Number(req.params.id)); res.json({ ok: true }); });
/** Cek siaran langsung kanal YouTube (dipakai tombol "Cek" di panel) */
r.post('/tv/:id/cek', admin, wrap(async (req, res) => {
  try { res.json({ ok: true, ...(await TV.ytLive(Number(req.params.id), true)) }); } catch (e) { res.json({ ok: false, error: e.message }); }
}));
r.post('/tv-refresh', admin, (req, res) => { TV.refresh(); res.json({ ok: true, iptv: { ...TV.status(), memuat: true } }); });

/* ---------- Pengguna ---------- */
const qUsers = db.prepare(`SELECT u.id, u.name, u.email, u.created_at, u.last_seen, u.disabled, u.drive_mode,
    (u.google_refresh_enc IS NOT NULL) AS google, u.drive_folder_name,
    (SELECT COUNT(*) FROM push_tokens t WHERE t.user_id = u.id) AS perangkat
  FROM users u
  WHERE (? = '' OR u.email LIKE ? OR u.name LIKE ?) AND (? = 'semua' OR (? = 'aktif' AND u.disabled = 0) OR (? = 'nonaktif' AND u.disabled = 1))
  ORDER BY u.id DESC LIMIT ? OFFSET ?`);
const qUsersCount = db.prepare(`SELECT COUNT(*) AS n FROM users u
  WHERE (? = '' OR u.email LIKE ? OR u.name LIKE ?) AND (? = 'semua' OR (? = 'aktif' AND u.disabled = 0) OR (? = 'nonaktif' AND u.disabled = 1))`);
const setDisabled = db.prepare('UPDATE users SET disabled = ?, token_version = token_version + ? WHERE id = ?');
const dropTokensOf = db.prepare('DELETE FROM push_tokens WHERE user_id = ?');

r.get('/users', admin, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const status = ['aktif', 'nonaktif'].includes(req.query.status) ? req.query.status : 'semua';
  const per = 50;
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = qUsers.all(q, like, like, status, status, status, per, (page - 1) * per);
  const total = qUsersCount.get(q, like, like, status, status, status).n;
  res.json({
    total, page, pages: Math.max(1, Math.ceil(total / per)),
    users: rows.map((u) => ({
      id: u.id, name: u.name, email: u.email, createdAt: u.created_at, lastSeen: u.last_seen, aktif: !u.disabled,
      drive: u.drive_mode === 'link' ? 'link' : u.google ? 'google' : null, folder: u.drive_folder_name, perangkat: u.perangkat,
    })),
  });
});

r.patch('/users/:id', admin, (req, res) => {
  const id = Number(req.params.id);
  const u = A.getUser.get(id);
  if (!u) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  if (typeof req.body?.aktif !== 'boolean') return res.status(400).json({ error: 'Field "aktif" (true/false) wajib.' });
  // Menonaktifkan → semua sesi & token pengguna langsung tidak berlaku
  setDisabled.run(req.body.aktif ? 0 : 1, req.body.aktif ? 0 : 1, id);
  if (!req.body.aktif) dropTokensOf.run(id);
  res.json({ ok: true, aktif: req.body.aktif });
});

/* ---------- Suara adzan global ---------- */
r.get('/adzan', admin, wrap(async (req, res) => res.json(await Adzan.status())));
r.put('/adzan', admin, wrap(async (req, res) => {
  if (typeof req.body?.paksa === 'boolean') settings.set('adzan.paksa', req.body.paksa);
  res.json(await Adzan.status());
}));
/** Unggah file: body = isi file audio (Content-Type audio/*), nama asli di header X-File-Name. */
r.post('/adzan/:jenis', admin, express.raw({ type: () => true, limit: '20mb' }), wrap(async (req, res) => {
  const jenis = req.params.jenis === 'subuh' ? 'subuh' : 'umum';
  Adzan.save(jenis, req.body, decodeURIComponent(String(req.get('X-File-Name') || '')));
  res.json(await Adzan.status());
}));
r.delete('/adzan/:jenis', admin, wrap(async (req, res) => {
  Adzan.remove(req.params.jenis === 'subuh' ? 'subuh' : 'umum');
  res.json(await Adzan.status());
}));
r.get('/adzan/:jenis/file', admin, wrap(async (req, res) => {
  const file = await Adzan.ensureFile(req.params.jenis === 'subuh' ? 'subuh' : 'umum').catch(() => null);
  if (!file) return res.status(404).json({ error: 'Belum ada file.' });
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(file);
}));

/* ---------- Database lirik bersama ---------- */
r.get('/lirik', admin, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const { total, items } = Lyr.admin.list(req.query.q, page, 50);
  res.json({
    stats: Lyr.admin.stats(), total, page, pages: Math.max(1, Math.ceil(total / 50)),
    items: items.map((x) => ({ id: x.id, title: x.title, artist: x.artist, duration: x.duration, ytId: x.yt_id, source: x.source,
      synced: Boolean(x.synced), instrumental: Boolean(x.instrumental), hits: x.hits, createdAt: x.created_at, lastHitAt: x.last_hit_at })),
  });
});
r.get('/lirik/:id', admin, (req, res) => {
  const x = Lyr.admin.get(Number(req.params.id));
  if (!x) return res.status(404).json({ error: 'Lirik tidak ditemukan.' });
  res.json({ id: x.id, title: x.title, artist: x.artist, source: x.source, synced: Boolean(x.synced), data: x.data });
});
r.delete('/lirik/:id', admin, (req, res) => {
  if (!Lyr.admin.remove(Number(req.params.id))) return res.status(404).json({ error: 'Lirik tidak ditemukan.' });
  res.json({ ok: true });
});

/* ---------- Pengumuman ---------- */
r.get('/pengumuman', admin, (req, res) => {
  res.json({
    perangkat: Ann.tokenCount(),
    pengumuman: Ann.listAll().map((a) => ({ ...Ann.toPublic(a), reads: a.reads, pushOk: a.push_ok, pushFail: a.push_fail })),
  });
});
r.post('/pengumuman', admin, wrap(async (req, res) => {
  const a = Ann.create(req.body || {}, req.admin.id);
  const push = req.body?.push === false ? null : await Ann.push(a);
  res.json({ pengumuman: Ann.toPublic(a), push });
}));
r.delete('/pengumuman/:id', admin, (req, res) => { Ann.remove(Number(req.params.id)); res.json({ ok: true }); });

module.exports = r;

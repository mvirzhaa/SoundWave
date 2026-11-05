'use strict';
/** Pencarian YouTube, konversi MP3/MP4, unduh, dan simpan ke Drive milik pengguna. */
const express = require('express');
const rateLimit = require('express-rate-limit');
const yt = require('../lib/ytdlp');
const jobs = require('../lib/jobs');
const A = require('../lib/auth');
const D = require('../lib/drive');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = A.requireAuth();
const SEARCH_LIMIT = Math.min(30, Number(process.env.SEARCH_LIMIT) || 16);

const convertLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `u${req.user?.id}`,
  message: { error: 'Terlalu banyak permintaan konversi. Coba lagi beberapa menit lagi.' },
});

const searchCache = new Map();
const SEARCH_TTL = 10 * 60 * 1000;

r.get('/config', (req, res) => {
  res.json({ mp3: jobs.MP3_QUALITIES, mp4: jobs.MP4_QUALITIES });
});

r.get('/suggest', auth, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json([]);
  try { res.json(await yt.suggest(q)); } catch { res.json([]); }
});

r.get('/search', auth, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Kata kunci kosong.' });
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return res.json({ query: q, results: hit.results });
  try {
    const results = await yt.search(q, SEARCH_LIMIT);
    searchCache.set(key, { at: Date.now(), results });
    if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value);
    res.json({ query: q, results });
  } catch (e) {
    console.error('[search]', e.message);
    res.status(502).json({ error: 'Pencarian gagal: ' + e.message });
  }
}));

r.post('/convert', auth, convertLimiter, (req, res) => {
  const { videoId, format } = req.body || {};
  const quality = Number(req.body?.quality);
  if (!yt.VIDEO_ID_RE.test(String(videoId || ''))) return res.status(400).json({ error: 'ID video tidak valid.' });
  if (format !== 'mp3' && format !== 'mp4') return res.status(400).json({ error: 'Format harus mp3 atau mp4.' });
  const allowed = format === 'mp3' ? jobs.MP3_QUALITIES : jobs.MP4_QUALITIES;
  if (!allowed.includes(quality)) return res.status(400).json({ error: 'Kualitas tidak didukung.' });
  const job = jobs.createJob({ videoId, format, quality });
  res.status(202).json(jobs.publicView(job, req.user.id));
});

r.get('/jobs/:id', auth, (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan atau sudah kedaluwarsa.' });
  res.json(jobs.publicView(job, req.user.id));
});

r.get('/jobs/:id/file', A.requireAuth({ media: true }), (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).send('File tidak tersedia.');
  res.download(job.file, job.filename, (err) => {
    if (err && !res.headersSent) res.status(500).send('Gagal mengirim file.');
  });
});

const uploading = new Map(); // `${jobId}:${userId}` -> Promise

r.post('/jobs/:id/drive', auth, wrap(async (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'File belum siap.' });
  const uid = req.user.id;
  if (job.driveLinks.has(uid)) return res.json({ link: job.driveLinks.get(uid) });
  const key = `${job.id}:${uid}`;
  if (!uploading.has(key)) {
    uploading.set(key, D.uploadJob(req.user, job).finally(() => uploading.delete(key)));
  }
  const { link } = await uploading.get(key);
  job.driveLinks.set(uid, link);
  res.json({ link });
}));

module.exports = r;

'use strict';
/** Jadwal sholat, pengaturan wilayah & adzan, serta file suara adzan. */
const fs = require('fs');
const path = require('path');
const express = require('express');
const A = require('../lib/auth');
const S = require('../lib/sholat');
const Prefs = require('../lib/prefs');
const { DATA_DIR } = require('../lib/config');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = A.requireAuth();

/* ---------- Kota & jadwal ---------- */
r.get('/kota', auth, wrap(async (req, res) => {
  res.json({ kota: await S.cariKota(String(req.query.q || '').slice(0, 60)) });
}));

/** Cocokkan nama wilayah dari GPS HP ke kota MyQuran. */
r.get('/kota/cocok', auth, wrap(async (req, res) => {
  const k = await S.cocokkanKota({ subregion: String(req.query.subregion || '').slice(0, 80), city: String(req.query.city || '').slice(0, 80) });
  res.json({ kota: k });
}));

/**
 * Jadwal sebulan. ?kota=<id> (resmi Kemenag) atau ?lat=&lon=&tz= (hitung).
 * Tanpa parameter: pakai pengaturan wilayah tersimpan milik pengguna.
 */
r.get('/jadwal', auth, wrap(async (req, res) => {
  const now = new Date();
  const year = Number(req.query.tahun) || now.getFullYear();
  const month = Number(req.query.bulan) || now.getMonth() + 1;
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return res.status(400).json({ error: 'Tahun/bulan tidak valid.' });
  const prefs = Prefs.get(req.user.id).sholat;
  let kotaId = req.query.kota ? String(req.query.kota) : null;
  let lat = req.query.lat != null ? Number(req.query.lat) : null;
  let lon = req.query.lon != null ? Number(req.query.lon) : null;
  let tz = req.query.tz != null ? Number(req.query.tz) : null;
  let nama = '';
  if (!kotaId && lat == null) {
    if (prefs.mode === 'auto' && prefs.koordinat) {
      // Mode lokasi: pakai kota Kemenag yang cocok dengan GPS bila ada, selain itu hitung dari koordinat
      ({ lat, lon, tz, nama } = prefs.koordinat);
      kotaId = prefs.kota?.id || null;
    } else if (prefs.kota) kotaId = prefs.kota.id;
    else return res.status(409).json({ error: 'Wilayah belum diatur.', code: 'NO_REGION' });
  }
  if (kotaId) {
    try { return res.json(await S.jadwalKota(kotaId, year, month)); } catch (e) {
      // MyQuran gagal: hitung sendiri bila koordinat diketahui
      if (lat == null && prefs.koordinat) ({ lat, lon, tz, nama } = prefs.koordinat);
      if (lat == null) throw e;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(409).json({ error: 'Wilayah belum diatur.', code: 'NO_REGION' });
  }
  const out = S.jadwalKoordinat(lat, lon, year, month, Number.isFinite(tz) ? tz : 420);
  out.lokasi = nama || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  res.json(out);
}));

/* ---------- Pengaturan ---------- */
r.get('/pengaturan', auth, (req, res) => res.json(Prefs.get(req.user.id)));
r.put('/pengaturan', auth, (req, res) => res.json(Prefs.update(req.user.id, req.body)));

/* ---------- Suara adzan bawaan server ---------- */
// Letakkan file di folder data/: adzan.mp3 (umum) dan opsional adzan-subuh.mp3,
// atau isi ADZAN_URL / ADZAN_SUBUH_URL agar diunduh otomatis sekali.
const FILES = { umum: 'adzan.mp3', subuh: 'adzan-subuh.mp3' };
const URLS = { umum: process.env.ADZAN_URL, subuh: process.env.ADZAN_SUBUH_URL };
const fetching = {};

async function ensureFile(jenis) {
  const file = path.join(DATA_DIR, FILES[jenis]);
  if (fs.existsSync(file)) return file;
  const url = URLS[jenis];
  if (!url) return null;
  if (!fetching[jenis]) {
    fetching[jenis] = (async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'SoundWave/1.0' } });
      if (!res.ok) throw new Error(`Gagal mengunduh adzan (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10000) throw new Error('File adzan terlalu kecil / bukan audio.');
      fs.writeFileSync(file, buf);
      return file;
    })().finally(() => { delete fetching[jenis]; });
  }
  return fetching[jenis];
}

r.get('/adzan', auth, wrap(async (req, res) => {
  const umum = await ensureFile('umum').catch(() => null);
  const subuh = await ensureFile('subuh').catch(() => null);
  res.json({ tersedia: Boolean(umum), subuh: Boolean(subuh) });
}));

r.get('/adzan/:jenis', A.requireAuth({ media: true }), wrap(async (req, res) => {
  let jenis = req.params.jenis === 'subuh' ? 'subuh' : 'umum';
  let file = await ensureFile(jenis).catch(() => null);
  if (!file && jenis === 'subuh') file = await ensureFile('umum').catch(() => null);
  if (!file) return res.status(404).json({ error: 'Suara adzan bawaan belum dipasang di server. Pilih suara adzan dari Pustaka di pengaturan.', code: 'NO_ADZAN' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
}));

module.exports = r;

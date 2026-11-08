'use strict';
/** Pengaturan per pengguna (dipakai bersama web & mobile): wilayah sholat, adzan, qari. */
const { db } = require('./db');

const PRAYERS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
const DEFAULTS = {
  sholat: {
    mode: 'manual', // manual (pilih kota) | auto (lokasi HP)
    kota: null, // { id, lokasi, daerah }
    koordinat: null, // { lat, lon, nama, tz } — terakhir dari GPS HP
    adzan: {
      aktif: true,
      waktu: { subuh: true, dzuhur: true, ashar: true, maghrib: true, isya: true },
      volume: 0.9,
      jedaMusik: true, // jeda lagu saat adzan, lanjutkan sesudahnya
      suara: { jenis: 'bawaan' }, // bawaan | lagu (dari pustaka: { id, title, url? })
    },
    pengingat: 0, // menit sebelum waktu sholat (0 = mati)
  },
  quran: { qari: '05', semua: false },
  radio: { favorit: [] }, // stasiun favorit (maks. 100)
  tv: { favorit: [] }, // saluran TV favorit (maks. 100)
};

const getRow = db.prepare('SELECT data FROM user_prefs WHERE user_id = ?');
const putRow = db.prepare(`INSERT INTO user_prefs (user_id, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

function get(userId) {
  const row = getRow.get(userId);
  return merge(DEFAULTS, row ? JSON.parse(row.data) : {});
}

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v, min, max) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : null);

/** Validasi & simpan perubahan sebagian. */
function update(userId, patch) {
  const cur = get(userId);
  const p = patch || {};
  const s = p.sholat || {};
  const next = merge(cur, {});
  if (s.mode === 'manual' || s.mode === 'auto') next.sholat.mode = s.mode;
  if ('kota' in s) {
    next.sholat.kota = s.kota && /^\d{1,6}$/.test(String(s.kota.id))
      ? { id: String(s.kota.id), lokasi: str(s.kota.lokasi, 120), daerah: str(s.kota.daerah, 120) } : null;
  }
  if ('koordinat' in s) {
    const lat = num(s.koordinat?.lat, -90, 90); const lon = num(s.koordinat?.lon, -180, 180);
    next.sholat.koordinat = lat != null && lon != null
      ? { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, nama: str(s.koordinat.nama, 120), tz: num(s.koordinat.tz, -720, 840) ?? 420 } : null;
  }
  if (isObj(s.adzan)) {
    const a = s.adzan;
    if (typeof a.aktif === 'boolean') next.sholat.adzan.aktif = a.aktif;
    if (isObj(a.waktu)) PRAYERS.forEach((k) => { if (typeof a.waktu[k] === 'boolean') next.sholat.adzan.waktu[k] = a.waktu[k]; });
    if (num(a.volume, 0, 1) != null) next.sholat.adzan.volume = num(a.volume, 0, 1);
    if (typeof a.jedaMusik === 'boolean') next.sholat.adzan.jedaMusik = a.jedaMusik;
    if (isObj(a.suara)) {
      next.sholat.adzan.suara = a.suara.jenis === 'lagu' && /^[A-Za-z0-9_-]{4,200}$/.test(String(a.suara.id || ''))
        ? { jenis: 'lagu', id: String(a.suara.id), title: str(a.suara.title, 200), local: Boolean(a.suara.local) }
        : { jenis: 'bawaan' };
    }
  }
  if ('pengingat' in s) next.sholat.pengingat = num(s.pengingat, 0, 60) ?? 0;
  if (isObj(p.quran)) {
    if (/^\d{2}$/.test(String(p.quran.qari || ''))) next.quran.qari = String(p.quran.qari);
    if (typeof p.quran.semua === 'boolean') next.quran.semua = p.quran.semua;
  }
  if (isObj(p.tv) && Array.isArray(p.tv.favorit)) {
    const { sanitizeFav } = require('./tv');
    next.tv.favorit = p.tv.favorit.map(sanitizeFav).filter(Boolean).slice(0, 100);
  }
  if (isObj(p.radio) && Array.isArray(p.radio.favorit)) {
    // eslint-disable-next-line global-require
    const { sanitizeStation } = require('./radio');
    next.radio.favorit = p.radio.favorit.map(sanitizeStation).filter(Boolean).slice(0, 100);
  }
  putRow.run(userId, JSON.stringify(next), Date.now());
  return next;
}

module.exports = { get, update, DEFAULTS };

'use strict';
/**
 * Jadwal sholat.
 *  - Resmi: API MyQuran (data Kemenag RI / Bimas Islam) per kabupaten/kota — dipakai untuk wilayah yang dipilih.
 *  - Hitung: pustaka `adhan` dengan parameter ala Kemenag (Subuh 20°, Isya 18°, Ashar Syafi'i, ihtiyat 2 menit)
 *    — dipakai untuk koordinat GPS yang tidak cocok dengan daftar kota, atau saat MyQuran tidak dapat dihubungi.
 * Semua jam dalam waktu setempat wilayah; `tz` = selisih menit dari UTC (WIB 420, WITA 480, WIT 540).
 */
const adhan = require('adhan');
const { cached } = require('./db');

const BASE = (process.env.MYQURAN_BASE || 'https://api.myquran.com/v2').replace(/\/+$/, '');
const DAY = 24 * 3600 * 1000;
const PRAYERS = ['imsak', 'subuh', 'terbit', 'dhuha', 'dzuhur', 'ashar', 'maghrib', 'isya'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\bkabupaten\b|\bkab\b\.?/g, 'kab').replace(/[^a-z0-9]+/g, ' ').trim();

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'SoundWave/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw Object.assign(new Error('Server jadwal sholat (MyQuran) tidak dapat dihubungi.'), { status: 502, code: 'SHOLAT_UNREACHABLE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw Object.assign(new Error(data.message || `MyQuran ${res.status}`), { status: 502, code: 'SHOLAT_ERROR' });
  return data;
}

/* ---------- Zona waktu dari provinsi ---------- */
function tzFromDaerah(daerah) {
  const d = String(daerah || '').toUpperCase();
  if (/PAPUA|MALUKU/.test(d)) return 540; // WIT
  if (/BALI|NUSA TENGGARA|NTB|NTT|KALIMANTAN (SELATAN|TIMUR|UTARA)|SULAWESI|GORONTALO/.test(d)) return 480; // WITA
  return 420; // WIB
}
const tzLabel = (tz) => ({ 420: 'WIB', 480: 'WITA', 540: 'WIT' }[tz] || `UTC${tz >= 0 ? '+' : '-'}${Math.abs(tz / 60)}`);

/* ---------- Kota ---------- */
async function kotaSemua() {
  return cached('sholat:kota', 7 * DAY, async () => {
    const r = await getJson(`${BASE}/sholat/kota/semua`);
    const list = (Array.isArray(r.data) ? r.data : []).map((k) => ({ id: String(k.id), lokasi: String(k.lokasi || '').trim() })).filter((k) => k.id && k.lokasi);
    if (!list.length) throw new Error('Daftar kota kosong.');
    return list;
  });
}

async function cariKota(q, limit = 30) {
  const list = await kotaSemua();
  const nq = norm(q);
  if (!nq) return list.slice(0, limit);
  const scored = [];
  for (const k of list) {
    const n = norm(k.lokasi);
    const bare = n.replace(/^(kota|kab) /, '');
    let s = 0;
    if (n === nq || bare === nq) s = 100;
    else if (bare.startsWith(nq) || n.startsWith(nq)) s = 80;
    else if (n.includes(nq)) s = 60;
    else if (nq.split(' ').every((w) => n.includes(w))) s = 40;
    if (s) scored.push({ k, s: s + (n.startsWith('kota') ? 1 : 0) });
  }
  return scored.sort((a, b) => b.s - a.s || a.k.lokasi.localeCompare(b.k.lokasi)).slice(0, limit).map((x) => x.k);
}

/**
 * Cocokkan hasil reverse-geocode HP (subregion = kabupaten/kota, city = kota/kecamatan) ke daftar MyQuran.
 * @returns {Promise<{id, lokasi} | null>}
 */
async function cocokkanKota({ subregion, city }) {
  const list = await kotaSemua();
  const byName = new Map(list.map((k) => [norm(k.lokasi), k]));
  const tries = [];
  const add = (v) => { const n = norm(v); if (n) tries.push(n); };
  // "Kabupaten Bogor" → "kab bogor", "Kota Bogor" → "kota bogor"
  add(subregion);
  if (subregion && !/^(kota|kab)/.test(norm(subregion))) { add(`kota ${subregion}`); add(`kab ${subregion}`); }
  if (city) { add(`kota ${city}`); add(city); add(`kab ${city}`); }
  for (const t of tries) if (byName.has(t)) return byName.get(t);
  return null;
}

/* ---------- Jadwal ---------- */
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (s) => (String(s || '').match(/(\d{1,2})[:.](\d{2})/) || []).slice(1).map((x, i) => (i ? x : pad(x))).join(':') || null;

/** Jadwal sebulan dari MyQuran untuk satu kota. */
async function jadwalKota(id, year, month) {
  if (!/^\d{1,6}$/.test(String(id))) throw Object.assign(new Error('ID kota tidak valid.'), { status: 400 });
  return cached(`sholat:${id}:${year}-${pad(month)}`, 7 * DAY, async () => {
    const r = await getJson(`${BASE}/sholat/jadwal/${id}/${year}/${pad(month)}`);
    const d = r.data || {};
    const rows = Array.isArray(d.jadwal) ? d.jadwal : d.jadwal ? [d.jadwal] : [];
    const jadwal = rows.map((j, i) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : `${year}-${pad(month)}-${pad(i + 1)}`;
      const o = { date };
      PRAYERS.forEach((p) => { o[p] = hhmm(j[p]); });
      return o;
    }).filter((j) => j.subuh && j.maghrib);
    if (!jadwal.length) throw new Error('Jadwal kosong dari MyQuran.');
    const tz = tzFromDaerah(d.daerah);
    return { sumber: 'kemenag', kotaId: String(id), lokasi: d.lokasi || '', daerah: d.daerah || '', tz, zona: tzLabel(tz), jadwal };
  });
}

/** Hitung jadwal sebulan dari koordinat (parameter ala Kemenag). tz = menit dari UTC. */
function jadwalKoordinat(lat, lon, year, month, tz) {
  const p = adhan.CalculationMethod.Other();
  p.fajrAngle = 20;
  p.ishaAngle = 18;
  p.madhab = adhan.Madhab.Shafi;
  p.adjustments = { fajr: 2, sunrise: -2, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 }; // ihtiyat
  const coords = new adhan.Coordinates(lat, lon);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const fmt = (d) => { const t = new Date(d.getTime() + tz * 60000); return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`; };
  const jadwal = [];
  for (let day = 1; day <= days; day++) {
    const pt = new adhan.PrayerTimes(coords, new Date(Date.UTC(year, month - 1, day, 12)), p);
    jadwal.push({
      date: `${year}-${pad(month)}-${pad(day)}`,
      imsak: fmt(new Date(pt.fajr.getTime() - 10 * 60000)),
      subuh: fmt(pt.fajr), terbit: fmt(pt.sunrise), dhuha: fmt(new Date(pt.sunrise.getTime() + 15 * 60000)),
      dzuhur: fmt(pt.dhuhr), ashar: fmt(pt.asr), maghrib: fmt(pt.maghrib), isya: fmt(pt.isha),
    });
  }
  return { sumber: 'hitung', lokasi: '', daerah: '', tz, zona: tzLabel(tz), lat, lon, jadwal };
}

module.exports = { kotaSemua, cariKota, cocokkanKota, jadwalKota, jadwalKoordinat, tzFromDaerah, tzLabel, PRAYERS };

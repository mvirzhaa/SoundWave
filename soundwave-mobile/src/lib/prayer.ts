/**
 * Perhitungan & utilitas jadwal sholat di HP.
 * Jadwal resmi diambil dari server (Kemenag via MyQuran); bila server tak terjangkau,
 * jadwal dihitung langsung di HP dari koordinat GPS dengan parameter yang sama dengan server
 * (Subuh 20°, Isya 18°, Ashar Syafi'i, ihtiyat +2 menit).
 */
import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan';

export type WaktuKey = 'imsak' | 'subuh' | 'terbit' | 'dhuha' | 'dzuhur' | 'ashar' | 'maghrib' | 'isya';
export type Wajib = 'subuh' | 'dzuhur' | 'ashar' | 'maghrib' | 'isya';
export type Hari = { date: string } & Record<WaktuKey, string>;
export type Jadwal = {
  sumber: 'kemenag' | 'hitung';
  kotaId?: string;
  lokasi: string;
  daerah: string;
  tz: number; // menit dari UTC
  zona: string;
  lat?: number;
  lon?: number;
  jadwal: Hari[];
};
export type Next = { key: Wajib; at: number; date: string; jam: string };

export const WAKTU: [WaktuKey, string][] = [
  ['imsak', 'Imsak'], ['subuh', 'Subuh'], ['terbit', 'Terbit'], ['dhuha', 'Dhuha'],
  ['dzuhur', 'Dzuhur'], ['ashar', 'Ashar'], ['maghrib', 'Maghrib'], ['isya', 'Isya'],
];
export const WAJIB: Wajib[] = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
export const namaWaktu = Object.fromEntries(WAKTU) as Record<WaktuKey, string>;

const pad = (n: number) => String(n).padStart(2, '0');

export function tzLabel(tz: number) {
  if (tz === 420) return 'WIB';
  if (tz === 480) return 'WITA';
  if (tz === 540) return 'WIT';
  const h = tz / 60;
  return `UTC${h >= 0 ? '+' : ''}${Number.isInteger(h) ? h : h.toFixed(1)}`;
}

/** Zona waktu perangkat saat ini (menit dari UTC). */
export const deviceTz = () => -new Date().getTimezoneOffset();

/** Tanggal "hari ini" (YYYY-MM-DD) di zona waktu wilayah. */
export function todayIn(tz: number, offsetDays = 0) {
  return new Date(Date.now() + tz * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" + "HH:MM" di zona tz → epoch ms. */
export function toInstant(date: string, hhmm: string, tz: number) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - tz * 60000;
}

export const fmtJam = (hhmm?: string) => (hhmm ? hhmm.replace(':', '.') : '–');

/** Hitung jadwal sebulan dari koordinat. */
export function hitungBulan(lat: number, lon: number, year: number, month: number, tz: number): Jadwal {
  const p = CalculationMethod.Other();
  p.fajrAngle = 20;
  p.ishaAngle = 18;
  p.madhab = Madhab.Shafi;
  p.adjustments = { fajr: 2, sunrise: -2, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 };
  const coords = new Coordinates(lat, lon);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const fmt = (d: Date) => { const t = new Date(d.getTime() + tz * 60000); return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`; };
  const jadwal: Hari[] = [];
  for (let day = 1; day <= days; day++) {
    const pt = new PrayerTimes(coords, new Date(Date.UTC(year, month - 1, day, 12)), p);
    jadwal.push({
      date: `${year}-${pad(month)}-${pad(day)}`,
      imsak: fmt(new Date(pt.fajr.getTime() - 10 * 60000)),
      subuh: fmt(pt.fajr), terbit: fmt(pt.sunrise), dhuha: fmt(new Date(pt.sunrise.getTime() + 15 * 60000)),
      dzuhur: fmt(pt.dhuhr), ashar: fmt(pt.asr), maghrib: fmt(pt.maghrib), isya: fmt(pt.isha),
    });
  }
  return { sumber: 'hitung', lokasi: '', daerah: '', tz, zona: tzLabel(tz), lat, lon, jadwal };
}

export const hariIni = (j: Jadwal | null) => (j ? j.jadwal.find((x) => x.date === todayIn(j.tz)) || null : null);

/** Daftar waktu sholat wajib yang akan datang (urut), maksimal `limit`. */
export function upcoming(j: Jadwal | null, limit = 1, now = Date.now()): Next[] {
  if (!j) return [];
  const out: Next[] = [];
  const days = [...j.jadwal].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) {
    if (d.date < todayIn(j.tz, -1)) continue;
    for (const k of WAJIB) {
      if (!d[k]) continue;
      const at = toInstant(d.date, d[k], j.tz);
      if (at > now) { out.push({ key: k, at, date: d.date, jam: d[k] }); if (out.length >= limit) return out; }
    }
  }
  return out;
}

/** Jarak dua koordinat (km). */
export function jarakKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371; const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const titleCase = (s?: string) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function formatTanggal(iso: string, lang: 'id' | 'en' = 'id') {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (lang === 'en') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${days[dt.getUTCDay()]}, ${months[m - 1]} ${d}, ${y}`;
  }
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${hari[dt.getUTCDay()]}, ${d} ${bulan[m - 1]} ${y}`;
}

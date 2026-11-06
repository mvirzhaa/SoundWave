/**
 * Jadwal sholat & adzan di web.
 * Memuat pengaturan + jadwal bulanan dari server, menghitung waktu sholat berikutnya,
 * dan memutar adzan tepat waktu (musik dijeda lalu dilanjutkan) selama tab SoundWave terbuka.
 */
import { h, icon, toast } from './ui.js';
import { get, put, apiUrl } from './api.js';
import { emit, on, store } from './store.js';
import { getLocalFile } from './local.js';

export const WAKTU = [
  ['imsak', 'Imsak'], ['subuh', 'Subuh'], ['terbit', 'Terbit'], ['dhuha', 'Dhuha'],
  ['dzuhur', 'Dzuhur'], ['ashar', 'Ashar'], ['maghrib', 'Maghrib'], ['isya', 'Isya'],
];
export const WAJIB = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
export const namaWaktu = Object.fromEntries(WAKTU);

export const sholat = { prefs: null, jadwal: null, error: null, next: null, playing: null, global: null };
let timer = null;
let tickTimer = null;
const adzanAudio = new Audio();
adzanAudio.preload = 'none';

/* ---------- Waktu ---------- */
/** "HH:MM" pada tanggal & zona wilayah → milidetik UTC. */
export function toInstant(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - tz * 60000;
}
/** Tanggal (YYYY-MM-DD) "hari ini" di zona wilayah. */
export function todayIn(tz, offsetDays = 0) {
  return new Date(Date.now() + tz * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
export const fmtJam = (hhmm) => (hhmm ? hhmm.replace(':', '.') : '–');

export function hariIni() {
  const j = sholat.jadwal;
  if (!j) return null;
  return j.jadwal.find((x) => x.date === todayIn(j.tz)) || null;
}

/** Waktu sholat wajib berikutnya { key, at, date }. */
function hitungNext() {
  const j = sholat.jadwal;
  if (!j) return null;
  const now = Date.now();
  for (const off of [0, 1]) {
    const d = j.jadwal.find((x) => x.date === todayIn(j.tz, off));
    if (!d) continue;
    for (const k of WAJIB) {
      const at = toInstant(d.date, d[k], j.tz);
      if (at > now) return { key: k, at, date: d.date, jam: d[k] };
    }
  }
  return null;
}

/* ---------- Muat data ---------- */
export async function loadSholat() {
  try {
    sholat.prefs = await get('/api/sholat/pengaturan');
    // Suara adzan global dari superadmin (versi & apakah dipaksa untuk semua akun)
    sholat.global = await get('/api/sholat/adzan').catch(() => null);
    await loadJadwal();
  } catch (e) { sholat.error = e.message; }
  schedule();
  emit('sholat');
}

async function loadJadwal() {
  sholat.error = null;
  try {
    const now = new Date();
    const j = await get(`/api/sholat/jadwal?tahun=${now.getFullYear()}&bulan=${now.getMonth() + 1}`);
    // Akhir bulan: gabungkan bulan depan agar "besok" tetap ada
    if (now.getDate() >= 27) {
      const n = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      try { const j2 = await get(`/api/sholat/jadwal?tahun=${n.getFullYear()}&bulan=${n.getMonth() + 1}`); j.jadwal = [...j.jadwal, ...j2.jadwal]; } catch { /* abaikan */ }
    }
    sholat.jadwal = j;
  } catch (e) {
    sholat.jadwal = null;
    sholat.error = e.code === 'NO_REGION' ? null : e.message;
  }
}

export async function savePrefs(patch) {
  sholat.prefs = await put('/api/sholat/pengaturan', patch);
  if (patch.sholat && ('kota' in patch.sholat || 'mode' in patch.sholat)) await loadJadwal();
  schedule();
  emit('sholat');
  return sholat.prefs;
}

/* ---------- Penjadwal adzan ---------- */
function schedule() {
  clearTimeout(timer);
  clearInterval(tickTimer);
  sholat.next = hitungNext();
  emit('sholat:tick');
  tickTimer = setInterval(() => emit('sholat:tick'), 30000);
  if (!sholat.next) return;
  // setTimeout maksimal ±24 hari; cek ulang paling lambat tiap 1 jam (mis. komputer tidur)
  const wait = Math.min(sholat.next.at - Date.now(), 3600000);
  timer = setTimeout(() => {
    const n = sholat.next;
    if (n && Date.now() >= n.at - 1000 && Date.now() - n.at < 5 * 60000) masukWaktu(n);
    if (sholat.jadwal && !sholat.jadwal.jadwal.some((x) => x.date === todayIn(sholat.jadwal.tz, 1))) loadJadwal().then(schedule);
    else schedule();
  }, Math.max(1000, wait));
}

function masukWaktu({ key, jam }) {
  const a = sholat.prefs?.sholat?.adzan;
  const where = sholat.jadwal?.lokasi ? ` · ${sholat.jadwal.lokasi}` : '';
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`Waktu ${namaWaktu[key]} telah tiba`, { body: `${fmtJam(jam)} ${sholat.jadwal?.zona || ''}${where}`, tag: 'adzan' }); } catch { /* abaikan */ }
  }
  if (a?.aktif && a.waktu?.[key]) playAdzan(key, { jam });
  else toast(`Waktu ${namaWaktu[key]} telah tiba${where}`);
}

/** URL suara adzan sesuai pengaturan. */
async function adzanUrl(key) {
  const s = sholat.prefs?.sholat?.adzan?.suara;
  if (s?.jenis === 'lagu' && s.id && !sholat.global?.paksa) {
    if (s.local) return URL.createObjectURL(await getLocalFile(s.id));
    return apiUrl(`/api/library/stream/${encodeURIComponent(s.id)}`);
  }
  const v = sholat.global?.versi ? `?v=${encodeURIComponent(sholat.global.versi)}` : '';
  return apiUrl(`/api/sholat/adzan/${key === 'subuh' ? 'subuh' : 'umum'}${v}`);
}

let resumeAfter = false;
export async function playAdzan(key = 'dzuhur', { test = false, jam = '' } = {}) {
  const a = sholat.prefs?.sholat?.adzan || {};
  const media = document.getElementById('media');
  resumeAfter = false;
  if (a.jedaMusik !== false && media && !media.paused) { media.pause(); resumeAfter = true; }
  emit('preview:start');
  try {
    adzanAudio.src = await adzanUrl(key);
    adzanAudio.volume = a.volume ?? 0.9;
    await adzanAudio.play();
    sholat.playing = key;
    showBanner(key, test, jam);
  } catch (e) {
    sholat.playing = null;
    const msg = (await fetch(adzanAudio.src).then((r) => r.json()).catch(() => null))?.error;
    toast(msg || `Waktu ${namaWaktu[key]} telah tiba — suara adzan tidak dapat diputar. ${e.name === 'NotAllowedError' ? 'Klik di halaman sekali agar browser mengizinkan suara.' : ''}`, { type: 'error' });
    if (resumeAfter) media.play().catch(() => {});
  }
}

export function stopAdzan() {
  adzanAudio.pause();
  adzanAudio.currentTime = 0;
  onAdzanEnd();
}
function onAdzanEnd() {
  sholat.playing = null;
  document.getElementById('adzanBanner')?.remove();
  if (resumeAfter) { resumeAfter = false; document.getElementById('media')?.play().catch(() => {}); }
}
adzanAudio.addEventListener('ended', onAdzanEnd);

function showBanner(key, test, jam) {
  document.getElementById('adzanBanner')?.remove();
  const where = sholat.jadwal?.lokasi || '';
  document.body.append(h('div#adzanBanner.adzan-banner', { role: 'alert' },
    h('span.adzan-ico', {}, icon('M12 3c3 2 5 4.5 5 8H7c0-3.5 2-6 5-8zM6 11h12v9H6zM10 20v-4a2 2 0 0 1 4 0v4M12 3V1')),
    h('span.adzan-text', {}, h('b', { text: test ? 'Uji suara adzan' : `Waktu ${namaWaktu[key]} telah tiba` }),
      h('small', { text: test ? 'Begini adzan akan terdengar saat masuk waktu sholat.' : `${fmtJam(jam)} ${sholat.jadwal?.zona || ''} · ${where}` })),
    h('button.btn', { type: 'button', text: 'Hentikan', onclick: stopAdzan })));
}

/** Chip waktu berikutnya di topbar. */
export function nextChipText() {
  const n = sholat.next;
  if (!n) return '';
  const mins = Math.max(0, Math.round((n.at - Date.now()) / 60000));
  const sisa = mins >= 60 ? `${Math.floor(mins / 60)} j ${mins % 60} m` : `${mins} m`;
  return `${namaWaktu[n.key]} ${fmtJam(n.jam)} · ${sisa} lagi`;
}

on('user', (u) => { if (!u) { clearTimeout(timer); clearInterval(tickTimer); stopAdzan(); } });
export const sholatStore = store;

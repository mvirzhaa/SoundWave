'use strict';
/**
 * Al-Qur'an untuk playlist "Hapalan Quran" — data dari API equran.id v2
 * (teks: Kemenag RI, audio murottal: everyayah.com), di-cache di SQLite.
 */
const { cached } = require('./db');

const BASE = (process.env.EQURAN_BASE || 'https://equran.id/api/v2').replace(/\/+$/, '');
const DAY = 24 * 3600 * 1000;
const QURAN_ID_RE = /^quran-(\d{2})-(\d{3})(?:-(\d{3}))?$/;
const isQuranId = (id) => QURAN_ID_RE.test(String(id || ''));
const pad3 = (n) => String(n).padStart(3, '0');
/** Juz 30 (An-Naba' s.d. An-Nas) + Al-Fatihah — urutan umum hafalan. */
const JUZ30 = [1, ...Array.from({ length: 37 }, (_, i) => 78 + i)];

async function getJson(url) {
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'SoundWave/1.0' }, signal: AbortSignal.timeout(15000) }); } catch {
    throw Object.assign(new Error('Server Al-Qur\'an (equran.id) tidak dapat dihubungi.'), { status: 502, code: 'QURAN_UNREACHABLE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `equran.id ${res.status}`), { status: 502, code: 'QURAN_ERROR' });
  return data.data;
}

async function daftarSurat() {
  return cached('quran:surat', 7 * DAY, async () => {
    const list = await getJson(`${BASE}/surat`);
    if (!Array.isArray(list) || !list.length) throw new Error('Daftar surat kosong.');
    return list.map((s) => ({
      nomor: Number(s.nomor), nama: s.nama, namaLatin: s.namaLatin, jumlahAyat: Number(s.jumlahAyat) || null,
      tempatTurun: s.tempatTurun || '', arti: s.arti || '', audioFull: s.audioFull || {},
    }));
  });
}

async function detailSurat(nomor) {
  const n = Number(nomor);
  if (!Number.isInteger(n) || n < 1 || n > 114) throw Object.assign(new Error('Nomor surat harus 1–114.'), { status: 400 });
  return cached(`quran:surat:${n}`, 30 * DAY, async () => {
    const s = await getJson(`${BASE}/surat/${n}`);
    return {
      nomor: Number(s.nomor), nama: s.nama, namaLatin: s.namaLatin, jumlahAyat: Number(s.jumlahAyat), arti: s.arti || '',
      ayat: (s.ayat || []).map((a) => ({
        nomorAyat: Number(a.nomorAyat), teksArab: a.teksArab, teksLatin: a.teksLatin, teksIndonesia: a.teksIndonesia, audio: a.audio || {},
      })),
    };
  });
}

/** Nama qari diambil dari nama folder di URL audio (mis. .../Misyari-Rasyid-Al-Afasi/001.mp3). */
function qariList(list) {
  const af = list.find((s) => s.audioFull && Object.keys(s.audioFull).length)?.audioFull || {};
  return Object.entries(af).sort(([a], [b]) => a.localeCompare(b)).map(([id, url]) => {
    let name = id;
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      name = decodeURIComponent(parts[parts.length - 2] || id).replace(/[-_]+/g, ' ').trim();
    } catch { /* biarkan id */ }
    return { id, name };
  });
}

function trackSurat(s, qari, qariName) {
  return {
    id: `quran-${qari}-${pad3(s.nomor)}`,
    name: `${pad3(s.nomor)} ${s.namaLatin}.mp3`,
    title: `${s.nomor}. ${s.namaLatin}`,
    artist: qariName,
    album: 'Hapalan Quran',
    genre: 'Murottal',
    url: s.audioFull?.[qari] || null,
    mime: 'audio/mpeg', isVideo: false, duration: null, ytId: null,
    quran: { surat: s.nomor, nama: s.nama, arti: s.arti, jumlahAyat: s.jumlahAyat, tempatTurun: s.tempatTurun },
    available: Boolean(s.audioFull?.[qari]),
  };
}

/** Daftar lagu untuk playlist Hapalan Quran. semua=false → Juz 30 + Al-Fatihah. */
async function playlist({ qari, semua }) {
  const list = await daftarSurat();
  const qaris = qariList(list);
  const q = qaris.find((x) => x.id === qari) || qaris.find((x) => /afasi/i.test(x.name)) || qaris[0];
  const pick = semua ? list : JUZ30.map((n) => list.find((s) => s.nomor === n)).filter(Boolean);
  return { qari: q?.id, qariList: qaris, items: pick.map((s) => trackSurat(s, q?.id, q?.name || 'Murottal')) };
}

/** Antrean hafalan per ayat: tiap ayat diulang `ulang` kali. */
async function ayatQueue(nomor, qari, ulang = 3, dari = 1, sampai = 9999) {
  const [s, list] = await Promise.all([detailSurat(nomor), daftarSurat()]);
  const q = qariList(list).find((x) => x.id === qari) || { id: qari, name: 'Murottal' };
  const n = Math.max(1, Math.min(10, Number(ulang) || 1));
  const items = [];
  for (const a of s.ayat.filter((x) => x.nomorAyat >= dari && x.nomorAyat <= sampai)) {
    for (let k = 1; k <= n; k++) {
      items.push({
        id: `quran-${q.id}-${pad3(s.nomor)}-${pad3(a.nomorAyat)}`,
        name: `${s.namaLatin} ${a.nomorAyat}`,
        title: `${s.namaLatin} : ${a.nomorAyat}${n > 1 ? ` (${k}/${n})` : ''}`,
        artist: q.name, album: 'Hapalan Quran', genre: 'Murottal',
        url: a.audio?.[q.id] || null, mime: 'audio/mpeg', isVideo: false, duration: null, ytId: null,
        quran: { surat: s.nomor, ayat: a.nomorAyat, nama: s.nama },
        available: Boolean(a.audio?.[q.id]),
      });
    }
  }
  return { surat: { nomor: s.nomor, namaLatin: s.namaLatin, jumlahAyat: s.jumlahAyat }, items };
}

/** Cari surat dari ucapan ("al mulk", "yasin", "surat 36"). */
async function cariSurat(q) {
  const list = await daftarSurat();
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^(al|an|ar|as|at|ad|az|asy|ash|adh)/, '');
  const num = String(q).match(/\b(\d{1,3})\b/);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= 114) return list.find((s) => s.nomor === Number(num[1]));
  const nq = norm(q);
  return list.find((s) => norm(s.namaLatin) === nq)
    || list.find((s) => norm(s.namaLatin).startsWith(nq) || nq.startsWith(norm(s.namaLatin)))
    || list.find((s) => norm(s.arti) === nq) || null;
}

module.exports = { daftarSurat, detailSurat, qariList, playlist, ayatQueue, cariSurat, isQuranId, QURAN_ID_RE, JUZ30 };

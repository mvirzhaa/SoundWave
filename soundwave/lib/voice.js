'use strict';
/**
 * Pengurai perintah suara berbahasa Indonesia (juga menerima beberapa kata Inggris).
 * Fungsi di sini murni (tanpa I/O) agar mudah diuji.
 *
 * Contoh:
 *   "putarkan lagu the corrs"                    -> play artis
 *   "putarkan lagu rock"                         -> play genre
 *   "putarkan lagu dari playlist nostalgia"      -> play playlist
 *   "putar fly me to the moon"                   -> play judul
 *   "buatkan playlist kenangan"                  -> buat playlist
 *   "masukkan lagu dewa ke playlist kenangan"    -> tambah semua lagu artis
 *   "masukkan lagu fly me to the moon ke playlist kenangan" -> tambah satu lagu
 *   "jeda" / "lanjutkan" / "lagu berikutnya" / "sebelumnya" -> kontrol
 */
const { norm, genreMatches, isKnownGenreWord } = require('./genre');

/* ---------- Kemiripan teks ---------- */
function bigrams(s) {
  const t = ` ${s} `;
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}
function dice(a, b) {
  if (!a || !b) return 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) || 0); total += n; }
  for (const n of B.values()) total += n;
  return (2 * inter) / total;
}
/** Skor 0..1 seberapa cocok ucapan q dengan teks s (keduanya sudah dinormalisasi). */
function similarity(q, s) {
  if (!q || !s) return 0;
  if (q === s) return 1;
  const pad = ` ${s} `;
  if (pad.includes(` ${q} `)) return q.length >= 3 ? 0.92 : 0.6;
  const qt = q.split(' '), st = new Set(s.split(' '));
  if (qt.every((w) => st.has(w))) return 0.86;
  if (` ${q} `.includes(pad) && s.length >= 4) return 0.82; // ucapan memuat nama lengkap + kata lain
  return dice(q, s);
}

/* ---------- Normalisasi ucapan ---------- */
const FILLER_START = /^(?:(?:hai|hei|hey|halo|ok|oke|okay)\s+(?:soundwave|sound wave)\s*|tolong\s+|coba\s+|bisa\s+|boleh\s+|mohon\s+|aku\s+mau\s+|saya\s+mau\s+|saya\s+ingin\s+|aku\s+ingin\s+|mau\s+|ingin\s+)+/;
const FILLER_END = /(?:\s+(?:dong|ya|yah|deh|sih|nih|please|sekarang|aja|saja|untukku|buat aku|buat saya|untuk saya))+$/;

function clean(text) {
  let t = String(text || '').toLowerCase()
    .replace(/[“”"'`’]/g, '')
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) t = t.replace(FILLER_START, '').replace(FILLER_END, '').trim();
  return t;
}

const PLAY = /^(?:putar(?:kan|in)?|puterin|puter|mainkan|mainin|setel(?:kan|in)?|stel|nyalakan|dengarkan|dengerin|play)\b\s*(.*)$/;
const CREATE = /^(?:buat(?:kan|in)?|bikin(?:kan|in)?|tambah(?:kan)?\s+playlist\s+baru|create)\s*(?:sebuah\s+|satu\s+)?(?:playlist|daftar putar)\s*(?:baru\s*)?(?:(?:yang\s+)?(?:bernama|berjudul|dengan nama|namanya|nama)\s+)?(.*)$/;
const CREATE_ALT = /^(?:tambah(?:kan)?\s+playlist\s+baru)\s*(?:(?:bernama|dengan nama|namanya)\s+)?(.*)$/;
const ADD = /^(?:masuk(?:kan|in)|tambah(?:kan|in)?|simpan(?:kan)?|add)\s+(.+?)\s+(?:ke\s*dalam|ke)\s+(?:playlist|daftar putar)\s+(.+)$/;

const CONTROLS = [
  [/^(?:jeda|pause|berhenti|stop|hentikan|matikan)(?:\s+(?:lagu|musik|dulu))*$/, 'pause'],
  [/^(?:lanjut(?:kan)?|resume|teruskan|putar lagi|lanjut putar)(?:\s+(?:lagu|musik))*$/, 'resume'],
  [/^(?:(?:lagu\s+)?(?:berikutnya|selanjutnya)|next|skip|lewati|ganti lagu)(?:\s+lagu)?$/, 'next'],
  [/^(?:(?:lagu\s+)?sebelumnya|previous|kembali)(?:\s+lagu)?$/, 'previous'],
];

const SHUFFLE_WORDS = /\s*\b(?:secara\s+)?(?:acak|random|shuffle|diacak)\b\s*/g;
const SONG_PREFIX = /^(?:semua\s+)?(?:lagu(?:\s+lagu)?|lagunya|musik|musiknya|track)?\s*(?:dari|oleh|milik|karya|punya|yang dinyanyikan|yang dibawakan|nya)?\s*/;

/**
 * Urai teks menjadi niat (intent).
 * @returns {{action:string, ...}}
 */
function parse(text) {
  const t = clean(text);
  if (!t) return { action: 'unknown', text: t };

  for (const [re, cmd] of CONTROLS) if (re.test(t)) return { action: 'control', command: cmd, text: t };
  if (/^(?:bantuan|help|apa (?:saja )?yang bisa (?:kamu|kau|anda) lakukan|perintah apa saja)/.test(t)) return { action: 'help', text: t };

  let m = t.match(ADD);
  if (m) return { action: 'add_to_playlist', query: m[1].replace(SONG_PREFIX, '').trim(), playlist: m[2].trim(), text: t };

  m = t.match(CREATE) || t.match(CREATE_ALT);
  if (m) return { action: 'create_playlist', name: m[1].trim(), text: t };

  m = t.match(PLAY);
  if (m) {
    let rest = m[1];
    const shuffle = /\b(?:acak|random|shuffle|diacak)\b/.test(rest);
    rest = rest.replace(SHUFFLE_WORDS, ' ').replace(/\s+/g, ' ').trim();
    let p;
    if ((p = rest.match(/^(?:semua\s+)?(?:lagu(?:\s+lagu)?\s+)?(?:yang\s+ada\s+)?(?:dari|di|dalam)?\s*(?:playlist|daftar putar)\s+(.+)$/))) {
      return { action: 'play', target: 'playlist', query: p[1].trim(), shuffle, text: t };
    }
    if (/\b(?:favorit|favorite|kesukaan(?:ku)?|yang (?:aku |saya )?sukai?)\b/.test(rest)) return { action: 'play', target: 'favorites', shuffle, text: t };
    if (/\b(?:terakhir|baru saja|barusan) (?:diputar|didengar)\b/.test(rest)) return { action: 'play', target: 'recent', shuffle, text: t };
    if ((p = rest.match(/^(?:semua\s+)?(?:lagu(?:\s+lagu)?\s+)?(?:ber)?(?:genre|aliran|jenis(?:\s+musik)?)\s+(.+)$/))) {
      return { action: 'play', target: 'genre', query: p[1].trim(), shuffle, text: t };
    }
    const q = rest.replace(SONG_PREFIX, '').trim();
    if (!q || /^(?:semua(?:nya)?|apa saja|apa aja|sembarang|bebas|musik|lagu)$/.test(q)) return { action: 'play', target: 'all', shuffle: true, text: t };
    return { action: 'play', target: 'auto', query: q, shuffle, text: t };
  }
  return { action: 'unknown', text: t };
}

/* ---------- Pencocokan terhadap pustaka ---------- */
function artistsOf(tracks) {
  const map = new Map();
  for (const tr of tracks) {
    if (!tr.artist || tr.artist === 'Tidak diketahui') continue;
    const k = norm(tr.artist);
    if (!map.has(k)) map.set(k, { name: tr.artist, tracks: [] });
    map.get(k).tracks.push(tr);
  }
  return map;
}

/**
 * Cari artis. Artis dengan nama mirip digabung (mis. "dewa" → "Dewa" + "Dewa 19")
 * agar semua lagunya ikut diputar.
 */
function findArtist(tracks, q, min = 0.8) {
  const nq = norm(q);
  const hits = [];
  for (const [k, a] of artistsOf(tracks)) {
    // "the corrs" juga cocok dengan "corrs"
    const s = Math.max(similarity(nq, k), similarity(nq.replace(/^the /, ''), k.replace(/^the /, '')));
    if (s >= min) hits.push({ ...a, score: s });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  const top = hits[0];
  // Nama persis cocok → hanya gabungkan nama yang memuat ucapan utuh (mis. "Dewa" + "Dewa 19"), bukan yang sekadar mirip
  const floor = top.score >= 0.99 ? 0.9 : Math.max(min, top.score - 0.1);
  const group = hits.filter((x) => x.score >= floor);
  return {
    name: group.map((x) => x.name).join(' & '),
    score: top.score,
    tracks: group.flatMap((x) => x.tracks),
  };
}

function findTitles(tracks, q, min = 0.72) {
  const nq = norm(q);
  return tracks
    .map((tr) => {
      const title = norm(tr.title);
      const s = Math.max(similarity(nq, title), similarity(nq, `${title} ${norm(tr.artist)}`), similarity(nq, norm(tr.name || '')) - 0.05);
      return { track: tr, score: s };
    })
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score);
}

function findGenre(tracks, q) {
  const list = tracks.filter((tr) => genreMatches(q, tr.genre));
  const label = list.length ? mostCommon(list.map((tr) => tr.genre)) : q;
  return { tracks: list, label };
}

function findPlaylist(playlists, q, min = 0.75) {
  const nq = norm(q);
  let best = null;
  for (const p of playlists) {
    const s = similarity(nq, norm(p.name));
    if (s >= min && (!best || s > best.score)) best = { ...p, score: s };
  }
  return best;
}

function mostCommon(arr) {
  const c = new Map();
  arr.forEach((x) => c.set(x, (c.get(x) || 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const sortByTitle = (list) => [...list].sort((a, b) => a.title.localeCompare(b.title, 'id'));

module.exports = {
  parse, clean, similarity, findArtist, findTitles, findGenre, findPlaylist, artistsOf, isKnownGenreWord, sortByTitle,
};

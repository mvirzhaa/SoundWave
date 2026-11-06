'use strict';
/**
 * Lirik tersinkron.
 *  1. LRCLIB (lrclib.net) — database lirik tersinkron gratis, dicocokkan dengan artis + judul + durasi.
 *  2. Subtitle YouTube (untuk lagu yang punya ID video) — subtitle unggahan pemilik video dalam bahasa
 *     asli lagu; bila tidak ada, subtitle otomatis YouTube (ditandai "otomatis", akurasi lebih rendah).
 * Urutan: DATABASE LIRIK SERVER dulu (lintas pengguna & HP) → baru sumber luar bila belum ada.
 * Setiap lirik yang berhasil ditemukan disimpan ke tabel lyrics_db (judul & artis dinormalisasi + durasi),
 * sehingga pengguna lain dengan lagu yang sama — walau nama filenya beda ("(Official Video)", "Artis - Judul",
 * "feat. …") — langsung mendapatkannya dari server. "Tidak ditemukan" disimpan sementara (3 hari).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./db');
const yt = require('./ytdlp');

const LRCLIB = (process.env.LRCLIB_BASE || 'https://lrclib.net').replace(/\/+$/, '');
const UA = 'SoundWave/1.0 (self-hosted music player)';
const NEG_TTL = 3 * 24 * 3600 * 1000; // "tidak ditemukan" dicoba ulang setelah 3 hari
const YT_ENABLED = String(process.env.LYRICS_YOUTUBE ?? 'true').toLowerCase() !== 'false';

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------- Parser ---------- */

/** "[01:23.45] teks" → [{ t: 83.45, text }] (mendukung beberapa timestamp per baris). */
function parseLrc(lrc) {
  const out = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2].replace(':', '.')), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

const vttTime = (s) => {
  const p = s.trim().split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

/** WebVTT YouTube → baris lirik. Subtitle otomatis YouTube bersifat "roll-up" (baris berulang) — dirapikan. */
function parseVtt(vtt) {
  const out = [];
  const blocks = String(vtt || '').replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const t = vttTime(lines[i].split('-->')[0]);
    const texts = lines.slice(i + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!texts.length) continue;
    const text = texts[texts.length - 1]; // pada roll-up, baris terakhir adalah baris baru
    const prev = out[out.length - 1];
    if (prev && (prev.text === text || prev.text.endsWith(text))) continue;
    out.push({ t, text });
  }
  // Buang penanda non-lirik
  return out
    .map((l) => ({ t: l.t, text: l.text.replace(/^[♪♫\s-]+|[♪♫\s]+$/g, '').trim() }))
    .filter((l) => l.text && !/^[[(](music|musik|applause|tepuk tangan|instrumental|lagu)[\])]$/i.test(l.text));
}

/* ---------- Cache ---------- */
const getCache = db.prepare('SELECT * FROM lyrics WHERE key = ?');
const putCache = db.prepare(`INSERT INTO lyrics (key, found, data, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET found = excluded.found, data = excluded.data, updated_at = excluded.updated_at`);

function cached(key) {
  const row = key && getCache.get(key);
  if (!row) return undefined;
  if (row.found) return JSON.parse(row.data);
  return Date.now() - row.updated_at < NEG_TTL ? null : undefined; // null = pasti tidak ada (sementara)
}
function store(keys, data) {
  const now = Date.now();
  keys.filter(Boolean).forEach((k) => putCache.run(k, data ? 1 : 0, data ? JSON.stringify(data) : null, now));
}

/* ---------- LRCLIB ---------- */
async function lrclibFetch(pathAndQuery) {
  const res = await fetch(`${LRCLIB}${pathAndQuery}`, { headers: { 'User-Agent': UA, 'Lrclib-Client': UA }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return res.json();
}

function fromLrclib(r) {
  if (!r) return null;
  const dur = Number(r.duration) > 0 ? Math.round(Number(r.duration)) : null;
  if (r.instrumental) return { source: 'lrclib', synced: false, instrumental: true, lines: [], plain: '', duration: dur };
  const lines = parseLrc(r.syncedLyrics);
  if (lines.length) return { source: 'lrclib', synced: true, lines, plain: r.plainLyrics || '', duration: dur };
  if (r.plainLyrics) return { source: 'lrclib', synced: false, lines: [], plain: r.plainLyrics, duration: dur };
  return null;
}

async function lrclib({ title, artist, album, duration }) {
  const hasArtist = artist && artist !== 'Tidak diketahui';
  // 1) Pencocokan tepat (butuh durasi; LRCLIB mentoleransi selisih ±2 detik)
  if (hasArtist && duration) {
    const q = new URLSearchParams({ track_name: title, artist_name: artist, duration: String(Math.round(duration)) });
    if (album) q.set('album_name', album);
    const exact = fromLrclib(await lrclibFetch(`/api/get?${q}`));
    if (exact && (exact.synced || exact.instrumental)) return exact;
  }
  // 2) Pencarian — pilih hasil dengan judul/artis cocok & durasi terdekat, utamakan yang tersinkron
  const q = hasArtist ? new URLSearchParams({ track_name: title, artist_name: artist }) : new URLSearchParams({ q: title });
  const list = (await lrclibFetch(`/api/search?${q}`)) || [];
  const nt = norm(title);
  const na = norm(artist);
  const scored = list
    .filter((r) => norm(r.trackName).includes(nt) || nt.includes(norm(r.trackName)))
    .filter((r) => !hasArtist || norm(r.artistName).includes(na) || na.includes(norm(r.artistName)))
    .map((r) => ({ r, diff: duration && r.duration ? Math.abs(r.duration - duration) : 0 }));
  // Utamakan versi dengan durasi hampir sama (±8 dtk); bila tidak ada, terima yang terdekat (±30 dtk, mis. radio edit)
  const near = scored.filter((x) => x.diff <= 8);
  const pool = near.length ? near : scored.filter((x) => x.diff <= 30);
  pool.sort((a, b) => Number(Boolean(b.r.syncedLyrics)) - Number(Boolean(a.r.syncedLyrics)) || a.diff - b.diff);
  return fromLrclib(pool[0]?.r);
}

/* ---------- YouTube ---------- */
function runYtdlp(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(yt.YTDLP, args, { windowsHide: true });
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err.split('\n').find((l) => l.startsWith('ERROR')) || `yt-dlp ${code}`)); });
  });
}

/** Pilih subtitle dalam bahasa asli lagu (bukan terjemahan). */
function pickSubtitle(info) {
  const manual = Object.keys(info.subtitles || {}).filter((k) => k !== 'live_chat');
  const autos = Object.keys(info.automatic_captions || {});
  // YouTube menandai bahasa ucapan asli dengan akhiran "-orig" pada subtitle otomatis
  const origKey = autos.find((k) => k.endsWith('-orig'));
  const lang = (info.language || (origKey ? origKey.replace(/-orig$/, '') : '') || '').toLowerCase();
  const base = lang.split('-')[0];
  const sameLang = (k) => k.toLowerCase() === lang || k.toLowerCase().split('-')[0] === base;
  let key = lang ? manual.find(sameLang) : null;
  if (!key && manual.length === 1 && !lang) key = manual[0];
  if (key) return { key, auto: false, lang: key };
  if (origKey) return { key: origKey, auto: true, lang: base || origKey };
  return null;
}

async function youtube(videoId) {
  if (!YT_ENABLED || !yt.VIDEO_ID_RE.test(videoId || '')) return null;
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await yt.runJson([...yt.baseArgs(), '--no-playlist', '--skip-download', '-J', url], 45000);
  const pick = pickSubtitle(info);
  if (!pick) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-sub-'));
  try {
    await runYtdlp([...yt.baseArgs(), '--no-playlist', '--skip-download',
      pick.auto ? '--write-auto-subs' : '--write-subs', '--sub-langs', pick.key, '--sub-format', 'vtt',
      '-o', path.join(dir, 'sub.%(ext)s'), url]);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.vtt'));
    if (!file) return null;
    const lines = parseVtt(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (lines.length < 4) return null; // terlalu sedikit untuk dianggap lirik
    return { source: pick.auto ? 'youtube-auto' : 'youtube', synced: true, auto: pick.auto, lang: pick.lang, lines, plain: '' };
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

/* ---------- Resolusi ---------- */
const inflight = new Map(); // cegah pencarian ganda untuk lagu yang sama secara bersamaan

/* ---------- Database lirik bersama ---------- */

const NOISE = /\b(official|video|music video|lyric|lyrics|lirik|audio|visualizer|mv|hd|hq|4k|remaster(ed)?(\s+\d{4})?|explicit|clean|full song|versi?on? asli|original|cover art)\b/i;
/**
 * Normalisasi judul agar varian nama file/video dari lagu yang sama dikenali sama:
 * buang "(Official Video)", "[Lirik]", "feat. X", "| Topic", prefiks "Artis - " dan ekstensi file.
 */
function cleanTitle(title, artist) {
  let t = String(title || '').replace(/\.(mp3|m4a|flac|ogg|wav|opus|aac)$/i, '');
  t = t.replace(/[([{【][^)\]}】]*[)\]}】]/g, (m) => (NOISE.test(m) || /feat\.?|ft\.?|prod\.?/i.test(m) ? ' ' : m));
  t = t.replace(/\s[|｜•·]\s.*$/, ' ');
  t = t.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, ' ');
  const a = norm(artist);
  const parts = t.split(/\s[-–—]\s/);
  if (parts.length > 1) {
    // "Artis - Judul" → "Judul" (bila bagian depan sama dengan artis, atau artis tidak diketahui)
    if (!a || a === 'tidak diketahui' || norm(parts[0]) === a || a.includes(norm(parts[0])) || norm(parts[0]).includes(a)) t = parts.slice(1).join(' - ');
  }
  return norm(t.replace(NOISE, ' ')) || norm(title);
}
function cleanArtist(artist) {
  const a = norm(String(artist || '').replace(/\s*-\s*topic$/i, '').replace(/\s(feat\.?|ft\.?|&|x|,)\s.*$/i, ''));
  return a === 'tidak diketahui' || a === 'unknown' || a === 'unknown artist' ? '' : a;
}
function similar(a, b) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const grams = (x) => { const g = new Set(); for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2)); return g; };
  const A = grams(a); const B = grams(b);
  let n = 0; A.forEach((g) => { if (B.has(g)) n++; });
  return (2 * n) / (A.size + B.size || 1) >= 0.8;
}

const qByYt = db.prepare('SELECT * FROM lyrics_db WHERE yt_id = ? ORDER BY synced DESC, hits DESC LIMIT 1');
const qByTitle = db.prepare('SELECT * FROM lyrics_db WHERE title_norm = ? LIMIT 50');
const qHit = db.prepare('UPDATE lyrics_db SET hits = hits + 1, last_hit_at = ? WHERE id = ?');
const qInsert = db.prepare(`INSERT INTO lyrics_db (artist_norm, title_norm, artist, title, duration, yt_id, source, synced, instrumental, data, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const qUpdate = db.prepare('UPDATE lyrics_db SET source = ?, synced = ?, instrumental = ?, data = ?, duration = COALESCE(?, duration), yt_id = COALESCE(yt_id, ?), updated_at = ? WHERE id = ?');

const SYNC_TOL = 8; // detik: lirik tersinkron hanya cocok untuk versi lagu dengan durasi hampir sama
const PLAIN_TOL = 60;

function pickRow(rows, { artistN, duration }) {
  const cand = rows
    .filter((r) => !artistN || !r.artist_norm || similar(r.artist_norm, artistN))
    .map((r) => ({ r, diff: duration && r.duration ? Math.abs(r.duration - duration) : 0 }))
    .filter(({ r, diff }) => diff <= (r.synced ? SYNC_TOL : PLAIN_TOL));
  cand.sort((x, y) => Number(Boolean(y.r.artist_norm === artistN)) - Number(Boolean(x.r.artist_norm === artistN))
    || y.r.synced - x.r.synced || x.diff - y.diff || y.r.hits - x.r.hits);
  return cand[0]?.r || null;
}

/** Cari di database server. */
function fromDb({ title, artist, duration, ytId }) {
  let row = ytId ? qByYt.get(ytId) : null;
  const titleN = cleanTitle(title, artist);
  const artistN = cleanArtist(artist);
  if (!row && titleN) row = pickRow(qByTitle.all(titleN), { artistN, duration });
  if (!row) return null;
  qHit.run(Date.now(), row.id);
  return { ...JSON.parse(row.data), server: true, dbId: row.id, hits: row.hits + 1 };
}

/** Simpan / perbarui lirik di database server (dipanggil setiap kali sumber luar berhasil). */
function toDb({ title, artist, duration, ytId }, result, { replace = false } = {}) {
  if (!result) return;
  const titleN = cleanTitle(title, artist);
  if (!titleN) return;
  const artistN = cleanArtist(artist);
  const dur = result.duration || (duration ? Math.round(duration) : null);
  // Subtitle otomatis YouTube hanya dikaitkan ke videonya (akurasinya rendah untuk dipakai lagu lain)
  const ytOnly = result.source === 'youtube-auto';
  const { server, dbId, hits, ...clean } = result; // eslint-disable-line no-unused-vars
  const data = JSON.stringify(clean);
  const now = Date.now();
  const same = qByTitle.all(titleN).find((r) => (r.artist_norm || '') === artistN
    && (!dur || !r.duration || Math.abs(r.duration - dur) <= 2) && (!ytOnly || r.yt_id === ytId));
  if (same) {
    // Jangan menurunkan kualitas: lirik tersinkron tidak diganti lirik biasa, kecuali "Cari ulang"
    if (replace || (!same.synced && result.synced) || same.source === 'youtube-auto') {
      qUpdate.run(result.source, result.synced ? 1 : 0, result.instrumental ? 1 : 0, data, dur, ytId || null, now, same.id);
    }
    return same.id;
  }
  const r = qInsert.run(artistN, titleN, String(artist || '').slice(0, 200), String(title || '').slice(0, 300), dur, ytId || null,
    result.source, result.synced ? 1 : 0, result.instrumental ? 1 : 0, data, now, now);
  return Number(r.lastInsertRowid);
}

/**
 * Cari lirik untuk satu lagu: database server → (bila belum ada) LRCLIB → subtitle YouTube.
 * @param {{title:string, artist?:string, album?:string, duration?:number, ytId?:string, refresh?:boolean}} t
 */
async function find(t0) {
  const title = String(t0.title || '').trim();
  if (!title) return null;
  // Artis tidak diketahui tapi judul berbentuk "Artis - Judul" (umum pada file hasil unduhan) → pakai bagian depan
  const t = { ...t0 };
  if (!cleanArtist(t.artist)) {
    const parts = title.replace(/\.(mp3|m4a|flac|ogg|wav|opus|aac)$/i, '').split(/\s[-–—]\s/);
    if (parts.length > 1 && parts[0].length <= 60) t.artist = parts[0].trim();
  }
  const mKey = `m:${crypto.createHash('sha1').update(`${cleanArtist(t.artist)}|${cleanTitle(title, t.artist)}`).digest('hex')}`;
  const yKey = t.ytId ? `yt:${t.ytId}` : null;
  if (!t.refresh) {
    // 1) Database lirik bersama
    const hit = fromDb({ ...t, title });
    if (hit) return hit;
    // 2) Cache lama (versi sebelumnya) → pindahkan ke database bersama
    for (const k of [yKey, mKey]) {
      const c = cached(k);
      if (c) { toDb({ ...t, title }, c); return c; }
    }
    // 3) Baru-baru ini sudah dicari & memang tidak ada → jangan cari ke luar lagi (3 hari)
    if (cached(mKey) === null && (!yKey || cached(yKey) === null)) return null;
  }
  const flightKey = yKey || mKey;
  if (inflight.has(flightKey)) return inflight.get(flightKey);
  const save = (res, keys) => { store(keys, res); toDb({ ...t, title }, res, { replace: Boolean(t.refresh) }); return { ...res, server: false }; };
  const p = (async () => {
    let result = null;
    const errors = [];
    // LRCLIB dicari dengan judul yang sudah dibersihkan (lebih sering cocok) — fallback judul asli
    const cleanT = cleanTitle(title, t.artist);
    try {
      result = await lrclib({ ...t, title: cleanT && cleanT !== norm(title) ? cleanTitleText(title, t.artist) : title });
      if (!result && cleanT !== norm(title)) result = await lrclib({ ...t, title });
    } catch (e) { errors.push(e.message); }
    if (result && (result.synced || result.instrumental || !yKey)) return save(result, [mKey, yKey]);
    // LRCLIB kosong atau hanya lirik tanpa waktu → coba subtitle YouTube yang tersinkron
    if (yKey) {
      let ytRes = null;
      try { ytRes = await youtube(t.ytId); } catch (e) { errors.push(e.message); }
      if (ytRes) return save(ytRes, ytRes.auto ? [yKey] : [yKey, mKey]);
    }
    if (result) return save(result, [mKey, yKey]);
    // Simpan "tidak ditemukan" hanya bila semua sumber benar-benar menjawab (bukan error jaringan)
    if (!errors.length) store([mKey, yKey], null);
    else if (!result) throw Object.assign(new Error('Sumber lirik tidak dapat dihubungi. Coba lagi nanti.'), { status: 502, code: 'LYRICS_UNREACHABLE' });
    return null;
  })().finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, p);
  return p;
}

/** Versi teks (bukan dinormalisasi) dari judul bersih — untuk dikirim ke LRCLIB. */
function cleanTitleText(title, artist) {
  let t = String(title || '').replace(/\.(mp3|m4a|flac|ogg|wav|opus|aac)$/i, '');
  t = t.replace(/[([{【][^)\]}】]*[)\]}】]/g, (m) => (NOISE.test(m) || /feat\.?|ft\.?|prod\.?/i.test(m) ? ' ' : m));
  t = t.replace(/\s[|｜•·]\s.*$/, ' ').replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, ' ');
  const a = norm(artist);
  const parts = t.split(/\s[-–—]\s/);
  if (parts.length > 1 && (!a || a === 'tidak diketahui' || norm(parts[0]) === a || a.includes(norm(parts[0])) || norm(parts[0]).includes(a))) t = parts.slice(1).join(' - ');
  return t.replace(/\s+/g, ' ').trim() || title;
}

/* ---------- Untuk panel admin ---------- */
const qStats = db.prepare(`SELECT COUNT(*) AS total, SUM(synced) AS synced, SUM(hits) AS hits,
  SUM(source = 'lrclib') AS lrclib, SUM(source LIKE 'youtube%') AS youtube FROM lyrics_db`);
const qList = db.prepare(`SELECT id, artist, title, duration, yt_id, source, synced, instrumental, hits, created_at, last_hit_at FROM lyrics_db
  WHERE (? = '' OR title LIKE ? OR artist LIKE ? OR title_norm LIKE ?) ORDER BY hits DESC, id DESC LIMIT ? OFFSET ?`);
const qCount = db.prepare(`SELECT COUNT(*) AS n FROM lyrics_db WHERE (? = '' OR title LIKE ? OR artist LIKE ? OR title_norm LIKE ?)`);
const qGet = db.prepare('SELECT * FROM lyrics_db WHERE id = ?');
const qDel = db.prepare('DELETE FROM lyrics_db WHERE id = ?');
const qDelLegacy = db.prepare('DELETE FROM lyrics WHERE key = ? OR key = ?');

const admin = {
  stats: () => { const r = qStats.get(); return { total: r.total || 0, synced: r.synced || 0, hits: r.hits || 0, lrclib: r.lrclib || 0, youtube: r.youtube || 0 }; },
  list(q, page = 1, per = 50) {
    const s = String(q || '').trim().slice(0, 80);
    const like = `%${s.replace(/[%_]/g, '')}%`;
    const likeN = `%${norm(s)}%`;
    return { total: qCount.get(s, like, like, likeN).n, items: qList.all(s, like, like, likeN, per, (page - 1) * per) };
  },
  get: (id) => { const r = qGet.get(id); return r ? { ...r, data: JSON.parse(r.data) } : null; },
  /** Hapus lirik yang salah: berikutnya akan dicari ulang dari sumber luar. */
  remove(id) {
    const r = qGet.get(id);
    if (!r) return false;
    qDel.run(id);
    qDelLegacy.run(`m:${crypto.createHash('sha1').update(`${r.artist_norm}|${r.title_norm}`).digest('hex')}`, r.yt_id ? `yt:${r.yt_id}` : '-');
    return true;
  },
};

module.exports = { find, parseLrc, parseVtt, pickSubtitle, cleanTitle, cleanArtist, admin };

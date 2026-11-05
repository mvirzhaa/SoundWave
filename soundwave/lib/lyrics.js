'use strict';
/**
 * Lirik tersinkron.
 *  1. LRCLIB (lrclib.net) — database lirik tersinkron gratis, dicocokkan dengan artis + judul + durasi.
 *  2. Subtitle YouTube (untuk lagu yang punya ID video) — subtitle unggahan pemilik video dalam bahasa
 *     asli lagu; bila tidak ada, subtitle otomatis YouTube (ditandai "otomatis", akurasi lebih rendah).
 * Hasil (termasuk "tidak ditemukan") disimpan di SQLite agar tiap lagu cukup dicari sekali.
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
  if (r.instrumental) return { source: 'lrclib', synced: false, instrumental: true, lines: [], plain: '' };
  const lines = parseLrc(r.syncedLyrics);
  if (lines.length) return { source: 'lrclib', synced: true, lines, plain: r.plainLyrics || '' };
  if (r.plainLyrics) return { source: 'lrclib', synced: false, lines: [], plain: r.plainLyrics };
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

/**
 * Cari lirik untuk satu lagu.
 * @param {{title:string, artist?:string, album?:string, duration?:number, ytId?:string, refresh?:boolean}} t
 */
async function find(t) {
  const title = String(t.title || '').trim();
  if (!title) return null;
  const mKey = `m:${crypto.createHash('sha1').update(`${norm(t.artist)}|${norm(title)}`).digest('hex')}`;
  const yKey = t.ytId ? `yt:${t.ytId}` : null;
  if (!t.refresh) {
    for (const k of [yKey, mKey]) {
      const c = cached(k);
      if (c) return c;
    }
    if (cached(mKey) === null && (!yKey || cached(yKey) === null)) return null;
  }
  const flightKey = yKey || mKey;
  if (inflight.has(flightKey)) return inflight.get(flightKey);
  const p = (async () => {
    let result = null;
    const errors = [];
    try { result = await lrclib({ ...t, title }); } catch (e) { errors.push(e.message); }
    if (result && (result.synced || result.instrumental || !yKey)) { store([mKey, yKey], result); return result; }
    // LRCLIB kosong atau hanya lirik tanpa waktu → coba subtitle YouTube yang tersinkron
    if (yKey) {
      let ytRes = null;
      try { ytRes = await youtube(t.ytId); } catch (e) { errors.push(e.message); }
      if (ytRes) { store([yKey], ytRes); return ytRes; }
    }
    if (result) { store([mKey, yKey], result); return result; }
    // Simpan "tidak ditemukan" hanya bila semua sumber benar-benar menjawab (bukan error jaringan)
    if (!errors.length) store([mKey, yKey], null);
    else if (!result) throw Object.assign(new Error('Sumber lirik tidak dapat dihubungi. Coba lagi nanti.'), { status: 502, code: 'LYRICS_UNREACHABLE' });
    return null;
  })().finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, p);
  return p;
}

module.exports = { find, parseLrc, parseVtt, pickSubtitle };

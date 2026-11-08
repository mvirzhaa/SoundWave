'use strict';
/**
 * TV streaming.
 *  1. Daftar publik iptv-org (https://github.com/iptv-org/api) — ribuan siaran gratis dari seluruh dunia.
 *     Diunduh di latar belakang, diringkas, dan disimpan ke data/tv-cache.json (diperbarui tiap 24 jam).
 *     Permintaan pengguna TIDAK pernah menunggu unduhan lebih dari beberapa detik: bila ada cache lama,
 *     cache itu yang dipakai sambil diperbarui.
 *  2. Saluran pilihan (diatur superadmin): YouTube Live resmi (mis. Kompas TV, Al Jazeera) atau link HLS.
 *  3. Link M3U milik pengguna (seperti "Buka stream jaringan" di VLC) — disimpan per akun.
 * Kanal dewasa (is_nsfw), kanal yang sudah tutup, dan stream yang butuh header khusus dibuang.
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { spawn } = require('child_process');
const { db } = require('./db');
const cfg = require('./config');

const BASES = (process.env.TV_DATA_BASE
  ? [process.env.TV_DATA_BASE]
  : ['https://iptv-org.github.io/api', 'https://raw.githubusercontent.com/iptv-org/api/gh-pages']).map((b) => b.replace(/\/+$/, ''));
const CACHE_FILE = path.join(cfg.DATA_DIR, 'tv-cache.json');
const TTL = Number(process.env.TV_REFRESH_HOURS || 24) * 3600000;
const PAGE = 60;

class TvError extends Error {
  constructor(message, status = 502, code = 'TV_ERROR') { super(message); this.status = status; this.code = code; }
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

/* ======================= 1. iptv-org ======================= */

let state = { data: null, builtAt: 0, loading: null, error: null };

async function fetchJson(name) {
  let last;
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}/${name}.json`, { headers: { 'User-Agent': 'SoundWave/1.0' }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { last = e; }
  }
  throw new TvError(`Daftar TV tidak dapat diunduh (${last?.message || 'galat'}).`, 502, 'TV_UNREACHABLE');
}

const qNum = (q) => parseInt(String(q || '').replace(/\D/g, ''), 10) || 0;

/** Ringkas data mentah iptv-org menjadi satu entri per kanal, dengan beberapa stream cadangan. */
function build(raw) {
  const ch = new Map();
  for (const c of raw.channels) {
    if (!c?.id || c.is_nsfw || c.closed) continue;
    ch.set(c.id, c);
  }
  const logos = new Map();
  for (const l of raw.logos) {
    const u = httpsOnly(l?.url);
    if (!u || !ch.has(l.channel)) continue;
    const cur = logos.get(l.channel);
    // Utamakan logo kanal utama (bukan per-feed), lalu yang lebarnya wajar
    const score = (l.feed ? 0 : 4) + (l.in_use === false ? 0 : 2) + ((l.width || 0) >= 64 && (l.width || 0) <= 800 ? 1 : 0);
    if (!cur || score > cur.score) logos.set(l.channel, { url: u, score });
  }
  const streams = new Map();
  for (const s of raw.streams) {
    if (!s?.channel || !ch.has(s.channel) || s.user_agent || s.referrer) continue;
    if (!/^https?:\/\//i.test(s.url || '') || s.url.length > 600) continue;
    const labels = Array.isArray(s.labels) ? s.labels : [];
    const arr = streams.get(s.channel) || [];
    arr.push({
      u: s.url,
      q: s.quality || null,
      geo: labels.includes('Geo-blocked') || undefined,
      part: labels.includes('Not 24/7') || undefined,
    });
    streams.set(s.channel, arr);
  }
  const items = [];
  for (const [id, list] of streams) {
    const c = ch.get(id);
    // Urutan cadangan: https dulu, tanpa label masalah, kualitas tertinggi
    list.sort((a, b) => (/^https/i.test(b.u) - /^https/i.test(a.u)) || ((a.geo ? 2 : 0) + (a.part ? 1 : 0)) - ((b.geo ? 2 : 0) + (b.part ? 1 : 0)) || qNum(b.q) - qNum(a.q));
    const top = list.slice(0, 4);
    items.push({
      id: `iptv-${id}`,
      name: String(c.name).slice(0, 80),
      alt: (c.alt_names || []).slice(0, 3).join(' | ').slice(0, 120) || undefined,
      country: c.country || '',
      cats: (c.categories || []).slice(0, 3),
      logo: logos.get(id)?.url || null,
      q: top[0].q || null,
      geo: top.every((x) => x.geo) || undefined,
      part: top.every((x) => x.part) || undefined,
      httpOnly: top.every((x) => !/^https/i.test(x.u)) || undefined,
      streams: top,
      site: httpsOnly(c.website) || undefined,
    });
  }
  // Kanal yang paling mungkin jalan di atas: tanpa geo-block, siaran 24 jam, https
  // + punya logo & kualitas HD biasanya menandakan kanal yang terawat (bukan siaran uji coba)
  const rank = (x) => (x.geo ? 16 : 0) + (x.part ? 8 : 0) + (x.httpOnly ? 4 : 0) + (x.logo ? 0 : 2) + (qNum(x.q) >= 720 ? 0 : 1);
  items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const count = {};
  for (const it of items) count[it.country] = (count[it.country] || 0) + 1;
  const countries = raw.countries.filter((c) => count[c.code]).map((c) => ({ code: c.code, name: c.name, flag: c.flag || '', count: count[c.code] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const catCount = {};
  for (const it of items) for (const k of it.cats) catCount[k] = (catCount[k] || 0) + 1;
  const categories = raw.categories.filter((c) => catCount[c.id]).map((c) => ({ id: c.id, name: c.name, count: catCount[c.id] }))
    .sort((a, b) => b.count - a.count);
  return { items, countries, categories, builtAt: Date.now() };
}

function prepare(data) {
  // Indeks pencarian dibuat sekali (bukan di setiap permintaan)
  for (const it of data.items) it._k = norm(`${it.name} ${it.alt || ''}`);
  data.byId = new Map(data.items.map((x) => [x.id, x]));
  return data;
}

function loadDisk() {
  try {
    const d = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(d.items)) { state.data = prepare(d); state.builtAt = d.builtAt || 0; }
  } catch { /* belum ada cache */ }
}

function refresh() {
  if (state.loading) return state.loading;
  state.loading = (async () => {
    try {
      const [channels, streams, logos, countries, categories] = await Promise.all(
        ['channels', 'streams', 'logos', 'countries', 'categories'].map(fetchJson));
      // Beri jeda ke event loop sebelum & sesudah pemrosesan agar permintaan lain tetap dilayani
      await new Promise((r) => setImmediate(r));
      const data = build({ channels, streams, logos, countries, categories });
      await new Promise((r) => setImmediate(r));
      const tmp = `${CACHE_FILE}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(data));
      await fs.promises.rename(tmp, CACHE_FILE);
      state.data = prepare(data);
      state.builtAt = data.builtAt;
      state.error = null;
      console.log(`[tv] daftar iptv-org diperbarui: ${data.items.length} kanal`);
    } catch (e) {
      state.error = e;
      console.warn('[tv] gagal memperbarui daftar:', e.message);
    } finally {
      state.loading = null;
    }
  })();
  return state.loading;
}

/** Data siap pakai. Cache lama dipakai sambil diperbarui; tanpa cache sama sekali → tunggu maks. 25 detik. */
async function data() {
  if (!state.data) loadDisk();
  if (state.data) {
    if (Date.now() - state.builtAt > TTL) refresh();
    return state.data;
  }
  const p = refresh();
  await Promise.race([p, new Promise((r) => setTimeout(r, 25000))]);
  if (state.data) return state.data;
  if (state.error) throw state.error;
  throw new TvError('Daftar TV sedang disiapkan untuk pertama kali. Coba lagi sebentar lagi.', 503, 'TV_LOADING');
}

const pub = ({ _k, ...x }) => x;

async function list({ negara = 'ID', kategori = '', q = '', offset = 0 } = {}) {
  const d = await data();
  const f = norm(q);
  const neg = String(negara || '').toUpperCase();
  let out = d.items;
  if (neg) out = out.filter((x) => x.country === neg);
  if (kategori) out = out.filter((x) => x.cats.includes(kategori));
  if (f) {
    const words = f.split(' ');
    out = out.filter((x) => words.every((w) => x._k.includes(w)));
    // Nama yang diawali kata kunci tampil lebih dulu
    out = [...out].sort((a, b) => (b._k.startsWith(f) - a._k.startsWith(f)));
  }
  const off = Math.max(0, Number(offset) || 0);
  return { total: out.length, offset: off, items: out.slice(off, off + PAGE).map(pub) };
}

async function meta() {
  const d = await data();
  return { countries: d.countries, categories: d.categories, updatedAt: d.builtAt, total: d.items.length };
}

async function byIds(ids) {
  const d = await data().catch(() => null);
  return ids.map((id) => d?.byId.get(id)).filter(Boolean).map(pub);
}

function status() {
  return { siap: Boolean(state.data), kanal: state.data?.items.length || 0, diperbarui: state.builtAt || null, memuat: Boolean(state.loading), galat: state.error?.message || null };
}

/* ======================= 2. Saluran pilihan (admin) ======================= */

/** Isi awal: siaran langsung resmi di YouTube. Bisa diubah/dihapus dari panel admin. */
const SEED = [
  ['Kompas TV', 'youtube', '@kompastv', 'ID', 'news'],
  ['CNN Indonesia', 'youtube', '@cnnindonesiaofficial', 'ID', 'news'],
  ['tvOne', 'youtube', '@tvOneNews', 'ID', 'news'],
  ['Metro TV', 'youtube', '@metrotvnews', 'ID', 'news'],
  ['iNews', 'youtube', '@OfficialiNews', 'ID', 'news'],
  ['CNBC Indonesia', 'youtube', '@CNBCIndonesia', 'ID', 'business'],
  ['Al Jazeera English', 'youtube', 'UCNye-wNBqNL5ZzHSJj3l8Bg', 'QA', 'news'],
  ['DW News', 'youtube', 'UCknLrEdhRCp1aegoMqRaCZg', 'DE', 'news'],
  ['France 24 English', 'youtube', 'UCQfwfsi5VrQ8yKZ-UWmAEFg', 'FR', 'news'],
  ['NHK WORLD-JAPAN', 'youtube', '@NHKWORLDJAPAN', 'JP', 'news'],
  ['Sky News', 'youtube', '@SkyNews', 'GB', 'news'],
  ['CNA', 'youtube', '@channelnewsasia', 'SG', 'news'],
  ['TRT World', 'youtube', '@trtworld', 'TR', 'news'],
  ['Euronews', 'youtube', '@euronews', 'FR', 'news'],
];

const q = {
  all: db.prepare('SELECT * FROM tv_channels ORDER BY sort, id'),
  active: db.prepare('SELECT * FROM tv_channels WHERE active = 1 ORDER BY sort, id'),
  get: db.prepare('SELECT * FROM tv_channels WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM tv_channels'),
  ins: db.prepare('INSERT INTO tv_channels (name, kind, src, logo, country, category, sort, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  upd: db.prepare('UPDATE tv_channels SET name = ?, kind = ?, src = ?, logo = ?, country = ?, category = ?, sort = ?, active = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM tv_channels WHERE id = ?'),
};

function seed() {
  if (q.count.get().n) return;
  SEED.forEach(([name, kind, src, country, category], i) => q.ins.run(name, kind, src, null, country, category, (i + 1) * 10, 1, Date.now()));
}
seed();

/** "@handle", "UC…", atau URL kanal/video YouTube → URL yang bisa dibuka yt-dlp untuk mencari siaran langsung. */
function ytLiveUrl(src) {
  const s = String(src || '').trim();
  if (/^@[\w.-]{2,60}$/.test(s)) return `https://www.youtube.com/${s}/live`;
  if (/^UC[\w-]{22}$/.test(s)) return `https://www.youtube.com/channel/${s}/live`;
  const vid = s.match(/(?:v=|youtu\.be\/|\/live\/|\/embed\/)([\w-]{11})/);
  if (vid) return `https://www.youtube.com/watch?v=${vid[1]}`;
  const m = s.match(/^https:\/\/(?:www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22})/);
  if (m) return `https://www.youtube.com/${m[1]}/live`;
  return null;
}
const ytPage = (src) => ytLiveUrl(src) || 'https://www.youtube.com';

function sanitizeChannel(b, cur = {}) {
  const name = String(b.name ?? cur.name ?? '').trim().slice(0, 80);
  const kind = b.kind === 'hls' ? 'hls' : b.kind === 'youtube' ? 'youtube' : cur.kind || 'youtube';
  const src = String(b.src ?? cur.src ?? '').trim().slice(0, 500);
  if (!name) throw new TvError('Nama saluran wajib diisi.', 400);
  if (kind === 'youtube' && !ytLiveUrl(src)) throw new TvError('Sumber YouTube harus @handle, ID kanal (UC…), atau link kanal/video YouTube.', 400);
  if (kind === 'hls' && !/^https?:\/\/\S+$/i.test(src)) throw new TvError('Link HLS harus diawali http:// atau https://', 400);
  const logo = b.logo !== undefined ? (httpsOnly(String(b.logo || '').trim()) || null) : cur.logo ?? null;
  const country = String(b.country ?? cur.country ?? 'ID').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'ID';
  const category = String(b.category ?? cur.category ?? '').toLowerCase().replace(/[^a-z_-]/g, '').slice(0, 30) || null;
  const sort = Number.isFinite(Number(b.sort)) ? Math.round(Number(b.sort)) : cur.sort ?? 100;
  const active = typeof b.active === 'boolean' ? (b.active ? 1 : 0) : cur.active ?? 1;
  return { name, kind, src, logo, country, category, sort, active };
}

const toItem = (r) => ({
  id: `tvc-${r.id}`,
  name: r.name,
  country: r.country,
  cats: r.category ? [r.category] : [],
  logo: r.logo || null,
  kind: r.kind,
  official: true,
  ...(r.kind === 'hls' ? { streams: [{ u: r.src }], httpOnly: /^http:/i.test(r.src) || undefined } : { yt: r.src, ytPage: ytPage(r.src) }),
});

const pilihan = () => q.active.all().map(toItem);
const admin = {
  list: () => q.all.all().map((r) => ({ ...r, active: Boolean(r.active), live: ytCache.get(r.id) || null })),
  create(b) { const c = sanitizeChannel(b); const info = q.ins.run(c.name, c.kind, c.src, c.logo, c.country, c.category, c.sort, c.active, Date.now()); return q.get.get(Number(info.lastInsertRowid)); },
  update(id, b) { const cur = q.get.get(id); if (!cur) throw new TvError('Saluran tidak ditemukan.', 404); const c = sanitizeChannel(b, cur); q.upd.run(c.name, c.kind, c.src, c.logo, c.country, c.category, c.sort, c.active, id); ytCache.delete(id); return q.get.get(id); },
  remove(id) { q.del.run(id); ytCache.delete(id); },
};

/* ---------- YouTube: cari video siaran langsung yang sedang berjalan ---------- */
const ytCache = new Map(); // id → { videoId|null, at, error? }
const ytPending = new Map();
let ytRunning = 0;
const ytQueue = [];

function ytdlpLive(url) {
  const { YTDLP, baseArgs } = require('./ytdlp');
  return new Promise((resolve, reject) => {
    const run = () => {
      ytRunning++;
      let out = ''; let err = '';
      const child = spawn(YTDLP, [...baseArgs(), '--skip-download', '--no-playlist', '--print', '%(id)s\t%(is_live)s', url], { windowsHide: true });
      const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
      const done = (fn) => { clearTimeout(timer); ytRunning--; const n = ytQueue.shift(); if (n) n(); fn(); };
      child.on('error', (e) => done(() => reject(e)));
      child.on('close', (code) => done(() => {
        const [id, live] = out.trim().split('\n').pop()?.split('\t') || [];
        if (code === 0 && /^[\w-]{11}$/.test(id || '')) return resolve({ videoId: id, live: live === 'True' });
        const line = err.split('\n').reverse().find((l) => l.startsWith('ERROR:')) || '';
        reject(new TvError(/not currently live|no live|is not live|upcoming/i.test(line) ? 'Kanal ini sedang tidak siaran langsung.' : 'Siaran YouTube tidak dapat dibuka dari server.', 404, 'TV_NOT_LIVE'));
      }));
    };
    // Maks. 2 proses yt-dlp sekaligus agar server tidak kewalahan; antrean dibatasi agar permintaan tidak menunggu lama
    if (ytRunning < 2) run();
    else if (ytQueue.length >= 8) reject(new TvError('Server sedang sibuk mencari siaran YouTube. Coba lagi sebentar.', 503, 'TV_BUSY'));
    else ytQueue.push(run);
  });
}

async function ytLive(id, includeHidden = false) {
  const r = q.get.get(id);
  if (!r || r.kind !== 'youtube' || (!r.active && !includeHidden)) throw new TvError('Saluran tidak ditemukan.', 404);
  const c = ytCache.get(id);
  if (c && Date.now() - c.at < (c.videoId ? 15 * 60000 : 3 * 60000)) {
    if (c.videoId) return { videoId: c.videoId, page: ytPage(r.src) };
    throw new TvError(c.error || 'Kanal ini sedang tidak siaran langsung.', 404, 'TV_NOT_LIVE');
  }
  if (ytPending.has(id)) return ytPending.get(id);
  const p = (async () => {
    try {
      const { videoId } = await ytdlpLive(ytLiveUrl(r.src));
      ytCache.set(id, { videoId, at: Date.now() });
      return { videoId, page: ytPage(r.src) };
    } catch (e) {
      ytCache.set(id, { videoId: null, at: Date.now(), error: e.message });
      throw e instanceof TvError ? e : new TvError('Siaran YouTube tidak dapat dibuka dari server.', 502);
    } finally { ytPending.delete(id); }
  })();
  ytPending.set(id, p);
  return p;
}

/* ======================= 3. Link M3U pengguna ======================= */

const m3uQ = {
  list: db.prepare('SELECT id, name, url, created_at FROM tv_m3u WHERE user_id = ? ORDER BY id'),
  get: db.prepare('SELECT * FROM tv_m3u WHERE id = ? AND user_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM tv_m3u WHERE user_id = ?'),
  ins: db.prepare('INSERT INTO tv_m3u (user_id, name, url, created_at) VALUES (?, ?, ?, ?)'),
  del: db.prepare('DELETE FROM tv_m3u WHERE id = ? AND user_id = ?'),
  ren: db.prepare('UPDATE tv_m3u SET name = ? WHERE id = ? AND user_id = ?'),
};
const m3uCache = new Map(); // `${id}` → { at, items }
const M3U_MAX = 8 * 1024 * 1024;

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || (v.startsWith('::ffff:') && isPrivate(v.slice(7)));
}

async function guardUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new TvError('Link tidak valid.', 400); }
  if (!/^https?:$/.test(url.protocol)) throw new TvError('Link harus diawali http:// atau https://', 400);
  if (process.env.TV_ALLOW_PRIVATE === '1') return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new TvError('Alamat link tidak ditemukan.', 400); })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivate)) throw new TvError('Link ke jaringan lokal/privat tidak diizinkan.', 400);
  return url;
}

/** Ambil file M3U (dibatasi ukuran & waktu) lalu urai menjadi daftar saluran. */
async function fetchM3u(u) {
  const url = await guardUrl(u);
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'SoundWave/1.0 (VLC-compatible)' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch { throw new TvError('Link M3U tidak dapat dihubungi (waktu habis atau server menolak).', 502, 'M3U_UNREACHABLE'); }
  if (!res.ok) throw new TvError(`Server link M3U membalas ${res.status}.`, 502);
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > M3U_MAX) { reader.cancel().catch(() => {}); throw new TvError('File M3U terlalu besar (maks. 8 MB).', 400); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!/#EXTM3U|#EXTINF/i.test(text.slice(0, 20000)) && !/^https?:\/\//m.test(text)) throw new TvError('Isi link bukan daftar M3U.', 400, 'M3U_INVALID');
  return parseM3u(text);
}

function parseM3u(text) {
  const out = [];
  let info = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const attr = (k) => (line.match(new RegExp(`${k}="([^"]*)"`, 'i')) || [])[1] || '';
      const comma = line.lastIndexOf(',');
      info = { name: (comma >= 0 ? line.slice(comma + 1) : '').trim() || attr('tvg-name'), logo: attr('tvg-logo'), group: attr('group-title') };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (/^https?:\/\//i.test(line)) {
      out.push({
        name: String(info?.name || `Saluran ${out.length + 1}`).slice(0, 80),
        group: String(info?.group || '').slice(0, 40) || undefined,
        logo: /^https?:\/\//i.test(info?.logo || '') ? info.logo.slice(0, 400) : null,
        u: line.slice(0, 1000),
      });
      if (out.length >= 3000) break;
    }
    info = null;
  }
  return out;
}

const m3u = {
  list: (userId) => m3uQ.list.all(userId).map((r) => ({ id: r.id, name: r.name, url: r.url, createdAt: r.created_at })),
  async add(userId, body) {
    if (m3uQ.count.get(userId).n >= 10) throw new TvError('Maksimal 10 link M3U per akun.', 400);
    const url = String(body?.url || '').trim().slice(0, 1000);
    const items = await fetchM3u(url); // validasi dulu: link harus benar-benar berisi saluran
    if (!items.length) throw new TvError('Tidak ada saluran di link M3U ini.', 400, 'M3U_EMPTY');
    let name = String(body?.name || '').trim().slice(0, 60);
    if (!name) { try { name = new URL(url).hostname; } catch { name = 'Link M3U'; } }
    const info = m3uQ.ins.run(userId, name, url, Date.now());
    const id = Number(info.lastInsertRowid);
    m3uCache.set(String(id), { at: Date.now(), items });
    return { id, name, url, count: items.length };
  },
  remove: (userId, id) => { m3uQ.del.run(id, userId); m3uCache.delete(String(id)); },
  rename: (userId, id, name) => { const n = String(name || '').trim().slice(0, 60); if (!n) throw new TvError('Nama wajib diisi.', 400); m3uQ.ren.run(n, id, userId); },
  async channels(userId, id, { q = '', offset = 0 } = {}) {
    const row = m3uQ.get.get(id, userId);
    if (!row) throw new TvError('Link M3U tidak ditemukan.', 404);
    let c = m3uCache.get(String(id));
    if (!c || Date.now() - c.at > 30 * 60000) {
      try { c = { at: Date.now(), items: await fetchM3u(row.url) }; m3uCache.set(String(id), c); }
      catch (e) { if (!c) throw e; } // pakai salinan lama bila link sedang bermasalah
    }
    const f = norm(q);
    let items = c.items.map((x, i) => ({
      id: `m3u-${id}-${i}`, name: x.name, logo: x.logo && /^https:/i.test(x.logo) ? x.logo : null,
      cats: x.group ? [x.group] : [], country: '', streams: [{ u: x.u }], httpOnly: /^http:/i.test(x.u) || undefined, m3u: row.name,
    }));
    if (f) items = items.filter((x) => norm(`${x.name} ${x.cats.join(' ')}`).includes(f));
    const off = Math.max(0, Number(offset) || 0);
    return { total: items.length, offset: off, items: items.slice(off, off + PAGE), name: row.name };
  },
};

/* ======================= Favorit ======================= */

function sanitizeFav(x) {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || '');
  if (!/^(iptv-[\w.@-]{1,80}|tvc-\d{1,9}|m3u-\d{1,9}-\d{1,5})$/.test(id)) return null;
  const streams = Array.isArray(x.streams)
    ? x.streams.filter((s) => /^https?:\/\/\S+$/i.test(s?.u || '') && s.u.length <= 1000).slice(0, 4).map((s) => ({ u: s.u, q: typeof s.q === 'string' ? s.q.slice(0, 10) : null }))
    : undefined;
  return {
    id,
    name: String(x.name || '').slice(0, 80) || 'TV',
    logo: httpsOnly(x.logo) || null,
    country: String(x.country || '').slice(0, 2),
    cats: Array.isArray(x.cats) ? x.cats.slice(0, 3).map((c) => String(c).slice(0, 40)) : [],
    ...(streams?.length ? { streams } : {}),
    ...(x.kind === 'youtube' ? { kind: 'youtube', official: true } : {}),
  };
}

/** Segarkan favorit: data kanal iptv-org & pilihan admin diambil yang terbaru (stream bisa berganti). */
async function freshFavs(favs) {
  const iptv = new Map((await byIds(favs.filter((f) => f.id.startsWith('iptv-')).map((f) => f.id))).map((x) => [x.id, x]));
  const pil = new Map(pilihan().map((x) => [x.id, x]));
  return favs.map((f) => iptv.get(f.id) || pil.get(f.id) || (f.id.startsWith('tvc-') ? null : f)).filter(Boolean);
}

/** Muat cache dari disk saat server menyala dan perbarui di latar belakang bila sudah basi. */
function warmup() {
  loadDisk();
  if (process.env.TV_DISABLE === '1') return;
  if (!state.data || Date.now() - state.builtAt > TTL) setTimeout(() => refresh(), 5000).unref();
  setInterval(() => { if (Date.now() - state.builtAt > TTL) refresh(); }, 3600000).unref();
}

module.exports = { list, meta, status, refresh, warmup, pilihan, admin, ytLive, m3u, sanitizeFav, freshFavs, parseM3u, build, TvError, PAGE };

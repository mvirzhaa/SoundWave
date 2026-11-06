'use strict';
/**
 * Radio internet dari direktori terbuka Radio Browser (https://www.radio-browser.info).
 * - Cari berdasarkan nama atau frekuensi ("101.1", "prambors"), filter negara (default Indonesia).
 * - Frekuensi FM tidak punya kolom sendiri di Radio Browser, jadi diambil dari nama/tag stasiun.
 * - Streaming http:// diteruskan lewat server (/api/radio/stream/:id) agar bisa diputar di halaman https.
 */
const dns = require('dns').promises;
const net = require('net');
const { Readable } = require('stream');
const { cached } = require('./db');

const BASE = (process.env.RADIO_BROWSER_BASE || 'https://all.api.radio-browser.info').replace(/\/+$/, '');
const UA = 'SoundWave/1.0';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN = 60000;

class RadioError extends Error {
  constructor(message, status = 502, code = 'RADIO_ERROR') { super(message); this.status = status; this.code = code; }
}

async function getJson(path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new RadioError('Direktori radio tidak dapat dihubungi. Periksa koneksi internet server.', 502, 'RADIO_UNREACHABLE');
  }
  if (!res.ok) throw new RadioError(`Direktori radio membalas ${res.status}.`, 502);
  return res.json();
}

/** "Prambors 102.2 FM" → "102.2". Rentang FM 87.5–108. */
function frekuensi(s) {
  const m = String(s || '').match(/(?:^|[^\d.,])(8[7-9]|9\d|10[0-8])[.,](\d)(?![\d.,])/);
  return m ? `${m[1]}.${m[2]}` : null;
}

function mapStation(x) {
  const url = x.url_resolved || x.url;
  if (!UUID_RE.test(x.stationuuid || '') || !/^https?:\/\//i.test(url || '')) return null;
  const freq = frekuensi(x.name) || String(x.tags || '').split(',').map((t) => frekuensi(t.trim())).find(Boolean) || null;
  return {
    id: `radio-${x.stationuuid}`,
    uuid: x.stationuuid,
    name: String(x.name || '').trim().slice(0, 120) || 'Radio',
    url,
    https: /^https:/i.test(url),
    favicon: /^https:\/\//i.test(x.favicon || '') ? x.favicon : null,
    homepage: /^https?:\/\//i.test(x.homepage || '') ? x.homepage : null,
    freq,
    tags: String(x.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6),
    country: x.country || '',
    countrycode: x.countrycode || '',
    state: x.state || '',
    language: x.language || '',
    codec: x.codec || '',
    bitrate: Number(x.bitrate) || 0,
    votes: Number(x.votes) || 0,
  };
}

const uniq = (list) => {
  const seen = new Set();
  return list.filter((s) => s && !seen.has(s.uuid) && seen.add(s.uuid));
};

/** Stasiun populer di negara tertentu (default Indonesia). */
async function populer(negara = 'ID', limit = 60) {
  // negara '' = seluruh dunia (stasiun paling banyak diputar dari semua negara)
  const cc = /^[A-Z]{2}$/i.test(negara || '') ? negara.toUpperCase() : '';
  return cached(`radio:top:${cc || 'ALL'}:${limit}`, 30 * MIN, async () => {
    const q = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit), ...(cc ? { countrycode: cc } : {}) });
    return uniq((await getJson(`/json/stations/search?${q}`)).map(mapStation));
  });
}

/**
 * Cari stasiun. q bisa nama ("gen fm"), kota ("bandung"), atau frekuensi ("101.1" / "101,1").
 * negara: kode 2 huruf, atau "" untuk semua negara.
 */
async function cari(q, negara = 'ID') {
  const text = String(q || '').trim().slice(0, 60);
  if (!text) return populer(negara, negara ? 60 : 100);
  const cc = /^[A-Z]{2}$/i.test(negara || '') ? negara.toUpperCase() : '';
  const freq = frekuensi(` ${text} `) || (/^\d{2,3}([.,]\d)?$/.test(text) ? text.replace(',', '.') : null);
  return cached(`radio:q:${cc}:${text.toLowerCase()}`, 10 * MIN, async () => {
    const base = { hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '80', ...(cc ? { countrycode: cc } : {}) };
    const reqs = [
      getJson(`/json/stations/search?${new URLSearchParams({ ...base, name: freq || text })}`),
      getJson(`/json/stations/search?${new URLSearchParams({ ...base, tag: freq || text.toLowerCase() })}`),
    ];
    if (!freq) reqs.push(getJson(`/json/stations/search?${new URLSearchParams({ ...base, state: text })}`).catch(() => []));
    if (freq && freq.includes('.')) reqs.push(getJson(`/json/stations/search?${new URLSearchParams({ ...base, name: freq.replace('.', ',') })}`).catch(() => []));
    const parts = await Promise.all(reqs.map((p) => p.catch(() => [])));
    let list = uniq(parts.flat().map(mapStation));
    if (freq) {
      // Utamakan stasiun yang frekuensinya persis sama
      list = list.sort((a, b) => Number(b.freq === freq) - Number(a.freq === freq) || b.votes - a.votes);
    }
    return list.slice(0, 80);
  });
}

async function byUuid(uuid) {
  if (!UUID_RE.test(uuid)) throw new RadioError('ID stasiun tidak valid.', 400);
  return cached(`radio:id:${uuid}`, 60 * MIN, async () => {
    const [x] = await getJson(`/json/stations/byuuid/${uuid}`);
    const s = x && mapStation(x);
    if (!s) throw new RadioError('Stasiun tidak ditemukan.', 404, 'RADIO_NOT_FOUND');
    return s;
  });
}

/** Catat klik ke Radio Browser (etika pemakaian API; membantu peringkat stasiun). */
function catatKlik(uuid) {
  if (!UUID_RE.test(uuid)) return;
  fetch(`${BASE}/json/url/${uuid}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }).catch(() => {});
}

/* ---------- Proxy streaming (untuk stream http:// di halaman https) ---------- */
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && isPrivate(v.slice(7));
}

const MAX_PROXY = Number(process.env.RADIO_MAX_STREAMS || 20);
let aktif = 0;

async function proxy(uuid, req, res) {
  const st = await byUuid(uuid);
  if (aktif >= MAX_PROXY) throw new RadioError('Terlalu banyak radio diputar lewat server. Coba lagi sebentar.', 503, 'RADIO_BUSY');
  let url = st.url;
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  let up;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new RadioError('Alamat stream tidak didukung.', 400);
    const { address } = await dns.lookup(u.hostname).catch(() => ({ address: '' }));
    if (!address || (isPrivate(address) && process.env.RADIO_ALLOW_PRIVATE !== '1')) throw new RadioError('Alamat stream ditolak.', 400, 'RADIO_BLOCKED');
    try {
      up = await fetch(url, { headers: { 'User-Agent': UA, 'Icy-MetaData': '0' }, redirect: 'manual', signal: ac.signal });
    } catch { throw new RadioError('Stasiun radio tidak merespons.', 502, 'RADIO_OFFLINE'); }
    if (up.status >= 300 && up.status < 400 && up.headers.get('location')) { url = new URL(up.headers.get('location'), url).href; continue; }
    break;
  }
  if (!up || !up.ok || !up.body) throw new RadioError('Stasiun radio sedang tidak siaran.', 502, 'RADIO_OFFLINE');
  aktif++;
  const done = () => { aktif = Math.max(0, aktif - 1); };
  res.status(200);
  res.setHeader('Content-Type', up.headers.get('content-type') || 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  const body = Readable.fromWeb(up.body);
  body.on('error', () => res.destroy());
  res.on('close', () => { done(); ac.abort(); });
  body.pipe(res);
}

/** Validasi stasiun yang disimpan pengguna sebagai favorit. */
function sanitizeStation(s) {
  if (!s || !UUID_RE.test(String(s.uuid || ''))) return null;
  const url = String(s.url || '');
  if (!/^https?:\/\//i.test(url) || url.length > 500) return null;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    id: `radio-${s.uuid}`, uuid: s.uuid, name: str(s.name, 120) || 'Radio', url, https: /^https:/i.test(url),
    favicon: /^https:\/\//i.test(s.favicon || '') ? str(s.favicon, 500) : null, freq: frekuensi(s.freq ? ` ${s.freq} ` : '') || null,
    tags: Array.isArray(s.tags) ? s.tags.slice(0, 6).map((x) => str(x, 40)) : [],
    country: str(s.country, 60), countrycode: str(s.countrycode, 2), state: str(s.state, 80), codec: str(s.codec, 20), bitrate: Number(s.bitrate) || 0,
  };
}

module.exports = { populer, cari, byUuid, catatKlik, proxy, frekuensi, sanitizeStation, RadioError, UUID_RE };

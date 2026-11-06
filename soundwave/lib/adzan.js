'use strict';
/**
 * File suara adzan global (dipakai semua akun web & mobile).
 * Sumber: unggahan superadmin, atau file di data/ (adzan.mp3, adzan-subuh.mp3), atau ADZAN_URL / ADZAN_SUBUH_URL.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const settings = require('./appsettings');

const FILES = { umum: 'adzan.mp3', subuh: 'adzan-subuh.mp3' };
const URLS = { umum: process.env.ADZAN_URL, subuh: process.env.ADZAN_SUBUH_URL };
const fetching = {};
const fileOf = (jenis) => path.join(DATA_DIR, FILES[jenis === 'subuh' ? 'subuh' : 'umum']);

async function ensureFile(jenis) {
  const file = fileOf(jenis);
  if (fs.existsSync(file)) return file;
  const url = URLS[jenis];
  if (!url) return null;
  if (!fetching[jenis]) {
    fetching[jenis] = (async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'SoundWave/1.0' } });
      if (!res.ok) throw new Error(`Gagal mengunduh adzan (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10000) throw new Error('File adzan terlalu kecil / bukan audio.');
      fs.writeFileSync(file, buf);
      return file;
    })().finally(() => { delete fetching[jenis]; });
  }
  return fetching[jenis];
}

/** Versi file (berubah tiap admin mengganti suara) → HP mengunduh ulang cache adzannya. */
function versi(jenis) {
  try { const st = fs.statSync(fileOf(jenis)); return `${Math.round(st.mtimeMs)}-${st.size}`; } catch { return null; }
}

/** Validasi ringan isi file audio (MP3 / M4A / OGG / WAV). */
function looksLikeAudio(buf) {
  if (!buf || buf.length < 10000) return false;
  const h = buf.subarray(0, 12);
  return h.toString('latin1', 0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) // MP3
    || h.toString('latin1', 4, 8) === 'ftyp' // M4A/AAC
    || h.toString('latin1', 0, 4) === 'OggS' || (h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WAVE');
}

function save(jenis, buf, namaAsli) {
  if (!looksLikeAudio(buf)) { const e = new Error('File bukan audio yang didukung (MP3, M4A, OGG, WAV) atau terlalu kecil.'); e.status = 400; throw e; }
  const file = fileOf(jenis);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  settings.set(`adzan.nama.${jenis}`, String(namaAsli || '').slice(0, 120) || FILES[jenis]);
}
function remove(jenis) {
  try { fs.unlinkSync(fileOf(jenis)); } catch { /* tidak ada */ }
  settings.set(`adzan.nama.${jenis}`, null);
}

/** Status untuk klien: tersedia, versi, dan apakah admin memaksa semua akun memakai suara global. */
async function status() {
  const umum = await ensureFile('umum').catch(() => null);
  const subuh = await ensureFile('subuh').catch(() => null);
  return {
    tersedia: Boolean(umum),
    subuh: Boolean(subuh),
    versi: [versi('umum'), versi('subuh')].filter(Boolean).join('_') || null,
    paksa: Boolean(settings.get('adzan.paksa')) && Boolean(umum),
    nama: { umum: umum ? settings.get('adzan.nama.umum') || FILES.umum : null, subuh: subuh ? settings.get('adzan.nama.subuh') || FILES.subuh : null },
  };
}

module.exports = { ensureFile, versi, save, remove, status, fileOf, FILES };

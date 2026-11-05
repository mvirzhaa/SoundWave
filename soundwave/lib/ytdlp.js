'use strict';
/**
 * Pembungkus yt-dlp. Semua pemanggilan memakai spawn() dengan array argumen
 * (tanpa shell), dan ID video divalidasi dengan regex — tidak ada ruang untuk
 * command injection dari input pengguna.
 */
const { spawn } = require('child_process');

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function baseArgs() {
  const args = ['--no-warnings', '--ignore-config', '--no-color'];
  const rt = (process.env.YTDLP_JS_RUNTIME || 'node').toLowerCase();
  if (rt === 'node') args.push('--js-runtimes', `node:${process.execPath}`);
  else if (rt && rt !== 'none') args.push('--js-runtimes', rt);
  if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
  if (process.env.FFMPEG_PATH) args.push('--ffmpeg-location', process.env.FFMPEG_PATH);
  return args;
}

/** Ambil ID video dari URL YouTube apa pun (watch, youtu.be, shorts, embed, music). */
function extractVideoId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (VIDEO_ID_RE.test(s)) return null; // string 11 huruf biasa diperlakukan sebagai kata kunci
  let url;
  try { url = new URL(s); } catch { return null; }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    if (!id) {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) id = m[1];
    }
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

/** Jalankan yt-dlp dan kembalikan stdout yang di-parse sebagai JSON. */
function runJson(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('yt-dlp timeout')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? 'yt-dlp tidak ditemukan. Pasang yt-dlp atau isi YTDLP_PATH.' : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(cleanError(err) || `yt-dlp keluar dengan kode ${code}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Output yt-dlp tidak valid')); }
    });
  });
}

function cleanError(stderr) {
  const line = String(stderr).split('\n').reverse().find((l) => l.startsWith('ERROR:'));
  return line ? line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 300) : '';
}

function mapEntry(e) {
  if (!e || !VIDEO_ID_RE.test(e.id || '')) return null;
  return {
    id: e.id,
    title: e.title || '(tanpa judul)',
    channel: e.channel || e.uploader || '',
    duration: typeof e.duration === 'number' ? Math.round(e.duration) : null,
    views: e.view_count ?? null,
    thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
    isLive: e.live_status === 'is_live',
  };
}

/** Cari video. Jika query berupa URL YouTube, kembalikan video itu saja. */
async function search(query, limit = 16) {
  const id = extractVideoId(query);
  if (id) {
    const info = await runJson([...baseArgs(), '--no-playlist', '--skip-download', '-J',
      `https://www.youtube.com/watch?v=${id}`]);
    const item = mapEntry(info);
    return item ? [item] : [];
  }
  const data = await runJson([...baseArgs(), '--flat-playlist', '-J', `ytsearch${limit}:${query}`]);
  return (data.entries || []).map(mapEntry).filter((x) => x && !x.isLive);
}

/** Saran autocomplete dari layanan suggest YouTube. */
async function suggest(query) {
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=id&q='
    + encodeURIComponent(query);
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return [];
  const buf = Buffer.from(await res.arrayBuffer());
  // Respons kadang ISO-8859-1; coba UTF-8 lalu fallback
  let text = buf.toString('utf8');
  if (text.includes('�')) text = buf.toString('latin1');
  const json = JSON.parse(text);
  return Array.isArray(json[1]) ? json[1].slice(0, 10).map(String) : [];
}

module.exports = { YTDLP, VIDEO_ID_RE, baseArgs, extractVideoId, search, suggest };

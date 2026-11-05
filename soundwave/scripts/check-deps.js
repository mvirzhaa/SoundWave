'use strict';
// Cek cepat kesiapan server: npm run check
require('dotenv').config();
const { spawnSync } = require('child_process');

function check(name, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) { console.log(`✗ ${name}: tidak ditemukan (${cmd})`); return false; }
  console.log(`✓ ${name}: ${(r.stdout || r.stderr).split('\n')[0].trim()}`);
  return true;
}

const [major, minor] = process.versions.node.split('.').map(Number);
const nodeOk = major > 22 || (major === 22 && minor >= 13);
console.log(`${nodeOk ? '✓' : '✗'} Node.js: ${process.version}${nodeOk ? '' : ' — butuh 22.13 atau lebih baru (untuk SQLite bawaan)'}`);
const ok1 = check('yt-dlp', process.env.YTDLP_PATH || 'yt-dlp', ['--version']);
const ok2 = check('ffmpeg', process.env.FFMPEG_PATH || 'ffmpeg', ['-version']);
const drive = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
const url = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
console.log(`${drive ? '✓' : '–'} Google Drive: ${drive ? `terkonfigurasi — redirect URI: ${url}/api/drive/callback` : 'belum dikonfigurasi (Pustaka & simpan ke Drive nonaktif)'}`);
process.exit(nodeOk && ok1 && ok2 ? 0 : 1);

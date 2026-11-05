'use strict';
/**
 * Antrean konversi. Setiap job = satu proses yt-dlp di folder sendiri.
 * Progress dibaca dari output --newline yt-dlp.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { YTDLP, baseArgs } = require('./ytdlp');

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), 'soundwave');
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS) || 3);
const TTL_MS = (Number(process.env.FILE_TTL_MIN) || 60) * 60 * 1000;
const MAX_DURATION = Number(process.env.MAX_DURATION_SEC) || 7200;
const JOB_TIMEOUT_MS = 20 * 60 * 1000;

const MP3_QUALITIES = [128, 192, 256, 320];
const MP4_QUALITIES = [360, 480, 720, 1080];

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const jobs = new Map();
const queue = [];
let running = 0;

function publicView(job, userId) {
  return {
    id: job.id,
    videoId: job.videoId,
    format: job.format,
    quality: job.quality,
    status: job.status, // queued | running | done | error
    stage: job.stage,
    progress: Math.round(job.progress),
    title: job.title,
    filename: job.filename,
    size: job.size,
    error: job.error,
    driveLink: (userId && job.driveLinks.get(userId)) || null,
  };
}

function createJob({ videoId, format, quality }) {
  const key = `${videoId}:${format}:${quality}`;
  // Pakai ulang hasil yang sama jika masih ada (hemat bandwidth & CPU)
  for (const j of jobs.values()) {
    if (j.key === key && j.status !== 'error' && (j.status !== 'done' || fs.existsSync(j.file))) {
      j.touchedAt = Date.now();
      return j;
    }
  }
  const job = {
    id: crypto.randomUUID(),
    key, videoId, format, quality,
    status: 'queued', stage: 'Menunggu antrean', progress: 0,
    title: null, filename: null, file: null, size: null, error: null, meta: null,
    driveLinks: new Map(), // userId -> link Google Drive
    dir: path.join(DOWNLOAD_DIR, crypto.randomUUID()),
    createdAt: Date.now(), touchedAt: Date.now(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job;
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    run(job).finally(() => { running--; pump(); });
  }
}

function buildArgs(job) {
  const args = [
    ...baseArgs(),
    '--no-playlist', '--newline', '--no-part', '--no-mtime',
    '--match-filter', `duration <= ${MAX_DURATION} & !is_live`,
    '--embed-metadata', '--write-info-json', '--no-write-playlist-metafiles',
    '-o', path.join(job.dir, '%(title).150B [%(id)s].%(ext)s'),
  ];
  if (job.format === 'mp3') {
    args.push(
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'mp3', '--audio-quality', `${job.quality}K`,
      '--embed-thumbnail', '--convert-thumbnails', 'jpg',
      // Sampul persegi agar rapi di pemutar musik
      '--ppa', 'ThumbnailsConvertor+FFmpeg_o:-vf crop=ih:ih',
    );
  } else {
    // Prioritaskan H.264 + AAC (paling kompatibel & ukuran efisien) tanpa re-encode
    args.push(
      '-f', 'bv*+ba/b',
      '-S', `res:${job.quality},vcodec:h264,acodec:m4a`,
      '--merge-output-format', 'mp4',
      '--remux-video', 'mp4',
    );
  }
  args.push(`https://www.youtube.com/watch?v=${job.videoId}`);
  return args;
}

function run(job) {
  return new Promise((resolve) => {
    fs.mkdirSync(job.dir, { recursive: true });
    job.status = 'running';
    job.stage = 'Menyiapkan';
    job.progress = 2;

    const child = spawn(YTDLP, buildArgs(job), { windowsHide: true });
    let streamIndex = -1;
    let stderr = '';
    const streams = job.format === 'mp4' ? 2 : 1;
    const dlSpan = job.format === 'mp4' ? 90 : 80; // sisa persen untuk konversi/merge

    const timer = setTimeout(() => child.kill('SIGKILL'), JOB_TIMEOUT_MS);

    const onLine = (line) => {
      if (line.startsWith('[download] Destination:')) {
        streamIndex++;
        job.stage = streams > 1
          ? `Mengunduh ${streamIndex === 0 ? 'video' : 'audio'} (${Math.min(streamIndex + 1, 2)}/2)`
          : 'Mengunduh audio';
        return;
      }
      const m = line.match(/^\[download\]\s+([\d.]+)%/);
      if (m) {
        const pct = Math.min(100, parseFloat(m[1]));
        const idx = Math.max(0, Math.min(streamIndex, streams - 1));
        const val = 3 + ((idx + pct / 100) / streams) * dlSpan;
        job.progress = Math.max(job.progress, Math.min(val, 3 + dlSpan));
        return;
      }
      if (/^\[(ExtractAudio)\]/.test(line)) { job.stage = `Mengonversi ke MP3 ${job.quality} kbps`; job.progress = Math.max(job.progress, 85); }
      else if (/^\[(Merger|VideoRemuxer)\]/.test(line)) { job.stage = 'Menggabungkan video & audio'; job.progress = Math.max(job.progress, 94); }
      else if (/^\[(EmbedThumbnail|Metadata)\]/.test(line)) { job.stage = 'Menambahkan metadata'; job.progress = Math.max(job.progress, 97); }
      else if (/does not pass filter/.test(line)) { job.filtered = true; }
    };

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach((l) => onLine(l.trim()));
    });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });

    const fail = (msg) => {
      job.status = 'error';
      job.stage = 'Gagal';
      job.error = msg;
      fs.rm(job.dir, { recursive: true, force: true }, () => {});
    };

    child.on('error', (e) => {
      clearTimeout(timer);
      fail(e.code === 'ENOENT' ? 'yt-dlp tidak ditemukan di server.' : e.message);
      resolve();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const line = stderr.split('\n').reverse().find((l) => l.startsWith('ERROR:')) || '';
        fail(line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 300) || `Konversi gagal (kode ${code}).`);
        return resolve();
      }
      const want = `.${job.format}`;
      const file = fs.readdirSync(job.dir).find((f) => f.toLowerCase().endsWith(want));
      if (!file) {
        fail(job.filtered
          ? `Video terlalu panjang (maks ${Math.round(MAX_DURATION / 60)} menit) atau sedang live.`
          : 'File hasil tidak ditemukan.');
        return resolve();
      }
      job.file = path.join(job.dir, file);
      job.filename = file.replace(/ \[[A-Za-z0-9_-]{11}\](?=\.\w+$)/, '');
      job.title = job.filename.replace(/\.\w+$/, '');
      job.size = fs.statSync(job.file).size;
      job.meta = readInfo(job);
      job.status = 'done';
      job.stage = 'Siap diunduh';
      job.progress = 100;
      resolve();
    });
  });
}

/** Ambil judul, kanal, durasi dari .info.json yang ditulis yt-dlp, lalu hapus file itu. */
function readInfo(job) {
  const meta = { title: job.title, channel: '', duration: null };
  try {
    const f = fs.readdirSync(job.dir).find((x) => x.endsWith('.info.json'));
    if (f) {
      const info = JSON.parse(fs.readFileSync(path.join(job.dir, f), 'utf8'));
      meta.title = info.title || meta.title;
      meta.channel = info.channel || info.uploader || '';
      meta.duration = info.duration ? Math.round(info.duration) : null;
      fs.rmSync(path.join(job.dir, f), { force: true });
    }
  } catch { /* metadata opsional */ }
  return meta;
}

function getJob(id) {
  const job = jobs.get(id);
  if (job) job.touchedAt = Date.now();
  return job;
}

// Bersihkan file lama secara berkala
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === 'running' || job.status === 'queued') continue;
    if (now - job.touchedAt > TTL_MS) {
      fs.rm(job.dir, { recursive: true, force: true }, () => {});
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = { createJob, getJob, publicView, MP3_QUALITIES, MP4_QUALITIES, DOWNLOAD_DIR };

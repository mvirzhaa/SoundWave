'use strict';
/**
 * Google Drive per pengguna.
 * Setiap pengguna menghubungkan akun Google-nya sendiri (OAuth) dan memilih folder
 * penyimpanannya sendiri. Semua panggilan memakai REST API Drive v3 via fetch.
 */
const fs = require('fs');
const { Readable } = require('stream');
const { db } = require('./db');
const cfg = require('./config');
const { encrypt, decrypt, stateToken, verify, getUser } = require('./auth');

const API = cfg.GOOGLE_API_BASE;
const OAUTH = process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com';
const AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = `${cfg.PUBLIC_URL}/api/drive/callback`;
const SCOPES = ['https://www.googleapis.com/auth/drive', 'openid', 'email'];
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const MEDIA_FILTER = "(mimeType contains 'audio/' or mimeType = 'video/mp4' or mimeType = 'video/x-m4v')";

class DriveError extends Error {
  constructor(message, status = 400, code = 'DRIVE_ERROR') { super(message); this.status = status; this.code = code; }
}

/** fetch dengan pesan jelas bila Google tidak bisa dihubungi. */
async function gfetch(url, init) {
  try { return await fetch(url, init); } catch (e) {
    if (e.name === 'AbortError' && init?.signal?.aborted && !String(init.signal.reason).includes('Timeout')) throw e;
    throw new DriveError('Tidak dapat terhubung ke Google Drive. Periksa koneksi internet server.', 502, 'DRIVE_UNREACHABLE');
  }
}

const isConfigured = () => Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET);

/* ---------- OAuth ---------- */
function authUrl(user, client) {
  if (!isConfigured()) throw new DriveError('Integrasi Google Drive belum dikonfigurasi oleh admin server.', 501, 'DRIVE_NOT_CONFIGURED');
  const p = new URLSearchParams({
    client_id: cfg.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: stateToken(user, client === 'mobile' ? 'mobile' : 'web'),
  });
  if (user.google_email) p.set('login_hint', user.google_email);
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(params) {
  const res = await gfetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.GOOGLE_CLIENT_ID, client_secret: cfg.GOOGLE_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new DriveError(data.error_description || data.error || 'Gagal menukar token Google.', 502, data.error === 'invalid_grant' ? 'DRIVE_REAUTH' : 'DRIVE_ERROR');
  return data;
}

const saveGoogle = db.prepare('UPDATE users SET google_refresh_enc = ?, google_email = ? WHERE id = ?');
const clearGoogle = db.prepare('UPDATE users SET google_refresh_enc = NULL, google_email = NULL WHERE id = ?');

/** Dipanggil dari /api/drive/callback. Mengembalikan { user, client }. */
async function handleCallback(code, state) {
  let st;
  try { st = verify(state); } catch { throw new DriveError('Sesi otorisasi kedaluwarsa. Ulangi hubungkan Google Drive.', 400); }
  if (st.typ !== 'gstate') throw new DriveError('State tidak valid.', 400);
  const user = getUser.get(st.sub);
  if (!user) throw new DriveError('Pengguna tidak ditemukan.', 404);
  const tok = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
  if (!tok.refresh_token) throw new DriveError('Google tidak memberikan refresh token. Cabut akses SoundWave di myaccount.google.com/permissions lalu ulangi.', 400);
  let email = null;
  try {
    const about = await apiJson(tok.access_token, '/drive/v3/about?fields=user(emailAddress)');
    email = about.user?.emailAddress || null;
  } catch { /* tidak fatal */ }
  saveGoogle.run(encrypt(tok.refresh_token), email, user.id);
  accessCache.set(user.id, { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 });
  invalidate(user.id);
  return { user: getUser.get(user.id), client: st.client };
}

async function disconnect(user) {
  if (user.google_refresh_enc) {
    try {
      await fetch(`${OAUTH}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decrypt(user.google_refresh_enc) }),
        signal: AbortSignal.timeout(8000),
      });
    } catch { /* abaikan */ }
  }
  clearGoogle.run(user.id);
  accessCache.delete(user.id);
  invalidate(user.id);
}

/* ---------- Access token per user ---------- */
const accessCache = new Map(); // userId -> { token, exp }

async function accessToken(user) {
  if (!isConfigured()) throw new DriveError('Integrasi Google Drive belum dikonfigurasi oleh admin server.', 501, 'DRIVE_NOT_CONFIGURED');
  if (!user.google_refresh_enc) throw new DriveError('Akun Google Drive belum dihubungkan.', 409, 'DRIVE_NOT_CONNECTED');
  const c = accessCache.get(user.id);
  if (c && c.exp > Date.now()) return c.token;
  try {
    const tok = await tokenRequest({ refresh_token: decrypt(user.google_refresh_enc), grant_type: 'refresh_token' });
    accessCache.set(user.id, { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 });
    return tok.access_token;
  } catch (e) {
    if (e.code === 'DRIVE_REAUTH') {
      clearGoogle.run(user.id);
      throw new DriveError('Akses Google Drive kedaluwarsa atau dicabut. Hubungkan ulang di menu Akun.', 409, 'DRIVE_NOT_CONNECTED');
    }
    throw e;
  }
}

async function apiJson(token, pathAndQuery, init = {}) {
  const res = await gfetch(`${API}${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(20000),
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `Google Drive API error ${res.status}`;
    throw new DriveError(msg, res.status === 404 ? 404 : res.status === 403 ? 403 : 502);
  }
  return data;
}

/* ---------- Folder ---------- */
function parseFolderInput(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  const id = m ? m[1] : s;
  return FILE_ID_RE.test(id) ? id : null;
}

const saveFolder = db.prepare('UPDATE users SET drive_folder_id = ?, drive_folder_name = ? WHERE id = ?');

async function setFolder(user, input) {
  const id = parseFolderInput(input);
  if (!id) throw new DriveError('Link atau ID folder Google Drive tidak valid.', 400);
  const token = await accessToken(user);
  let f;
  try {
    f = await apiJson(token, `/drive/v3/files/${id}?fields=id,name,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`);
  } catch (e) {
    if (e.status === 404) throw new DriveError('Folder tidak ditemukan atau akun Google Anda tidak punya akses ke folder itu.', 404);
    throw e;
  }
  if (f.mimeType !== 'application/vnd.google-apps.folder') throw new DriveError('Link tersebut bukan folder.', 400);
  if (f.trashed) throw new DriveError('Folder ada di sampah.', 400);
  if (!f.capabilities?.canAddChildren) throw new DriveError('Akun Google Anda tidak punya izin edit pada folder ini.', 403);
  saveFolder.run(f.id, f.name, user.id);
  invalidate(user.id);
  return { id: f.id, name: f.name };
}

async function createFolder(user, name) {
  const token = await accessToken(user);
  const f = await apiJson(token, '/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: String(name || 'SoundWave').slice(0, 100), mimeType: 'application/vnd.google-apps.folder' }),
  });
  saveFolder.run(f.id, f.name, user.id);
  invalidate(user.id);
  return { id: f.id, name: f.name };
}

function requireFolder(user) {
  if (!user.drive_folder_id) throw new DriveError('Folder penyimpanan Google Drive belum diatur. Atur di menu Akun.', 409, 'DRIVE_NO_FOLDER');
  return user.drive_folder_id;
}

/* ---------- Metadata lagu ---------- */
const NOISE = /\s*[([【]([^)\]】]*?(official|video|audio|lyric|lirik|visuali[sz]er|\bmv\b|\bhd\b|\b4k\b|\bhq\b|full album|music)[^)\]】]*)[)\]】]/gi;

function cleanTitle(t) {
  return t.replace(NOISE, '').replace(/\s+\|\s+.*$/, '').replace(/\s{2,}/g, ' ').trim();
}

function parseTrack(f) {
  const ap = f.appProperties || {};
  const base = f.name.replace(/\.[^.]+$/, '');
  let title = ap.title || base;
  let artist = ap.channel || '';
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) { artist = m[1].trim(); title = m[2].trim(); }
  title = cleanTitle(title) || base;
  artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/(?<=\S)VEVO$/, '').trim();
  const ytId = /^[A-Za-z0-9_-]{11}$/.test(ap.ytId || '') ? ap.ytId : null;
  const durMs = Number(f.videoMediaMetadata?.durationMillis) || 0;
  return {
    id: f.id,
    name: f.name,
    title,
    artist: artist || 'Tidak diketahui',
    mime: f.mimeType,
    isVideo: String(f.mimeType).startsWith('video/'),
    size: f.size ? Number(f.size) : null,
    duration: ap.duration ? Number(ap.duration) : durMs ? Math.round(durMs / 1000) : null,
    ytId,
    cover: ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : null,
    createdTime: f.createdTime || null,
  };
}

/* ---------- Daftar lagu (cache 60 detik per user) ---------- */
const trackCache = new Map(); // userId -> { at, folderId, tracks }
function invalidate(userId) { trackCache.delete(userId); }

async function listTracks(user, { refresh = false } = {}) {
  const folderId = requireFolder(user);
  const c = trackCache.get(user.id);
  if (!refresh && c && c.folderId === folderId && Date.now() - c.at < 60000) return c.tracks;
  const token = await accessToken(user);
  const tracks = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and ${MEDIA_FILTER}`);
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,appProperties,videoMediaMetadata(durationMillis))');
    const data = await apiJson(token, `/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&orderBy=createdTime desc`
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    (data.files || []).forEach((f) => tracks.push(parseTrack(f)));
    pageToken = data.nextPageToken || '';
  } while (pageToken && tracks.length < 10000);
  trackCache.set(user.id, { at: Date.now(), folderId, tracks });
  return tracks;
}

/* ---------- Streaming (mendukung Range untuk seek) ---------- */
const isDriveId = (id) => FILE_ID_RE.test(id) && !id.startsWith('local-');

async function stream(user, fileId, req, res) {
  if (!isDriveId(fileId)) throw new DriveError('ID file tidak valid.', 400);
  const token = await accessToken(user);
  const headers = { Authorization: `Bearer ${token}` };
  if (req.headers.range) headers.Range = req.headers.range;
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const up = await gfetch(`${API}/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, { headers, signal: ac.signal });
  if (!up.ok && up.status !== 206) {
    if (up.status === 416) { res.status(416).end(); return; }
    throw new DriveError(up.status === 404 ? 'File tidak ditemukan di Drive.' : `Gagal membaca file (${up.status}).`, up.status === 404 ? 404 : 502);
  }
  res.status(up.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = up.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!up.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (req.method === 'HEAD') { res.end(); ac.abort(); return; }
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
}

/* ---------- Upload hasil konversi (resumable) ---------- */
function clipBytes(s, max) {
  let out = String(s || '');
  while (Buffer.byteLength(out, 'utf8') > max) out = out.slice(0, -1);
  return out;
}

async function uploadJob(user, job) {
  const folderId = requireFolder(user);
  const token = await accessToken(user);
  const mime = job.format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
  const size = fs.statSync(job.file).size;
  // appProperties: maks 124 byte per pasangan key+value
  const appProperties = {
    sw: '1',
    ytId: job.videoId,
    title: clipBytes(job.meta?.title || job.title, 110),
    channel: clipBytes(job.meta?.channel || '', 110),
    duration: String(job.meta?.duration || ''),
  };
  const init = await gfetch(`${API}/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name: job.filename, parents: [folderId], appProperties }),
    signal: AbortSignal.timeout(20000),
  });
  if (!init.ok) {
    const d = await init.json().catch(() => ({}));
    throw new DriveError(d.error?.message || `Gagal memulai upload (${init.status}).`, 502);
  }
  const location = init.headers.get('location');
  const put = await gfetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': mime, 'Content-Length': String(size) },
    body: Readable.toWeb(fs.createReadStream(job.file)),
    duplex: 'half',
  });
  const data = await put.json().catch(() => ({}));
  if (!put.ok) throw new DriveError(data.error?.message || `Upload gagal (${put.status}).`, 502);
  invalidate(user.id);
  return { id: data.id, link: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view` };
}

async function trashFile(user, fileId) {
  if (!isDriveId(fileId)) throw new DriveError('ID file tidak valid.', 400);
  const token = await accessToken(user);
  await apiJson(token, `/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  invalidate(user.id);
}

module.exports = {
  DriveError, FILE_ID_RE, isConfigured, authUrl, handleCallback, disconnect,
  setFolder, createFolder, listTracks, stream, uploadJob, trashFile, parseTrack, invalidate,
};

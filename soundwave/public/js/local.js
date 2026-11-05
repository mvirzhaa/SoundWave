/**
 * Sumber musik lokal di web: folder di komputer pengguna.
 * - Chrome/Edge: File System Access API (showDirectoryPicker) — folder diingat (IndexedDB),
 *   cukup klik "Izinkan akses" saat membuka SoundWave lagi.
 * - Browser lain: <input webkitdirectory> — berlaku selama tab terbuka.
 * File TIDAK diunggah ke server; hanya metadata ringkas yang dikirim untuk playlist & perintah suara.
 */
import { parseId3, id3Size, parseFileName, hashId, AUDIO_EXT } from './id3.js';
import { emit, store } from './store.js';

export const fsaSupported = typeof window.showDirectoryPicker === 'function';
const DB_NAME = 'soundwave-local';
const GENRE_KEY = 'sw-local-genre';

const files = new Map(); // id -> { handle?: FileSystemFileHandle, file?: File, path }
const coverUrls = new Map(); // id -> objectURL
const local = {
  status: 'none', // none | need-permission | scanning | ready | error
  folderName: '',
  progress: { done: 0, total: 0 },
  error: '',
  mode: '', // fsa | input
};
export const localState = local;

/* ---------- IndexedDB kecil (handle folder + cache metadata) ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbOp(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const kvGet = (k) => idbOp('kv', 'readonly', (s) => s.get(k)).catch(() => null);
const kvSet = (k, v) => idbOp('kv', 'readwrite', (s) => s.put(v, k)).catch(() => {});
const kvDel = (k) => idbOp('kv', 'readwrite', (s) => s.delete(k)).catch(() => {});
const metaGet = (k) => idbOp('meta', 'readonly', (s) => s.get(k)).catch(() => null);
const metaSet = (k, v) => idbOp('meta', 'readwrite', (s) => s.put(v, k)).catch(() => {});

function genreOverrides() { try { return JSON.parse(localStorage.getItem(GENRE_KEY) || '{}'); } catch { return {}; } }
export function setLocalGenre(id, genre) {
  const o = genreOverrides();
  if (genre) o[id] = genre; else delete o[id];
  try { localStorage.setItem(GENRE_KEY, JSON.stringify(o)); } catch { /* abaikan */ }
  store.localTracks?.forEach((t) => { if (t.id === id) t.genre = genre || t.tagGenre || null; });
}

const changed = () => emit('local', local);

/* ---------- Memilih folder ---------- */
export async function initLocal() {
  if (!fsaSupported) return;
  const handle = await kvGet('root');
  if (!handle) return;
  local.folderName = handle.name;
  local.mode = 'fsa';
  const perm = await handle.queryPermission?.({ mode: 'read' });
  if (perm === 'granted') scanHandle(handle);
  else { local.status = 'need-permission'; changed(); }
}

/** Buka pemilih folder (harus dari klik pengguna). */
export async function pickFolder() {
  if (!fsaSupported) return pickWithInput();
  let handle;
  try { handle = await window.showDirectoryPicker({ id: 'soundwave-music', mode: 'read', startIn: 'music' }); } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
  await kvSet('root', handle);
  local.folderName = handle.name;
  local.mode = 'fsa';
  await scanHandle(handle);
}

/** Minta izin baca lagi untuk folder yang tersimpan (harus dari klik pengguna). */
export async function reconnect() {
  const handle = await kvGet('root');
  if (!handle) return pickFolder();
  const p = await handle.requestPermission({ mode: 'read' });
  if (p === 'granted') await scanHandle(handle);
}

export async function rescan() {
  if (local.mode === 'fsa') { const h = await kvGet('root'); if (h) return scanHandle(h); }
  if (local.mode === 'input') return pickWithInput();
}

export async function forgetFolder() {
  await kvDel('root');
  files.clear();
  coverUrls.forEach((u) => URL.revokeObjectURL(u));
  coverUrls.clear();
  Object.assign(local, { status: 'none', folderName: '', mode: '', progress: { done: 0, total: 0 } });
  store.localTracks = null;
  changed();
  emit('tracks');
}

function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = async () => {
      const list = [...input.files].filter((f) => AUDIO_EXT[ext(f.name)]);
      local.mode = 'input';
      local.folderName = (input.files[0]?.webkitRelativePath || '').split('/')[0] || 'Folder';
      await scanEntries(list.map((f) => ({ path: f.webkitRelativePath || f.name, file: f })));
      resolve();
    };
    input.click();
  });
}

/* ---------- Pemindaian ---------- */
const ext = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

async function walk(dir, prefix, out, depth = 0) {
  if (depth > 8) return;
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue;
    const p = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') await walk(entry, p, out, depth + 1);
    else if (AUDIO_EXT[ext(entry.name)]) out.push({ path: p, handle: entry });
    if (out.length > 20000) return;
  }
}

async function scanHandle(handle) {
  local.status = 'scanning'; local.progress = { done: 0, total: 0 }; changed();
  try {
    const out = [];
    await walk(handle, handle.name, out);
    await scanEntries(out);
  } catch (e) {
    local.status = 'error'; local.error = e.message; changed();
  }
}

/** Baca metadata (cache IndexedDB berdasarkan path + ukuran + tanggal ubah). */
async function scanEntries(entries) {
  local.status = 'scanning';
  local.progress = { done: 0, total: entries.length };
  changed();
  files.clear();
  const overrides = genreOverrides();
  const tracks = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const en = entries[i];
      try {
        const file = en.file || await en.handle.getFile();
        const key = `${en.path}|${file.size}|${file.lastModified}`;
        let meta = await metaGet(key);
        if (!meta) { meta = await readMeta(file); metaSet(key, meta); }
        const id = `local-w-${hashId(en.path)}`;
        files.set(id, { handle: en.handle, file: en.file, path: en.path });
        const fromName = parseFileName(file.name);
        const e = ext(file.name);
        tracks[i] = {
          id, local: true, name: file.name, path: en.path,
          title: meta.title || fromName.title,
          artist: meta.artist || fromName.artist || 'Tidak diketahui',
          album: meta.album || null,
          tagGenre: meta.genre || null,
          genre: overrides[id] || meta.genre || null,
          hasPic: Boolean(meta.hasPic),
          mime: AUDIO_EXT[e], isVideo: e === 'mp4' || e === 'm4v',
          size: file.size, duration: meta.duration || null, ytId: null, available: true,
          added: file.lastModified,
        };
      } catch { /* lewati file yang tak terbaca */ }
      local.progress.done++;
      if (local.progress.done % 25 === 0) changed();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  store.localTracks = tracks.filter(Boolean).sort((a, b) => b.added - a.added);
  local.status = 'ready';
  changed();
  emit('tracks');
}

async function readMeta(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const size = id3Size(head);
  if (!size) return {};
  // Baca seluruh tag (maks. 3 MB agar gambar sampul besar tetap terbaca)
  const tag = parseId3(new Uint8Array(await file.slice(0, Math.min(size, 3 * 1048576)).arrayBuffer())) || {};
  return { title: tag.title, artist: tag.artist, album: tag.album, genre: tag.genre, hasPic: Boolean(tag.picture) };
}

/* ---------- Akses file untuk pemutar & sampul ---------- */
export async function getLocalFile(id) {
  const f = files.get(id);
  if (!f) throw new Error('File lokal tidak ditemukan di folder ini.');
  if (f.file) return f.file;
  try { return await f.handle.getFile(); } catch (e) {
    // Izin bisa hilang setelah browser dibuka ulang — minta lagi (butuh klik pengguna)
    const root = await kvGet('root');
    if (root && (await root.requestPermission({ mode: 'read' })) === 'granted') return f.handle.getFile();
    throw e;
  }
}
export const hasLocal = (id) => files.has(id);
export const localById = (id) => store.localTracks?.find((t) => t.id === id) || null;

export async function coverUrl(track) {
  if (!track?.hasPic) return null;
  if (coverUrls.has(track.id)) return coverUrls.get(track.id);
  try {
    const file = await getLocalFile(track.id);
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    const tag = parseId3(new Uint8Array(await file.slice(0, Math.min(id3Size(head), 3 * 1048576)).arrayBuffer()));
    if (!tag?.picture) return null;
    const url = URL.createObjectURL(new Blob([tag.picture.data], { type: tag.picture.mime }));
    coverUrls.set(track.id, url);
    return url;
  } catch { return null; }
}

/** Ringkasan lagu lokal untuk perintah suara / playlist (tanpa handle file). */
export function localSummary() {
  return (store.localTracks || []).map((t) => ({
    id: t.id, name: t.name, title: t.title, artist: t.artist, album: t.album, genre: t.genre, mime: t.mime, isVideo: t.isVideo, duration: t.duration,
  }));
}

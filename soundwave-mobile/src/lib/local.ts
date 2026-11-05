/**
 * Musik dari penyimpanan HP:
 *  1. Pindai semua lagu di HP (Android: MediaStore lewat expo-media-library).
 *  2. Folder pilihan (Android: Storage Access Framework; iOS: folder di app File).
 *  3. Impor file (salin ke penyimpanan aplikasi) — cara paling andal di iOS.
 * Metadata (judul, artis, album, genre, sampul) dibaca dari tag ID3; hasilnya di-cache.
 * File tidak pernah diunggah ke server.
 */
import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import { parseId3, id3Size, parseFileName, hashId, AUDIO_EXT, type Id3Tag } from './id3';
import type { Track } from './types';

export type LocalSettings = { device: boolean; folders: { uri: string; name: string }[] };
type Meta = { title?: string; artist?: string; album?: string; genre?: string | null; cover?: string | null };
type Saved = {
  settings: LocalSettings;
  tracks: Track[];
  meta: Record<string, Meta>; // cache metadata per file (uri|ukuran|waktu ubah)
  genre: Record<string, string>; // ubahan genre manual
};

const indexFile = new File(Paths.document, 'local-library.json');
const importDir = new Directory(Paths.document, 'imported');
const coverDir = new Directory(Paths.cache, 'local-covers');

let saved: Saved = { settings: { device: false, folders: [] }, tracks: [], meta: {}, genre: {} };

export function loadSaved(): Saved {
  try {
    if (indexFile.exists) saved = { ...saved, ...JSON.parse(indexFile.textSync() || '{}') };
  } catch { /* mulai kosong */ }
  return saved;
}
function persist() {
  try {
    if (!indexFile.exists) indexFile.create();
    indexFile.write(JSON.stringify(saved));
  } catch { /* abaikan */ }
}

export const getSettings = () => saved.settings;
export const setSettings = (s: LocalSettings) => { saved.settings = s; persist(); };

const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const isAudio = (name: string) => Boolean((AUDIO_EXT as Record<string, string>)[extOf(name)]);
const decodeName = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Baca tag ID3 dari awal file (maks. 1 MB). Gambar sampul disimpan ke cache. */
function readMeta(id: string, uri: string): Meta {
  let handle: ReturnType<File['open']> | null = null;
  try {
    const f = new File(uri);
    handle = f.open();
    const head = handle.readBytesSync(10);
    const size = id3Size(head);
    if (!size) return {};
    handle.offset = 0;
    const tag = parseId3(handle.readBytesSync(Math.min(size, 1048576))) as Id3Tag | null;
    if (!tag) return {};
    let cover: string | null = null;
    if (tag.picture?.data?.length) {
      try {
        if (!coverDir.exists) coverDir.create({ intermediates: true, idempotent: true });
        const out = new File(coverDir, `${id}.${tag.picture.mime.includes('png') ? 'png' : 'jpg'}`);
        if (!out.exists) { out.create(); out.write(tag.picture.data); }
        cover = out.uri;
      } catch { /* tanpa sampul */ }
    }
    return { title: tag.title, artist: tag.artist, album: tag.album, genre: tag.genre || null, cover };
  } catch {
    return {};
  } finally {
    try { handle?.close(); } catch { /* abaikan */ }
  }
}

function makeTrack(id: string, uri: string, name: string, extra: { duration?: number | null; size?: number | null; mtime?: number | null; path?: string; source: string }): Track {
  const key = `${uri}|${extra.size ?? ''}|${extra.mtime ?? ''}`;
  let meta = saved.meta[key];
  if (!meta) { meta = readMeta(id, uri); saved.meta[key] = meta; }
  const fromName = parseFileName(name);
  const e = extOf(name);
  return {
    id, uri, name, local: true, source: extra.source, path: extra.path || name,
    title: meta.title || fromName.title,
    artist: meta.artist || fromName.artist || 'Tidak diketahui',
    album: meta.album || null,
    tagGenre: meta.genre || null,
    genre: saved.genre[id] || meta.genre || null,
    coverUri: meta.cover || null,
    mime: (AUDIO_EXT as Record<string, string>)[e] || 'audio/mpeg',
    isVideo: e === 'mp4' || e === 'm4v',
    duration: extra.duration ? Math.round(extra.duration) : null,
    size: extra.size ?? null,
    added: extra.mtime ?? 0,
    ytId: null,
    available: true,
  };
}

type Progress = (done: number, total: number) => void;
const tick = () => new Promise((r) => setTimeout(r, 0)); // beri jeda agar UI tetap responsif

/** 1) Semua audio di HP (Android). Di iOS lagu Apple Music tidak bisa diakses aplikasi pihak ketiga. */
export async function scanDevice(progress?: Progress): Promise<Track[]> {
  const perm = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  if (!perm.granted) throw new Error('Izin akses musik ditolak. Izinkan di Pengaturan → Aplikasi → SoundWave → Izin.');
  const out: Track[] = [];
  let after: string | undefined;
  let total = 0;
  for (let page = 0; page < 100; page++) {
    const res = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 200, after, sortBy: [[MediaLibrary.SortBy.modificationTime, false]] });
    total = res.totalCount;
    for (const a of res.assets) {
      if (!isAudio(a.filename) || (a.duration && a.duration < 20)) continue; // lewati nada dering/notifikasi pendek
      out.push(makeTrack(`local-m-a${hashId(a.id)}`, a.uri, a.filename, { duration: a.duration, mtime: a.modificationTime, source: 'device' }));
      if (out.length % 20 === 0) { progress?.(out.length, total); await tick(); }
    }
    if (!res.hasNextPage) break;
    after = res.endCursor;
  }
  return out;
}

/** 2) Pilih folder (dialog sistem). Kembalikan { uri, name } atau null bila dibatalkan. */
export async function pickFolder(): Promise<{ uri: string; name: string } | null> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    return { uri: dir.uri, name: decodeName(dir.name || 'Folder') };
  } catch (e: any) {
    if (String(e?.message || '').toLowerCase().includes('cancel')) return null;
    throw e;
  }
}

export async function scanFolder(uri: string, progress?: Progress): Promise<Track[]> {
  const out: Track[] = [];
  const walk = async (dir: Directory, prefix: string, depth: number) => {
    if (depth > 8 || out.length > 20000) return;
    for (const entry of dir.list()) {
      const name = decodeName(entry.name);
      if (name.startsWith('.')) continue;
      if (entry instanceof Directory) await walk(entry, `${prefix}/${name}`, depth + 1);
      else if (isAudio(name)) {
        const f = entry as File;
        out.push(makeTrack(`local-m-d${hashId(f.uri)}`, f.uri, name, { size: f.size, mtime: f.modificationTime, path: `${prefix}/${name}`, source: 'folder' }));
        if (out.length % 10 === 0) { progress?.(out.length, 0); await tick(); }
      }
    }
  };
  const root = new Directory(uri);
  if (!root.exists) throw new Error('Folder tidak bisa dibaca lagi. Pilih ulang foldernya.');
  await walk(root, decodeName(root.name || 'Folder'), 0);
  return out;
}

/** 3) Impor file audio ke penyimpanan aplikasi. */
export async function importFiles(): Promise<number> {
  const res = await File.pickFileAsync({ multipleFiles: true, mimeTypes: ['audio/*', 'video/mp4'] });
  if (res.canceled) return 0;
  if (!importDir.exists) importDir.create({ intermediates: true, idempotent: true });
  let n = 0;
  for (const f of res.result) {
    try {
      const dest = new File(importDir, decodeName(f.name).replace(/[\\/:*?"<>|]/g, '_'));
      if (!dest.exists) await f.copy(dest);
      n++;
    } catch { /* lewati */ }
  }
  return n;
}

export function scanImported(): Track[] {
  if (!importDir.exists) return [];
  return importDir.list().filter((e): e is File => e instanceof File && isAudio(e.name))
    .map((f) => makeTrack(`local-m-f${hashId(f.name)}`, f.uri, f.name, { size: f.size, mtime: f.modificationTime, path: `Impor/${f.name}`, source: 'import' }));
}

export function deleteImported(t: Track) {
  if (t.source !== 'import' || !t.uri) return;
  try { const f = new File(t.uri); if (f.exists) f.delete(); } catch { /* abaikan */ }
}

/** Pindai semua sumber lokal sesuai pengaturan, simpan hasil ke cache. */
export async function scanAll(progress?: Progress): Promise<{ tracks: Track[]; errors: string[] }> {
  const errors: string[] = [];
  const all: Track[] = [];
  if (saved.settings.device && Platform.OS === 'android') {
    try { all.push(...await scanDevice(progress)); } catch (e: any) { errors.push(e.message); }
  }
  for (const f of saved.settings.folders) {
    try { all.push(...await scanFolder(f.uri, progress)); } catch (e: any) { errors.push(`${f.name}: ${e.message}`); }
  }
  all.push(...scanImported());
  // Lagu yang sama bisa terbaca dari pemindaian HP dan folder — buang duplikat berdasarkan nama+ukuran/durasi
  const seen = new Set<string>();
  const tracks = all.filter((t) => {
    const k = `${t.name}|${t.title}|${t.artist}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (b.added || 0) - (a.added || 0));
  // Rapikan cache metadata agar tidak membengkak
  if (Object.keys(saved.meta).length > tracks.length * 2 + 500) saved.meta = {};
  saved.tracks = tracks;
  persist();
  return { tracks, errors };
}

export function setLocalGenre(id: string, genre: string) {
  if (genre) saved.genre[id] = genre; else delete saved.genre[id];
  saved.tracks = saved.tracks.map((t) => (t.id === id ? { ...t, genre: genre || t.tagGenre || null } : t));
  persist();
  return saved.tracks;
}

/** Metadata ringkas untuk perintah suara (tanpa uri file). */
export const summarize = (tracks: Track[]) => tracks.map((t) => ({
  id: t.id, name: t.name, title: t.title, artist: t.artist, album: t.album, genre: t.genre, mime: t.mime, isVideo: t.isVideo, duration: t.duration,
}));

/**
 * Simpan lagu untuk diputar offline (seperti tombol unduh di CloudBeats).
 * File disimpan di folder dokumen aplikasi; indeks metadata di offline/index.json.
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { streamUrl } from './api';
import { T } from './i18n';
import type { Track } from './types';

type Entry = { uri: string; track: Track; savedAt: number };

const dir = new Directory(Paths.document, 'offline');
const indexFile = new File(dir, 'index.json');
let index: Record<string, Entry> = {};
let loaded = false;
const listeners = new Set<() => void>();
const downloading = new Set<string>();

function ensureDir() {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export function loadOffline() {
  if (loaded) return;
  loaded = true;
  try {
    ensureDir();
    if (indexFile.exists) index = JSON.parse(indexFile.textSync() || '{}');
    // Bersihkan entri yang filenya hilang
    for (const [id, e] of Object.entries(index)) { const f = new File(e.uri); if (!f.exists || (f.size || 0) < 32 * 1024) { try { if (f.exists) f.delete(); } catch { /* abaikan */ } delete index[id]; } }
  } catch {
    index = {};
  }
}

function save() {
  try {
    ensureDir();
    if (!indexFile.exists) indexFile.create();
    indexFile.write(JSON.stringify(index));
  } catch { /* abaikan */ }
  listeners.forEach((fn) => fn());
}

export const subscribeOffline = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const isOffline = (id: string) => Boolean(index[id]);
export const isDownloading = (id: string) => downloading.has(id);
export const offlineUri = (id: string) => index[id]?.uri || null;
export const offlineTracks = (): Track[] => Object.values(index).sort((a, b) => b.savedAt - a.savedAt).map((e) => ({ ...e.track, available: true }));

function extOf(t: Track) {
  const m = t.name?.match(/\.(\w{2,4})$/);
  if (m) return m[1].toLowerCase();
  return t.isVideo ? 'mp4' : 'mp3';
}

/** File audio/video asli berukuran wajar dan tidak diawali teks JSON/HTML. */
function looksLikeMedia(f: File) {
  try {
    if (!f.exists || (f.size || 0) < 32 * 1024) return false;
    const h = f.open(FileMode.ReadOnly);
    try {
      const b = h.readBytesSync(16);
      const head = String.fromCharCode(...Array.from(b)).trimStart().toLowerCase();
      return !(head.startsWith('{') || head.startsWith('[') || head.startsWith('<!doctype') || head.startsWith('<html'));
    } finally { h.close(); }
  } catch {
    return true; // tidak bisa diperiksa → anggap valid (ukuran sudah lolos)
  }
}

export async function downloadOffline(t: Track) {
  if (index[t.id] || downloading.has(t.id)) return;
  downloading.add(t.id);
  listeners.forEach((fn) => fn());
  try {
    ensureDir();
    const dest = new File(dir, `${t.id}.${extOf(t)}`);
    if (dest.exists) { try { dest.delete(); } catch { /* abaikan */ } }
    const file = await File.downloadFileAsync(t.url && t.id.startsWith('quran-') ? t.url : await streamUrl(t.id), dest, { idempotent: true });
    // Pastikan yang tersimpan benar-benar audio/video, bukan pesan error (JSON/HTML) dari server
    if (!looksLikeMedia(file)) {
      try { file.delete(); } catch { /* abaikan */ }
      throw new Error(T('File yang diunduh bukan audio. Coba unduh ulang saat koneksi stabil.'));
    }
    const { available, itemId, ...meta } = t;
    index[t.id] = { uri: file.uri, track: meta, savedAt: Date.now() };
  } finally {
    downloading.delete(t.id);
    save();
  }
}

/** Perbarui judul/artis unduhan offline setelah lagu diganti namanya. */
export function updateOfflineMeta(id: string, patch: Partial<Track>) {
  const e = index[id];
  if (!e) return;
  e.track = { ...e.track, ...patch };
  save();
}

export function removeOffline(id: string) {
  const e = index[id];
  if (!e) return;
  try { const f = new File(e.uri); if (f.exists) f.delete(); } catch { /* abaikan */ }
  delete index[id];
  save();
}

export function offlineSizeBytes() {
  return Object.values(index).reduce((s, e) => {
    try { return s + (new File(e.uri).size || 0); } catch { return s; }
  }, 0);
}

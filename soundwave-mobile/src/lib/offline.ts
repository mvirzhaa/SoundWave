/**
 * Simpan lagu untuk diputar offline (seperti tombol unduh di CloudBeats).
 * File disimpan di folder dokumen aplikasi; indeks metadata di offline/index.json.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { streamUrl } from './api';
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
    for (const [id, e] of Object.entries(index)) if (!new File(e.uri).exists) delete index[id];
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

export async function downloadOffline(t: Track) {
  if (index[t.id] || downloading.has(t.id)) return;
  downloading.add(t.id);
  listeners.forEach((fn) => fn());
  try {
    ensureDir();
    const dest = new File(dir, `${t.id}.${extOf(t)}`);
    const file = await File.downloadFileAsync(await streamUrl(t.id), dest, { idempotent: true });
    const { available, itemId, ...meta } = t;
    index[t.id] = { uri: file.uri, track: meta, savedAt: Date.now() };
  } finally {
    downloading.delete(t.id);
    save();
  }
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

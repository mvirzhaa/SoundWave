/**
 * Salinan status pemutar + daftar lagu untuk widget. Disimpan sebagai file JSON kecil agar widget tetap bisa
 * digambar walaupun aplikasi sedang tidak berjalan.
 */
import { File, Paths } from 'expo-file-system';

export type WTrack = { id: string; t: string; a: string; o: 0 | 1 };
export type WState = {
  login: boolean;
  title: string;
  artist: string;
  playing: boolean;
  shuffle: boolean;
  hasQueue: boolean;
  online: boolean;
  /** Daftar lagu untuk widget. Saat offline hanya berisi lagu yang bisa diputar tanpa internet. */
  tracks: WTrack[];
  total: number;
};

export const EMPTY: WState = { login: false, title: '', artist: '', playing: false, shuffle: false, hasQueue: false, online: true, tracks: [], total: 0 };

const file = () => new File(Paths.document, 'widget-state.json');

export function readState(): WState {
  try { const f = file(); return f.exists ? { ...EMPTY, ...JSON.parse(f.textSync()) } : EMPTY; } catch { return EMPTY; }
}
export function writeState(s: WState) {
  try { const f = file(); if (!f.exists) f.create(); f.write(JSON.stringify(s)); } catch { /* abaikan */ }
}
export function clearState() {
  try { const f = file(); if (f.exists) f.delete(); } catch { /* abaikan */ }
}

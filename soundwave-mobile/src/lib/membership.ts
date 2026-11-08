/** Penanda di Pustaka: lagu mana sudah masuk playlist mana (lingkaran kecil berisi inisial playlist). */
import { useSyncExternalStore } from 'react';
import { get } from './api';

export type PlMark = { id: number; name: string; initials: string; hue: number };
type Snap = { pls: Map<number, PlMark>; map: Record<string, number[]> };

let snap: Snap = { pls: new Map(), map: {} };
let seq = 0;
const subs = new Set<() => void>();

export async function refreshMembership() {
  const my = ++seq;
  try {
    const r = await get<{ playlists: PlMark[]; map: Record<string, number[]> }>('/api/library/playlists/membership', { timeout: 20000 });
    if (my !== seq) return;
    snap = { pls: new Map(r.playlists.map((p) => [p.id, p])), map: r.map };
    subs.forEach((f) => f());
  } catch { /* penanda bersifat tambahan; abaikan bila gagal */ }
}

export function clearMembership() { snap = { pls: new Map(), map: {} }; subs.forEach((f) => f()); }

/** Playlist yang memuat lagu `id` (baris hanya dirender ulang saat data penanda berubah). */
export function usePlaylistMarks(id: string, enabled = true): PlMark[] {
  const s = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => snap);
  if (!enabled) return [];
  return (s.map[id] || []).map((pid) => s.pls.get(pid)).filter(Boolean) as PlMark[];
}

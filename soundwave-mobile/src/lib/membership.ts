/** Penanda di Pustaka: lagu mana sudah masuk playlist mana (lingkaran kecil berisi inisial playlist). */
import { useSyncExternalStore } from 'react';
import { getCached, readCache } from './cache';

export type PlMark = { id: number; name: string; initials: string; hue: number };
type Snap = { pls: Map<number, PlMark>; map: Record<string, number[]> };

let snap: Snap = { pls: new Map(), map: {} };
let seq = 0;
const subs = new Set<() => void>();

type Raw = { playlists: PlMark[]; map: Record<string, number[]> };
const KEY = 'membership';
const apply = (r: Raw) => { snap = { pls: new Map(r.playlists.map((p) => [p.id, p])), map: r.map }; subs.forEach((f) => f()); };

/** Tampilkan salinan terakhir di HP segera (mis. saat offline / server lambat), lalu perbarui dari server. */
export function loadMembershipCache() {
  const c = readCache<Raw>(KEY);
  if (c && !snap.pls.size) apply(c);
}

export async function refreshMembership() {
  const my = ++seq;
  loadMembershipCache();
  try {
    // Offline → getCached memakai salinan terakhir, sehingga penanda playlist tidak hilang
    const { data } = await getCached<Raw>(KEY, '/api/library/playlists/membership', { timeout: 20000 });
    if (my !== seq) return;
    apply(data);
  } catch { /* penanda bersifat tambahan; abaikan bila gagal */ }
}

export function clearMembership() { snap = { pls: new Map(), map: {} }; subs.forEach((f) => f()); }

/** Playlist yang memuat lagu `id` (baris hanya dirender ulang saat data penanda berubah). */
export function usePlaylistMarks(id: string, enabled = true): PlMark[] {
  const s = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => snap);
  if (!enabled) return [];
  return (s.map[id] || []).map((pid) => s.pls.get(pid)).filter(Boolean) as PlMark[];
}

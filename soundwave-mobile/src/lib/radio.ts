/** Radio internet (HP): favorit (disimpan di akun) + konversi stasiun → track pemutar. */
import { useSyncExternalStore } from 'react';
import { del, get, put } from './api';
import type { Station, Track } from './types';

let favorit: Station[] = [];
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export function useRadioFav() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => favorit);
}
export const isFavRadio = (uuid: string) => favorit.some((s) => s.uuid === uuid);

export async function loadRadioFav(force = false) {
  if (loaded && !force) return;
  try { favorit = (await get<{ stasiun: Station[] }>('/api/radio/favorit')).stasiun; loaded = true; notify(); } catch { /* abaikan */ }
}
export async function toggleRadioFav(st: Station) {
  const fav = isFavRadio(st.uuid);
  favorit = fav
    ? (await del<{ stasiun: Station[] }>(`/api/radio/favorit/${st.uuid}`)).stasiun
    : (await put<{ stasiun: Station[] }>(`/api/radio/favorit/${st.uuid}`, { stasiun: st })).stasiun;
  notify();
  return !fav;
}

export function stationTrack(st: Station): Track {
  const where = [st.state, st.country].filter(Boolean).join(', ');
  return {
    id: st.id || `radio-${st.uuid}`,
    name: st.name,
    title: st.name,
    artist: [st.freq ? `${st.freq} FM` : 'Radio', where].filter(Boolean).join(' · '),
    mime: 'audio/mpeg',
    isVideo: false,
    size: null,
    duration: null,
    ytId: null,
    url: st.url, // HP boleh memutar http langsung (cleartext diizinkan di app.json)
    coverUri: st.favicon || null,
    radio: st,
  };
}

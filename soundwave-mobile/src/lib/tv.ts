/** TV (HP): tipe data, API, favorit (tersimpan di akun), dan antrean saluran untuk layar pemutar. */
import { useSyncExternalStore } from 'react';
import { del, get, post, put } from './api';
import { T } from './i18n';

export type TvStream = { u: string; q?: string | null; geo?: boolean; part?: boolean };
export type TvItem = {
  id: string;
  name: string;
  logo?: string | null;
  country?: string;
  cats?: string[];
  q?: string | null;
  geo?: boolean;
  part?: boolean;
  httpOnly?: boolean;
  streams?: TvStream[];
  kind?: 'youtube' | 'hls';
  official?: boolean;
  yt?: string;
  ytPage?: string;
  m3u?: string;
};
export type TvPage = { total: number; offset: number; items: TvItem[]; name?: string };
export type TvMeta = { countries: { code: string; name: string; flag: string; count: number }[]; categories: { id: string; name: string; count: number }[]; total: number; updatedAt: number };
export type M3uLink = { id: number; name: string; url: string; createdAt: number };

const CAT: Record<string, string> = {
  general: 'Umum', news: 'Berita', religious: 'Religi', entertainment: 'Hiburan', music: 'Musik', sports: 'Olahraga', kids: 'Anak',
  movies: 'Film', series: 'Serial', education: 'Edukasi', business: 'Bisnis', lifestyle: 'Gaya hidup', cooking: 'Kuliner',
  documentary: 'Dokumenter', culture: 'Budaya', travel: 'Wisata', science: 'Sains', comedy: 'Komedi', animation: 'Animasi',
  classic: 'Klasik', family: 'Keluarga', legislative: 'Parlemen', public: 'Publik', relax: 'Santai', shop: 'Belanja',
  weather: 'Cuaca', outdoor: 'Alam', auto: 'Otomotif', interactive: 'Interaktif',
};
export const catName = (id: string) => (CAT[id] ? T(CAT[id]) : id);

const TO = { timeout: 30000 };
export const tvApi = {
  list: (p: { negara: string; kategori?: string; q?: string; offset?: number }) =>
    get<TvPage>(`/api/tv?negara=${encodeURIComponent(p.negara)}&kategori=${encodeURIComponent(p.kategori || '')}&q=${encodeURIComponent(p.q || '')}&offset=${p.offset || 0}`, TO),
  meta: () => get<TvMeta>('/api/tv/meta', TO),
  pilihan: () => get<{ items: TvItem[] }>('/api/tv/pilihan', TO).then((r) => r.items),
  yt: (id: string) => get<{ videoId: string; page: string }>(`/api/tv/yt/${encodeURIComponent(id)}`, { timeout: 35000 }),
  m3uLinks: () => get<{ links: M3uLink[] }>('/api/tv/m3u', TO).then((r) => r.links),
  m3uAdd: (url: string, name: string) => post<{ link: M3uLink & { count: number } }>('/api/tv/m3u', { url, name }),
  m3uDel: (id: number) => del<{ links: M3uLink[] }>(`/api/tv/m3u/${id}`).then((r) => r.links),
  m3uChannels: (id: number, q = '', offset = 0) => get<TvPage>(`/api/tv/m3u/${id}/saluran?q=${encodeURIComponent(q)}&offset=${offset}`, TO),
};

/* ---------- Favorit ---------- */
let favs: TvItem[] = [];
let favLoaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
export const useTvFav = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => favs);
export const isFavTv = (id: string) => favs.some((x) => x.id === id);
export async function loadTvFav(force = false) {
  if (favLoaded && !force) return favs;
  try { favs = (await get<{ items: TvItem[] }>('/api/tv/favorit', TO)).items; favLoaded = true; notify(); } catch { /* abaikan */ }
  return favs;
}
export async function toggleTvFav(it: TvItem) {
  const on = isFavTv(it.id);
  favs = on
    ? (await del<{ items: TvItem[] }>(`/api/tv/favorit/${encodeURIComponent(it.id)}`)).items
    : (await put<{ items: TvItem[] }>('/api/tv/favorit', { item: it })).items;
  notify();
  return !on;
}

/* ---------- Antrean untuk layar pemutar (dikirim lewat modul, bukan parameter rute) ---------- */
let queue: { list: TvItem[]; index: number } = { list: [], index: 0 };
export const setTvQueue = (list: TvItem[], index: number) => { queue = { list, index }; };
export const getTvQueue = () => queue;

export const initials = (name: string) =>
  name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'TV';
export const hueOf = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

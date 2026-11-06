/** State bersama: pengguna yang masuk & cache pustaka. */
import { get, put, del, post } from './api.js';

const bus = new EventTarget();
/** Daftarkan listener; mengembalikan fungsi untuk melepasnya. */
export const on = (ev, fn) => {
  const l = (e) => fn(e.detail);
  bus.addEventListener(ev, l);
  return () => bus.removeEventListener(ev, l);
};
export const emit = (ev, detail) => bus.dispatchEvent(new CustomEvent(ev, { detail }));

export const store = {
  user: null,
  tracks: null, // array lagu dari Drive (null = belum dimuat)
  localTracks: null, // array lagu dari folder lokal (null = belum ada folder)
  tracksError: null,
  favorites: new Set(),
};

export function setUser(u) {
  store.user = u;
  emit('user', u);
}

export const driveReady = () => Boolean(store.user?.drive?.ready ?? (store.user?.drive?.connected && store.user?.drive?.folderId));
/** Bisa menyimpan ke Drive (mode login Google, bukan mode link folder). */
export const driveWritable = () => driveReady() && !store.user?.drive?.readOnly;

let loading = null;
export async function loadTracks(refresh = false) {
  if (!driveReady()) { store.tracks = []; return store.tracks; }
  if (loading && !refresh) return loading;
  loading = (async () => {
    try {
      const { tracks } = await get('/api/library/tracks' + (refresh ? '?refresh=1' : ''));
      store.tracks = tracks;
      store.tracksError = null;
      const localFavs = [...store.favorites].filter((id) => id.startsWith('local-'));
      store.favorites = new Set([...tracks.filter((t) => t.favorite).map((t) => t.id), ...localFavs]);
      emit('tracks', tracks);
      return tracks;
    } catch (e) {
      store.tracksError = e;
      throw e;
    } finally { loading = null; }
  })();
  return loading;
}

export function invalidateTracks() { store.tracks = null; }

export async function toggleFavorite(track) {
  const fav = store.favorites.has(track.id);
  if (fav) await del(`/api/library/favorites/${track.id}`);
  else await put(`/api/library/favorites/${track.id}`, { track });
  fav ? store.favorites.delete(track.id) : store.favorites.add(track.id);
  emit('favorites', { id: track.id, favorite: !fav });
  return !fav;
}

export const recordPlay = (track) => post(`/api/library/recent/${track.id}`, { track }).catch(() => {});

/** Favorit untuk lagu lokal (server menyimpan ID-nya; file tetap di perangkat). */
export async function loadLocalFavorites() {
  try {
    const p = await get('/api/library/playlists/favorites');
    p.items.filter((x) => x.id.startsWith('local-')).forEach((x) => store.favorites.add(x.id));
  } catch { /* abaikan */ }
}

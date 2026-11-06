/** Radio internet (web): favorit, konversi stasiun → track pemutar. */
import { get, put, del } from './api.js';
import { emit } from './store.js';

export const radio = { favorit: [], loaded: false };
export const isFavRadio = (uuid) => radio.favorit.some((s) => s.uuid === uuid);

export async function loadRadioFav() {
  try { radio.favorit = (await get('/api/radio/favorit')).stasiun; radio.loaded = true; emit('radio:fav'); } catch { /* abaikan */ }
}
export async function toggleRadioFav(st) {
  const fav = isFavRadio(st.uuid);
  radio.favorit = fav
    ? (await del(`/api/radio/favorit/${st.uuid}`)).stasiun
    : (await put(`/api/radio/favorit/${st.uuid}`, { stasiun: st })).stasiun;
  emit('radio:fav');
  return !fav;
}

/** Halaman https tidak boleh memutar audio http → lewatkan proxy server. */
export function stationTrack(st) {
  const where = [st.state, st.country].filter(Boolean).join(', ');
  return {
    id: st.id || `radio-${st.uuid}`,
    title: st.name,
    artist: [st.freq ? `${st.freq} FM` : 'Radio internet', where].filter(Boolean).join(' · '),
    url: st.https ? st.url : `/api/radio/stream/${st.uuid}`,
    coverUri: st.favicon || null,
    isVideo: false,
    duration: null,
    radio: st,
  };
}

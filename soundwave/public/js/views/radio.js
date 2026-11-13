/** Halaman Radio: cari stasiun / frekuensi, stasiun populer Indonesia, favorit. */
import { h, icon, I, toast, fillCover, debounce , clearable } from '../ui.js';
import { get, post } from '../api.js';
import { on } from '../store.js';
import { playList, current } from '../player.js';
import { radio, isFavRadio, toggleRadioFav, stationTrack, loadRadioFav } from '../radio.js';

const NEGARA_KEY = 'sw-radio-negara';

export function renderRadio(view) {
  const page = h('section.page.radio');
  view.append(page);
  let negara = 'ID';
  try { negara = localStorage.getItem(NEGARA_KEY) ?? 'ID'; } catch { /* abaikan */ }
  let hasil = null;
  let err = '';
  let seq = 0;

  const input = h('input', { type: 'search', placeholder: 'Nama stasiun, kota, atau frekuensi (mis. 101.1)', 'aria-label': 'Cari radio', inputmode: 'search' });
  const listBox = h('div');
  const favBox = h('div');
  const head = h('p.muted.src-line');

  const cari = async () => {
    const my = ++seq;
    const q = input.value.trim();
    head.textContent = q ? 'Mencari…' : 'Memuat stasiun populer…';
    try {
      const r = await get(`/api/radio?q=${encodeURIComponent(q)}&negara=${encodeURIComponent(negara)}`);
      if (my !== seq) return;
      hasil = r.stasiun; err = '';
    } catch (e) { if (my !== seq) return; hasil = []; err = e.message; }
    drawList();
  };

  const card = (st, list) => {
    const t = stationTrack(st);
    const playing = current()?.id === t.id;
    const cover = fillCover(h('span.cover.sm'), t);
    const fav = isFavRadio(st.uuid);
    return h(`div.track.station${playing ? '.now' : ''}`, {},
      h('button.track-main', { type: 'button', onclick: () => play(st, list) }, cover,
        h('span.track-text', {},
          h('b', {}, st.name, st.freq ? h('span.freq', { text: `${st.freq} FM` }) : null),
          h('small', { text: [[st.state, st.country].filter(Boolean).join(', '), st.codec && `${st.codec}${st.bitrate ? ` ${st.bitrate} kbps` : ''}`, ...(st.tags || []).slice(0, 2)].filter(Boolean).join(' · ') }))),
      h('button.icon-btn.heart', {
        type: 'button', 'aria-pressed': String(fav), 'aria-label': fav ? 'Hapus dari favorit' : 'Tambah ke favorit',
        onclick: async () => { try { const f = await toggleRadioFav(st); toast(f ? `${st.name} ditambahkan ke favorit` : `${st.name} dihapus dari favorit`); } catch (e) { toast(e.message, { type: 'error' }); } },
      }, icon(I.heart)));
  };

  function play(st, list) {
    const tracks = list.map(stationTrack);
    if (navigator.onLine === false) { toast('Radio tidak bisa diputar saat offline. Sambungkan ke internet lalu coba lagi.', { type: 'error' }); return; }
    playList(tracks, list.indexOf(st), { shuffle: false, repeat: 'off', source: 'Radio' });
    post(`/api/radio/klik/${st.uuid}`).catch(() => {});
  }

  function drawFav() {
    favBox.textContent = '';
    if (!radio.favorit.length) return;
    favBox.append(h('h3', { text: 'Favorit' }), h('div.tracks', {}, radio.favorit.map((s) => card(s, radio.favorit))));
  }
  function drawList() {
    listBox.textContent = '';
    const q = input.value.trim();
    head.textContent = err || (hasil?.length
      ? `${q ? `Hasil “${q}”` : `Populer${negara ? ' di Indonesia' : ' di seluruh dunia'}`} · ${hasil.length} stasiun`
      : q ? 'Stasiun tidak ditemukan. Coba nama lain, atau pilih “Semua negara”.' : '');
    if (hasil?.length) listBox.append(h('div.tracks', {}, hasil.map((s) => card(s, hasil))));
  }

  const negaraSeg = h('div.sources', { role: 'radiogroup' }, [['ID', 'Indonesia'], ['', 'Semua negara']].map(([cc, label]) => h('button.chip-src', {
    type: 'button', role: 'radio', 'aria-checked': String(negara === cc), text: label,
    onclick: (e) => {
      negara = cc;
      try { localStorage.setItem(NEGARA_KEY, cc); } catch { /* abaikan */ }
      negaraSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
      cari();
    },
  })));
  input.addEventListener('input', debounce(cari, 350));

  page.append(
    h('h2', { text: 'Radio' }),
    h('div.search.radio-search', {}, h('div.search-box', {}, icon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5'], 'search-ico'), clearable(input))),
    negaraSeg,
    favBox,
    head,
    listBox,
    h('p.hint', { text: 'Radio internet dari direktori terbuka Radio Browser. Frekuensi FM diambil dari nama stasiun; siaran diputar lewat internet, bukan tuner FM.' }));

  drawFav();
  if (!radio.loaded) loadRadioFav();
  cari();
  const offs = [on('radio:fav', () => { drawFav(); drawList(); }), on('player:track', () => { drawFav(); drawList(); })];
  return () => offs.forEach((f) => f());
}

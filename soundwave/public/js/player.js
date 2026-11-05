/**
 * Pemutar pustaka: antrean, acak, ulangi, favorit, mini player, pemutar penuh,
 * Media Session (tombol media keyboard / layar kunci HP), dan simpan sesi terakhir.
 */
import { h, icon, I, fillCover, fmtDur, toast, actionMenu } from './ui.js';
import { store, on, emit, toggleFavorite, recordPlay } from './store.js';
import { getLocalFile, coverUrl, localById } from './local.js';

const $ = (id) => document.getElementById(id);
const media = $('media');
const mini = $('mini');
const full = $('full');

const state = {
  queue: [],      // urutan putar saat ini
  original: [],   // urutan asli (untuk mematikan acak)
  index: -1,
  shuffle: false,
  repeat: 'off',  // off | all | one
  source: 'Pustaka',
};

export const current = () => state.queue[state.index] || null;
export const isPlaying = () => !media.paused && !media.ended;

/* ---------- Simpan / pulihkan sesi ---------- */
const KEY = () => `sw-player-${store.user?.id}`;
function persist() {
  try {
    localStorage.setItem(KEY(), JSON.stringify({
      queue: state.queue.slice(0, 500), index: state.index, shuffle: state.shuffle, repeat: state.repeat,
      source: state.source, time: media.currentTime || 0,
    }));
  } catch { /* abaikan */ }
}
export function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY()) || 'null');
    if (!s?.queue?.length) return;
    Object.assign(state, { queue: s.queue, original: [...s.queue], index: Math.min(s.index, s.queue.length - 1), shuffle: s.shuffle, repeat: s.repeat, source: s.source });
    load(false, s.time);
  } catch { /* abaikan */ }
}
export function reset() {
  media.pause();
  media.removeAttribute('src');
  media.load();
  Object.assign(state, { queue: [], original: [], index: -1 });
  mini.hidden = true;
  closeFull();
  document.body.classList.remove('has-mini');
}

/* ---------- Kontrol inti ---------- */
const shuffleArr = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * Putar daftar lagu mulai dari index (null = mulai acak).
 * opts: { shuffle: true|false (ubah mode acak), source: label asal }
 */
export function playList(tracks, index = 0, opts = {}) {
  const wanted = index == null ? null : tracks[index];
  const list = tracks.filter((t) => t && t.available !== false);
  if (!list.length) { toast('Tidak ada lagu yang bisa diputar.'); return; }
  state.original = [...list];
  state.source = opts.source || 'Pustaka';
  if (opts.shuffle != null) state.shuffle = opts.shuffle;
  const startIdx = wanted == null ? Math.floor(Math.random() * list.length) : Math.max(0, list.indexOf(wanted));
  state.queue = state.shuffle ? [list[startIdx], ...shuffleArr(list.filter((_, i) => i !== startIdx))] : [...list];
  state.index = state.shuffle ? 0 : startIdx;
  updateModes();
  load(true);
}

export function playNext(track) {
  if (!current()) return playList([track]);
  state.queue.splice(state.index + 1, 0, track);
  state.original.push(track);
  renderQueue(); persist();
  toast(`“${track.title}” diputar berikutnya`);
}
export function addToQueue(track) {
  if (!current()) return playList([track]);
  state.queue.push(track);
  state.original.push(track);
  renderQueue(); persist();
  toast(`“${track.title}” ditambahkan ke antrean`);
}

let blobUrl = null;
/** URL sumber: stream dari server (Google Drive) atau blob dari file lokal. */
async function sourceUrl(t) {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  if (!t.local) return `/api/library/stream/${encodeURIComponent(t.id)}`;
  blobUrl = URL.createObjectURL(await getLocalFile(t.id));
  return blobUrl;
}

let lastRecorded = null;
let loadSeq = 0;
let loaded = false; // media sudah punya sumber untuk lagu saat ini
let failStreak = 0; // cegah loncat tanpa henti bila banyak file tak tersedia
async function load(autoplay = true, startAt = 0) {
  let t = current();
  if (!t) return;
  // Lagu lokal dari antrean/playlist: pakai objek terbaru dari hasil pindai folder
  if (t.local && localById(t.id)) { t = localById(t.id); state.queue[state.index] = t; }
  const seq = ++loadSeq;
  emit('player:start'); // hentikan pratinjau YouTube
  updateNowPlaying();
  renderQueue();
  persist();
  loaded = false;
  try {
    const src = await sourceUrl(t);
    if (seq !== loadSeq) return;
    media.src = src;
    loaded = true;
  } catch {
    if (seq !== loadSeq) return;
    if (autoplay && ++failStreak < Math.min(5, state.queue.length)) {
      toast(t.local ? `“${t.title}” tidak ada di folder lokal saat ini. Melewati…` : `Gagal memuat “${t.title}”.`, { type: 'error' });
      setTimeout(() => next(true), 1200);
    }
    return;
  }
  if (startAt) media.addEventListener('loadedmetadata', () => { media.currentTime = startAt; }, { once: true });
  if (autoplay) media.play().catch(() => {});
  if (autoplay && lastRecorded !== t.id) { lastRecorded = t.id; recordPlay(t); }
}

export function toggle() {
  if (!current()) return;
  if (!loaded) { load(true); return; } // mis. sesi dipulihkan, file lokal butuh izin dulu
  if (media.paused) media.play().catch(() => {}); else media.pause();
}
export function pause() { media.pause(); }
export function resume() { if (!current()) return; if (!loaded) load(true); else media.play().catch(() => {}); }

export function next(auto = false) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 'one') { media.currentTime = 0; media.play(); return; }
  if (state.index < state.queue.length - 1) state.index++;
  else if (state.repeat === 'all' || !auto) state.index = 0;
  else { media.pause(); media.currentTime = 0; return; }
  load(true);
}
export function prev() {
  if (!state.queue.length) return;
  if (media.currentTime > 3) { media.currentTime = 0; return; }
  state.index = state.index > 0 ? state.index - 1 : (state.repeat === 'all' ? state.queue.length - 1 : 0);
  load(true);
}

function setShuffle(on) {
  const cur = current();
  state.shuffle = on;
  if (cur) {
    if (on) state.queue = [cur, ...shuffleArr(state.queue.filter((t, i) => i !== state.index))];
    else state.queue = [...state.original];
    state.index = Math.max(0, state.queue.findIndex((t) => t.id === cur.id));
  }
  updateModes(); renderQueue(); persist();
}
function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  updateModes(); persist();
  toast({ off: 'Ulangi: mati', all: 'Ulangi semua', one: 'Ulangi satu lagu' }[state.repeat]);
}

/* ---------- Tampilan ---------- */
function updateNowPlaying() {
  const t = current();
  if (!t) return;
  mini.hidden = false;
  document.body.classList.add('has-mini');
  $('miniTitle').textContent = t.title;
  $('miniArtist').textContent = t.artist;
  fillCover($('miniCover'), t);
  $('fullTitle').textContent = t.title;
  $('fullArtist').textContent = t.artist;
  $('fullSource').textContent = state.source;
  fillCover($('fullCover'), t, { hq: true });
  $('stage').classList.toggle('is-video', Boolean(t.isVideo));
  updateFav();
  document.title = `${t.title} · ${t.artist} — SoundWave`;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: state.source,
      artwork: t.ytId ? [{ src: `https://i.ytimg.com/vi/${t.ytId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }] : [],
    });
    if (t.local && t.hasPic) {
      coverUrl(t).then((url) => {
        if (url && current()?.id === t.id) navigator.mediaSession.metadata.artwork = [{ src: url, sizes: '512x512' }];
      });
    }
  }
}
function updateFav() {
  const t = current();
  const fav = t && store.favorites.has(t.id);
  $('favBtn').setAttribute('aria-pressed', String(Boolean(fav)));
}
function updateModes() {
  $('shuffleBtn').setAttribute('aria-pressed', String(state.shuffle));
  const r = $('repeatBtn');
  r.dataset.mode = state.repeat;
  r.setAttribute('aria-label', { off: 'Ulangi: mati', all: 'Ulangi semua', one: 'Ulangi satu' }[state.repeat]);
}
function updatePlayState() {
  document.body.classList.toggle('is-playing', isPlaying());
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = media.paused ? 'paused' : 'playing';
}

let seeking = false;
function updateTime() {
  const d = media.duration || current()?.duration || 0;
  const c = media.currentTime || 0;
  $('miniProg').style.width = d ? (c / d) * 100 + '%' : '0';
  if (!seeking) $('seek').value = d ? Math.round((c / d) * 1000) : 0;
  $('tCur').textContent = fmtDur(c);
  $('tDur').textContent = fmtDur(d);
  if ('mediaSession' in navigator && d && Number.isFinite(d)) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: 1 }); } catch { /* abaikan */ }
  }
}

function renderQueue() {
  const ol = $('queueList');
  if ($('queue').hidden) return;
  ol.textContent = '';
  state.queue.forEach((t, i) => {
    const li = h(`li${i === state.index ? '.now' : ''}`, {},
      h('button.q-item', { type: 'button', onclick: () => { state.index = i; load(true); } },
        h('span.q-num', { text: i === state.index ? '▶' : String(i + 1) }),
        h('span.q-text', {}, h('b', { text: t.title }), h('small', { text: t.artist }))),
      i !== state.index ? h('button.icon-btn.sm', {
        type: 'button', 'aria-label': 'Hapus dari antrean',
        onclick: () => {
          state.queue.splice(i, 1);
          if (i < state.index) state.index--;
          renderQueue(); persist();
        },
      }, icon('M6 6l12 12M18 6 6 18')) : null);
    ol.append(li);
  });
  ol.querySelector('.now')?.scrollIntoView({ block: 'nearest' });
}

export function openFull() {
  if (!current()) return;
  full.hidden = false;
  document.body.classList.add('full-open');
  updateTime();
}
export function closeFull() {
  full.hidden = true;
  document.body.classList.remove('full-open');
}

/* ---------- Event ---------- */
export function initPlayer({ trackMenu }) {
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    ({ toggle, next: () => next(false), prev })[b.dataset.act]?.();
  }));
  $('miniOpen').addEventListener('click', openFull);
  $('fullClose').addEventListener('click', closeFull);
  $('shuffleBtn').addEventListener('click', () => setShuffle(!state.shuffle));
  $('repeatBtn').addEventListener('click', cycleRepeat);
  $('favBtn').addEventListener('click', async () => {
    const t = current(); if (!t) return;
    try { const fav = await toggleFavorite(t); toast(fav ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit'); } catch (e) { toast(e.message, { type: 'error' }); }
  });
  $('fullMenu').addEventListener('click', () => current() && trackMenu(current(), { fromPlayer: true }));
  $('queueBtn').addEventListener('click', () => {
    const q = $('queue');
    q.hidden = !q.hidden;
    $('queueBtn').setAttribute('aria-pressed', String(!q.hidden));
    renderQueue();
  });
  $('queueClear').addEventListener('click', () => { state.queue.splice(state.index + 1); renderQueue(); persist(); });

  const seek = $('seek');
  seek.addEventListener('input', () => { seeking = true; const d = media.duration || 0; $('tCur').textContent = fmtDur((seek.value / 1000) * d); });
  seek.addEventListener('change', () => { const d = media.duration || 0; if (d) media.currentTime = (seek.value / 1000) * d; seeking = false; });
  const vol = $('volume');
  try { const v = localStorage.getItem('sw-volume'); if (v != null) media.volume = vol.value = Number(v); } catch { /* abaikan */ }
  vol.addEventListener('input', () => { media.volume = Number(vol.value); try { localStorage.setItem('sw-volume', vol.value); } catch { /* abaikan */ } });

  media.addEventListener('play', updatePlayState);
  media.addEventListener('playing', () => { failStreak = 0; });
  media.addEventListener('pause', () => { updatePlayState(); persist(); });
  media.addEventListener('timeupdate', updateTime);
  media.addEventListener('loadedmetadata', updateTime);
  media.addEventListener('ended', () => next(true));
  media.addEventListener('error', () => {
    if (!current()) return;
    if (++failStreak >= Math.min(5, state.queue.length)) { toast('Beberapa lagu gagal diputar. Pemutaran dihentikan.', { type: 'error' }); return; }
    toast(`Gagal memutar “${current().title}”. Melewati…`, { type: 'error' });
    setTimeout(() => next(true), 1200);
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', resume);
    ms.setActionHandler('pause', pause);
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', () => next(false));
    try { ms.setActionHandler('seekto', (d) => { media.currentTime = d.seekTime; }); } catch { /* abaikan */ }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && current()) { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && !full.hidden) closeFull();
    else if (e.key === 'ArrowRight' && e.shiftKey) next(false);
    else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
  });

  on('favorites', updateFav);
  on('preview:start', () => media.pause()); // pratinjau YouTube diputar → jeda pustaka
  updateModes();
}

export { state as playerState };

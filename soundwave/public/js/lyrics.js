/**
 * Lirik tersinkron (karaoke) di pemutar penuh web.
 * Sumber dari server: LRCLIB, lalu subtitle YouTube. Baris aktif disorot & digulir otomatis,
 * klik baris untuk loncat, timing bisa digeser ±0,5 detik (diingat per lagu).
 */
import { h, icon } from './ui.js';
import { get } from './api.js';
import { on } from './store.js';

const OFFSET_KEY = 'sw-lyrics-offset';
const OPEN_KEY = 'sw-lyrics-open';
const SOURCE_LABEL = {
  lrclib: 'Lirik dari LRCLIB',
  youtube: 'Subtitle YouTube',
  'youtube-auto': 'Subtitle otomatis YouTube — mungkin kurang akurat',
};

let media; let current;
const box = () => document.getElementById('lyrics');
const btn = () => document.getElementById('lyricsBtn');
const state = { open: false, trackId: null, data: null, lines: [], active: -1, userScrollAt: 0, seq: 0 };

const offsets = () => { try { return JSON.parse(localStorage.getItem(OFFSET_KEY) || '{}'); } catch { return {}; } };
const getOffset = (id) => offsets()[id] || 0;
function setOffset(id, v) {
  const o = offsets();
  if (Math.abs(v) < 0.01) delete o[id]; else o[id] = Math.round(v * 10) / 10;
  try { localStorage.setItem(OFFSET_KEY, JSON.stringify(o)); } catch { /* abaikan */ }
}

export function initLyrics(deps) {
  ({ media, current } = deps);
  btn().addEventListener('click', () => toggleLyrics());
  media.addEventListener('timeupdate', sync);
  media.addEventListener('seeked', () => { state.userScrollAt = 0; sync(); });
  on('player:track', (t) => { if (state.open && t.id !== state.trackId) load(t); });
  box().addEventListener('wheel', () => { state.userScrollAt = Date.now(); }, { passive: true });
  box().addEventListener('touchmove', () => { state.userScrollAt = Date.now(); }, { passive: true });
  try { if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true, false); } catch { /* abaikan */ }
}

function setOpen(open, loadNow = true) {
  state.open = open;
  box().hidden = !open;
  document.getElementById('stage').classList.toggle('show-lyrics', open);
  btn().setAttribute('aria-pressed', String(open));
  try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* abaikan */ }
  if (open && loadNow && current()) load(current());
}

export function toggleLyrics(force) {
  setOpen(force ?? !state.open);
}

async function load(t, refresh = false) {
  const seq = ++state.seq;
  state.trackId = t.id;
  state.data = null; state.lines = []; state.active = -1;
  const el = box();
  el.textContent = '';
  if (t.quran) return loadQuran(t, seq);
  if (t.radio) { el.append(h('p.lyrics-msg', { text: 'Lirik tidak tersedia untuk siaran radio.' })); return; }
  if (navigator.onLine === false) {
    el.append(h('p.lyrics-msg', { text: 'Lirik tidak dapat dilihat saat offline. Lagu tetap bisa diputar; lirik muncul lagi saat terhubung ke internet.' }));
    window.addEventListener('online', () => { if (seq === state.seq) load(t); }, { once: true });
    return;
  }
  el.append(h('p.lyrics-msg', { text: 'Mencari lirik…' }));
  // Tunggu durasi asli file (lebih akurat untuk pencocokan versi lagu di LRCLIB)
  if (!(media.duration > 0)) {
    await new Promise((r) => { const done = () => r(); media.addEventListener('loadedmetadata', done, { once: true }); setTimeout(done, 3000); });
    if (seq !== state.seq) return;
  }
  const dur = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : t.duration;
  const q = new URLSearchParams({ title: t.title, artist: t.artist || '' });
  if (t.album) q.set('album', t.album);
  if (dur) q.set('duration', String(Math.round(dur)));
  if (t.ytId) q.set('ytId', t.ytId);
  if (refresh) q.set('refresh', '1');
  try {
    const data = await get(`/api/lyrics?${q}`);
    if (seq !== state.seq) return;
    state.data = data;
    render(t);
  } catch (e) {
    if (seq !== state.seq) return;
    el.textContent = '';
    if (e.status === 0) {
      // Offline: beri tahu dengan jelas, dan muat otomatis begitu koneksi kembali
      el.append(h('p.lyrics-msg', { text: 'Lirik tidak dapat dilihat saat offline. Lagu tetap bisa diputar; lirik muncul lagi saat terhubung ke internet.' }));
      window.addEventListener('online', () => { if (seq === state.seq) load(t); }, { once: true });
      return;
    }
    el.append(h('p.lyrics-msg', { text: e.message }), retry(t));
  }
}

const retry = (t) => h('button.btn', { type: 'button', text: 'Cari ulang', onclick: () => load(t, true) });

function render(t) {
  const el = box();
  el.textContent = '';
  const d = state.data;
  if (!d?.found) {
    el.append(h('div.lyrics-empty', {},
      icon('M4 6h16M4 10h10M4 14h12M4 18h7'),
      h('p', { text: 'Lirik belum tersedia untuk lagu ini.' }),
      h('small', { text: 'Dicari di LRCLIB' + (t.ytId ? ' dan subtitle YouTube.' : ' berdasarkan judul & artis.') }),
      retry(t)));
    return;
  }
  if (d.instrumental) { el.append(h('div.lyrics-empty', {}, h('p', { text: '♪ Lagu instrumental ♪' }))); return; }

  const label = `${SOURCE_LABEL[d.source] || d.source}${d.server ? ' · tersimpan di server SoundWave' : ''}`;
  const head = h('div.lyrics-head', {}, h('small', { text: label, title: d.server ? `Sudah dipakai ${d.hits || 1}× oleh pengguna SoundWave` : '' }));
  if (d.synced) {
    const offLabel = h('span.off', {});
    const showOff = () => { const o = getOffset(t.id); offLabel.textContent = o ? `${o > 0 ? '+' : ''}${o.toFixed(1)} dtk` : 'Pas'; };
    const nudge = (dv) => { setOffset(t.id, getOffset(t.id) + dv); showOff(); state.userScrollAt = 0; sync(); };
    head.append(h('span.lyrics-tools', { title: 'Geser timing lirik bila terlalu cepat/lambat' },
      h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Lirik lebih awal 0,5 detik', text: '−', onclick: () => nudge(-0.5) }),
      offLabel,
      h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Lirik lebih lambat 0,5 detik', text: '+', onclick: () => nudge(0.5) })));
    showOff();
  }
  head.append(h('button.link', { type: 'button', text: 'Cari ulang', onclick: () => load(t, true) }));
  el.append(head);

  if (!d.synced) {
    el.append(h('pre.lyrics-plain', { text: d.plain }));
    return;
  }
  state.lines = d.lines;
  const list = h('div.lyrics-lines');
  d.lines.forEach((l, i) => list.append(h('p', {
    dataset: { i },
    text: l.text || '♪',
    onclick: () => { media.currentTime = Math.max(0, l.t - getOffset(t.id) + 0.05); media.play().catch(() => {}); },
  })));
  el.append(list);
  el.scrollTop = 0;
  sync();
}

function sync() {
  if (!state.open || !state.lines.length || current()?.id !== state.trackId) return;
  const now = media.currentTime + getOffset(state.trackId);
  let i = -1;
  // Cari baris terakhir yang waktunya sudah lewat (pencarian biner)
  let lo = 0; let hi = state.lines.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (state.lines[mid].t <= now) { i = mid; lo = mid + 1; } else hi = mid - 1; }
  if (i === state.active) return;
  const list = box().querySelector('.lyrics-lines');
  if (!list) return;
  list.children[state.active]?.classList.remove('active');
  state.active = i;
  const p = list.children[i];
  if (!p) return;
  p.classList.add('active');
  // Jangan menggulir otomatis bila pengguna baru saja menggulir sendiri
  if (Date.now() - state.userScrollAt > 3500) {
    const el = box();
    el.scrollTo({ top: p.offsetTop - el.clientHeight / 2 + p.clientHeight / 2, behavior: 'smooth' });
  }
}

/* ---------- Teks Al-Qur'an untuk murottal ---------- */
const suratCache = new Map();
async function loadQuran(t, seq) {
  const el = box();
  el.append(h('p.lyrics-msg', { text: 'Memuat teks surat…' }));
  try {
    const n = t.quran.surat;
    if (!suratCache.has(n)) suratCache.set(n, await get(`/api/quran/surat/${n}`));
    if (seq !== state.seq) return;
    const s = suratCache.get(n);
    el.textContent = '';
    el.append(h('div.lyrics-head', {}, h('small', { text: `${s.namaLatin} · ${s.arti} · ${s.jumlahAyat} ayat — teks & terjemahan Kemenag RI` })));
    const list = h('div.ayat-list');
    s.ayat.forEach((a) => list.append(h(`div.ayat${t.quran.ayat === a.nomorAyat ? '.active' : ''}`, { dataset: { ayat: a.nomorAyat } },
      h('p.ar', { lang: 'ar', dir: 'rtl' }, a.teksArab, h('span.no', { text: ` ﴿${a.nomorAyat.toLocaleString('ar-EG')}﴾` })),
      h('p.lat', { text: a.teksLatin }),
      h('p.id', {}, h('b', { text: `${a.nomorAyat}. ` }), a.teksIndonesia))));
    el.append(list);
    const act = list.querySelector('.ayat.active');
    if (act) el.scrollTo({ top: act.offsetTop - 40 });
  } catch (e) {
    if (seq !== state.seq) return;
    el.textContent = '';
    el.append(h('p.lyrics-msg', { text: e.status === 0 ? 'Teks surat tidak dapat dilihat saat offline.' : e.message }));
  }
}

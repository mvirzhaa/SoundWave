/**
 * Pemutar TV (web): HLS lewat hls.js (Safari: native), YouTube Live lewat iframe.
 * Pengaman agar tidak "hang":
 *  - setiap pergantian saluran membatalkan pemuatan sebelumnya (nomor urut `seq`) dan menghancurkan instance hls.js;
 *  - batas waktu 15 detik per stream → otomatis mencoba stream cadangan berikutnya;
 *  - macet (buffering) > 20 detik saat menonton → sambung ulang otomatis satu kali;
 *  - permintaan ke server memakai batas waktu; overlay selalu bisa ditutup (Esc / tombol / tombol Kembali HP).
 */
import { h, icon, I, toast } from './ui.js';
import { get, apiUrl } from './api.js';
import { emit } from './store.js';

const CAT = { general: 'Umum', news: 'Berita', religious: 'Religi', entertainment: 'Hiburan', music: 'Musik', sports: 'Olahraga', kids: 'Anak', movies: 'Film', series: 'Serial', education: 'Edukasi', business: 'Bisnis', lifestyle: 'Gaya hidup', cooking: 'Kuliner', documentary: 'Dokumenter', culture: 'Budaya', travel: 'Wisata', science: 'Sains', comedy: 'Komedi', animation: 'Animasi', classic: 'Klasik', family: 'Keluarga', legislative: 'Parlemen', public: 'Publik', relax: 'Santai', shop: 'Belanja', weather: 'Cuaca', outdoor: 'Alam', auto: 'Otomotif', interactive: 'Interaktif' };
export const catName = (id) => CAT[id] || id;
const STREAM_TIMEOUT = 15000;
const STALL_TIMEOUT = 20000;
const secure = location.protocol === 'https:';

let hlsLib = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLib) return hlsLib;
  hlsLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = apiUrl('/vendor/hls.min.js');
    s.onload = () => resolve(window.Hls);
    s.onerror = () => { hlsLib = null; reject(new Error('Pemutar HLS gagal dimuat.')); };
    document.head.append(s);
  });
  return hlsLib;
}

const nativeHls = () => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
const isHlsUrl = (u) => /\.m3u8(\?|$)|\/hls\/|m3u8/i.test(u);

/** Saluran → stream yang mungkin diputar di halaman ini (http diblokir browser di halaman https). */
export const playableStreams = (it) => (it.streams || []).filter((s) => !(secure && /^http:/i.test(s.u)));

let ui = null; // elemen overlay yang sedang terbuka
let ctx = null; // { list, index, opts }
let seq = 0;
let hls = null;
let timer = null;
let stallTimer = null;
let ytListen = null;

function teardown() {
  clearTimeout(timer); clearTimeout(stallTimer); timer = stallTimer = null;
  if (ytListen) { window.removeEventListener('message', ytListen); ytListen = null; }
  if (hls) { try { hls.destroy(); } catch { /* abaikan */ } hls = null; }
  if (!ui) return;
  const v = ui.video;
  try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* abaikan */ }
  v.hidden = true;
  if (ui.frame) { ui.frame.src = 'about:blank'; ui.frame.remove(); ui.frame = null; }
}

function status(text, { spin = true, actions = [] } = {}) {
  if (!ui) return;
  ui.status.hidden = !text;
  ui.status.textContent = '';
  if (!text) return;
  ui.status.append(spin ? h('span.tvp-spin', { 'aria-hidden': 'true' }) : h('span.tvp-warn', {}, icon('M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z')),
    h('p', { text }), actions.length ? h('div.tvp-actions', {}, actions) : null);
}

const btn = (label, onclick, primary = false) => h(primary ? 'button.btn-primary.sm' : 'button.btn.sm', { type: 'button', text: label, onclick });

function failed(msg, it) {
  const acts = [btn('Coba lagi', () => play(ctx.index), true)];
  if (ctx.list.length > 1) acts.push(btn('Saluran berikutnya', () => step(1)));
  if (it?.ytPage) acts.push(btn('Buka di YouTube', () => window.open(it.ytPage, '_blank', 'noopener')));
  status(msg, { spin: false, actions: acts });
  ui?.root.classList.remove('is-playing');
}

/* ---------------- HLS / file video ---------------- */
async function playStreams(it, my) {
  const streams = playableStreams(it);
  if (!streams.length) {
    return failed(it.streams?.length
      ? 'Saluran ini hanya tersedia lewat http, yang diblokir browser di halaman https. Buka lewat aplikasi HP SoundWave.'
      : 'Saluran ini tidak punya alamat siaran.', it);
  }
  const v = ui.video;
  v.hidden = false;
  let i = Math.min(it._ok || 0, streams.length - 1);

  const tryNext = (why) => {
    if (my !== seq) return;
    i += 1;
    if (i >= streams.length) {
      return failed(why === 'timeout'
        ? 'Saluran tidak merespons. Siaran mungkin sedang off-air atau dibatasi wilayah.'
        : 'Siaran tidak dapat diputar saat ini.', it);
    }
    start();
  };

  const start = async () => {
    if (my !== seq) return;
    clearTimeout(timer);
    if (hls) { try { hls.destroy(); } catch { /* abaikan */ } hls = null; }
    const s = streams[i];
    status(streams.length > 1 && i > 0 ? `Mencoba sumber cadangan ${i + 1}/${streams.length}…` : 'Menyambungkan…');
    timer = setTimeout(() => tryNext('timeout'), STREAM_TIMEOUT);
    try {
      if (isHlsUrl(s.u) && !nativeHls()) {
        const Hls = await loadHls();
        if (my !== seq) return;
        if (!Hls.isSupported()) throw new Error('Browser ini tidak mendukung siaran HLS.');
        hls = new Hls({
          manifestLoadingTimeOut: 10000, manifestLoadingMaxRetry: 1,
          levelLoadingTimeOut: 10000, levelLoadingMaxRetry: 2,
          fragLoadingTimeOut: 20000, fragLoadingMaxRetry: 3,
          maxBufferLength: 30, backBufferLength: 30, enableWorker: true,
        });
        let recovered = false;
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal || my !== seq) return;
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
          tryNext('error');
        });
        hls.loadSource(s.u);
        hls.attachMedia(v);
      } else {
        v.src = s.u;
      }
      await v.play().catch((e) => {
        if (e?.name === 'NotAllowedError' && my === seq) {
          clearTimeout(timer);
          status('Ketuk untuk memutar', { spin: false, actions: [btn('Putar', () => { v.play().catch(() => {}); status(''); }, true)] });
        }
      });
    } catch (e) {
      if (my === seq) { clearTimeout(timer); failed(e.message, it); }
    }
  };

  v.onplaying = () => {
    if (my !== seq) return;
    clearTimeout(timer); clearTimeout(stallTimer);
    it._ok = i; // ingat sumber yang berhasil untuk "Coba lagi"
    status('');
    ui.root.classList.add('is-playing');
    updatePlayBtn();
  };
  v.onwaiting = () => {
    if (my !== seq) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (my !== seq) return;
      status('Sinyal lemah — menyambung ulang…');
      start();
    }, STALL_TIMEOUT);
  };
  v.onerror = () => { if (my === seq && !hls) tryNext('error'); };
  v.onpause = v.onplay = updatePlayBtn;
  start();
}

/* ---------------- YouTube Live ---------------- */
async function playYoutube(it, my) {
  status('Mencari siaran langsung…');
  let r;
  try {
    r = await get(`/api/tv/yt/${encodeURIComponent(it.id)}`, { signal: AbortSignal.timeout(35000) });
  } catch (e) {
    if (my !== seq) return;
    return failed(e.name === 'TimeoutError' ? 'Server terlalu lama mencari siaran YouTube. Coba lagi.' : e.message, it);
  }
  if (my !== seq) return;
  const f = h('iframe.tvp-frame', {
    src: `https://www.youtube-nocookie.com/embed/${r.videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`,
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin', title: it.name,
  });
  ui.frame = f;
  ui.stage.append(f);
  status('Memuat pemutar YouTube…');
  // Status & galat dari player YouTube (tanpa memuat skrip API YouTube)
  const listen = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch { /* abaikan */ } };
  f.addEventListener('load', () => { listen(); setTimeout(listen, 800); timer = setTimeout(() => { if (my === seq) status(''); }, 4000); });
  ytListen = (e) => {
    if (my !== seq || e.source !== f.contentWindow) return;
    let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (d?.event === 'onError') {
      failed([101, 150, 152, 153].includes(Number(d.info))
        ? 'Pemilik siaran tidak mengizinkan diputar di luar YouTube.'
        : 'Siaran YouTube tidak dapat diputar.', it);
    } else if (d?.event === 'onReady' || (d?.event === 'infoDelivery' && d.info?.playerState === 1) || (d?.event === 'onStateChange' && d.info === 1)) {
      clearTimeout(timer); status(''); ui.root.classList.add('is-playing');
    }
  };
  window.addEventListener('message', ytListen);
}

/* ---------------- Kontrol ---------------- */
function play(index) {
  if (!ui || !ctx) return;
  const my = ++seq;
  teardown();
  ctx.index = (index + ctx.list.length) % ctx.list.length;
  const it = ctx.list[ctx.index];
  ui.root.classList.remove('is-playing');
  ui.root.classList.toggle('is-yt', it.kind === 'youtube');
  ui.logo.textContent = '';
  ui.logo.append(logoEl(it));
  ui.title.textContent = it.name;
  ui.sub.textContent = [it.official ? (it.kind === 'youtube' ? 'YouTube Live resmi' : 'Saluran pilihan') : '', it.m3u ? `Link: ${it.m3u}` : '', ...(it.cats || []).map(catName), it.q].filter(Boolean).join(' · ');
  ui.pos.textContent = ctx.list.length > 1 ? `${ctx.index + 1}/${ctx.list.length}` : '';
  updateFav();
  drawList();
  emit('preview:start'); // jeda musik/radio yang sedang diputar
  ctx.opts.onPlay?.(it);
  if (it.kind === 'youtube') playYoutube(it, my); else playStreams(it, my);
}
const step = (d) => { if (ctx && ctx.list.length > 1) play(ctx.index + d); };

function updatePlayBtn() { /* kontrol bawaan <video> */ }

/** Daftar saluran di bawah video (HP) untuk berpindah cepat tanpa menutup pemutar. */
function drawList() {
  if (!ui || !ctx) return;
  const box = ui.root.querySelector('.tvp-list');
  if (ctx.list.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  if (box.dataset.n !== String(ctx.list.length)) {
    box.textContent = '';
    box.dataset.n = String(ctx.list.length);
    const frag = document.createDocumentFragment();
    ctx.list.forEach((it, i) => frag.append(h('button.tvp-item', { type: 'button', role: 'listitem', onclick: () => play(i) },
      h('span.tvp-ilogo', {}, logoEl(it)), h('span.tvp-iname', { text: it.name }),
      h('small', { text: (it.cats || []).map(catName).slice(0, 1).join('') }))));
    box.append(frag);
  }
  [...box.children].forEach((b, i) => { const on = i === ctx.index; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  box.children[ctx.index]?.scrollIntoView({ block: 'nearest' });
}
function updateFav() {
  if (!ui || !ctx) return;
  const it = ctx.list[ctx.index];
  const on = ctx.opts.isFav?.(it);
  ui.favBtn.setAttribute('aria-pressed', String(Boolean(on)));
  ui.favBtn.setAttribute('aria-label', on ? 'Hapus dari favorit' : 'Tambah ke favorit');
}

export function logoEl(it) {
  const initials = it.name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'TV';
  let hue = 0; for (const c of it.name) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const fb = h('span.tv-initials', { text: initials, style: `--h:${hue}` });
  if (!it.logo) return fb;
  const img = h('img', { src: it.logo, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(fb), { once: true });
  return img;
}

function onKey(e) {
  if (!ui) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); closeTv(); }
  else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); step(1); }
  else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); step(-1); }
  else if (k === ' ' && !ui.root.classList.contains('is-yt')) { e.preventDefault(); ui.video.paused ? ui.video.play().catch(() => {}) : ui.video.pause(); }
  else if (k === 'f') { e.preventDefault(); fullscreen(); }
  else return;
  e.stopImmediatePropagation(); // jangan sampai ikut mengendalikan pemutar musik
}

function fullscreen() {
  const el = ui?.stage;
  if (!el) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else (el.requestFullscreen?.() || ui.video.webkitEnterFullscreen?.())?.catch?.(() => {});
}

const onPop = () => { if (ui) closeTv(true); };
const onMusicPlay = () => { if (ui && !ui.video.paused) ui.video.pause(); };

/** Buka pemutar TV untuk `list[index]`. opts: { isFav(it), toggleFav(it), onPlay(it) } */
export function openTv(list, index, opts = {}) {
  if (!ui) build();
  ctx = { list, index, opts };
  play(index);
}

export function closeTv(fromPop = false) {
  if (!ui) return;
  ++seq;
  teardown();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const { root, prevFocus } = ui;
  ui = null; ctx = null;
  root.remove();
  document.body.classList.remove('tv-open');
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('popstate', onPop);
  document.getElementById('media')?.removeEventListener('play', onMusicPlay);
  if (!fromPop && history.state?.tv) history.back();
  prevFocus?.focus?.({ preventScroll: true });
}

export const tvRefreshFav = updateFav;

function build() {
  const video = h('video.tvp-video', { playsinline: true, controls: true, preload: 'none', hidden: true });
  const stage = h('div.tvp-stage', {}, video, h('div.tvp-status', { role: 'status', 'aria-live': 'polite', hidden: true }));
  const playBtn = h('span.tvp-play'); // kontrol putar/jeda memakai kontrol bawaan <video>
  const favBtn = h('button.icon-btn.heart', { type: 'button', onclick: async () => {
    const it = ctx?.list[ctx.index]; if (!it || !ctx.opts.toggleFav) return;
    try { const on = await ctx.opts.toggleFav(it); toast(on ? `${it.name} ditambahkan ke favorit` : `${it.name} dihapus dari favorit`); updateFav(); } catch (e) { toast(e.message, { type: 'error' }); }
  } }, icon(I.heart));
  const root = h('div.tvp', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pemutar TV' },
    h('div.tvp-box', {},
      h('div.tvp-head', {},
        h('span.tvp-logo'),
        h('div.tvp-text', {}, h('b.tvp-title'), h('small.tvp-sub')),
        favBtn,
        h('button.icon-btn', { type: 'button', 'aria-label': 'Tutup TV', onclick: () => closeTv() }, icon('M6 6l12 12M18 6 6 18'))),
      stage,
      h('div.tvp-bar', {},
        h('button.icon-btn', { type: 'button', 'aria-label': 'Saluran sebelumnya', onclick: () => step(-1) }, icon([['M6 5h2v14H6zM20 5v14L9 12z', true]])),
        h('span.tvp-pos'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Saluran berikutnya', onclick: () => step(1) }, icon([['M16 5h2v14h-2zM4 5v14l11-7z', true]])),
        h('span.tvp-hint', { text: '← → pindah saluran · F layar penuh · Esc tutup' })),
      h('div.tvp-list', { role: 'list', 'aria-label': 'Saluran lain' })));
  ui = {
    root, video, stage, playBtn, favBtn,
    status: stage.querySelector('.tvp-status'),
    logo: root.querySelector('.tvp-logo'), title: root.querySelector('.tvp-title'), sub: root.querySelector('.tvp-sub'), pos: root.querySelector('.tvp-pos'),
    frame: null, prevFocus: document.activeElement,
  };
  root.addEventListener('click', (e) => { if (e.target === root) closeTv(); });
  document.body.append(root);
  document.body.classList.add('tv-open');
  document.addEventListener('keydown', onKey, true);
  // Tombol Kembali di HP menutup pemutar, bukan meninggalkan halaman
  history.pushState({ tv: 1 }, '');
  window.addEventListener('popstate', onPop);
  document.getElementById('media')?.addEventListener('play', onMusicPlay);
  updatePlayBtn();
  root.querySelector('.tvp-head .icon-btn:last-child').focus({ preventScroll: true });
}

window.addEventListener('hashchange', () => { if (ui) closeTv(true); });

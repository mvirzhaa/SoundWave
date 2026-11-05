/** Utilitas DOM & komponen UI kecil (toast, modal, menu aksi, sampul). */
import { coverUrl } from './local.js';

/** Buat elemen: h('div.card#id', { onclick, attrs... }, ...children). Teks selalu via textContent (aman XSS). */
export function h(spec, props = {}, ...children) {
  const [, tag = 'div', rest = ''] = spec.match(/^([a-z0-9-]+)?(.*)$/i);
  const el = document.createElement(tag || 'div');
  (rest.match(/[.#][^.#]+/g) || []).forEach((p) => (p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1))));
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/** SVG ikon dari path string. */
export function icon(paths, cls = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  for (const p of [].concat(paths)) {
    const [d, fill] = Array.isArray(p) ? p : [p, false];
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    if (fill) path.setAttribute('class', 'f');
    svg.appendChild(path);
  }
  return svg;
}

export const I = {
  play: [['M8 5v14l11-7z', true]],
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  more: [['M12 3.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 17.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z', true]],
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  note: 'M9 18V5l11-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  drag: [['M9 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM15 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM15 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 15.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM15 15.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', true]],
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14',
  cloud: 'M7 19a5 5 0 0 1-.6-9.96A6 6 0 0 1 17.8 8.5 4.5 4.5 0 0 1 17.5 19H7zM12 17v-6m-2.5 2.5L12 11l2.5 2.5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
};

export function fmtDur(s) {
  if (!s && s !== 0) return '';
  s = Math.max(0, Math.floor(s));
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
export const fmtSize = (b) => (b == null ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- Sampul ---------- */
function hue(str) { let x = 0; for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }

/** Isi elemen .cover dengan thumbnail YouTube, atau gradasi + ikon not musik. */
export function fillCover(el, track, { hq = false } = {}) {
  el.textContent = '';
  el.style.removeProperty('--h');
  const yt = track?.ytId;
  if (track?.quran) {
    // Sampul murottal: nomor surat di atas gradasi hijau
    el.classList.add('gen', 'quran-cover');
    el.append(h('span.qnum', { text: String(track.quran.surat || '') }));
    return el;
  }
  if (yt) {
    const img = h('img', { alt: '', loading: 'lazy', src: `https://i.ytimg.com/vi/${yt}/${hq ? 'hqdefault' : 'mqdefault'}.jpg` });
    img.onerror = () => { img.remove(); el.classList.add('gen'); el.append(icon(I.note)); };
    el.classList.remove('gen');
    el.append(img);
  } else {
    el.classList.add('gen');
    el.style.setProperty('--h', hue((track?.artist || '') + (track?.title || '')));
    el.append(icon(I.note));
    if (track?.local && track.hasPic) lazyLocalCover(el, track);
  }
  return el;
}

/* Sampul dari tag ID3 file lokal — dimuat saat elemen terlihat agar folder besar tetap ringan */
const pending = new WeakMap();
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    io.unobserve(en.target);
    const t = pending.get(en.target);
    if (t) showLocalCover(en.target, t);
  });
}, { rootMargin: '200px' }) : null;
function lazyLocalCover(el, track) {
  if (io) { pending.set(el, track); io.observe(el); } else showLocalCover(el, track);
}
async function showLocalCover(el, track) {
  const url = await coverUrl(track);
  if (!url || !el.isConnected) return;
  el.textContent = '';
  el.classList.remove('gen');
  el.classList.add('local-art');
  el.append(h('img', { alt: '', src: url }));
}
export const cover = (track, size = '', opts) => fillCover(h(`span.cover${size ? '.' + size : ''}`), track, opts);

/** Kolase 2x2 dari daftar ytId (untuk playlist). */
export function collage(ytIds, size = '', fallbackIcon = I.note) {
  const el = h(`span.cover.collage${size ? '.' + size : ''}`);
  const ids = (ytIds || []).slice(0, 4);
  if (ids.length >= 4) ids.forEach((id) => el.append(h('img', { alt: '', loading: 'lazy', src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` })));
  else if (ids.length) { el.classList.add('single'); el.append(h('img', { alt: '', loading: 'lazy', src: `https://i.ytimg.com/vi/${ids[0]}/mqdefault.jpg` })); }
  else { el.classList.add('gen'); el.append(icon(fallbackIcon)); }
  // Jika thumbnail gagal dimuat, ganti dengan sampul gradasi
  el.querySelectorAll('img').forEach((img) => { img.onerror = () => {
    img.remove();
    if (!el.querySelector('img')) { el.className = el.className.replace(/\bsingle\b/, '') + ' gen'; el.append(icon(fallbackIcon)); }
  }; });
  return el;
}

/* ---------- Toast ---------- */
let toastTimer;
export function toast(msg, { type = '', action } = {}) {
  const t = document.getElementById('toast');
  t.textContent = '';
  t.className = 'toast' + (type ? ' ' + type : '');
  t.append(h('span', { text: msg }));
  if (action) t.append(h('button.link', { text: action.label, onclick: () => { action.run(); t.hidden = true; } }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3200);
}

/* ---------- Overlay: modal & sheet ---------- */
let closeCurrent = null;
export function openOverlay(content, { sheet = false, onClose } = {}) {
  closeOverlay();
  const ov = document.getElementById('overlay');
  ov.textContent = '';
  const box = h(sheet ? 'div.sheet' : 'div.modal', { role: 'dialog', 'aria-modal': 'true' }, content);
  ov.append(box);
  ov.hidden = false;
  const close = () => { ov.hidden = true; ov.textContent = ''; document.removeEventListener('keydown', onKey); closeCurrent = null; onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.onclick = (e) => { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
  closeCurrent = close;
  requestAnimationFrame(() => box.querySelector('input, button')?.focus());
  return close;
}
export const closeOverlay = () => closeCurrent?.();

/** Menu aksi (bottom sheet di HP, kartu di desktop). items: [{label, icon, run, danger}] */
export function actionMenu(title, items, sub) {
  const list = h('div.menu-list');
  const close = openOverlay(h('div', {},
    title ? h('div.menu-head', {}, title instanceof Node ? title : h('b', { text: title }), sub ? h('small', { text: sub }) : null) : null,
    list), { sheet: true });
  items.filter(Boolean).forEach((it) => list.append(
    h(`button.menu-item${it.danger ? '.danger' : ''}`, { type: 'button', onclick: () => { close(); it.run(); } },
      it.icon ? icon(it.icon) : null, h('span', { text: it.label }))));
}

/** Dialog input teks. Mengembalikan Promise<string|null>. */
export function promptDialog(title, { value = '', placeholder = '', ok = 'Simpan' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { value, placeholder, maxlength: 100 });
    const form = h('form.dialog', {
      onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { done = true; close(); resolve(v); } },
    }, h('h3', { text: title }), input,
    h('div.dialog-actions', {}, h('button.btn', { type: 'button', text: 'Batal', onclick: () => close() }),
      h('button.btn-primary', { type: 'submit', text: ok })));
    const close = openOverlay(form, { onClose: () => { if (!done) resolve(null); } });
  });
}

export function confirmDialog(title, message, { ok = 'Ya', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = openOverlay(h('div.dialog', {}, h('h3', { text: title }), message ? h('p', { text: message }) : null,
      h('div.dialog-actions', {},
        h('button.btn', { type: 'button', text: 'Batal', onclick: () => close() }),
        h(`button.btn-primary${danger ? '.danger' : ''}`, { type: 'button', text: ok, onclick: () => { done = true; close(); resolve(true); } }))),
    { onClose: () => { if (!done) resolve(false); } });
  });
}

/** Animasi batang gelombang logo. */
export function fillBars(el, n = 19) {
  const hs = [18, 30, 46, 26, 58, 72, 50, 64, 36, 54, 70, 44, 28, 48, 62, 34, 22, 40, 16];
  el.textContent = '';
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    b.style.height = hs[i % hs.length] + 'px';
    b.style.animationDelay = i * 0.08 + 's';
    el.append(b);
  }
}

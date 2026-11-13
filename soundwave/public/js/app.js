/** Titik masuk aplikasi web: autentikasi, routing hash, tema. */
import { h, icon, fillBars, toast } from './ui.js';
import { get, post, onUnauthorized } from './api.js';
import { store, setUser, invalidateTracks, loadLocalFavorites } from './store.js';
import { initLocal } from './local.js';
import { initPlayer, restore as restorePlayer, reset as resetPlayer, closeFull } from './player.js';
import { renderSearch } from './views/search.js';
import { renderLibrary, renderPlaylist, renderGroup, trackMenu } from './views/library.js';
import { renderAccount } from './views/account.js';
import { renderSholat } from './views/sholat.js';
import { renderRadio } from './views/radio.js';
import { renderTv } from './views/tv.js';
import { loadRadioFav } from './radio.js';
import { startAnnouncements, stopAnnouncements } from './announce.js';
import { loadSholat, nextChipText } from './sholat.js';
import { on as onEvent } from './store.js';
import { openVoice } from './voice.js';

const $ = (id) => document.getElementById(id);
const authView = $('authView');
const appView = $('appView');
const view = $('view');

/* ---------- Tema ---------- */
const root = document.documentElement;
try { const t = localStorage.getItem('sw-theme'); if (t) root.dataset.theme = t; } catch { /* abaikan */ }
$('themeToggle').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('sw-theme', root.dataset.theme); } catch { /* abaikan */ }
});
document.querySelectorAll('[data-bars]').forEach((el) => fillBars(el, Number(el.dataset.bars)));

/* ---------- Tombol mikrofon (perintah suara) ---------- */
const micBtn = h('button.icon-btn.mic', { type: 'button', 'aria-label': 'Perintah suara', title: 'Perintah suara', onclick: openVoice },
  icon('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3'));
$('themeToggle').before(micBtn);

/* ---------- Autentikasi ---------- */
let mode = 'login';
const form = $('authForm');
const authErr = $('authErr');

function setMode(m) {
  mode = m;
  document.querySelectorAll('.auth-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  form.querySelectorAll('[data-only="register"]').forEach((el) => { el.hidden = m !== 'register'; });
  form.password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('authSubmit').textContent = m === 'register' ? 'Buat akun' : 'Masuk';
  authErr.hidden = true;
}
document.querySelectorAll('.auth-tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
setMode('login');

get('/api/auth/config').then((c) => {
  if (!c.registration) document.querySelector('.auth-tabs [data-mode="register"]').hidden = true;
  if (c.emailDomains?.length) form.email.placeholder = `nama@${c.emailDomains[0]}`;
}).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  authErr.hidden = true;
  const btn = $('authSubmit');
  btn.disabled = true;
  try {
    const body = { email: form.email.value, password: form.password.value };
    if (mode === 'register') body.name = form.name.value;
    const r = await post(`/api/auth/${mode}`, body);
    form.password.value = '';
    enterApp(r.user);
  } catch (err) {
    authErr.textContent = err.message;
    authErr.hidden = false;
  } finally { btn.disabled = false; }
});

function showAuth() {
  appView.hidden = true;
  authView.hidden = false;
  document.body.classList.remove('has-mini');
  form.email.focus();
}

let playerReady = false;
function enterApp(user) {
  setUser(user);
  authView.hidden = true;
  appView.hidden = false;
  if (!playerReady) { initPlayer({ trackMenu }); playerReady = true; }
  restorePlayer();
  initLocal().catch(() => {});
  loadSholat();
  loadRadioFav();
  startAnnouncements();
  loadLocalFavorites();
  route();
}

async function logout(all) {
  try { await post(all ? '/api/auth/logout-all' : '/api/auth/logout'); } catch { /* abaikan */ }
  resetPlayer();
  stopAnnouncements();
  store.user = null;
  invalidateTracks();
  showAuth();
  toast(all ? 'Keluar dari semua perangkat.' : 'Anda sudah keluar.');
}
onUnauthorized(() => { if (store.user) { store.user = null; resetPlayer(); showAuth(); toast('Sesi berakhir. Silakan masuk lagi.'); } });

/* ---------- Routing ---------- */
let cleanup = null;
function route() {
  if (!store.user) return;
  const raw = location.hash.slice(1) || '/pustaka';
  const [path, qs = ''] = raw.split('?');
  const params = new URLSearchParams(qs);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const section = parts[0] || 'pustaka';

  cleanup?.(); cleanup = null;
  closeFull();
  view.textContent = '';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === section || (a.dataset.nav === 'pustaka' && ['playlist', 'artis', 'genre'].includes(section))
      || (a.dataset.nav === 'akun' && section === 'sholat'); // Sholat kini bagian dari menu Akun
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  let r;
  switch (section) {
    case 'pustaka': r = renderLibrary(view, params); break;
    case 'playlist': r = renderPlaylist(view, parts[1]); break;
    case 'artis': case 'genre': r = renderGroup(view, section, parts[1] || ''); break;
    case 'akun': renderAccount(view, params, { logout }); break;
    case 'sholat': r = renderSholat(view); break;
    case 'radio': r = renderRadio(view); break;
    case 'tv': r = renderTv(view); break;
    default: renderSearch(view, params);
  }
  Promise.resolve(r).then((fn) => { if (typeof fn === 'function') cleanup = fn; });
  if (!document.title.includes('·')) document.title = 'SoundWave';
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------- Mulai ---------- */
get('/api/auth/me').then((r) => enterApp(r.user)).catch(() => showAuth());

/* ---------- Chip waktu sholat berikutnya ---------- */
const chip = document.getElementById('nextChip');
const updateChip = () => { const t = nextChipText(); chip.hidden = !t; chip.textContent = t; };
onEvent('sholat:tick', updateChip);
onEvent('sholat', updateChip);

/* Koneksi terputus / kembali: beri tahu fitur apa saja yang butuh internet */
window.addEventListener('offline', () => toast('Sedang offline — radio, TV, lirik, pencarian, dan lagu dari Drive tidak bisa dimuat.', { type: 'error' }));
window.addEventListener('online', () => toast('Kembali online.'));

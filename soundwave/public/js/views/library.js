/** Pustaka: sumber Google Drive / folder lokal / semua — tab Lagu, Playlist, Artis, Genre. */
import { h, icon, I, cover, collage, fmtDur, toast, actionMenu, promptDialog, confirmDialog, clearable, openOverlay } from '../ui.js';
import { get, post, put, patch, del } from '../api.js';
import { store, on, loadTracks, driveReady, toggleFavorite } from '../store.js';
import { playList, playNext, addToQueue, current } from '../player.js';
import { savePrefs as saveSholatPrefs, sholat as sholatState } from '../sholat.js';
import { isFavRadio, toggleRadioFav } from '../radio.js';
import { localState, fsaSupported, pickFolder, reconnect, rescan, forgetFolder, setLocalGenre, localById } from '../local.js';

const TABS = [['lagu', 'Lagu'], ['playlist', 'Playlist'], ['artis', 'Artis'], ['genre', 'Genre']];
const SORTS = { baru: 'Terbaru', lama: 'Terlama', judul: 'Judul A–Z', judulza: 'Judul Z–A', artis: 'Artis A–Z' };
let ui = { tab: 'lagu', filter: '', sort: 'baru', source: 'semua', plView: 'kartu' };
try { Object.assign(ui, JSON.parse(localStorage.getItem('sw-lib-ui') || '{}'), { filter: '' }); } catch { /* abaikan */ }
const saveUi = () => { try { localStorage.setItem('sw-lib-ui', JSON.stringify({ tab: ui.tab, sort: ui.sort, source: ui.source, plView: ui.plView })); } catch { /* abaikan */ } };

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const byTitle = (a, b) => a.title.localeCompare(b.title, 'id');

/* ================= Penanda playlist ================= */

/** Lagu mana sudah masuk playlist mana (untuk lingkaran inisial di Pustaka). */
const member = { pls: new Map(), map: {}, seq: 0 };
export async function loadMembership() {
  const my = ++member.seq;
  try {
    const r = await get('/api/library/playlists/membership');
    if (my !== member.seq) return;
    member.pls = new Map(r.playlists.map((p) => [p.id, p]));
    member.map = r.map;
    document.querySelectorAll('.track[data-id] .pl-dots').forEach((el) => el.replaceWith(plDots(el.closest('.track').dataset.id)));
  } catch { /* penanda bersifat tambahan; abaikan bila gagal */ }
}

function plDots(id) {
  const pls = (member.map[id] || []).map((pid) => member.pls.get(pid)).filter(Boolean);
  const box = h('span.pl-dots');
  if (!pls.length) return box;
  const names = pls.map((p) => p.name).join(', ');
  box.title = `Ada di playlist: ${names}`;
  box.setAttribute('aria-label', `Ada di playlist: ${names}`);
  box.setAttribute('role', 'img');
  const shown = pls.length > 3 ? pls.slice(0, 2) : pls;
  shown.forEach((p) => box.append(h('span.pl-dot', { text: p.initials, style: `--h:${p.hue}`, 'aria-hidden': 'true' })));
  if (pls.length > 3) box.append(h('span.pl-dot.more', { text: `+${pls.length - 2}`, 'aria-hidden': 'true' }));
  return box;
}

/* ================= Komponen ================= */

/** Baris lagu. ctx: { list, index, source, playlist, onChange } */
function trackRow(t, i, ctx) {
  const playing = current()?.id === t.id;
  const row = h(`div.track${playing ? '.now' : ''}${t.available === false ? '.missing' : ''}`, {
    role: 'button', tabindex: 0, dataset: { id: t.id },
    onclick: (e) => { if (e.target.closest('.track-more, .drag')) return; play(); },
    onkeydown: (e) => { if (e.key === 'Enter') play(); },
  },
  ctx.draggable ? h('span.drag', { 'aria-hidden': 'true' }, icon(I.drag)) : null,
  cover(t, 'sm'),
  h('span.track-text', {},
    h('b', {}, t.title, t.isVideo ? h('span.badge', { text: 'MP4' }) : null, ctx.showSource && t.local ? h('span.badge.local', { text: 'LOKAL' }) : null),
    h('small', { text: [t.artist, fmtDur(t.duration), t.available === false ? (t.local ? 'tidak ada di folder lokal ini' : 'tidak ada di Drive') : ''].filter(Boolean).join(' · ') })),
  ctx.playlist || t.quran ? null : plDots(t.id),
  store.favorites.has(t.id) ? h('span.fav-dot', { 'aria-label': 'Favorit' }, icon(I.heart)) : null,
  h('button.icon-btn.track-more', { type: 'button', 'aria-label': 'Menu lagu', onclick: () => trackMenu(t, { ...ctx, index: i }) }, icon(I.more)));
  function play() {
    if (t.available === false) return toast(t.local ? 'File ini tidak ada di folder lokal yang sedang dibuka.' : 'File ini sudah tidak ada di Drive.');
    playList(ctx.list, i, { source: ctx.source });
  }
  return row;
}

function trackList(tracks, ctx) {
  const box = h('div.tracks');
  const frag = document.createDocumentFragment();
  tracks.forEach((t, i) => frag.append(trackRow(t, i, { ...ctx, list: tracks })));
  box.append(frag);
  return box;
}

/** Menu aksi untuk satu lagu (dipakai juga oleh pemutar penuh). */
export function trackMenu(t, ctx = {}) {
  if (t.radio) return radioMenu(t);
  const fav = store.favorites.has(t.id);
  const pl = ctx.playlist && !ctx.playlist.special ? ctx.playlist : null;
  actionMenu(h('span.menu-track', {}, cover(t, 'sm'), h('span', {}, h('b', { text: t.title }), h('small', { text: t.artist }))), [
    !ctx.fromPlayer && { label: 'Putar berikutnya', icon: 'M4 6h12M4 12h12M4 18h8M18 15v6l4-3z', run: () => playNext(t) },
    !ctx.fromPlayer && { label: 'Tambah ke antrean', icon: I.plus, run: () => addToQueue(t) },
    { label: 'Tambah ke playlist…', icon: 'M4 6h12M4 12h12M4 18h7M17 15v6M14 18h6', run: () => addToPlaylistMenu([t]) },
    { label: fav ? 'Hapus dari Favorit' : 'Tambah ke Favorit', icon: I.heart, run: async () => {
      try { const f = await toggleFavorite(t); toast(f ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit'); ctx.onChange?.(); } catch (e) { toast(e.message, { type: 'error' }); }
    } },
    !t.quran && t.artist && t.artist !== 'Tidak diketahui' && { label: `Lihat artis: ${t.artist}`, icon: I.user, run: () => { location.hash = '#/artis/' + encodeURIComponent(t.artist); } },
    t.quran && !t.quran.ayat && { label: 'Ulangi / hafalan…', icon: 'M4 6h16M4 10h10M4 14h12M17 17l2 2 3-4', run: () => hafalanMenu(t) },
    t.quran?.ayat ? { label: 'Hafalan mulai dari ayat ini…', icon: 'M4 6h10M4 12h16M4 18h7', run: () => hafalanRange(t, t.quran.ayat) } : null,
    !t.local && !t.quran && !store.user?.drive?.readOnly && { label: 'Ganti nama…', icon: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', run: () => renameTrack(t, ctx) },
    !t.quran && { label: `Ubah genre${t.genre ? ` (${t.genre})` : ''}`, icon: 'M4 7h16M4 12h10M4 17h6', run: () => editGenre(t, ctx) },
    !t.quran && !sholatState.global?.paksa && { label: 'Jadikan suara adzan', icon: 'M12 3c3 2 5 4.5 5 8H7c0-3.5 2-6 5-8zM5 11h14v10H5z', run: async () => {
      try { await saveSholatPrefs({ sholat: { adzan: { suara: { jenis: 'lagu', id: t.id, title: t.title, local: Boolean(t.local) } } } }); toast(`“${t.title}” dipakai sebagai suara adzan`); } catch (e) { toast(e.message, { type: 'error' }); }
    } },
    pl && ctx.index > 0 && { label: 'Naikkan', icon: 'M12 19V5M6 11l6-6 6 6', run: () => move(pl, ctx.index, -1, ctx) },
    pl && ctx.index < ctx.list.length - 1 && { label: 'Turunkan', icon: 'M12 5v14M6 13l6 6 6-6', run: () => move(pl, ctx.index, 1, ctx) },
    pl && { label: `Hapus dari “${pl.name}”`, icon: 'M5 12h14', run: async () => {
      await del(`/api/library/playlists/${pl.id}/items/${t.itemId}`).catch((e) => toast(e.message, { type: 'error' }));
      loadMembership();
      ctx.onChange?.();
    } },
    t.local && t.path && { label: `Lokasi: ${t.path}`, icon: 'M3 7h6l2 2h10v10H3z', run: () => toast(t.path) },
    !t.local && !t.quran && { label: 'Buka di Google Drive', icon: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', run: () => window.open(`https://drive.google.com/file/d/${t.id}/view`, '_blank', 'noopener') },
    !t.local && !t.quran && !store.user?.drive?.readOnly && { label: 'Hapus dari Google Drive', icon: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', danger: true, run: async () => {
      if (!(await confirmDialog('Hapus dari Google Drive?', `“${t.name || t.title}” akan dipindahkan ke Sampah Google Drive.`, { ok: 'Pindahkan ke Sampah', danger: true }))) return;
      try {
        await del(`/api/library/tracks/${t.id}`);
        store.tracks = store.tracks?.filter((x) => x.id !== t.id) || null;
        toast('Dipindahkan ke Sampah Google Drive'); ctx.onChange?.();
      } catch (e) { toast(e.message, { type: 'error' }); }
    } },
  ], null);
}

async function renameTrack(t, ctx) {
  const cur = (t.name || t.title || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '');
  const v = await promptDialog('Ganti nama lagu', { value: cur, placeholder: 'mis. Natalie Imbruglia - Torn', ok: 'Ganti nama' });
  if (v == null || !v.trim() || v.trim() === cur) return;
  try {
    const { track } = await patch(`/api/library/tracks/${t.id}`, { name: v.trim() });
    const upd = { name: track.name, title: track.title, artist: track.artist };
    store.tracks?.forEach((x) => { if (x.id === t.id) Object.assign(x, upd); });
    Object.assign(t, upd);
    toast(`Nama diganti menjadi “${track.name}”`); ctx.onChange?.();
  } catch (e) { toast(e.message, { type: 'error' }); }
}

async function editGenre(t, ctx) {
  const g = await promptDialog('Genre lagu', { value: t.genre || '', placeholder: 'mis. Pop, Rock, Dangdut, Jazz' });
  if (g == null) return;
  if (t.local) {
    setLocalGenre(t.id, g.trim());
    t.genre = g.trim() || t.tagGenre || null;
    toast(`Genre diubah menjadi ${t.genre || '—'}`); ctx.onChange?.();
    return;
  }
  try {
    const { genre } = await put(`/api/library/tracks/${t.id}/genre`, { genre: g });
    store.tracks?.forEach((x) => { if (x.id === t.id) x.genre = genre; });
    t.genre = genre;
    toast(`Genre diubah menjadi ${genre || '—'}`); ctx.onChange?.();
  } catch (e) { toast(e.message, { type: 'error' }); }
}

async function move(pl, index, dir, ctx) {
  const ids = ctx.list.map((x) => x.itemId);
  const [it] = ids.splice(index, 1);
  ids.splice(index + dir, 0, it);
  await put(`/api/library/playlists/${pl.id}/order`, { itemIds: ids }).catch((e) => toast(e.message, { type: 'error' }));
  ctx.onChange?.();
}

/** Pilih playlist tujuan (atau buat baru) untuk sejumlah lagu. */
export async function addToPlaylistMenu(tracks, done) {
  let data;
  try { data = await get('/api/library/playlists'); } catch (e) { return toast(e.message, { type: 'error' }); }
  const add = async (p) => {
    try {
      const r = await post(`/api/library/playlists/${p.id}/items`, { tracks });
      loadMembership();
      if (tracks.length > 1) toast(r.added ? `${r.added} lagu ditambahkan ke “${p.name}”${r.skipped ? ` (${r.skipped} sudah ada)` : ''}` : `Semua lagu sudah ada di “${p.name}”`);
      else toast(r.added ? `Ditambahkan ke “${p.name}”` : `Sudah ada di “${p.name}”`);
      done?.();
    } catch (e) { toast(e.message, { type: 'error' }); }
  };
  actionMenu('Tambah ke playlist', [
    { label: 'Playlist baru…', icon: I.plus, run: async () => {
      const name = await promptDialog('Playlist baru', { placeholder: 'Nama playlist', ok: 'Buat' });
      if (!name) return;
      try { const p = await post('/api/library/playlists', { name }); await add(p); } catch (e) { toast(e.message, { type: 'error' }); }
    } },
    ...data.playlists.map((p) => ({ label: `${p.name} (${p.count})`, icon: I.note, run: () => add(p) })),
  ], tracks.length > 1 ? `${tracks.length} lagu` : tracks[0]?.title);
}

/** Pesan kosong / ajakan menghubungkan Drive. */
function driveGate() {
  const d = store.user?.drive;
  if (d?.ready) return null;
  if (!d?.configured && !d?.linkAvailable) return emptyState('Google Drive belum diaktifkan', 'Admin server perlu mengisi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET (login Google) atau GOOGLE_API_KEY (link folder).', null);
  if (!d.connected && d.mode !== 'link') return emptyState('Hubungkan Google Drive', 'Tempel link folder Drive publik, atau login Google untuk sekaligus menyimpan hasil unduhan.', ['Atur di menu Akun', '#/akun']);
  return emptyState('Atur folder Drive', 'Pilih folder Google Drive tempat lagu Anda disimpan.', ['Atur folder', '#/akun']);
}
function emptyState(title, text, cta) {
  return h('div.empty', {}, h('span.empty-ico', {}, icon(I.note)), h('h3', { text: title }), h('p', { text }),
    cta ? h('a.btn-primary', { href: cta[1], text: cta[0] }) : null);
}

/* ================= Halaman Pustaka ================= */

const SOURCES = [['semua', 'Semua'], ['drive', 'Google Drive'], ['lokal', 'Folder lokal']];
const addedAt = (t) => (t.createdTime ? Date.parse(t.createdTime) : t.added || 0);

/** Lagu dari sumber terpilih (null = Drive masih dimuat). */
function sourceTracks(src) {
  const drive = driveReady() ? store.tracks : [];
  const loc = store.localTracks || [];
  if (src === 'drive') return drive;
  if (src === 'lokal') return loc;
  return drive === null ? null : [...drive, ...loc];
}

/** Panel status folder lokal (pilih folder, izinkan akses, progres pindai). */
function localPanel(compact) {
  const st = localState;
  const wrap = h('div.local-panel');
  const act = (label, fn, primary) => h(primary ? 'button.btn-primary' : 'button.btn', {
    type: 'button', text: label,
    onclick: async () => { try { await fn(); } catch (e) { toast(e.message, { type: 'error' }); } },
  });
  if (st.status === 'none') {
    if (compact) {
      wrap.append(h('span.muted', { text: 'Punya musik di komputer?' }), act('Tambah folder lokal', pickFolder));
    } else {
      wrap.classList.add('big');
      wrap.append(
        h('span.empty-ico', {}, icon('M3 7h6l2 2h10v10H3z')),
        h('h3', { text: 'Putar musik dari folder di komputer' }),
        h('p.muted', { text: 'Pilih folder musik (mis. D:\\Musik). File tetap di komputer Anda — tidak diunggah ke server. Subfolder ikut dibaca, beserta judul, artis, album, genre, dan sampul dari tag MP3.' }),
        act('Pilih folder musik', pickFolder, true),
        fsaSupported ? null : h('p.hint', { text: 'Browser ini tidak bisa mengingat folder, jadi perlu dipilih ulang setiap membuka SoundWave. Gunakan Chrome atau Edge agar folder diingat.' }));
    }
  } else if (st.status === 'need-permission') {
    wrap.append(h('span', {}, 'Folder ', h('b', { text: `“${st.folderName}”` }), ' tersimpan. Browser meminta izin akses lagi.'),
      act('Izinkan akses', reconnect, true), act('Ganti folder', pickFolder));
  } else if (st.status === 'scanning') {
    const pct = st.progress.total ? Math.round((st.progress.done / st.progress.total) * 100) : 0;
    wrap.append(h('span', {}, 'Memindai ', h('b', { text: st.folderName }), ` … ${st.progress.done}/${st.progress.total || '?'}`),
      (() => { const i = h('i'); i.style.width = `${pct}%`; return h('div.bar.grow', {}, i); })());
  } else if (st.status === 'error') {
    wrap.append(h('span.err', { text: `Gagal membaca folder: ${st.error}` }), act('Pilih folder lain', pickFolder));
  } else {
    wrap.append(
      h('span.local-name', {}, icon('M3 7h6l2 2h10v10H3z'), h('b', { text: st.folderName }), h('small', { text: ` · ${store.localTracks?.length || 0} lagu` })),
      h('span.btn-row', {}, act('Pindai ulang', rescan), act('Ganti folder', pickFolder),
        h('button.link.danger', { type: 'button', text: 'Lupakan', onclick: async () => {
          if (await confirmDialog('Lupakan folder lokal?', 'SoundWave berhenti membaca folder ini. File Anda tidak dihapus.', { ok: 'Lupakan' })) forgetFolder();
        } })));
  }
  return wrap;
}

export async function renderLibrary(view, params) {
  loadMembership(); // penanda playlist selalu segar saat Pustaka dibuka
  if (params.get('tab')) ui.tab = params.get('tab');
  if (params.get('sumber')) ui.source = params.get('sumber');
  const page = h('section.page');
  view.append(page);

  const refreshBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Muat ulang', title: 'Muat ulang' }, icon(I.refresh));
  page.append(h('div.lib-head', {}, h('div', {}, h('h2', { text: 'Pustaka' })), refreshBtn));
  const sources = h('div.sources', { role: 'radiogroup', 'aria-label': 'Sumber musik' });
  const status = h('div');
  const tabs = h('div.tabs', { role: 'tablist' });
  const filter = h('input.filter', { type: 'search', placeholder: 'Cari di pustaka…', value: ui.filter });
  const sortSel = h('select.sort', { 'aria-label': 'Urutkan' }, Object.entries(SORTS).map(([k, v]) => h('option', { value: k, text: v, selected: ui.sort === k })));
  const tools = h('div.lib-tools', {}, clearable(filter), sortSel);
  const body = h('div.lib-body');
  const fab = h('button.fab', { type: 'button', 'aria-label': 'Putar acak semua' }, icon(I.shuffle), h('span', { text: 'Acak' }));
  page.append(sources, status, tabs, tools, body, fab);

  SOURCES.forEach(([k, label]) => sources.append(h('button.chip-src', {
    type: 'button', role: 'radio', 'aria-checked': String(ui.source === k), text: label,
    onclick: () => { ui.source = k; saveUi(); sources.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.textContent === label))); draw(); },
  })));
  TABS.forEach(([k, label]) => tabs.append(h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(ui.tab === k), text: label,
    onclick: () => { ui.tab = k; saveUi(); tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === label))); draw(); },
  })));
  filter.addEventListener('input', () => { ui.filter = filter.value; draw(); });
  sortSel.addEventListener('change', () => { ui.sort = sortSel.value; saveUi(); draw(); });
  fab.addEventListener('click', () => {
    const list = sourceTracks(ui.source);
    if (list?.length) playList(list, null, { shuffle: true, source: ui.source === 'lokal' ? 'Folder lokal' : 'Semua lagu' });
  });
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spin');
    try {
      if (ui.source !== 'lokal' && driveReady()) await loadTracks(true);
      if (ui.source !== 'drive' && localState.status === 'ready') await rescan();
      draw(); toast('Pustaka diperbarui');
    } catch (e) { toast(e.message, { type: 'error' }); }
    refreshBtn.classList.remove('spin');
  });

  function drawStatus() {
    status.textContent = '';
    const d = store.user?.drive;
    if (ui.source === 'drive' || ui.source === 'semua') {
      const gate = driveGate();
      if (gate && ui.source === 'drive') status.append(gate);
      else if (gate && (d?.configured || d?.linkAvailable)) {
        status.append(h('div.local-panel', {}, h('span.muted', { text: d.connected || d.mode === 'link' ? 'Folder Google Drive belum diatur.' : 'Google Drive belum dihubungkan.' }),
          h('a.btn', { href: '#/akun', text: d.connected ? 'Atur folder' : 'Hubungkan' })));
      } else if (!gate) status.append(h('p.muted.src-line', {}, icon(I.cloud), ` Google Drive: ${d.folderName}${d.readOnly ? ' (link folder · hanya putar)' : ''}`));
    }
    if (ui.source === 'lokal' || ui.source === 'semua') status.append(localPanel(ui.source === 'semua' || localState.status === 'ready'));
  }

  async function draw() {
    exitSelect();
    drawStatus();
    sortSel.hidden = ui.tab !== 'lagu';
    filter.placeholder = { lagu: 'Cari judul, artis, album…', playlist: 'Cari playlist…', artis: 'Cari artis…', genre: 'Cari genre…' }[ui.tab];
    const hideAll = (ui.source === 'drive' && driveGate()) || (ui.source === 'lokal' && localState.status !== 'ready');
    tabs.hidden = tools.hidden = Boolean(hideAll) && ui.tab !== 'playlist';
    fab.hidden = Boolean(hideAll) || ui.tab === 'playlist';
    if (ui.tab === 'playlist') { tabs.hidden = false; tools.hidden = false; return drawPlaylists(body); }
    body.textContent = '';
    if (hideAll) return;
    let tracks = sourceTracks(ui.source);
    if (tracks === null) {
      body.append(h('div.tracks', {}, Array.from({ length: 6 }, () => h('div.track.skeleton', {}, h('span.cover.sm'), h('span.track-text', {}, h('div.sk.w80'), h('div.sk.w45'))))));
      try { await loadTracks(); } catch (e) { body.textContent = ''; body.append(h('p.state.err', { text: e.message })); return; }
      tracks = sourceTracks(ui.source) || [];
      body.textContent = '';
    }
    if (!tracks.length) {
      if (ui.source !== 'lokal') body.append(emptyState('Belum ada lagu', 'Unduh lagu dari menu Cari lalu pilih “Simpan ke Google Drive”, atau tambahkan folder musik lokal.', ['Cari lagu', '#/cari']));
      return;
    }
    const f = norm(ui.filter);
    const mixed = ui.source === 'semua';
    if (ui.tab === 'lagu') {
      const list = f ? tracks.filter((t) => norm(`${t.title} ${t.artist} ${t.album || ''} ${t.name}`).includes(f)) : [...tracks];
      if (ui.sort === 'judul') list.sort(byTitle);
      else if (ui.sort === 'judulza') list.sort((a, b) => byTitle(b, a));
      else if (ui.sort === 'lama') list.sort((a, b) => addedAt(a) - addedAt(b));
      else if (ui.sort === 'artis') list.sort((a, b) => a.artist.localeCompare(b.artist, 'id') || byTitle(a, b));
      else list.sort((a, b) => addedAt(b) - addedAt(a));
      const box = trackList(list, { source: ui.source === 'lokal' ? 'Folder lokal' : 'Semua lagu', onChange: draw, showSource: mixed });
      enableSelect(box, list);
      body.append(h('p.count', {}, `${list.length} lagu`, h('span.hint-inline', { text: ' · tekan lama untuk memilih beberapa' })), box);
    } else {
      const key = ui.tab === 'artis' ? 'artist' : 'genre';
      const groups = new Map();
      tracks.forEach((t) => { const k = t[key] || (key === 'genre' ? 'Tanpa genre' : 'Tidak diketahui'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
      const rows = [...groups.entries()].filter(([k]) => !f || norm(k).includes(f)).sort((a, b) => a[0].localeCompare(b[0], 'id'));
      const box = h('div.groups');
      rows.forEach(([k, list]) => box.append(h('a.group', { href: `#/${ui.tab}/${encodeURIComponent(k)}` },
        collage(list.map((t) => t.ytId).filter(Boolean), 'sm', key === 'artist' ? I.user : I.note),
        h('span.track-text', {}, h('b', { text: k }), h('small', { text: `${list.length} lagu` })))));
      body.append(h('p.count', { text: `${rows.length} ${ui.tab}` }), box);
      if (key === 'genre' && groups.has('Tanpa genre')) {
        body.append(h('p.hint', { text: 'Genre lagu Drive diisi otomatis bertahap; lagu lokal memakai tag genre di file MP3. Ubah lewat menu ⋮ pada lagu.' }));
      }
    }
  }

  async function drawPlaylists(box) {
    box.textContent = '';
    let data;
    try { data = await get('/api/library/playlists'); } catch (e) { box.append(h('p.state.err', { text: e.message })); return; }
    const f = norm(ui.filter);
    const all = [...data.special, ...data.playlists].filter((p) => !f || norm(p.name).includes(f));
    const asList = ui.plView === 'daftar';
    const newPl = async () => {
      const name = await promptDialog('Playlist baru', { placeholder: 'Nama playlist', ok: 'Buat' });
      if (!name) return;
      try { const p = await post('/api/library/playlists', { name }); location.hash = `#/playlist/${p.id}`; } catch (e) { toast(e.message, { type: 'error' }); }
    };
    const art = (p, size) => (p.quran ? h(`span.cover.${size}.gen.quran-cover`, {}, h('span.qnum', { text: 'القرآن', lang: 'ar' }))
      : collage(p.covers, size, p.id === 'favorites' ? I.heart : p.id === 'recent' ? I.clock : I.note));
    const sub = (p) => `${p.count} ${p.quran ? 'surat' : 'lagu'}`;

    // Pilihan tampilan: kartu / daftar (diingat di browser ini)
    const viewBtn = (mode, label, path) => h(`button.seg-btn${ui.plView === mode ? '.on' : ''}`, {
      type: 'button', 'aria-pressed': String(ui.plView === mode), title: label, 'aria-label': `Tampilan ${label}`,
      onclick: () => { if (ui.plView === mode) return; ui.plView = mode; saveUi(); drawPlaylists(box); },
    }, icon(path), h('span', { text: label }));
    box.append(h('div.pl-head', {}, h('p.count', { text: `${all.length} playlist` }),
      h('div.seg', { role: 'group', 'aria-label': 'Tampilan playlist' },
        viewBtn('kartu', 'Kartu', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
        viewBtn('daftar', 'Daftar', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'))));

    if (asList) {
      const list = h('div.groups.pl-list');
      list.append(h('button.group.pl-new-row', { type: 'button', onclick: newPl },
        h('span.cover.sm.gen.plus', {}, icon(I.plus)), h('span.track-text', {}, h('b', { text: 'Playlist baru' }))));
      all.forEach((p) => list.append(h('a.group', { href: `#/playlist/${p.id}` }, art(p, 'sm'),
        h('span.track-text', {}, h('b', { text: p.name }), h('small', { text: sub(p) })))));
      box.append(list);
      return;
    }
    const grid = h('div.pl-grid');
    grid.append(h('button.pl-card.new', { type: 'button', onclick: newPl }, h('span.cover.md.gen.plus', {}, icon(I.plus)), h('b', { text: 'Playlist baru' })));
    all.forEach((p) => grid.append(h('a.pl-card', { href: `#/playlist/${p.id}` }, art(p, 'md'), h('b', { text: p.name }), h('small', { text: sub(p) }))));
    box.append(grid);
  }

  draw();
  const offs = [
    on('tracks', () => { if (document.body.contains(body)) draw(); }),
    on('local', () => { if (document.body.contains(status)) (localState.status === 'scanning' ? drawStatus() : draw()); }),
  ];
  return () => offs.forEach((off) => off());
}

function radioMenu(t) {
  const st = t.radio;
  const fav = isFavRadio(st.uuid);
  actionMenu(h('span.menu-track', {}, cover(t, 'sm'), h('span', {}, h('b', { text: t.title }), h('small', { text: t.artist }))), [
    { label: fav ? 'Hapus dari favorit radio' : 'Tambah ke favorit radio', icon: I.heart, run: async () => {
      try { const f = await toggleRadioFav(st); toast(f ? 'Ditambahkan ke favorit radio' : 'Dihapus dari favorit radio'); } catch (e) { toast(e.message, { type: 'error' }); }
    } },
    st.homepage && { label: 'Buka situs stasiun', icon: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', run: () => window.open(st.homepage, '_blank', 'noopener') },
    { label: 'Lihat semua radio', icon: I.radio, run: () => { location.hash = '#/radio'; } },
  ].filter(Boolean));
}

/* ================= Hapalan Quran ================= */

/** Pilih jumlah pengulangan lalu putar surat ayat demi ayat. */
export function hafalanMenu(t) {
  const qari = t.id.split('-')[1];
  const run = async (ulang) => {
    try {
      const r = await get(`/api/quran/hafalan/${t.quran.surat}?qari=${qari}&ulang=${ulang}`);
      playList(r.items, 0, { shuffle: false, repeat: 'off', source: `Hafalan ${r.surat.namaLatin}` });
      toast(r.terpotong
        ? `Hafalan ${r.surat.namaLatin} ayat ${r.dari}–${r.sampai}, tiap ayat ${ulang}×`
        : `Hafalan ${r.surat.namaLatin}: tiap ayat diulang ${ulang}×`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  };
  actionMenu(`Ulangi / hafalan · ${t.title}`, [
    { label: 'Pilih rentang ayat (dari – sampai)…', icon: 'M4 6h10M4 12h16M4 18h7M17 4v4M11 10v4M14 16v4', run: () => hafalanRange(t) },
    { label: 'Ulangi surat utuh (tanpa per ayat)', icon: I.refresh, run: () => {
      playList([t], 0, { shuffle: false, repeat: 'one', source: 'Hapalan Quran' });
      toast(`${t.title} diulang terus. Matikan lewat tombol ulangi di pemutar.`);
    } },
    ...[3, 7, 11, 20, 40].map((n) => ({ label: `Ulangi tiap ayat ${n}×`, icon: I.refresh, run: () => run(n) })),
  ], 'Teks Arab, Latin & terjemahan tampil di panel Lirik pemutar.');
}

/**
 * Hafalan rentang ayat: ayat awal & akhir bebas, tiap ayat diulang n kali, opsional rentang diulang terus.
 * `dari` bisa diisi untuk memulai dari ayat tertentu.
 */
export async function hafalanRange(t, dari = 1) {
  const n = t.quran.surat;
  const qari = t.id.split('-')[1];
  let s;
  try { s = await get(`/api/quran/surat/${n}`); } catch (e) { return toast(e.message, { type: 'error' }); }
  const max = s.jumlahAyat;
  let pref = {};
  try { pref = JSON.parse(localStorage.getItem('sw-hafalan') || '{}'); } catch { /* abaikan */ }
  const st = { dari: Math.min(Math.max(1, dari), max), sampai: Math.min(max, Math.max(1, dari) + 4), ulang: [1, 3, 7, 11, 20, 40].includes(pref.ulang) ? pref.ulang : 3, loop: Boolean(pref.loop) };

  const num = (val) => h('input.hf-num', { type: 'number', min: 1, max, value: val, inputmode: 'numeric', required: true });
  const fromIn = num(st.dari); const toIn = num(st.sampai);
  const prevFrom = h('div.hf-prev'); const prevTo = h('div.hf-prev');
  const summary = h('p.hf-sum', { role: 'status' });
  const ulangBox = h('div.hf-chips', { role: 'radiogroup', 'aria-label': 'Ulangi tiap ayat' });
  const presetBox = h('div.hf-chips');
  const loopIn = h('input', { type: 'checkbox', checked: st.loop });
  const preview = (box, no) => {
    const a = s.ayat.find((x) => x.nomorAyat === no);
    box.textContent = '';
    if (a) box.append(h('p.hf-arab', { lang: 'ar', dir: 'rtl', text: a.teksArab }), h('small', { text: `${no}. ${a.teksIndonesia}` }));
  };
  const clamp = (v) => Math.min(max, Math.max(1, Math.round(Number(v)) || 1));
  const sync = (src) => {
    st.dari = clamp(fromIn.value); st.sampai = clamp(toIn.value);
    if (st.sampai < st.dari) { if (src === 'from') st.sampai = st.dari; else st.dari = st.sampai; }
    fromIn.value = st.dari; toIn.value = st.sampai;
    preview(prevFrom, st.dari); preview(prevTo, st.sampai);
    const c = st.sampai - st.dari + 1;
    summary.textContent = `Ayat ${st.dari}–${st.sampai} · ${c} ayat × ${st.ulang} = ${c * st.ulang} putaran${st.loop ? ' · diulang terus' : ''}`;
    [...presetBox.children].forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.f) === st.dari && Number(b.dataset.t) === st.sampai)));
    [...ulangBox.children].forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.u) === st.ulang)));
  };
  fromIn.addEventListener('change', () => sync('from'));
  toIn.addEventListener('change', () => sync('to'));
  const step = (input, d, src) => h('button.icon-btn.hf-step', { type: 'button', 'aria-label': d > 0 ? 'Tambah' : 'Kurangi', onclick: () => { input.value = clamp(Number(input.value) + d); sync(src); } },
    icon(d > 0 ? 'M12 5v14M5 12h14' : 'M5 12h14'));
  [['Seluruh surat', 1, max], ['5 ayat pertama', 1, Math.min(5, max)], ['10 ayat pertama', 1, Math.min(10, max)], ['5 ayat terakhir', Math.max(1, max - 4), max]]
    .filter(([, f, to], i, arr) => arr.findIndex(([, f2, t2]) => f2 === f && t2 === to) === i)
    .forEach(([label, f, to]) => presetBox.append(h('button.chip-src', { type: 'button', text: label, dataset: { f, t: to }, onclick: () => { fromIn.value = f; toIn.value = to; sync('from'); } })));
  [1, 3, 7, 11, 20, 40].forEach((u) => ulangBox.append(h('button.chip-src', { type: 'button', role: 'radio', text: u === 1 ? 'Sekali' : `${u}×`, dataset: { u }, onclick: () => { st.ulang = u; sync(); } })));
  loopIn.addEventListener('change', () => { st.loop = loopIn.checked; sync(); });

  const go = h('button.btn-primary', { type: 'submit' }, icon(I.play), 'Mulai hafalan');
  const close = openOverlay(h('form.dialog.hafalan', { onsubmit: async (e) => {
    e.preventDefault(); sync();
    go.disabled = true;
    try { localStorage.setItem('sw-hafalan', JSON.stringify({ ulang: st.ulang, loop: st.loop })); } catch { /* abaikan */ }
    try {
      const r = await get(`/api/quran/hafalan/${n}?qari=${qari}&ulang=${st.ulang}&dari=${st.dari}&sampai=${st.sampai}`);
      playList(r.items, 0, { shuffle: false, repeat: st.loop ? 'all' : 'off', source: `Hafalan ${r.surat.namaLatin} ${r.dari}–${r.sampai}` });
      toast(`Hafalan ${r.surat.namaLatin} ayat ${r.dari}–${r.sampai}, tiap ayat ${st.ulang}×${st.loop ? ', diulang terus' : ''}${r.terpotong ? ' (dipotong karena terlalu panjang)' : ''}`);
      close();
    } catch (er) { toast(er.message, { type: 'error' }); go.disabled = false; }
  } },
  h('h3', {}, `Hafalan · ${s.namaLatin}`, h('small.muted', { text: ` ${s.arti} · ${max} ayat` })),
  h('div.hf-grid', {},
    h('div.hf-field', {}, h('label', { text: 'Dari ayat' }), h('div.hf-row', {}, step(fromIn, -1, 'from'), fromIn, step(fromIn, 1, 'from')), prevFrom),
    h('div.hf-field', {}, h('label', { text: 'Sampai ayat' }), h('div.hf-row', {}, step(toIn, -1, 'to'), toIn, step(toIn, 1, 'to')), prevTo)),
  presetBox,
  h('p.hf-label', { text: 'Ulangi tiap ayat' }), ulangBox,
  h('label.hf-loop', {}, loopIn, h('span', {}, h('b', { text: 'Ulangi rentang terus-menerus' }), h('small', { text: 'Setelah ayat terakhir kembali ke ayat awal sampai dihentikan.' }))),
  summary,
  h('div.btn-row', {}, h('button.btn', { type: 'button', text: 'Batal', onclick: () => close() }), go)));
  sync('from');
  fromIn.focus();
}

async function renderQuran(view) {
  const page = h('section.page');
  view.append(page);
  const load = async (q = {}) => {
    page.textContent = '';
    page.append(h('p.state', { text: 'Memuat daftar surat…' }));
    let p;
    try {
      const qs = new URLSearchParams();
      if (q.qari) qs.set('qari', q.qari);
      if (q.semua != null) qs.set('semua', q.semua ? '1' : '0');
      p = await get(`/api/library/playlists/quran?${qs}`);
    } catch (e) { page.textContent = ''; page.append(h('p.state.err', { text: e.message })); return; }
    page.textContent = '';
    const sel = h('select.sort', { 'aria-label': 'Qari' }, p.qariList.map((x) => h('option', { value: x.id, text: x.name, selected: x.id === p.qari })));
    sel.addEventListener('change', async () => { await saveSholatPrefs({ quran: { qari: sel.value } }).catch(() => {}); load({ qari: sel.value, semua: p.semua }); });
    const scope = h('div.sources', {}, [['juz30', 'Juz 30 + Al-Fatihah', false], ['semua', 'Semua 114 surat', true]].map(([, label, v]) => h('button.chip-src', {
      type: 'button', role: 'radio', 'aria-checked': String(Boolean(p.semua) === v), text: label,
      onclick: async () => { await saveSholatPrefs({ quran: { semua: v } }).catch(() => {}); load({ qari: p.qari, semua: v }); },
    })));
    const filter = h('input.filter', { type: 'search', placeholder: 'Cari surat…' });
    const listBox = h('div');
    const drawList = () => {
      const f = norm(filter.value);
      const items = f ? p.items.filter((x) => norm(`${x.title} ${x.quran.arti} ${x.quran.surat}`).includes(f)) : p.items;
      listBox.textContent = '';
      listBox.append(trackList(items, { source: 'Hapalan Quran', playlist: p, onChange: () => load({ qari: p.qari, semua: p.semua }) }));
      listBox.querySelectorAll('.track').forEach((row, i) => {
        const it = items[i];
        row.querySelector('.track-text small').textContent = `${it.quran.arti} · ${it.quran.jumlahAyat} ayat · ${it.quran.tempatTurun}`;
        row.querySelector('.track-text').after(h('span.arab', { text: it.quran.nama, lang: 'ar', dir: 'rtl' }));
      });
    };
    filter.addEventListener('input', drawList);
    page.append(
      h('a.back', { href: '#/pustaka?tab=playlist' }, icon(I.back), 'Playlist'),
      h('div.detail-head', {},
        h('span.cover.lg.gen.quran-cover', {}, h('span.qnum', { text: 'القرآن', lang: 'ar' })),
        h('div.detail-info', {},
          h('small.eyebrow', { text: 'Playlist bawaan' }),
          h('h2', { text: 'Hapalan Quran' }),
          h('p.muted', { text: `${p.items.length} surat · Murottal ${p.qariList.find((x) => x.id === p.qari)?.name || ''}` }),
          h('div.detail-actions', {},
            h('button.btn-primary', { type: 'button', onclick: () => playList(p.items, 0, { shuffle: false, source: 'Hapalan Quran' }) }, icon(I.play), 'Putar'),
            h('button.btn', { type: 'button', onclick: () => playList(p.items, null, { shuffle: true, source: 'Hapalan Quran' }) }, icon(I.shuffle), 'Acak')))),
      h('div.lib-tools', {}, h('label.qari', {}, h('span', { text: 'Qari' }), sel)),
      scope,
      h('div.lib-tools', {}, clearable(filter)),
      h('p.hint', { text: 'Tips hafalan: menu ⋮ → "Hafalan per ayat" untuk mengulang tiap ayat, dan tombol Lirik di pemutar untuk melihat teks Arab, Latin, dan terjemahan.' }),
      listBox,
      h('p.hint', { text: "Teks Al-Qur'an & terjemahan: Kemenag RI. Audio murottal: everyayah.com, melalui equran.id." }));
    drawList();
  };
  await load();
}

export async function renderPlaylist(view, id) {
  if (id === 'quran') return renderQuran(view);
  const page = h('section.page');
  view.append(page);
  const reload = async () => {
    let p;
    try { p = await get(`/api/library/playlists/${encodeURIComponent(id)}`); } catch (e) { page.textContent = ''; page.append(h('p.state.err', { text: e.message })); return; }
    page.textContent = '';
    // Lagu lokal: cocokkan dengan folder lokal yang sedang dibuka di browser ini
    p.items = p.items.map((x) => {
      if (!x.local) return x;
      const lt = localById(x.id);
      return lt ? { ...lt, itemId: x.itemId, available: true } : { ...x, available: false };
    });
    const missingLocal = p.items.some((x) => x.local && x.available === false);
    const playable = p.items.filter((x) => x.available !== false);
    const menuBtn = !p.special ? h('button.icon-btn', { type: 'button', 'aria-label': 'Menu playlist', onclick: () => actionMenu(p.name, [
      { label: 'Ubah nama', icon: 'M4 20h4L19 9l-4-4L4 16z', run: async () => {
        const name = await promptDialog('Ubah nama playlist', { value: p.name });
        if (name) { await patch(`/api/library/playlists/${p.id}`, { name }).catch((e) => toast(e.message, { type: 'error' })); reload(); loadMembership(); }
      } },
      { label: 'Hapus playlist', icon: 'M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3', danger: true, run: async () => {
        if (!(await confirmDialog('Hapus playlist?', `Playlist “${p.name}” akan dihapus. Lagu di Google Drive tidak ikut terhapus.`, { ok: 'Hapus', danger: true }))) return;
        await del(`/api/library/playlists/${p.id}`).catch((e) => toast(e.message, { type: 'error' }));
        loadMembership();
        location.hash = '#/pustaka?tab=playlist';
      } },
    ]) }, icon(I.more)) : null;
    page.append(
      h('a.back', { href: '#/pustaka?tab=playlist' }, icon(I.back), 'Playlist'),
      h('div.detail-head', {},
        collage(p.items.map((x) => x.ytId).filter(Boolean), 'lg', p.id === 'favorites' ? I.heart : p.id === 'recent' ? I.clock : I.note),
        h('div.detail-info', {},
          h('small.eyebrow', { text: p.special ? 'Playlist otomatis' : 'Playlist' }),
          h('h2', { text: p.name }),
          h('p.muted', { text: `${p.items.length} lagu · ${fmtDur(p.items.reduce((s, x) => s + (x.duration || 0), 0)) || '—'}` }),
          h('div.detail-actions', {},
            h('button.btn-primary', { type: 'button', disabled: !playable.length, onclick: () => playList(p.items, 0, { shuffle: false, source: p.name }) }, icon(I.play), 'Putar'),
            h('button.btn', { type: 'button', disabled: !playable.length, onclick: () => playList(p.items, null, { shuffle: true, source: p.name }) }, icon(I.shuffle), 'Acak'),
            menuBtn))));
    if (!p.items.length) {
      page.append(emptyState('Playlist masih kosong', p.special ? '' : 'Tambahkan lagu lewat menu ⋮ pada lagu di Pustaka, atau dengan perintah suara.', ['Buka Pustaka', '#/pustaka?tab=lagu']));
      return;
    }
    if (missingLocal) {
      page.append(localState.status === 'need-permission'
        ? h('div.local-panel', {}, h('span', { text: 'Playlist ini berisi lagu lokal. Izinkan akses folder untuk memutarnya.' }),
          h('button.btn-primary', { type: 'button', text: 'Izinkan akses', onclick: () => reconnect().then(reload) }))
        : h('p.hint', { text: 'Sebagian lagu lokal tidak ditemukan di folder yang sedang dibuka di browser ini (mungkin disimpan dari perangkat lain).' }));
    }
    const list = trackList(p.items, { source: p.name, playlist: p, onChange: reload, draggable: !p.special, showSource: true });
    if (!p.special) enableDrag(list, p, reload);
    page.append(list);
  };
  await reload();
}

/**
 * Urutkan lagu playlist dengan seret: tahan baris ±0,4 detik (layar sentuh / mouse) atau tarik pegangan ⠿,
 * lalu geser ke posisi baru dan lepaskan. Urutan disimpan ke server.
 */
function enableDrag(list, p, reload) {
  let drag = null; // { row, startOrder }
  let timer = null;
  let start = null;
  let blockClick = false;
  const rows = () => [...list.querySelectorAll('.track')];
  const order = () => rows().map((r) => r.dataset.id).join(',');

  const begin = (row) => {
    clearTimeout(timer); timer = null;
    drag = { row, startOrder: order() };
    row.classList.add('dragging');
    list.classList.add('is-dragging');
    navigator.vibrate?.(15);
  };
  const move = (y) => {
    if (!drag) return;
    for (const r of rows()) {
      if (r === drag.row) continue;
      const b = r.getBoundingClientRect();
      if (y > b.top && y < b.bottom) {
        list.insertBefore(drag.row, y < b.top + b.height / 2 ? r : r.nextSibling);
        break;
      }
    }
    // Gulir otomatis bila jari/kursor dekat tepi layar
    const edge = 70;
    if (y < edge) window.scrollBy(0, -12); else if (y > window.innerHeight - edge - 120) window.scrollBy(0, 12);
  };
  const finish = async () => {
    clearTimeout(timer); timer = null; start = null;
    if (!drag) return;
    const { row, startOrder } = drag;
    drag = null;
    row.classList.remove('dragging');
    list.classList.remove('is-dragging');
    blockClick = true; setTimeout(() => { blockClick = false; }, 350);
    if (order() === startOrder) return;
    const ids = rows().map((r) => p.items.find((x) => x.id === r.dataset.id)?.itemId).filter((x) => x != null);
    try { await put(`/api/library/playlists/${p.id}/order`, { itemIds: ids }); toast('Urutan disimpan'); }
    catch (e) { toast(e.message, { type: 'error' }); }
    reload();
  };

  // Klik setelah menyeret tidak boleh memutar lagu
  list.addEventListener('click', (e) => { if (blockClick || drag) { e.stopPropagation(); e.preventDefault(); } }, true);
  list.addEventListener('contextmenu', (e) => { if (e.target.closest('.track')) e.preventDefault(); });

  /* Sentuh */
  list.addEventListener('touchstart', (e) => {
    const row = e.target.closest('.track');
    if (!row || e.target.closest('.track-more') || e.touches.length > 1) return;
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.target.closest('.drag')) { begin(row); return; }
    timer = setTimeout(() => begin(row), 420);
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (drag) { e.preventDefault(); move(t.clientY); return; } // cegah halaman ikut menggulir
    if (timer && start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) { clearTimeout(timer); timer = null; }
  }, { passive: false });
  list.addEventListener('touchend', (e) => { if (drag) e.preventDefault(); finish(); });
  list.addEventListener('touchcancel', finish);

  /* Mouse */
  list.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.track');
    if (e.button !== 0 || !row || e.target.closest('.track-more')) return;
    start = { x: e.clientX, y: e.clientY };
    if (e.target.closest('.drag')) { e.preventDefault(); begin(row); } else timer = setTimeout(() => begin(row), 420);
    const mm = (ev) => {
      if (drag) { ev.preventDefault(); move(ev.clientY); return; }
      if (timer && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) { clearTimeout(timer); timer = null; }
    };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); finish(); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
}

/* ================= Pilih banyak lagu ================= */

/**
 * Tekan lama sebuah lagu → mode pilih. Ketuk lagu lain untuk menambah/membatalkan pilihan, lalu
 * "Tambah ke playlist" (atau antrean) untuk semua lagu terpilih sekaligus.
 */
let sel = null; // { box, tracks, ids: Set, bar, count }
function exitSelect() {
  if (!sel) return;
  sel.box.classList.remove('selecting');
  sel.box.querySelectorAll('.track.selected').forEach((r) => r.classList.remove('selected'));
  sel.bar.remove();
  document.body.classList.remove('has-selbar');
  sel = null;
}
window.addEventListener('hashchange', exitSelect);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel) exitSelect(); });

function selToggle(id, force) {
  if (!sel) return;
  const on = force ?? !sel.ids.has(id);
  if (on) sel.ids.add(id); else sel.ids.delete(id);
  sel.box.querySelector(`.track[data-id="${CSS.escape(id)}"]`)?.classList.toggle('selected', on);
  sel.count.textContent = `${sel.ids.size} dipilih`;
  if (!sel.ids.size) exitSelect();
}

function startSelect(box, tracks, firstId) {
  if (sel && sel.box !== box) exitSelect();
  if (!sel) {
    const count = h('b.selbar-count');
    const chosen = () => tracks.filter((t) => sel.ids.has(t.id) && !t.quran);
    const bar = h('div.selbar', { role: 'toolbar', 'aria-label': 'Lagu terpilih' },
      h('button.icon-btn', { type: 'button', 'aria-label': 'Batal memilih', onclick: exitSelect }, icon('M6 6l12 12M18 6 6 18')),
      count,
      h('button.icon-btn', { type: 'button', title: 'Pilih semua', 'aria-label': 'Pilih semua / batalkan semua', onclick: () => {
        const all = sel.ids.size < tracks.length;
        tracks.forEach((t) => selToggle(t.id, all || undefined));
        if (!all) exitSelect();
      } }, icon('M4 6l2 2 4-4M4 14l2 2 4-4M13 6h7M13 14h7M13 19h7')),
      h('button.btn.sm', { type: 'button', text: 'Antrean', onclick: () => {
        const list = chosen(); list.forEach((t) => addToQueue(t)); toast(`${list.length} lagu ditambahkan ke antrean`); exitSelect();
      } }),
      h('button.btn-primary.sm', { type: 'button', onclick: async () => {
        const list = chosen();
        if (!list.length) return toast('Pilih lagu dulu.');
        await addToPlaylistMenu(list, exitSelect);
      } }, icon(I.plus), 'Playlist'));
    document.body.append(bar);
    document.body.classList.add('has-selbar');
    box.classList.add('selecting');
    sel = { box, tracks, ids: new Set(), bar, count };
  }
  selToggle(firstId, true);
}

function enableSelect(box, tracks) {
  let timer = null; let start = null; let fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  box.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.track');
    if (!row || e.target.closest('.track-more') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    fired = false; start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { fired = true; timer = null; navigator.vibrate?.(15); startSelect(box, tracks, row.dataset.id); }, 450);
  });
  box.addEventListener('pointermove', (e) => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => box.addEventListener(ev, cancel));
  box.addEventListener('contextmenu', (e) => { if (e.target.closest('.track')) e.preventDefault(); });
  // Di mode pilih, ketukan memilih (bukan memutar); Ctrl/⌘-klik juga langsung memilih
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.track');
    if (!row || e.target.closest('.track-more')) return;
    if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); return; }
    if (sel?.box === box) { e.stopPropagation(); e.preventDefault(); selToggle(row.dataset.id); return; }
    if (e.ctrlKey || e.metaKey) { e.stopPropagation(); e.preventDefault(); startSelect(box, tracks, row.dataset.id); }
  }, true);
}

/* ================= Detail artis / genre ================= */

export async function renderGroup(view, kind, name) {
  loadMembership();
  const page = h('section.page');
  view.append(page);
  if (driveReady() && !store.tracks) {
    page.append(h('p.state', { text: 'Memuat…' }));
    try { await loadTracks(); } catch (e) { page.textContent = ''; page.append(h('p.state.err', { text: e.message })); return; }
  }
  page.textContent = '';
  const key = kind === 'artis' ? 'artist' : 'genre';
  const list = (sourceTracks(ui.source) || []).filter((t) => (t[key] || (key === 'genre' ? 'Tanpa genre' : 'Tidak diketahui')) === name).sort(byTitle);
  page.append(
    h('a.back', { href: `#/pustaka?tab=${kind}` }, icon(I.back), kind === 'artis' ? 'Artis' : 'Genre'),
    h('div.detail-head', {},
      collage(list.map((t) => t.ytId).filter(Boolean), 'lg', kind === 'artis' ? I.user : I.note),
      h('div.detail-info', {},
        h('small.eyebrow', { text: kind === 'artis' ? 'Artis' : 'Genre' }),
        h('h2', { text: name }),
        h('p.muted', { text: `${list.length} lagu` }),
        h('div.detail-actions', {},
          h('button.btn-primary', { type: 'button', onclick: () => playList(list, 0, { shuffle: false, source: name }) }, icon(I.play), 'Putar'),
          h('button.btn', { type: 'button', onclick: () => playList(list, null, { shuffle: true, source: name }) }, icon(I.shuffle), 'Acak'),
          h('button.btn', { type: 'button', onclick: () => addToPlaylistMenu(list) }, icon(I.plus), 'Ke playlist')))),
    list.length ? (() => { const box = trackList(list, { source: name, showSource: true, onChange: () => { view.textContent = ''; renderGroup(view, kind, name); } }); enableSelect(box, list); return box; })() : h('p.state', { text: 'Tidak ada lagu.' }),
  );
}

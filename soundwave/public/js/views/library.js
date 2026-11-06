/** Pustaka: sumber Google Drive / folder lokal / semua — tab Lagu, Playlist, Artis, Genre. */
import { h, icon, I, cover, collage, fmtDur, toast, actionMenu, promptDialog, confirmDialog } from '../ui.js';
import { get, post, put, patch, del } from '../api.js';
import { store, on, loadTracks, driveReady, toggleFavorite } from '../store.js';
import { playList, playNext, addToQueue, current } from '../player.js';
import { savePrefs as saveSholatPrefs } from '../sholat.js';
import { isFavRadio, toggleRadioFav } from '../radio.js';
import { localState, fsaSupported, pickFolder, reconnect, rescan, forgetFolder, setLocalGenre, localById } from '../local.js';

const TABS = [['lagu', 'Lagu'], ['playlist', 'Playlist'], ['artis', 'Artis'], ['genre', 'Genre']];
const SORTS = { baru: 'Terbaru', judul: 'Judul A–Z', artis: 'Artis A–Z' };
let ui = { tab: 'lagu', filter: '', sort: 'baru', source: 'semua' };
try { Object.assign(ui, JSON.parse(localStorage.getItem('sw-lib-ui') || '{}'), { filter: '' }); } catch { /* abaikan */ }
const saveUi = () => { try { localStorage.setItem('sw-lib-ui', JSON.stringify({ tab: ui.tab, sort: ui.sort, source: ui.source })); } catch { /* abaikan */ } };

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const byTitle = (a, b) => a.title.localeCompare(b.title, 'id');

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
    !t.quran && { label: `Ubah genre${t.genre ? ` (${t.genre})` : ''}`, icon: 'M4 7h16M4 12h10M4 17h6', run: () => editGenre(t, ctx) },
    !t.quran && { label: 'Jadikan suara adzan', icon: 'M12 3c3 2 5 4.5 5 8H7c0-3.5 2-6 5-8zM5 11h14v10H5z', run: async () => {
      try { await saveSholatPrefs({ sholat: { adzan: { suara: { jenis: 'lagu', id: t.id, title: t.title, local: Boolean(t.local) } } } }); toast(`“${t.title}” dipakai sebagai suara adzan`); } catch (e) { toast(e.message, { type: 'error' }); }
    } },
    pl && ctx.index > 0 && { label: 'Naikkan', icon: 'M12 19V5M6 11l6-6 6 6', run: () => move(pl, ctx.index, -1, ctx) },
    pl && ctx.index < ctx.list.length - 1 && { label: 'Turunkan', icon: 'M12 5v14M6 13l6 6 6-6', run: () => move(pl, ctx.index, 1, ctx) },
    pl && { label: `Hapus dari “${pl.name}”`, icon: 'M5 12h14', run: async () => {
      await del(`/api/library/playlists/${pl.id}/items/${t.itemId}`).catch((e) => toast(e.message, { type: 'error' }));
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
export async function addToPlaylistMenu(tracks) {
  let data;
  try { data = await get('/api/library/playlists'); } catch (e) { return toast(e.message, { type: 'error' }); }
  const add = async (p) => {
    try {
      const r = await post(`/api/library/playlists/${p.id}/items`, { tracks });
      toast(r.added ? `Ditambahkan ke “${p.name}”` : `Sudah ada di “${p.name}”`);
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
  const tools = h('div.lib-tools', {}, filter, sortSel);
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
      else if (ui.sort === 'artis') list.sort((a, b) => a.artist.localeCompare(b.artist, 'id') || byTitle(a, b));
      else list.sort((a, b) => addedAt(b) - addedAt(a));
      body.append(h('p.count', { text: `${list.length} lagu` }), trackList(list, { source: ui.source === 'lokal' ? 'Folder lokal' : 'Semua lagu', onChange: draw, showSource: mixed }));
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
    const grid = h('div.pl-grid');
    grid.append(h('button.pl-card.new', {
      type: 'button',
      onclick: async () => {
        const name = await promptDialog('Playlist baru', { placeholder: 'Nama playlist', ok: 'Buat' });
        if (!name) return;
        try { const p = await post('/api/library/playlists', { name }); location.hash = `#/playlist/${p.id}`; } catch (e) { toast(e.message, { type: 'error' }); }
      },
    }, h('span.cover.md.gen.plus', {}, icon(I.plus)), h('b', { text: 'Playlist baru' })));
    [...data.special, ...data.playlists].filter((p) => !f || norm(p.name).includes(f)).forEach((p) => grid.append(
      h('a.pl-card', { href: `#/playlist/${p.id}` },
        p.quran ? h('span.cover.md.gen.quran-cover', {}, h('span.qnum', { text: 'القرآن', lang: 'ar' }))
          : collage(p.covers, 'md', p.id === 'favorites' ? I.heart : p.id === 'recent' ? I.clock : I.note),
        h('b', { text: p.name }), h('small', { text: `${p.count} ${p.quran ? 'surat' : 'lagu'}` }))));
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
    { label: 'Ulangi surat utuh (tanpa per ayat)', icon: I.refresh, run: () => {
      playList([t], 0, { shuffle: false, repeat: 'one', source: 'Hapalan Quran' });
      toast(`${t.title} diulang terus. Matikan lewat tombol ulangi di pemutar.`);
    } },
    ...[3, 7, 11, 20, 40].map((n) => ({ label: `Ulangi tiap ayat ${n}×`, icon: I.refresh, run: () => run(n) })),
  ], 'Teks Arab, Latin & terjemahan tampil di panel Lirik pemutar.');
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
      h('div.lib-tools', {}, filter),
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
        if (name) { await patch(`/api/library/playlists/${p.id}`, { name }).catch((e) => toast(e.message, { type: 'error' })); reload(); }
      } },
      { label: 'Hapus playlist', icon: 'M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3', danger: true, run: async () => {
        if (!(await confirmDialog('Hapus playlist?', `Playlist “${p.name}” akan dihapus. Lagu di Google Drive tidak ikut terhapus.`, { ok: 'Hapus', danger: true }))) return;
        await del(`/api/library/playlists/${p.id}`).catch((e) => toast(e.message, { type: 'error' }));
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

/** Drag & drop untuk mengurutkan lagu dalam playlist (desktop). */
function enableDrag(list, p, reload) {
  let dragEl = null;
  list.querySelectorAll('.track').forEach((row) => {
    const handle = row.querySelector('.drag');
    handle.addEventListener('pointerdown', () => { row.draggable = true; });
    row.addEventListener('dragstart', (e) => { dragEl = row; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', async () => {
      row.classList.remove('dragging'); row.draggable = false; dragEl = null;
      const order = [...list.querySelectorAll('.track')].map((r) => p.items.find((x) => x.id === r.dataset.id)?.itemId);
      await put(`/api/library/playlists/${p.id}/order`, { itemIds: order }).catch((e) => toast(e.message, { type: 'error' }));
      reload();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      const r = row.getBoundingClientRect();
      list.insertBefore(dragEl, e.clientY < r.top + r.height / 2 ? row : row.nextSibling);
    });
  });
}

/* ================= Detail artis / genre ================= */

export async function renderGroup(view, kind, name) {
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
    list.length ? trackList(list, { source: name, showSource: true, onChange: () => { view.textContent = ''; renderGroup(view, kind, name); } }) : h('p.state', { text: 'Tidak ada lagu.' }),
  );
}

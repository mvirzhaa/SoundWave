/** Halaman TV: Pilihan (YouTube Live resmi & saluran admin), Indonesia, Dunia, Favorit, Link M3U pengguna. */
import { h, icon, I, toast, debounce } from '../ui.js';
import { get, put, del } from '../api.js';
import { openTv, logoEl, playableStreams, tvRefreshFav, catName } from '../tv-player.js';

const UI_KEY = 'sw-tv-ui';
const TABS = [['pilihan', 'Pilihan'], ['id', 'Indonesia'], ['dunia', 'Dunia'], ['favorit', 'Favorit'], ['m3u', 'Link saya']];
const secure = location.protocol === 'https:';

// Cache sederhana antar kunjungan halaman (tidak perlu memuat ulang saat bolak-balik menu)
const cache = { meta: null, pilihan: null, fav: null, m3u: null };

export function renderTv(view) {
  const page = h('section.page.tv');
  view.append(page);
  let st = { tab: 'pilihan', negara: '', kategori: '', m3u: null };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') }; } catch { /* abaikan */ }
  const save = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: st.tab, negara: st.negara, kategori: st.kategori, m3u: st.m3u })); } catch { /* abaikan */ } };

  let items = []; let total = 0; let loading = false; let seq = 0; let done = false;
  let alive = true;

  const input = h('input', { type: 'search', placeholder: 'Cari saluran TV…', 'aria-label': 'Cari saluran TV', inputmode: 'search', enterkeyhint: 'search' });
  const tabs = h('div.sources.tv-tabs', { role: 'tablist' });
  const filters = h('div.tv-filters');
  const head = h('p.muted.src-line', { role: 'status' });
  const grid = h('div.tv-grid');
  const more = h('div.tv-more');
  const foot = h('p.hint');

  /* ---------- Favorit ---------- */
  const favIds = () => new Set((cache.fav || []).map((x) => x.id));
  const isFav = (it) => favIds().has(it.id);
  async function toggleFav(it) {
    const on = isFav(it);
    const r = on ? await del(`/api/tv/favorit/${encodeURIComponent(it.id)}`) : await put('/api/tv/favorit', { item: it });
    cache.fav = r.items;
    grid.querySelectorAll(`[data-id="${CSS.escape(it.id)}"] .tv-fav`).forEach((b) => b.setAttribute('aria-pressed', String(!on)));
    if (st.tab === 'favorit') load(true);
    return !on;
  }

  /* ---------- Kartu saluran ---------- */
  function card(it, i) {
    const blocked = !it.kind && !playableStreams(it).length;
    const badges = [
      it.kind === 'youtube' ? h('span.tv-badge.yt', { text: 'YouTube' }) : null,
      it.q ? h('span.tv-badge', { text: it.q.replace(/p$/, 'p') }) : null,
      it.geo ? h('span.tv-badge.warn', { text: 'Geo', title: 'Mungkin dibatasi wilayah' }) : null,
      it.part ? h('span.tv-badge.warn', { text: 'Tidak 24 jam' }) : null,
      blocked ? h('span.tv-badge.warn', { text: 'http', title: 'Hanya bisa diputar di aplikasi HP' }) : null,
    ].filter(Boolean);
    const fav = isFav(it);
    return h(`div.tv-card${blocked ? '.blocked' : ''}`, { dataset: { id: it.id } },
      h('button.tv-main', { type: 'button', 'aria-label': `Tonton ${it.name}`, onclick: () => watch(i) },
        h('span.tv-logo', {}, logoEl(it), badges.length ? h('span.tv-badges', {}, badges) : null, h('span.tv-playico', {}, icon(I.play))),
        h('span.tv-name', { text: it.name }),
        h('small.tv-sub', { text: [(it.cats || []).map(catName).slice(0, 2).join(', '), it.m3u ? '' : it.country && st.tab !== 'id' ? it.country : ''].filter(Boolean).join(' · ') || ' ' })),
      h('button.icon-btn.tv-fav.heart', {
        type: 'button', 'aria-pressed': String(fav), 'aria-label': fav ? `Hapus ${it.name} dari favorit` : `Tambah ${it.name} ke favorit`,
        onclick: async (e) => {
          e.stopPropagation();
          try { const on = await toggleFav(it); toast(on ? `${it.name} ditambahkan ke favorit` : `${it.name} dihapus dari favorit`); } catch (err) { toast(err.message, { type: 'error' }); }
        },
      }, icon(I.heart)));
  }

  function watch(i) {
    openTv(items, i, { isFav, toggleFav: async (it) => { const r = await toggleFav(it); tvRefreshFav(); return r; } });
  }

  /* ---------- Memuat data ---------- */
  const q = () => input.value.trim();
  const timeout = () => ({ signal: AbortSignal.timeout(30000) });

  async function fetchPage(offset) {
    const term = encodeURIComponent(q());
    if (st.tab === 'id') return get(`/api/tv?negara=ID&kategori=${encodeURIComponent(st.kategori)}&q=${term}&offset=${offset}`, timeout());
    if (st.tab === 'dunia') return get(`/api/tv?negara=${encodeURIComponent(st.negara)}&kategori=${encodeURIComponent(st.kategori)}&q=${term}&offset=${offset}`, timeout());
    if (st.tab === 'm3u') return get(`/api/tv/m3u/${st.m3u}/saluran?q=${term}&offset=${offset}`, timeout());
    // Pilihan & Favorit: daftar kecil, disaring di browser
    if (st.tab === 'pilihan') cache.pilihan = cache.pilihan || (await get('/api/tv/pilihan', timeout())).items;
    if (st.tab === 'favorit') cache.fav = (await get('/api/tv/favorit', timeout())).items;
    const src = st.tab === 'pilihan' ? cache.pilihan : cache.fav;
    const f = q().toLowerCase();
    const list = f ? src.filter((x) => x.name.toLowerCase().includes(f)) : src;
    return { total: list.length, offset: 0, items: list };
  }

  async function load(reset = true) {
    if (loading && !reset) return;
    const my = ++seq;
    if (reset) {
      items = []; total = 0; done = false;
      grid.textContent = '';
      for (let i = 0; i < 8; i++) grid.append(h('div.tv-card.skeleton', {}, h('span.tv-logo'), h('span.sk.w80'), h('span.sk.w45')));
      head.textContent = 'Memuat saluran…';
    }
    loading = true;
    more.textContent = reset ? '' : 'Memuat…';
    try {
      const r = await fetchPage(items.length);
      if (my !== seq || !alive) return;
      if (reset) grid.textContent = '';
      const start = items.length;
      items = items.concat(r.items);
      total = r.total;
      done = items.length >= total || !r.items.length;
      const frag = document.createDocumentFragment();
      r.items.forEach((it, k) => frag.append(card(it, start + k)));
      grid.append(frag);
      drawHead();
    } catch (e) {
      if (my !== seq || !alive) return;
      if (reset) grid.textContent = '';
      head.textContent = '';
      grid.append(h('div.tv-empty', {}, h('p', { text: e.name === 'TimeoutError' ? 'Server terlalu lama menjawab.' : e.message }),
        h('button.btn.sm', { type: 'button', text: 'Coba lagi', onclick: () => load(true) })));
      done = true;
    } finally {
      if (my === seq) { loading = false; more.textContent = ''; }
    }
  }

  function drawHead() {
    const term = q();
    if (!items.length) {
      head.textContent = '';
      const msg = {
        favorit: ['Belum ada favorit', 'Ketuk ♥ pada saluran untuk menyimpannya di sini — tersimpan di akun, sama di web & HP.'],
        m3u: ['Belum ada saluran', 'Link M3U ini kosong atau tidak dapat dibaca.'],
      }[st.tab] || [term ? `Tidak ada saluran “${term}”` : 'Tidak ada saluran', term ? 'Coba kata lain atau pilih kategori/negara lain.' : 'Coba kategori atau negara lain.'];
      grid.append(h('div.tv-empty', {}, h('b', { text: msg[0] }), h('p', { text: msg[1] })));
      return;
    }
    const where = { pilihan: 'Siaran resmi & pilihan admin', id: 'Indonesia', dunia: st.negara ? countryName(st.negara) : 'Seluruh dunia', favorit: 'Favorit', m3u: (cache.m3u || []).find((l) => l.id === st.m3u)?.name || 'Link saya' }[st.tab];
    head.textContent = `${where}${st.kategori && ['id', 'dunia'].includes(st.tab) ? ` · ${catName(st.kategori)}` : ''}${term ? ` · “${term}”` : ''} · ${total} saluran`;
  }

  const countryName = (code) => cache.meta?.countries.find((c) => c.code === code)?.name || code;

  /* ---------- Tab & filter ---------- */
  function drawTabs() {
    tabs.textContent = '';
    for (const [k, label] of TABS) {
      if (k === 'm3u' && !cache.m3u?.length) continue;
      tabs.append(h('button.chip-src', {
        type: 'button', role: 'tab', 'aria-selected': String(st.tab === k), 'aria-checked': String(st.tab === k), text: label,
        onclick: () => { if (st.tab === k) return; st.tab = k; if (k !== 'dunia' && k !== 'id') st.kategori = ''; save(); drawTabs(); drawFilters(); load(true); },
      }));
    }
  }

  function select(label, value, options, onChange) {
    const s = h('select.tv-select', { 'aria-label': label });
    options.forEach(([v, t]) => s.append(h('option', { value: v, text: t, selected: v === value })));
    s.addEventListener('change', () => onChange(s.value));
    return h('label.tv-sel', {}, h('span', { text: label }), s);
  }

  function drawFilters() {
    filters.textContent = '';
    const m = cache.meta;
    if (st.tab === 'id' || st.tab === 'dunia') {
      if (st.tab === 'dunia') {
        filters.append(select('Negara', st.negara, [['', `Semua negara${m ? ` (${m.total})` : ''}`], ...(m?.countries || []).map((c) => [c.code, `${c.flag} ${c.name} (${c.count})`])],
          (v) => { st.negara = v; save(); load(true); }));
      }
      filters.append(select('Kategori', st.kategori, [['', 'Semua kategori'], ...(m?.categories || []).map((c) => [c.id, `${catName(c.id)}${st.tab === 'dunia' ? ` (${c.count})` : ''}`])],
        (v) => { st.kategori = v; save(); load(true); }));
    }
    if (st.tab === 'm3u' && cache.m3u?.length > 1) {
      filters.append(select('Link', String(st.m3u), cache.m3u.map((l) => [String(l.id), l.name]), (v) => { st.m3u = Number(v); save(); load(true); }));
    }
    filters.hidden = !filters.childElementCount;
  }

  /* ---------- Gulir tak berujung (60 saluran per halaman) ---------- */
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting) && !loading && !done && items.length) load(false);
  }, { rootMargin: '600px' });
  io.observe(more);

  input.addEventListener('input', debounce(() => load(true), 350));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); load(true); } });

  page.append(
    h('div.tv-top', {}, h('h2', { text: 'TV' }), h('a.link.tv-m3u-link', { href: '#/akun?buka=m3u', text: 'Link M3U' })),
    h('div.search.radio-search', {}, h('div.search-box', {}, icon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5'], 'search-ico'), input)),
    tabs, filters, head, grid, more, foot);

  foot.textContent = `Siaran gratis dari daftar publik iptv-org, siaran langsung resmi di YouTube, dan saluran pilihan admin. Ketersediaan bergantung pada penyiar; sebagian dibatasi wilayah atau tidak siaran 24 jam.${secure ? ' Saluran bertanda “http” hanya bisa diputar di aplikasi HP.' : ''}`;

  // Data pendukung (negara/kategori, link M3U, favorit) dimuat paralel; daftar saluran tidak menunggu semuanya
  const init = async () => {
    const [meta, m3u, fav] = await Promise.allSettled([
      cache.meta ? Promise.resolve(cache.meta) : get('/api/tv/meta', timeout()),
      get('/api/tv/m3u', timeout()).then((r) => r.links),
      cache.fav ? Promise.resolve(cache.fav) : get('/api/tv/favorit', timeout()).then((r) => r.items),
    ]);
    if (!alive) return;
    if (meta.status === 'fulfilled') cache.meta = meta.value;
    if (m3u.status === 'fulfilled') cache.m3u = m3u.value;
    if (fav.status === 'fulfilled') cache.fav = fav.value;
    if (st.tab === 'm3u' && !cache.m3u?.length) { st.tab = 'pilihan'; save(); load(true); }
    if (cache.m3u?.length && !cache.m3u.some((l) => l.id === st.m3u)) st.m3u = cache.m3u[0].id;
    drawTabs(); drawFilters();
    if (st.tab !== 'pilihan') grid.querySelectorAll('.tv-card[data-id]').forEach((c) => c.querySelector('.tv-fav')?.setAttribute('aria-pressed', String(favIds().has(c.dataset.id))));
  };
  if (st.tab === 'm3u' && !st.m3u) st.tab = 'pilihan';
  drawTabs(); drawFilters();
  init();
  load(true);

  return () => { alive = false; io.disconnect(); ++seq; };
}

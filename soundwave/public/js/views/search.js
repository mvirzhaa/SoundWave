/** Halaman Cari: pencarian YouTube, pratinjau, konversi MP3/MP4, unduh / simpan ke Drive. */
import { h, icon, I, fmtDur, fmtSize, debounce, fillBars, toast } from '../ui.js';
import { get, post, api, apiUrl } from '../api.js';
import { store, emit, on, driveReady, driveWritable, invalidateTracks } from '../store.js';

let config = { mp3: [128, 192, 256, 320], mp4: [360, 480, 720, 1080] };
get('/api/config').then((c) => { config = c; }).catch(() => {});

// Hasil terakhir disimpan agar kembali ke tab Cari tidak mengulang pencarian
let last = { q: '', results: null };
let openCard = null;
on('player:start', () => openCard?._stopPreview?.());

const fmtViews = (v) => (v == null ? '' : new Intl.NumberFormat('id-ID', { notation: 'compact' }).format(v) + ' x ditonton');

export function renderSearch(view, params) {
  const input = h('input#q', {
    type: 'search', placeholder: 'Judul lagu, artis, atau tempel link YouTube', role: 'combobox',
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'suggestions',
    enterkeyhint: 'search', spellcheck: false, maxlength: 200, autocomplete: 'off',
  });
  const list = h('ul#suggestions.suggestions', { role: 'listbox', hidden: true });
  const submit = h('button.btn-primary', { type: 'submit', text: 'Cari' });
  const results = h('section.results', { 'aria-live': 'polite' });
  const bars = h('div.bars');
  fillBars(bars);

  const form = h('form.search', { role: 'search', autocomplete: 'off' },
    h('div.search-box', {}, icon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5'], 'search-ico'), input, submit), list);

  view.append(
    h('section.hero', {},
      h('div.logo', { 'aria-hidden': 'true' }, bars),
      h('h1', {}, 'Sound', h('span', { text: 'Wave' })),
      h('p.tagline', { text: 'Cari, dengarkan dulu, lalu unduh — MP3 sampai 320 kbps atau MP4 sampai 1080p.' }),
      form),
    results,
    h('p.legal', { text: 'Gunakan hanya untuk konten milik Anda, berlisensi bebas, atau yang sudah Anda kantongi izinnya.' }),
  );

  /* ---------- Autocomplete ---------- */
  let items = []; let active = -1; let abort = null; let submitted = '';
  const closeSugg = () => { list.hidden = true; list.textContent = ''; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const renderSugg = (arr, q) => {
    list.textContent = ''; items = arr; active = -1;
    if (!arr.length) return closeSugg();
    arr.forEach((text, i) => {
      const li = h('li', { id: 'sug-' + i, role: 'option', 'aria-selected': 'false' });
      if (text.toLowerCase().startsWith(q.toLowerCase())) li.append(text.slice(0, q.length), h('mark', { text: text.slice(q.length) }));
      else li.textContent = text;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = text; closeSugg(); go(text); });
      list.append(li);
    });
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  const fetchSugg = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2 || /^https?:\/\//i.test(q) || q === submitted) return closeSugg();
    abort?.abort(); abort = new AbortController();
    try {
      const arr = await api('/api/suggest?q=' + encodeURIComponent(q), { signal: abort.signal });
      if (input.value.trim() === q && q !== submitted && document.activeElement === input) renderSugg(arr, q);
    } catch { /* abaikan */ }
  }, 180);
  input.addEventListener('input', fetchSugg);
  input.addEventListener('blur', () => setTimeout(closeSugg, 100));
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      input.value = items[active];
    } else if (e.key === 'Escape') closeSugg();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); closeSugg(); const q = input.value.trim(); if (q) go(q); });

  // Setelah mencari: saran ditutup dan tidak muncul lagi untuk kata yang sama (agar tidak menutupi hasil)
  const go = (q) => { submitted = q.trim(); abort?.abort(); closeSugg(); input.blur(); location.hash = '#/cari?q=' + encodeURIComponent(q); };

  /* ---------- Pencarian ---------- */
  const q = params.get('q');
  if (q) {
    input.value = q; submitted = q.trim();
    if (last.q === q && last.results) renderResults(results, q, last.results);
    else doSearch(results, q, submit);
  } else if (last.results) {
    input.value = last.q;
    renderResults(results, last.q, last.results, false);
  }
}

async function doSearch(results, q, btn) {
  results.textContent = '';
  for (let i = 0; i < 4; i++) results.append(h('div.card.skeleton', {}, h('div.card-row', {}, h('div.thumb'), h('div.meta', {}, h('div.sk.w80'), h('div.sk.w45')))));
  btn.disabled = true;
  try {
    const data = await get('/api/search?q=' + encodeURIComponent(q));
    last = { q, results: data.results };
    renderResults(results, data.query, data.results);
  } catch (err) {
    results.textContent = '';
    results.append(h('p.state', { text: err.message }));
  } finally { btn.disabled = false; }
}

function renderResults(results, q, items, scroll = true) {
  results.textContent = '';
  openCard = null;
  if (!items.length) { results.append(h('p.state', { text: `Tidak ada hasil untuk “${q}”. Coba kata kunci lain.` })); return; }
  results.append(h('p.results-head', {}, `${items.length} hasil untuk `, h('b', { text: `“${q}”` }), '. Putar dulu untuk memastikan, lalu unduh.'));
  items.forEach((it) => results.append(buildCard(it)));
  if (scroll) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildCard(it) {
  const player = h('div.player', { hidden: true });
  const playBtn = h('button.btn.act-play', { type: 'button' }, icon(I.play), 'Putar');
  const dlBtn = h('button.btn.btn-accent', { type: 'button' }, icon(I.download), 'Unduh');
  const thumb = h('button.thumb', { type: 'button', 'aria-label': 'Putar ' + it.title },
    h('img', { alt: '', loading: 'lazy', width: 160, height: 90, src: it.thumbnail }),
    it.duration ? h('span.dur', { text: fmtDur(it.duration) }) : null,
    h('span.play-ico', { 'aria-hidden': 'true' }, icon(I.play)));
  const dl = h('div.dl');
  const panel = h('div.panel', { hidden: true }, player, dl);
  const node = h('article.card', {},
    h('div.card-row', {}, thumb, h('div.meta', {},
      h('h3.title', { text: it.title, title: it.title }),
      h('p.sub', { text: [it.channel, fmtDur(it.duration), fmtViews(it.views)].filter(Boolean).join(' · ') }),
      h('div.actions', {}, playBtn, dlBtn))),
    panel);

  const st = { format: 'mp3', quality: 320, job: null, dlShown: false };
  const open = () => { if (openCard && openCard !== node) openCard._close(); openCard = node; node.classList.add('open'); panel.hidden = false; };
  const stopPlayer = () => { player.textContent = ''; player.hidden = true; playBtn.setAttribute('aria-pressed', 'false'); };
  node._stopPreview = stopPlayer;
  node._close = () => { stopPlayer(); panel.hidden = true; node.classList.remove('open'); if (openCard === node) openCard = null; };

  const togglePlay = () => {
    if (!player.hidden) { stopPlayer(); if (!st.dlShown) node._close(); return; }
    open();
    emit('preview:start');
    player.append(h('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${it.id}?autoplay=1&rel=0&modestbranding=1`,
      title: it.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
    }));
    player.hidden = false;
    playBtn.setAttribute('aria-pressed', 'true');
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  playBtn.addEventListener('click', togglePlay);
  thumb.addEventListener('click', togglePlay);
  dlBtn.addEventListener('click', () => {
    if (node.classList.contains('open') && player.hidden) return node._close();
    st.dlShown = true; open();
    dl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  /* ---------- Panel unduh ---------- */
  const seg = h('div.seg', { role: 'tablist', 'aria-label': 'Format' });
  const qBox = h('div.qualities', { role: 'radiogroup', 'aria-label': 'Kualitas' });
  const convertBtn = h('button.btn-primary', { type: 'button', text: 'Konversi' });
  const barFill = h('i');
  const stage = h('p.stage');
  const prog = h('div.progress', { hidden: true }, h('div.bar', {}, barFill), stage);
  const ready = h('p.ready');
  const saveA = h('a.btn-primary', { download: true }, icon(I.download), 'Unduh ke perangkat');
  const driveBtn = h('button.btn', { type: 'button' }, icon(I.cloud), 'Simpan ke Google Drive');
  const driveMsg = h('p.drive-msg');
  const done = h('div.done', { hidden: true }, ready, h('div.done-actions', {}, saveA, driveBtn), driveMsg);
  const errEl = h('p.err', { hidden: true });
  dl.append(seg, qBox, convertBtn, prog, done, errEl);

  [['mp3', 'MP3 · Audio'], ['mp4', 'MP4 · Video']].forEach(([fmt, label]) => seg.append(h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(fmt === st.format), text: label, dataset: { fmt },
    onclick: (e) => {
      st.format = fmt;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === e.currentTarget)));
      renderQualities(); resetResult();
    },
  })));

  function renderQualities() {
    qBox.textContent = '';
    const opts = st.format === 'mp3' ? config.mp3 : config.mp4;
    if (!opts.includes(st.quality)) st.quality = st.format === 'mp3' ? 320 : 720;
    const hints = st.format === 'mp3' ? { 128: 'hemat', 320: 'terbaik' } : { 720: 'HD', 1080: 'Full HD' };
    opts.forEach((qv) => {
      const r = h('input', { type: 'radio', name: 'q-' + it.id, value: qv, checked: qv === st.quality, onchange: () => { st.quality = qv; resetResult(); } });
      qBox.append(h('label', {}, r, h('span', {}, st.format === 'mp3' ? `${qv} kbps` : `${qv}p`, hints[qv] ? h('small', { text: hints[qv] }) : null)));
    });
  }
  renderQualities();

  let polling = null;
  function resetResult() {
    clearTimeout(polling); st.job = null;
    convertBtn.hidden = false; convertBtn.disabled = false; convertBtn.textContent = 'Konversi';
    prog.hidden = true; done.hidden = true; errEl.hidden = true;
    driveMsg.textContent = ''; driveMsg.className = 'drive-msg';
  }

  function showDriveState(job) {
    driveMsg.className = 'drive-msg'; driveMsg.textContent = '';
    if (job.driveLink) return showDriveLink(job.driveLink);
    if (!store.user?.drive?.configured) { driveBtn.hidden = true; return; }
    driveBtn.hidden = false; driveBtn.disabled = false;
    if (driveReady() && !driveWritable()) {
      driveBtn.hidden = true;
      driveMsg.append('Mode link folder hanya untuk memutar. Pilih "Login Google" di ', h('a', { href: '#/akun', text: 'menu Akun' }), ' untuk menyimpan ke Drive.');
    } else if (!driveReady()) {
      driveBtn.hidden = true;
      driveMsg.append(store.user?.drive?.connected ? 'Atur folder Drive Anda di ' : 'Hubungkan Google Drive di ',
        h('a', { href: '#/akun', text: 'menu Akun' }), ' untuk menyimpan ke Drive.');
    }
  }
  function showDriveLink(link) {
    driveMsg.className = 'drive-msg ok';
    driveMsg.textContent = 'Tersimpan di Google Drive · ';
    driveMsg.append(h('a', { href: link, target: '_blank', rel: 'noopener', text: 'Buka di Drive' }), ' · ',
      h('a', { href: '#/pustaka', text: 'Lihat di Pustaka' }));
    driveBtn.disabled = true;
  }

  function showJob(job) {
    if (job.status === 'error') {
      prog.hidden = true; convertBtn.hidden = false; convertBtn.disabled = false; convertBtn.textContent = 'Coba lagi';
      errEl.textContent = job.error || 'Konversi gagal.'; errEl.hidden = false;
      return true;
    }
    if (job.status === 'done') {
      prog.hidden = true;
      ready.textContent = 'File siap!';
      ready.append(h('small', { text: `${job.filename} · ${fmtSize(job.size)}` }));
      saveA.href = apiUrl(`/api/jobs/${job.id}/file`);
      saveA.setAttribute('download', job.filename);
      showDriveState(job);
      done.hidden = false;
      return true;
    }
    barFill.style.width = Math.max(3, job.progress) + '%';
    stage.textContent = `${job.stage} · ${job.progress}%`;
    return false;
  }
  async function poll(id) {
    try {
      const job = await get('/api/jobs/' + id);
      st.job = job;
      if (!showJob(job)) polling = setTimeout(() => poll(id), 900);
    } catch (e) { showJob({ status: 'error', error: e.message }); }
  }
  convertBtn.addEventListener('click', async () => {
    errEl.hidden = true; convertBtn.disabled = true;
    try {
      const job = await post('/api/convert', { videoId: it.id, format: st.format, quality: st.quality });
      st.job = job; convertBtn.hidden = true; prog.hidden = false;
      if (!showJob(job)) poll(job.id);
    } catch (e) { convertBtn.disabled = false; errEl.textContent = e.message; errEl.hidden = false; }
  });
  driveBtn.addEventListener('click', async () => {
    if (!st.job) return;
    driveBtn.disabled = true;
    driveMsg.className = 'drive-msg'; driveMsg.textContent = 'Mengunggah ke Google Drive…';
    try {
      const { link } = await post(`/api/jobs/${st.job.id}/drive`, {}, { timeout: 15 * 60000 }); // unggah file besar bisa lama
      invalidateTracks();
      showDriveLink(link);
      toast('Tersimpan ke Google Drive', { action: { label: 'Buka Pustaka', run: () => { location.hash = '#/pustaka'; } } });
    } catch (e) {
      driveBtn.disabled = false; driveMsg.className = 'err'; driveMsg.textContent = e.message;
    }
  });
  return node;
}

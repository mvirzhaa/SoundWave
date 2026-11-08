/** Panel superadmin: ringkasan, pengguna (aktif/nonaktif), suara adzan global, pengumuman + push. */
import { h, icon, toast, confirmDialog, debounce } from './ui.js';
import { apiUrl } from './api.js';

const $ = (id) => document.getElementById(id);
const view = $('adminView');

let adminToken = (() => {
  try { return sessionStorage.getItem('sw_admin_token') || null; } catch { return null; }
})();

function setAdminToken(t) {
  adminToken = t;
  try {
    if (t) sessionStorage.setItem('sw_admin_token', t);
    else sessionStorage.removeItem('sw_admin_token');
  } catch { /* abaikan */ }
}

/* ---------- API khusus admin (cookie sw_admin, path /api/admin) ---------- */
async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const authHeaders = {};
  if (adminToken) authHeaders['Authorization'] = `Bearer ${adminToken}`;
  const opts = { method, credentials: 'same-origin', headers: { 'X-SW-CSRF': '1', ...authHeaders, ...headers } };
  if (raw) opts.body = raw;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(apiUrl(`/api/admin${path}`), opts); } catch { throw new Error('Tidak dapat terhubung ke server.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'ADMIN_UNAUTHENTICATED' && path !== '/login') {
    setAdminToken(null);
    showLogin();
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error(data.error || `Kesalahan ${res.status}`);
  return data;
}

const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
function ago(ms) {
  if (!ms) return 'belum pernah';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const hh = Math.round(m / 60);
  if (hh < 24) return `${hh} jam lalu`;
  return `${Math.round(hh / 24)} hari lalu`;
}

/* ---------- Login ---------- */
const form = $('adminForm');
function showLogin() { $('adminApp').hidden = true; $('adminLogin').hidden = false; form.email.focus(); }
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('adminErr').hidden = true;
  $('adminSubmit').disabled = true;
  try {
    const res = await api('/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
    if (res?.token) setAdminToken(res.token);
    form.password.value = '';
    enter();
  } catch (er) { $('adminErr').textContent = er.message; $('adminErr').hidden = false; }
  $('adminSubmit').disabled = false;
});

let me = null;
async function enter() {
  try {
    const r = await api('/me');
    if (!r?.admin) throw new Error('Bukan admin');
    me = r.admin;
  } catch {
    showLogin();
    return;
  }
  $('adminLogin').hidden = true;
  $('adminApp').hidden = false;
  route();
}

/* ---------- Routing ---------- */
function route() {
  const sec = location.hash.slice(1) || 'ringkasan';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === sec));
  view.textContent = '';
  const page = h('section.page.admin');
  view.append(page);
  ({ ringkasan, pengguna, adzan, lirik, tv, pengumuman, akun }[sec] || ringkasan)(page);
}
window.addEventListener('hashchange', () => { if (me) route(); });

/* ---------- Ringkasan ---------- */
async function ringkasan(page) {
  page.append(h('h2', { text: 'Ringkasan' }), h('p.state', { text: 'Memuat…' }));
  try {
    const s = await api('/stats');
    page.lastChild?.remove();
    if (!s || !s.users) throw new Error('Data statistik tidak valid dari server.');
    const card = (label, value, sub) => h('div.panel-card.stat', {}, h('small', { text: label }), h('b', { text: String(value ?? 0) }), sub ? h('span.muted', { text: sub }) : null);
    page.append(h('div.stats', {},
      card('Pengguna', s.users?.total ?? 0, `${s.users?.aktif ?? 0} aktif · ${s.users?.nonaktif ?? 0} nonaktif`),
      card('Aktif 7 hari', s.users?.aktif7 ?? 0, 'membuka web/aplikasi'),
      card('Terhubung Drive', s.users?.drive ?? 0, 'login Google / link folder'),
      card('Perangkat HP', s.perangkat ?? 0, 'menerima push notification'),
      card('Lirik di server', s.lirik?.total ?? 0, `${s.lirik?.synced ?? 0} tersinkron · dipakai ulang ${s.lirik?.hits ?? 0}×`)),
    h('div.panel-card', {},
      h('h3', { text: 'Suara adzan global' }),
      h('div.status-line', {}, h(`span.dot.${s.adzan?.tersedia ? 'ok' : 'warn'}`), h('span', { text: s.adzan?.tersedia ? `Umum: ${s.adzan.nama?.umum}` : 'Belum ada suara adzan umum' })),
      h('div.status-line', {}, h(`span.dot.${s.adzan?.subuh ? 'ok' : 'warn'}`), h('span', { text: s.adzan?.subuh ? `Subuh: ${s.adzan.nama?.subuh}` : 'Subuh memakai suara umum' })),
      h('div.status-line', {}, h(`span.dot.${s.adzan?.paksa ? 'ok' : 'warn'}`), h('span', { text: s.adzan?.paksa ? 'Dipakai di semua akun (pilihan pengguna diabaikan)' : 'Bawaan — pengguna boleh memilih suara sendiri' })),
      h('a.btn', { href: '#adzan', text: 'Atur suara adzan' })),
    ytdlpCard());
  } catch (e) { if (page.lastChild) page.lastChild.textContent = e.message; }
}

/** Mesin unduh YouTube: versi + tombol perbarui. YouTube sering mengubah sistemnya; bila unduhan MP3/MP4
 *  gagal dengan pesan aneh (mis. "… is not defined"), memperbarui yt-dlp biasanya langsung memperbaikinya. */
function ytdlpCard() {
  const ver = h('span', { text: 'Memeriksa versi…' });
  const dot = h('span.dot.warn');
  const out = h('pre.ytdlp-out', { hidden: true });
  const btn = h('button.btn', { type: 'button', text: 'Perbarui yt-dlp' });
  const show = (v) => { dot.className = `dot ${v ? 'ok' : 'warn'}`; ver.textContent = v ? `Versi terpasang: ${v}` : 'yt-dlp tidak ditemukan di server'; };
  api('/ytdlp').then((d) => show(d.version)).catch((e) => { ver.textContent = e.message; });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Memperbarui… (bisa 1–2 menit)';
    try {
      const d = await api('/ytdlp/update', { method: 'POST' });
      show(d.after);
      out.textContent = d.output || '(tidak ada keluaran)'; out.hidden = false;
      toast(d.before !== d.after ? `yt-dlp diperbarui: ${d.before || '?'} → ${d.after || '?'}` : d.ok ? 'yt-dlp sudah versi terbaru' : 'Pembaruan otomatis gagal — lihat keterangan');
    } catch (e) { toast(e.message, { type: 'error' }); }
    btn.disabled = false; btn.textContent = 'Perbarui yt-dlp';
  });
  return h('div.panel-card', {},
    h('h3', { text: 'Mesin unduh YouTube (yt-dlp)' }),
    h('div.status-line', {}, dot, ver),
    h('p.muted', { text: 'Bila unduhan MP3/MP4 gagal dengan pesan seperti "… is not defined" atau "Requested format is not available", YouTube baru mengubah sistemnya — perbarui yt-dlp. Tombol ini menjalankan "yt-dlp -U" (untuk yt-dlp versi .exe/binary). Bila dipasang lewat pip: pip install -U "yt-dlp[default]".' }),
    btn, out);
}

/* ---------- Pengguna ---------- */
function pengguna(page) {
  let q = ''; let status = 'semua'; let pageNo = 1;
  const input = h('input', { type: 'search', placeholder: 'Cari nama atau email…', 'aria-label': 'Cari pengguna' });
  const box = h('div');
  const statusSeg = h('div.sources', { role: 'radiogroup' }, [['semua', 'Semua'], ['aktif', 'Aktif'], ['nonaktif', 'Nonaktif']].map(([k, label]) => h('button.chip-src', {
    type: 'button', role: 'radio', 'aria-checked': String(status === k), text: label,
    onclick: (e) => { status = k; pageNo = 1; statusSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget))); load(); },
  })));
  input.addEventListener('input', debounce(() => { q = input.value.trim(); pageNo = 1; load(); }, 300));
  page.append(h('h2', { text: 'Pengguna' }), h('div.admin-tools', {}, h('div.search-box.admin-search', {}, icon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5']), input), statusSeg), box);

  async function load() {
    box.textContent = '';
    box.append(h('p.state', { text: 'Memuat…' }));
    let r;
    try { r = await api(`/users?q=${encodeURIComponent(q)}&status=${status}&page=${pageNo}`); } catch (e) { box.firstChild.textContent = e.message; return; }
    box.textContent = '';
    box.append(h('p.muted', { text: `${r.total} pengguna` }));
    const table = h('div.utable', { role: 'table' },
      h('div.urow.uhead', { role: 'row' }, ['Pengguna', 'Drive', 'Terakhir aktif', 'Status'].map((t) => h('span', { role: 'columnheader', text: t }))));
    r.users.forEach((u) => {
      const sw = h('input', { type: 'checkbox', checked: u.aktif, 'aria-label': `Aktifkan ${u.email}` });
      sw.addEventListener('change', async () => {
        const want = sw.checked;
        if (!want && !(await confirmDialog(`Nonaktifkan ${u.name}?`, `${u.email} akan langsung keluar dari web & aplikasi dan tidak bisa masuk sampai diaktifkan lagi. Data & playlist-nya tetap tersimpan.`, { ok: 'Nonaktifkan', danger: true }))) { sw.checked = true; return; }
        try { await api(`/users/${u.id}`, { method: 'PATCH', body: { aktif: want } }); toast(want ? `${u.email} diaktifkan` : `${u.email} dinonaktifkan`); load(); }
        catch (e) { sw.checked = !want; toast(e.message, { type: 'error' }); }
      });
      table.append(h(`div.urow${u.aktif ? '' : '.off'}`, { role: 'row' },
        h('span.ucell', { role: 'cell' }, h('b', { text: u.name }), h('small', { text: u.email }), h('small', { text: `Daftar ${fmtTime(u.createdAt)}${u.perangkat ? ` · ${u.perangkat} HP` : ''}` })),
        h('span', { role: 'cell', text: u.drive === 'google' ? `Login Google${u.folder ? ` · ${u.folder}` : ''}` : u.drive === 'link' ? `Link folder${u.folder ? ` · ${u.folder}` : ''}` : '–' }),
        h('span', { role: 'cell', text: ago(u.lastSeen), title: fmtTime(u.lastSeen) }),
        h('label.toggle-row.ustatus', { role: 'cell' }, h('span', { text: u.aktif ? 'Aktif' : 'Nonaktif' }), h('span.switch', {}, sw, h('i')))));
    });
    box.append(table);
    if (r.pages > 1) {
      box.append(h('div.btn-row.pager', {},
        h('button.btn', { type: 'button', text: '← Sebelumnya', disabled: pageNo <= 1, onclick: () => { pageNo--; load(); } }),
        h('span.muted', { text: `Halaman ${r.page} / ${r.pages}` }),
        h('button.btn', { type: 'button', text: 'Berikutnya →', disabled: pageNo >= r.pages, onclick: () => { pageNo++; load(); } })));
    }
  }
  load();
}

/* ---------- Suara adzan ---------- */
async function adzan(page) {
  page.append(h('h2', { text: 'Suara adzan' }));
  const body = h('div');
  page.append(body);
  let st;
  const draw = () => {
    body.textContent = '';
    const slot = (jenis, label, desc) => {
      const has = jenis === 'umum' ? st.tersedia : st.subuh;
      const file = h('input', { type: 'file', accept: 'audio/*', hidden: true });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) { toast('File maksimal 20 MB', { type: 'error' }); return; }
        btn.disabled = true; btn.textContent = 'Mengunggah…';
        try {
          st = await api(`/adzan/${jenis}`, { method: 'POST', raw: f, headers: { 'Content-Type': f.type || 'audio/mpeg', 'X-File-Name': encodeURIComponent(f.name) } });
          toast(`Suara ${label.toLowerCase()} diganti`); draw();
        } catch (e) { toast(e.message, { type: 'error' }); btn.disabled = false; btn.textContent = has ? 'Ganti file' : 'Unggah file'; }
      });
      const btn = h('button.btn-primary', { type: 'button', text: has ? 'Ganti file' : 'Unggah file', onclick: () => file.click() });
      return h('div.panel-card', {},
        h('h3', { text: label }),
        h('p.muted', { text: desc }),
        has ? h('div.status-line', {}, h('span.dot.ok'), h('span', { text: st.nama[jenis] })) : h('div.status-line', {}, h('span.dot.warn'), h('span', { text: jenis === 'umum' ? 'Belum ada file' : 'Belum ada — memakai suara umum' })),
        has ? h('audio', { controls: true, preload: 'none', src: `/api/admin/adzan/${jenis}/file?v=${encodeURIComponent(st.versi || '')}` }) : null,
        h('div.btn-row', {}, btn, file,
          has ? h('button.link.danger', { type: 'button', text: 'Hapus', onclick: async () => {
            if (!(await confirmDialog(`Hapus suara adzan ${label.toLowerCase()}?`, jenis === 'umum' ? 'Pengguna tidak akan punya suara adzan bawaan sampai Anda mengunggah lagi.' : 'Subuh akan memakai suara adzan umum.', { ok: 'Hapus', danger: true }))) return;
            try { st = await api(`/adzan/${jenis}`, { method: 'DELETE' }); draw(); } catch (e) { toast(e.message, { type: 'error' }); }
          } }) : null));
    };
    const paksa = h('input', { type: 'checkbox', checked: st.paksa, disabled: !st.tersedia });
    paksa.addEventListener('change', async () => {
      try { st = await api('/adzan', { method: 'PUT', body: { paksa: paksa.checked } }); toast(st.paksa ? 'Semua akun memakai suara adzan ini' : 'Pengguna boleh memilih suara sendiri'); draw(); }
      catch (e) { paksa.checked = !paksa.checked; toast(e.message, { type: 'error' }); }
    });
    body.append(
      h('div.admin-grid', {},
        slot('umum', 'Adzan umum', 'Dipakai untuk Dzuhur, Ashar, Maghrib, Isya — dan Subuh bila tidak ada file khusus.'),
        slot('subuh', 'Adzan Subuh', 'Opsional: adzan Subuh dengan "ash-shalatu khairum minan naum".')),
      h('div.panel-card', {},
        h('h3', { text: 'Berlaku untuk' }),
        h('label.toggle-row', {}, h('span', { text: 'Pakai suara ini di semua akun web & aplikasi mobile (abaikan suara pilihan pengguna)' }), h('span.switch', {}, paksa, h('i'))),
        h('p.hint', { text: 'Jika mati: suara di atas menjadi bawaan, pengguna tetap boleh memilih lagu/file sendiri sebagai suara adzan. Aplikasi mobile mengunduh ulang suara adzan otomatis saat file diganti.' }),
        h('p.hint', { text: 'Format: MP3 / M4A / OGG / WAV, maks. 20 MB. Gunakan rekaman yang Anda miliki atau berlisensi bebas.' })));
  };
  try { st = await api('/adzan'); draw(); } catch (e) { body.append(h('p.state.err', { text: e.message })); }
}

/* ---------- TV: saluran pilihan ---------- */
function tv(page) {
  const box = h('div', {}, h('p.muted', { text: 'Memuat…' }));
  const status = h('p.muted.src-line');
  page.append(h('h2', { text: 'Saluran TV pilihan' }),
    h('p.muted', { text: 'Tampil paling atas di tab “Pilihan” menu TV (web & HP). YouTube: isi @handle, ID kanal (UC…), atau link kanal — server mencari siaran langsung yang sedang berjalan. HLS: link .m3u8 yang Anda punya izinnya (mis. TV kampus).' }),
    status, box);
  const field = (label, el) => h('label.field', {}, h('span', { text: label }), el);

  function form(cur, done) {
    const name = h('input', { value: cur?.name || '', required: true, maxlength: 80 });
    const kind = h('select', {}, h('option', { value: 'youtube', text: 'YouTube Live', selected: cur?.kind !== 'hls' }), h('option', { value: 'hls', text: 'Link HLS (.m3u8)', selected: cur?.kind === 'hls' }));
    const src = h('input', { value: cur?.src || '', required: true, maxlength: 500, placeholder: '@kanal, UC…, atau https://…/index.m3u8' });
    const logo = h('input', { value: cur?.logo || '', maxlength: 500, placeholder: 'https://…/logo.png (opsional)' });
    const country = h('input', { value: cur?.country || 'ID', maxlength: 2, style: 'text-transform:uppercase' });
    const category = h('input', { value: cur?.category || '', maxlength: 30, placeholder: 'news, general, religious…' });
    const sort = h('input', { type: 'number', value: cur?.sort ?? 100 });
    const err = h('p.err', { hidden: true });
    return h('form.grid-form.tv-form', { onsubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      const body = { name: name.value, kind: kind.value, src: src.value, logo: logo.value, country: country.value, category: category.value, sort: Number(sort.value) };
      try { await api(cur ? `/tv/${cur.id}` : '/tv', { method: cur ? 'PATCH' : 'POST', body }); toast(cur ? 'Saluran disimpan' : 'Saluran ditambahkan'); done(); }
      catch (er) { err.textContent = er.message; err.hidden = false; }
    } }, field('Nama', name), field('Jenis', kind), field('Sumber', src), field('Logo', logo), field('Negara (kode 2 huruf)', country), field('Kategori', category), field('Urutan', sort), err,
    h('div.btn-row', {}, h('button.btn-primary', { type: 'submit', text: cur ? 'Simpan' : 'Tambah saluran' }), cur ? h('button.btn', { type: 'button', text: 'Batal', onclick: done }) : null));
  }

  async function load() {
    let r;
    try { r = await api('/tv'); } catch (e) { box.textContent = e.message; return; }
    const i = r.iptv;
    status.textContent = `Daftar publik iptv-org: ${i.siap ? `${i.kanal} kanal, diperbarui ${fmtTime(i.diperbarui)}` : 'belum tersedia'}${i.memuat ? ' · sedang memperbarui…' : ''}${i.galat ? ` · galat terakhir: ${i.galat}` : ''}`;
    box.textContent = '';
    const table = h('div.utable.tvtable', { role: 'table' },
      h('div.urow.uhead', { role: 'row' }, ['Saluran', 'Sumber', 'Status', ''].map((t) => h('span', { role: 'columnheader', text: t }))));
    r.saluran.forEach((x) => {
      const st = h('span', { role: 'cell', text: x.kind === 'youtube' ? (x.live ? (x.live.videoId ? 'Siaran langsung ✓' : x.live.error || 'Tidak siaran') : 'Belum dicek') : 'HLS' });
      const edit = h('div.tv-edit', { hidden: true });
      table.append(h(`div.urow${x.active ? '' : '.off'}`, { role: 'row' },
        h('span.ucell', { role: 'cell' }, h('b', { text: x.name }), h('small', { text: `${x.country}${x.category ? ` · ${x.category}` : ''} · urutan ${x.sort}${x.active ? '' : ' · disembunyikan'}` }), edit),
        h('span.ucell', { role: 'cell' }, h('small', { text: `${x.kind === 'youtube' ? 'YouTube' : 'HLS'}: ${x.src}` })),
        st,
        h('span.btn-row', { role: 'cell' },
          x.kind === 'youtube' ? h('button.link', { type: 'button', text: 'Cek', onclick: async (e) => {
            e.target.textContent = 'Mengecek…';
            try { const c = await api(`/tv/${x.id}/cek`, { method: 'POST' }); st.textContent = c.ok ? 'Siaran langsung ✓' : c.error; } catch (er) { st.textContent = er.message; }
            e.target.textContent = 'Cek';
          } }) : null,
          h('button.link', { type: 'button', text: 'Ubah', onclick: () => { edit.hidden = !edit.hidden; if (!edit.hidden) { edit.textContent = ''; edit.append(form(x, load)); } } }),
          h('button.link', { type: 'button', text: x.active ? 'Sembunyikan' : 'Tampilkan', onclick: async () => {
            try { await api(`/tv/${x.id}`, { method: 'PATCH', body: { active: !x.active } }); load(); } catch (er) { toast(er.message, { type: 'error' }); }
          } }),
          h('button.link.danger', { type: 'button', text: 'Hapus', onclick: async () => {
            if (!(await confirmDialog('Hapus saluran?', `“${x.name}” dihapus dari tab Pilihan dan dari favorit pengguna.`, { ok: 'Hapus', danger: true }))) return;
            try { await api(`/tv/${x.id}`, { method: 'DELETE' }); toast('Saluran dihapus'); load(); } catch (er) { toast(er.message, { type: 'error' }); }
          } }))));
    });
    box.append(table,
      h('div.panel-card', {}, h('h3', { text: 'Tambah saluran' }), form(null, load)),
      h('div.btn-row', {}, h('button.btn', { type: 'button', text: 'Perbarui daftar iptv-org sekarang', onclick: async () => {
        try { await api('/tv-refresh', { method: 'POST' }); toast('Pembaruan berjalan di latar belakang (±1 menit)'); setTimeout(load, 4000); } catch (er) { toast(er.message, { type: 'error' }); }
      } })));
  }
  load();
}

/* ---------- Database lirik ---------- */
function lirik(page) {
  let q = ''; let pageNo = 1;
  const input = h('input', { type: 'search', placeholder: 'Cari judul atau artis…', 'aria-label': 'Cari lirik' });
  const head = h('div');
  const box = h('div');
  input.addEventListener('input', debounce(() => { q = input.value.trim(); pageNo = 1; load(); }, 300));
  page.append(h('h2', { text: 'Database lirik' }), head,
    h('div.admin-tools', {}, h('div.search-box.admin-search', {}, icon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5']), input)), box);
  const SRC = { lrclib: 'LRCLIB', youtube: 'Subtitle YouTube', 'youtube-auto': 'YouTube otomatis' };
  const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '–');

  async function load() {
    box.textContent = '';
    box.append(h('p.state', { text: 'Memuat…' }));
    let r;
    try { r = await api(`/lirik?q=${encodeURIComponent(q)}&page=${pageNo}`); } catch (e) { box.firstChild.textContent = e.message; return; }
    head.textContent = '';
    head.append(h('div.stats', {},
      h('div.panel-card.stat', {}, h('small', { text: 'Lagu tersimpan' }), h('b', { text: String(r.stats.total) }), h('span.muted', { text: `${r.stats.synced} tersinkron` })),
      h('div.panel-card.stat', {}, h('small', { text: 'Dipakai ulang dari server' }), h('b', { text: String(r.stats.hits) }), h('span.muted', { text: 'kali tanpa mencari ke luar' })),
      h('div.panel-card.stat', {}, h('small', { text: 'Sumber' }), h('b', { text: String(r.stats.lrclib) }), h('span.muted', { text: `LRCLIB · ${r.stats.youtube} YouTube` }))),
    h('p.hint', { text: 'Lirik yang sudah ditemukan satu pengguna disimpan di sini dan dipakai semua akun & HP. Hapus lirik yang salah agar dicari ulang dari sumber luar saat diputar berikutnya.' }));
    box.textContent = '';
    if (!r.items.length) { box.append(h('p.muted', { text: q ? 'Tidak ada yang cocok.' : 'Belum ada lirik tersimpan.' })); return; }
    const table = h('div.utable.ltable', { role: 'table' },
      h('div.urow.uhead', { role: 'row' }, ['Lagu', 'Sumber', 'Dipakai', ''].map((t) => h('span', { role: 'columnheader', text: t }))));
    r.items.forEach((x) => {
      const preview = h('pre.lyr-preview', { hidden: true });
      table.append(h('div.urow', { role: 'row' },
        h('span.ucell', { role: 'cell' }, h('b', { text: x.title }), h('small', { text: `${x.artist || 'Artis tidak diketahui'} · ${fmtDur(x.duration)}` }), preview),
        h('span', { role: 'cell', text: `${SRC[x.source] || x.source}${x.instrumental ? ' · instrumental' : x.synced ? ' · tersinkron' : ' · teks'}` }),
        h('span', { role: 'cell', text: `${x.hits}×`, title: `Terakhir ${fmtTime(x.lastHitAt)}` }),
        h('span.btn-row', { role: 'cell' },
          h('button.link', { type: 'button', text: 'Lihat', onclick: async (e) => {
            if (!preview.hidden) { preview.hidden = true; e.target.textContent = 'Lihat'; return; }
            try {
              const d = (await api(`/lirik/${x.id}`)).data;
              preview.textContent = d.synced ? d.lines.map((l) => `[${Math.floor(l.t / 60)}:${(l.t % 60).toFixed(1).padStart(4, '0')}] ${l.text}`).join('\n') : d.plain || '(instrumental)';
              preview.hidden = false; e.target.textContent = 'Tutup';
            } catch (er) { toast(er.message, { type: 'error' }); }
          } }),
          h('button.link.danger', { type: 'button', text: 'Hapus', onclick: async () => {
            if (!(await confirmDialog('Hapus lirik ini?', `Lirik “${x.title}” dihapus dari server dan akan dicari ulang dari LRCLIB/YouTube saat diputar berikutnya.`, { ok: 'Hapus', danger: true }))) return;
            try { await api(`/lirik/${x.id}`, { method: 'DELETE' }); toast('Lirik dihapus'); load(); } catch (er) { toast(er.message, { type: 'error' }); }
          } }))));
    });
    box.append(table);
    if (r.pages > 1) {
      box.append(h('div.btn-row.pager', {},
        h('button.btn', { type: 'button', text: '← Sebelumnya', disabled: pageNo <= 1, onclick: () => { pageNo--; load(); } }),
        h('span.muted', { text: `Halaman ${r.page} / ${r.pages}` }),
        h('button.btn', { type: 'button', text: 'Berikutnya →', disabled: pageNo >= r.pages, onclick: () => { pageNo++; load(); } })));
    }
  }
  load();
}

/* ---------- Pengumuman ---------- */
async function pengumuman(page) {
  page.append(h('h2', { text: 'Pengumuman' }));
  const title = h('input', { maxlength: 120, required: true, placeholder: 'Judul singkat' });
  const body = h('textarea', { maxlength: 4000, rows: 4, required: true, placeholder: 'Isi pengumuman untuk semua pengguna…' });
  const link = h('input', { type: 'url', placeholder: 'https://… (opsional)' });
  const penting = h('input', { type: 'checkbox' });
  const pushChk = h('input', { type: 'checkbox', checked: true });
  const listBox = h('div');
  const err = h('p.err', { hidden: true });
  const info = h('p.hint');
  page.append(
    h('form.panel-card.grid-form', { onsubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      const btn = e.submitter; btn.disabled = true;
      try {
        const r = await api('/pengumuman', { method: 'POST', body: { title: title.value, body: body.value, link: link.value, level: penting.checked ? 'penting' : 'info', push: pushChk.checked } });
        toast(r.push ? `Terkirim · push: ${r.push.ok} berhasil, ${r.push.fail} gagal dari ${r.push.total} HP` : 'Pengumuman disimpan');
        title.value = ''; body.value = ''; link.value = ''; penting.checked = false;
        load();
      } catch (er) { err.textContent = er.message; err.hidden = false; }
      btn.disabled = false;
    } },
      h('h3', { text: 'Kirim pengumuman baru' }),
      h('label.field', {}, h('span', { text: 'Judul' }), title),
      h('label.field', {}, h('span', { text: 'Isi' }), body),
      h('label.field', {}, h('span', { text: 'Tautan' }), link),
      h('label.toggle-row', {}, h('span', { text: 'Tandai penting (pop-up tetap muncul sampai ditutup)' }), h('span.switch', {}, penting, h('i'))),
      h('label.toggle-row', {}, h('span', { text: 'Kirim push notification ke HP pengguna' }), h('span.switch', {}, pushChk, h('i'))),
      info, err,
      h('button.btn-primary', { type: 'submit', text: 'Kirim ke semua pengguna' })),
    h('h3.section-title', { text: 'Riwayat' }),
    listBox);

  async function load() {
    listBox.textContent = '';
    try {
      const r = await api('/pengumuman');
      info.textContent = `Pengumuman tampil sebagai pop-up di aplikasi mobile & web, dan tersimpan di menu Pengumuman. Push dikirim ke ${r.perangkat} HP terdaftar.`;
      if (!r.pengumuman.length) { listBox.append(h('p.muted', { text: 'Belum ada pengumuman.' })); return; }
      r.pengumuman.forEach((a) => listBox.append(h(`div.panel-card.ann${a.level === 'penting' ? '.penting' : ''}`, {},
        h('div.ann-head', {}, h('b', { text: a.title }), a.level === 'penting' ? h('span.badge-penting', { text: 'Penting' }) : null,
          h('button.link.danger', { type: 'button', text: 'Hapus', onclick: async () => {
            if (!(await confirmDialog('Hapus pengumuman?', 'Pengumuman tidak lagi tampil di aplikasi. Push yang sudah terkirim tidak bisa ditarik.', { ok: 'Hapus', danger: true }))) return;
            try { await api(`/pengumuman/${a.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, { type: 'error' }); }
          } })),
        h('p', { text: a.body }),
        a.link ? h('a', { href: a.link, target: '_blank', rel: 'noopener', text: a.link }) : null,
        h('small.muted', { text: `${fmtTime(a.createdAt)} · dibaca ${a.reads} pengguna · push ${a.pushOk} berhasil${a.pushFail ? `, ${a.pushFail} gagal` : ''}` }))));
    } catch (e) { listBox.append(h('p.state.err', { text: e.message })); }
  }
  load();
}

/* ---------- Akun admin ---------- */
function akun(page) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const nxt = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  page.append(h('h2', { text: 'Akun admin' }),
    h('div.panel-card', {}, h('div.profile', {}, h('span.avatar', { text: (me.name || 'A').charAt(0) }), h('div', {}, h('b', { text: me.name }), h('small', { text: me.email })))),
    h('form.panel-card.grid-form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await api('/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); cur.value = ''; nxt.value = ''; toast('Kata sandi admin diganti'); }
      catch (er) { toast(er.message, { type: 'error' }); }
    } }, h('h3', { text: 'Ganti kata sandi' }), h('label.field', {}, h('span', { text: 'Kata sandi lama' }), cur), h('label.field', {}, h('span', { text: 'Kata sandi baru (min. 10)' }), nxt), h('button.btn', { type: 'submit', text: 'Ganti kata sandi' })),
    h('button.btn', { type: 'button', text: 'Keluar dari panel admin', onclick: async () => {
      await api('/logout', { method: 'POST' }).catch(() => {});
      setAdminToken(null);
      me = null;
      showLogin();
    } }));
}

/* ---------- Mulai ---------- */
try { const t = localStorage.getItem('sw-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* abaikan */ }
api('/me').then(() => enter()).catch(() => showLogin());

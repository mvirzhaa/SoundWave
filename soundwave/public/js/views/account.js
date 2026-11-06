/** Halaman Akun: profil, koneksi Google Drive & folder penyimpanan, kata sandi, keluar. */
import { h, icon, I, toast, confirmDialog } from '../ui.js';
import { post, put, patch, del } from '../api.js';
import { ann, markRead } from '../announce.js';
import { store, setUser, invalidateTracks } from '../store.js';

export function renderAccount(view, params, { logout }) {
  const page = h('section.page.account');
  view.append(page);

  // Pesan hasil OAuth Google (redirect dari /api/drive/callback)
  const st = params.get('drive');
  if (st === 'connected') toast('Google Drive berhasil terhubung.');
  else if (st && st !== 'connected') toast(params.get('message') || 'Gagal menghubungkan Google Drive.', { type: 'error' });
  if (st) history.replaceState(null, '', '#/akun');

  const draw = () => {
    const u = store.user;
    const d = u.drive;
    page.textContent = '';
    page.append(h('h2', { text: 'Akun' }));

    /* Profil */
    const nameIn = h('input', { value: u.name, maxlength: 80, 'aria-label': 'Nama' });
    page.append(h('div.panel-card', {},
      h('div.profile', {}, h('span.avatar', { text: (u.name || '?').trim().charAt(0).toUpperCase() }),
        h('div', {}, h('b', { text: u.name }), h('small', { text: u.email })))));
    page.append(section('profil', icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'), 'Profil', u.name, h('div', {},
      h('form.row-form', { onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await patch('/api/auth/me', { name: nameIn.value }); setUser(r.user); toast('Nama disimpan'); draw(); } catch (er) { toast(er.message, { type: 'error' }); }
      } }, h('label.field.grow', {}, h('span', { text: 'Nama tampilan' }), nameIn), h('button.btn', { type: 'submit', text: 'Simpan' })))));

    /* Google Drive — dua mode */
    page.append(section('drive', icon(I.cloud), 'Google Drive', driveSummary(d), driveCard(d)));

    /* Kata sandi */
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const nxt = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
    /* Pengumuman dari admin (tersimpan) */
    const annBody = h('div.ann-list');
    const drawAnn = () => {
      annBody.textContent = '';
      if (!ann.list.length) { annBody.append(h('p.muted', { text: 'Belum ada pengumuman.' })); return; }
      ann.list.forEach((a) => annBody.append(h(`div.panel-card.ann${a.level === 'penting' ? '.penting' : ''}`, {},
        h('div.ann-head', {}, h('b', { text: a.title }), a.level === 'penting' ? h('span.badge-penting', { text: 'Penting' }) : null, a.read ? null : h('span.dot.ok', { title: 'Baru' })),
        h('p', { text: a.body }),
        a.link ? h('a', { href: a.link, target: '_blank', rel: 'noopener', text: a.link }) : null,
        h('small.muted', { text: new Date(a.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) }))));
      const unread = ann.list.filter((x) => !x.read).map((x) => x.id);
      if (unread.length) markRead(unread);
    };
    page.append(section('pengumuman', icon('M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6'), 'Pengumuman',
      ann.unread ? `${ann.unread} belum dibaca` : `${ann.list.length} pengumuman`, annBody));
    drawAnn();

    page.append(section('sandi', icon('M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4'), 'Ganti kata sandi', 'Perangkat lain otomatis keluar', h('div', {},
      h('form.grid-form', { onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await post('/api/auth/password', { current: cur.value, next: nxt.value }); setUser(r.user); cur.value = nxt.value = ''; toast('Kata sandi diganti. Perangkat lain otomatis keluar.'); } catch (er) { toast(er.message, { type: 'error' }); }
      } },
      h('label.field', {}, h('span', { text: 'Kata sandi lama' }), cur),
      h('label.field', {}, h('span', { text: 'Kata sandi baru (min. 8)' }), nxt),
      h('button.btn', { type: 'submit', text: 'Ganti kata sandi' })))));

    /* Keluar */
    page.append(h('div.panel-card', {}, h('div.btn-row', {},
      h('button.btn', { type: 'button', text: 'Keluar', onclick: () => logout(false) }),
      h('button.link.danger', { type: 'button', text: 'Keluar dari semua perangkat', onclick: () => logout(true) }))));
  };

  /** Bagian akordion (<details>); status buka/tutup diingat per bagian. */
  function section(key, ico, title, summary, body) {
    const open = (() => { try { return JSON.parse(localStorage.getItem('sw-acc') || '{}')[key]; } catch { return undefined; } })();
    const el = h('details.panel-card.acc', { open: open ?? key === 'drive' },
      h('summary', {}, h('span.acc-ico', {}, ico), h('span.acc-title', {}, h('b', { text: title }), summary ? h('small', { text: summary }) : null),
        icon('m6 9 6 6 6-6')),
      h('div.acc-body', {}, body));
    el.addEventListener('toggle', () => {
      try { const m = JSON.parse(localStorage.getItem('sw-acc') || '{}'); m[key] = el.open; localStorage.setItem('sw-acc', JSON.stringify(m)); } catch { /* abaikan */ }
    });
    return el;
  }

  function driveSummary(d) {
    if (d.ready) return `${d.mode === 'link' ? 'Link folder' : 'Login Google'} · ${d.folderName || d.folderId}`;
    if (d.connected) return 'Terhubung · folder belum diatur';
    return 'Belum diatur';
  }

  let driveTab = null;
  function driveCard(d) {
    const box = h('div.drive-modes');
    const tab = driveTab || (d.mode === 'link' ? 'link' : d.mode === 'oauth' ? 'oauth' : d.linkAvailable && !d.configured ? 'link' : 'oauth');
    const seg = h('div.seg.mode-seg', { role: 'tablist' },
      [['link', 'Link folder', 'Hanya memutar'], ['oauth', 'Login Google', 'Putar + simpan']].map(([k, label, sub]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(tab === k),
        onclick: () => { driveTab = k; draw(); },
      }, h('b', { text: label }), h('small', { text: sub }), d.mode === k ? h('span.dot.ok') : null)));
    box.append(seg);
    if (tab === 'link') box.append(linkPane(d)); else box.append(oauthPane(d));
    return box;
  }

  function linkPane(d) {
    if (!d.linkAvailable) return h('p.muted', { text: 'Mode link folder belum diaktifkan admin server (isi GOOGLE_API_KEY di .env).' });
    const active = d.mode === 'link';
    const folderIn = h('input', { placeholder: 'https://drive.google.com/drive/folders/…', value: active ? d.folderUrl || '' : '', 'aria-label': 'Link folder Google Drive publik' });
    const err = h('p.err', { hidden: true });
    return h('div', {},
      active ? h('div.status-line', {}, h('span.dot.ok'), h('span', {}, 'Memutar dari folder: ', h('a', { href: d.folderUrl, target: '_blank', rel: 'noopener', text: d.folderName || d.folderId }))) : null,
      h('form.folder-form', { onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const btn = e.submitter; btn.disabled = true;
        try { const r = await put('/api/drive/link', { folder: folderIn.value }); setUser(r.user); invalidateTracks(); driveTab = null; toast(`Folder terbaca: ${r.user.drive.folderName}`); draw(); } catch (er) { err.textContent = er.message; err.hidden = false; }
        btn.disabled = false;
      } },
      h('label.field', {}, h('span', { text: 'Link folder Google Drive' }), folderIn),
      h('ol.steps', {},
        h('li', { text: 'Buka folder di Google Drive → klik Bagikan.' }),
        h('li', { text: 'Akses umum: pilih "Siapa saja yang memiliki link" (Pelihat).' }),
        h('li', { text: 'Salin link, tempel di sini.' })),
      h('p.hint', { text: 'Tanpa login Google. Lagu hanya bisa diputar — hasil unduhan tidak bisa disimpan ke folder ini, dan siapa pun yang punya link bisa melihat isinya.' }),
      err,
      h('div.btn-row', {},
        h('button.btn-primary', { type: 'submit', text: active ? 'Ganti folder' : 'Pakai folder ini' }),
        active ? h('button.link.danger', { type: 'button', text: 'Lepas folder', onclick: async () => {
          try { const r = await del('/api/drive/link'); setUser(r.user); invalidateTracks(); draw(); } catch (er) { toast(er.message, { type: 'error' }); }
        } }) : null)));
  }

  function oauthPane(d) {
    if (!d.configured) return h('p.muted', { text: 'Login Google belum dikonfigurasi di server (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET).' });
    if (!d.connected) {
      return h('div', {},
        h('p.muted', { text: 'Hubungkan akun Google Anda agar SoundWave bisa menyimpan hasil unduhan dan memutar lagu dari folder Drive pilihan Anda (folder boleh privat).' }),
        h('button.btn-primary', { type: 'button', onclick: connect }, icon(I.cloud), 'Login dengan Google'));
    }
    const active = d.mode === 'oauth';
    const folderIn = h('input', { placeholder: 'https://drive.google.com/drive/folders/…', value: active ? d.folderUrl || '' : '', 'aria-label': 'Link folder Google Drive' });
    const err = h('p.err', { hidden: true });
    return h('div', {},
      h('div.status-line', {}, h('span.dot.ok'), h('span', {}, 'Terhubung sebagai ', h('b', { text: d.googleEmail || 'akun Google' }))),
      active && d.folderId
        ? h('div.status-line', {}, h('span.dot.ok'), h('span', {}, 'Folder penyimpanan: ', h('a', { href: d.folderUrl, target: '_blank', rel: 'noopener', text: d.folderName || d.folderId })))
        : h('div.status-line', {}, h('span.dot.warn'), h('span', { text: d.mode === 'link' ? 'Sedang memakai mode link folder. Simpan folder di bawah untuk beralih ke mode Login Google.' : 'Folder penyimpanan belum diatur.' })),
      h('form.folder-form', { onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const btn = e.submitter; btn.disabled = true;
        try { const r = await put('/api/drive/folder', { folder: folderIn.value }); setUser(r.user); invalidateTracks(); driveTab = null; toast(`Folder diatur: ${r.user.drive.folderName}`); draw(); } catch (er) { err.textContent = er.message; err.hidden = false; }
        btn.disabled = false;
      } },
      h('label.field', {}, h('span', { text: 'Link folder Google Drive' }), folderIn),
      h('p.hint', { text: 'Tempel link folder (Bagikan → Salin link). Akun Google Anda harus punya akses edit ke folder tersebut.' }),
      err,
      h('div.btn-row', {},
        h('button.btn-primary', { type: 'submit', text: 'Simpan folder' }),
        h('button.btn', { type: 'button', text: 'Buat folder “SoundWave” baru', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { const r = await post('/api/drive/folder', { name: 'SoundWave' }); setUser(r.user); invalidateTracks(); driveTab = null; toast('Folder “SoundWave” dibuat di Drive Anda'); draw(); } catch (er) { toast(er.message, { type: 'error' }); }
        } }))),
      h('div.btn-row', {},
        h('button.link', { type: 'button', text: 'Hubungkan ulang', onclick: connect }),
        h('button.link.danger', { type: 'button', text: 'Putuskan Google', onclick: async () => {
          if (!(await confirmDialog('Putuskan Google Drive?', 'SoundWave tidak akan bisa membaca atau menyimpan ke Drive Anda sampai dihubungkan lagi. File di Drive tidak terhapus.', { ok: 'Putuskan', danger: true }))) return;
          try { const r = await post('/api/drive/disconnect'); setUser(r.user); invalidateTracks(); draw(); } catch (er) { toast(er.message, { type: 'error' }); }
        } })));
  }

  async function connect() {
    try { const { url } = await post('/api/drive/connect', { client: 'web' }); location.href = url; } catch (e) { toast(e.message, { type: 'error' }); }
  }
  draw();
}

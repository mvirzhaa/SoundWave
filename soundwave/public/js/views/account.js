/** Halaman Akun: profil, koneksi Google Drive & folder penyimpanan, kata sandi, keluar. */
import { h, icon, I, toast, confirmDialog } from '../ui.js';
import { post, put, patch } from '../api.js';
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
        h('div', {}, h('b', { text: u.name }), h('small', { text: u.email }))),
      h('form.row-form', { onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await patch('/api/auth/me', { name: nameIn.value }); setUser(r.user); toast('Nama disimpan'); draw(); } catch (er) { toast(er.message, { type: 'error' }); }
      } }, h('label.field.grow', {}, h('span', { text: 'Nama tampilan' }), nameIn), h('button.btn', { type: 'submit', text: 'Simpan' }))));

    /* Google Drive */
    const drive = h('div.panel-card', {}, h('h3', {}, icon(I.cloud), 'Google Drive'));
    page.append(drive);
    if (!d.configured) {
      drive.append(h('p.muted', { text: 'Integrasi Google Drive belum dikonfigurasi di server (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET).' }));
    } else if (!d.connected) {
      drive.append(
        h('p.muted', { text: 'Hubungkan akun Google Anda agar SoundWave bisa menyimpan hasil unduhan dan memutar lagu dari folder Drive pilihan Anda.' }),
        h('button.btn-primary', { type: 'button', onclick: connect }, icon(I.cloud), 'Hubungkan Google Drive'));
    } else {
      const folderIn = h('input', { placeholder: 'https://drive.google.com/drive/folders/…', value: d.folderUrl || '', 'aria-label': 'Link folder Google Drive' });
      const err = h('p.err', { hidden: true });
      drive.append(
        h('div.status-line', {}, h('span.dot.ok'), h('span', {}, 'Terhubung sebagai ', h('b', { text: d.googleEmail || 'akun Google' }))),
        d.folderId
          ? h('div.status-line', {}, h('span.dot.ok'), h('span', {}, 'Folder penyimpanan: ', h('a', { href: d.folderUrl, target: '_blank', rel: 'noopener', text: d.folderName || d.folderId })))
          : h('div.status-line', {}, h('span.dot.warn'), h('span', { text: 'Folder penyimpanan belum diatur.' })),
        h('form.folder-form', { onsubmit: async (e) => {
          e.preventDefault(); err.hidden = true;
          const btn = e.submitter; btn.disabled = true;
          try { const r = await put('/api/drive/folder', { folder: folderIn.value }); setUser(r.user); invalidateTracks(); toast(`Folder diatur: ${r.user.drive.folderName}`); draw(); } catch (er) { err.textContent = er.message; err.hidden = false; }
          btn.disabled = false;
        } },
        h('label.field', {}, h('span', { text: 'Link folder Google Drive' }), folderIn),
        h('p.hint', { text: 'Tempel link folder dari Google Drive (Bagikan → Salin link). Akun Google Anda harus punya akses edit ke folder tersebut.' }),
        err,
        h('div.btn-row', {},
          h('button.btn-primary', { type: 'submit', text: 'Simpan folder' }),
          h('button.btn', { type: 'button', text: 'Buat folder “SoundWave” baru', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { const r = await post('/api/drive/folder', { name: 'SoundWave' }); setUser(r.user); invalidateTracks(); toast('Folder “SoundWave” dibuat di Drive Anda'); draw(); } catch (er) { toast(er.message, { type: 'error' }); }
          } }))),
        h('div.btn-row', {},
          h('button.link', { type: 'button', text: 'Hubungkan ulang', onclick: connect }),
          h('button.link.danger', { type: 'button', text: 'Putuskan Google Drive', onclick: async () => {
            if (!(await confirmDialog('Putuskan Google Drive?', 'SoundWave tidak akan bisa membaca atau menyimpan ke Drive Anda sampai dihubungkan lagi. File di Drive tidak terhapus.', { ok: 'Putuskan', danger: true }))) return;
            try { const r = await post('/api/drive/disconnect'); setUser(r.user); invalidateTracks(); draw(); } catch (er) { toast(er.message, { type: 'error' }); }
          } })));
    }

    /* Kata sandi */
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const nxt = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
    page.append(h('div.panel-card', {}, h('h3', { text: 'Ganti kata sandi' }),
      h('form.grid-form', { onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await post('/api/auth/password', { current: cur.value, next: nxt.value }); setUser(r.user); cur.value = nxt.value = ''; toast('Kata sandi diganti. Perangkat lain otomatis keluar.'); } catch (er) { toast(er.message, { type: 'error' }); }
      } },
      h('label.field', {}, h('span', { text: 'Kata sandi lama' }), cur),
      h('label.field', {}, h('span', { text: 'Kata sandi baru (min. 8)' }), nxt),
      h('button.btn', { type: 'submit', text: 'Ganti kata sandi' }))));

    /* Keluar */
    page.append(h('div.panel-card', {}, h('div.btn-row', {},
      h('button.btn', { type: 'button', text: 'Keluar', onclick: () => logout(false) }),
      h('button.link.danger', { type: 'button', text: 'Keluar dari semua perangkat', onclick: () => logout(true) }))));
  };

  async function connect() {
    try { const { url } = await post('/api/drive/connect', { client: 'web' }); location.href = url; } catch (e) { toast(e.message, { type: 'error' }); }
  }
  draw();
}

/** Pengumuman dari admin (web): pop-up untuk yang belum dibaca + daftar tersimpan di Akun. */
import { h, openOverlay } from './ui.js';
import { get, post } from './api.js';
import { emit } from './store.js';

export const ann = { list: [], unread: 0 };
let showing = false;
let timer = null;

const fmt = (ms) => new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export async function loadAnnouncements({ popup = true } = {}) {
  try {
    const r = await get('/api/pengumuman');
    ann.list = r.pengumuman; ann.unread = r.belumDibaca;
    emit('pengumuman');
    if (popup) showUnread();
  } catch { /* abaikan */ }
}

export function startAnnouncements() {
  loadAnnouncements();
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') loadAnnouncements(); }, 10 * 60 * 1000);
}
export function stopAnnouncements() { clearInterval(timer); timer = null; ann.list = []; ann.unread = 0; }

export async function markRead(ids) {
  if (!ids.length) return;
  ann.list = ann.list.map((a) => (ids.includes(a.id) ? { ...a, read: true } : a));
  ann.unread = ann.list.filter((a) => !a.read).length;
  emit('pengumuman');
  post('/api/pengumuman/dibaca', { ids }).catch(() => {});
}

/** Tampilkan pengumuman yang belum dibaca satu per satu (terlama dulu). */
function showUnread() {
  if (showing) return;
  const queue = ann.list.filter((a) => !a.read).reverse();
  if (!queue.length) return;
  showing = true;
  const next = () => {
    const a = queue.shift();
    if (!a) { showing = false; return; }
    let closed = false;
    const done = () => { if (closed) return; closed = true; markRead([a.id]); close(); setTimeout(next, 250); };
    const close = openOverlay(announcementCard(a, { onClose: done, rest: queue.length }), { onClose: () => { if (!closed) { closed = true; markRead([a.id]); setTimeout(next, 250); } } });
  };
  next();
}

export function announcementCard(a, { onClose, rest = 0 } = {}) {
  return h('div.dialog.ann-pop', { role: 'dialog', 'aria-label': a.title },
    h('div.ann-head', {}, h('b', { text: a.title }), a.level === 'penting' ? h('span.badge-penting', { text: 'Penting' }) : null),
    h('p.ann-body', { text: a.body }),
    a.link ? h('a', { href: a.link, target: '_blank', rel: 'noopener', text: 'Buka tautan' }) : null,
    h('small', { text: `Pengumuman SoundWave · ${fmt(a.createdAt)}` }),
    onClose ? h('div.btn-row', {}, h('button.btn-primary', { type: 'button', text: rest ? `Mengerti (${rest} lagi)` : 'Mengerti', onclick: onClose })) : null);
}

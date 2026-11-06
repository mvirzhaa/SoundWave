'use strict';
/**
 * Pengumuman dari superadmin ke semua pengguna:
 *  - tersimpan di database (daftar pengumuman + status sudah dibaca per pengguna),
 *  - ditampilkan sebagai pop-up saat aplikasi/web dibuka,
 *  - dikirim sebagai push notification ke HP lewat Expo Push Service (token dari aplikasi mobile).
 */
const { db, tx } = require('./db');

const EXPO_PUSH = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/;

const insert = db.prepare('INSERT INTO announcements (title, body, link, level, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)');
const getOne = db.prepare('SELECT * FROM announcements WHERE id = ? AND deleted = 0');
const listAll = db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM announcement_reads r WHERE r.ann_id = a.id) AS reads
  FROM announcements a WHERE a.deleted = 0 ORDER BY a.id DESC LIMIT 200`);
const listForUser = db.prepare(`SELECT a.id, a.title, a.body, a.link, a.level, a.created_at, r.read_at
  FROM announcements a LEFT JOIN announcement_reads r ON r.ann_id = a.id AND r.user_id = ?
  WHERE a.deleted = 0 AND a.created_at >= ? ORDER BY a.id DESC LIMIT 100`);
const markRead = db.prepare('INSERT OR IGNORE INTO announcement_reads (user_id, ann_id, read_at) VALUES (?, ?, ?)');
const softDelete = db.prepare('UPDATE announcements SET deleted = 1 WHERE id = ?');
const setPushResult = db.prepare('UPDATE announcements SET push_ok = ?, push_fail = ? WHERE id = ?');
const userCreated = db.prepare('SELECT created_at FROM users WHERE id = ?');

const upsertToken = db.prepare(`INSERT INTO push_tokens (token, user_id, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`);
const deleteToken = db.prepare('DELETE FROM push_tokens WHERE token = ?');
const deleteTokenOf = db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?');
const activeTokens = db.prepare(`SELECT t.token FROM push_tokens t JOIN users u ON u.id = t.user_id WHERE u.disabled = 0`);
const tokenCount = db.prepare('SELECT COUNT(*) AS n FROM push_tokens');

function create({ title, body, link, level }, adminId) {
  const t = String(title || '').trim().slice(0, 120);
  const b = String(body || '').trim().slice(0, 4000);
  if (!t || !b) { const e = new Error('Judul dan isi pengumuman wajib diisi.'); e.status = 400; throw e; }
  let l = String(link || '').trim();
  if (l && !/^https:\/\/[^\s]{3,500}$/i.test(l)) { const e = new Error('Tautan harus diawali https://'); e.status = 400; throw e; }
  const lv = level === 'penting' ? 'penting' : 'info';
  const r = insert.run(t, b, l || null, lv, Date.now(), adminId || null);
  return getOne.get(Number(r.lastInsertRowid));
}

const toPublic = (a) => ({ id: a.id, title: a.title, body: a.body, link: a.link, level: a.level, createdAt: a.created_at, read: Boolean(a.read_at) });

/** Pengumuman untuk satu pengguna (termasuk yang terbit sebelum ia mendaftar, maks. 30 hari sebelumnya). */
function forUser(userId) {
  const created = userCreated.get(userId)?.created_at || 0;
  return listForUser.all(userId, created - 30 * 86400000).map(toPublic);
}

/** Kirim push ke semua perangkat terdaftar (per 100 pesan, sesuai batas Expo). */
async function push(ann) {
  const tokens = activeTokens.all().map((r) => r.token);
  let ok = 0; let fail = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const msgs = batch.map((to) => ({
      to, title: ann.title, body: ann.body.length > 180 ? `${ann.body.slice(0, 177)}…` : ann.body,
      sound: 'default', priority: 'high', channelId: 'pengumuman',
      data: { sw: 'pengumuman', id: ann.id },
    }));
    try {
      const res = await fetch(EXPO_PUSH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
        body: JSON.stringify(msgs),
        signal: AbortSignal.timeout(20000),
      });
      const j = await res.json().catch(() => ({}));
      (j.data || []).forEach((tk, k) => {
        if (tk.status === 'ok') ok++;
        else {
          fail++;
          // Token tidak berlaku lagi (aplikasi dihapus / izin dicabut) → buang
          if (tk.details?.error === 'DeviceNotRegistered') deleteToken.run(batch[k]);
        }
      });
      if (!res.ok && !j.data) fail += batch.length;
    } catch { fail += batch.length; }
  }
  setPushResult.run(ok, fail, ann.id);
  return { ok, fail, total: tokens.length };
}

function registerToken(userId, token, platform) {
  if (!TOKEN_RE.test(String(token || ''))) { const e = new Error('Token push tidak valid.'); e.status = 400; throw e; }
  const now = Date.now();
  upsertToken.run(token, userId, ['android', 'ios'].includes(platform) ? platform : null, now, now);
}

module.exports = {
  create, push, forUser, toPublic, registerToken,
  unregisterToken: (userId, token) => deleteTokenOf.run(String(token || ''), userId),
  markRead: (userId, ids) => tx(() => ids.forEach((id) => markRead.run(userId, id, Date.now()))),
  remove: (id) => softDelete.run(id),
  listAll: () => listAll.all(),
  tokenCount: () => tokenCount.get().n,
};

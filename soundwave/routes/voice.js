'use strict';
/**
 * POST /api/voice  { text }  — jalankan perintah suara.
 * Klien (mobile/web) mengubah suara → teks dengan speech recognition perangkat,
 * lalu server menafsirkan & mengeksekusi. Respons berisi `message` untuk dibacakan (TTS).
 */
const express = require('express');
const { db } = require('../lib/db');
const A = require('../lib/auth');
const D = require('../lib/drive');
const G = require('../lib/genre');
const P = require('../lib/playlists');
const V = require('../lib/voice');

const r = express.Router();
// Daftar lagu lokal bisa ribuan judul — perbesar batas body khusus endpoint ini
r.use(express.json({ limit: '4mb' }));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const HELP = 'Contoh perintah: "putarkan lagu The Corrs", "putarkan lagu rock", '
  + '"putarkan playlist nostalgia", "buatkan playlist kenangan", '
  + '"masukkan lagu Dewa ke playlist kenangan", "lagu berikutnya", atau "jeda".';

const titleCase = (s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const shuffled = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n) => `${n} lagu`;

function play(kind, label, tracks, shuffle, message) {
  return { action: 'play', kind, label, shuffle, tracks: shuffle ? shuffled(tracks) : tracks, message };
}

function playlistTracks(playlistId, map) {
  return P.itemsOf(playlistId).map((x) => map.get(x.file_id)).filter(Boolean);
}

/** Lagu lokal yang dikirim klien (folder komputer / penyimpanan HP) — hanya metadata, bukan file. */
function sanitizeLocal(list) {
  if (!Array.isArray(list)) return [];
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return list.slice(0, 20000).filter((t) => P.isLocalId(t?.id)).map((t) => ({
    id: t.id,
    name: str(t.name, 300),
    title: str(t.title, 300) || str(t.name, 300) || 'Tanpa judul',
    artist: str(t.artist, 200) || 'Tidak diketahui',
    album: str(t.album, 200) || null,
    genre: str(t.genre, 60) || null,
    mime: str(t.mime, 80),
    isVideo: Boolean(t.isVideo),
    duration: Number(t.duration) || null,
    ytId: null,
    local: true,
  }));
}

/** Gabungan lagu Drive (bila tersedia) + lagu lokal dari perangkat. */
async function libraryFor(user, local) {
  let drive = [];
  try { drive = G.attach(await D.listTracks(user)); } catch (e) {
    // Drive belum dihubungkan/diatur: tetap jalan dengan lagu lokal saja
    if (!(e instanceof D.DriveError) || !local.length || !['DRIVE_NOT_CONNECTED', 'DRIVE_NO_FOLDER', 'DRIVE_NOT_CONFIGURED', 'DRIVE_UNREACHABLE'].includes(e.code)) throw e;
  }
  return [...drive, ...local];
}

async function execute(user, intent, local = []) {
  switch (intent.action) {
    case 'help': return { action: 'none', message: HELP };
    case 'control': return { action: 'control', command: intent.command, message: '' };
    case 'unknown': return { action: 'none', message: `Maaf, saya belum mengerti "${intent.text}". ${HELP}` };
    default: break;
  }

  if (intent.action === 'create_playlist') {
    const name = titleCase(intent.name || '');
    if (!name) return { action: 'none', message: 'Sebutkan nama playlist-nya, misalnya "buatkan playlist kenangan".' };
    const existing = V.findPlaylist(P.listForUser(user.id), name, 0.97);
    if (existing) return { action: 'none', playlist: { id: existing.id, name: existing.name }, message: `Playlist ${existing.name} sudah ada.` };
    const pl = P.create(user.id, name);
    return { action: 'playlist_created', playlist: pl, message: `Playlist ${pl.name} sudah dibuat.` };
  }

  // Perintah berikut butuh daftar lagu dari Drive
  const tracks = await libraryFor(user, local);
  const map = new Map(tracks.map((t) => [t.id, t]));
  if (!tracks.length) return { action: 'none', message: 'Belum ada lagu di Google Drive maupun di folder lokal Anda.' };

  if (intent.action === 'add_to_playlist') {
    let pl = V.findPlaylist(P.listForUser(user.id), intent.playlist, 0.8);
    let created = false;
    if (!pl) { pl = P.create(user.id, titleCase(intent.playlist)); created = true; }
    const artist = V.findArtist(tracks, intent.query);
    let picked = [];
    let what = '';
    if (artist) { picked = V.sortByTitle(artist.tracks); what = `${plural(picked.length)} ${artist.name}`; }
    else {
      const t = V.findTitles(tracks, intent.query)[0];
      if (t) { picked = [t.track]; what = `${t.track.title} – ${t.track.artist}`; }
    }
    if (!picked.length) {
      return { action: created ? 'playlist_created' : 'none', playlist: { id: pl.id, name: pl.name },
        message: `Saya tidak menemukan lagu atau artis "${intent.query}" di pustaka Anda.${created ? ` Playlist ${pl.name} tetap dibuat.` : ''}` };
    }
    const added = P.addTracks(pl.id, picked, map);
    const skipped = picked.length - added;
    let message = `${created ? `Playlist ${pl.name} dibuat. ` : ''}`;
    message += added
      ? `${picked.length === 1 ? what : `${plural(added)} ${artist.name}`} ditambahkan ke playlist ${pl.name}.`
      : `${what} sudah ada di playlist ${pl.name}.`;
    if (added && skipped) message += ` ${skipped} lagu sudah ada sebelumnya.`;
    return { action: added ? 'added' : 'none', playlist: { id: pl.id, name: pl.name }, added, tracks: picked, message };
  }

  // ----- play -----
  const { target, query, shuffle } = intent;
  const lists = P.listForUser(user.id);

  if (target === 'all') return play('all', 'Semua lagu', tracks, true, `Memutar acak ${plural(tracks.length)} dari pustaka Anda.`);

  if (target === 'favorites' || target === 'recent') {
    const rows = target === 'favorites'
      ? db.prepare('SELECT file_id FROM favorites WHERE user_id = ? ORDER BY added_at DESC').all(user.id)
      : db.prepare('SELECT file_id FROM recent_plays WHERE user_id = ? ORDER BY played_at DESC').all(user.id);
    const list = rows.map((x) => map.get(x.file_id)).filter(Boolean);
    const label = target === 'favorites' ? 'Favorit' : 'Terakhir Diputar';
    if (!list.length) return { action: 'none', message: `Daftar ${label} masih kosong.` };
    return play(target, label, list, shuffle, `Memutar ${label} (${plural(list.length)}).`);
  }

  if (target === 'playlist') {
    const pl = V.findPlaylist(lists, query);
    if (!pl) {
      const names = lists.map((x) => x.name).slice(0, 6).join(', ');
      return { action: 'none', message: `Playlist "${query}" tidak ditemukan.${names ? ` Playlist Anda: ${names}.` : ' Anda belum punya playlist.'}` };
    }
    const list = playlistTracks(pl.id, map);
    if (!list.length) return { action: 'none', message: `Playlist ${pl.name} masih kosong.` };
    return { ...play('playlist', pl.name, list, shuffle, `Memutar playlist ${pl.name} (${plural(list.length)}).`), playlist: { id: pl.id, name: pl.name } };
  }

  if (target === 'genre') return playGenre(tracks, query, shuffle);

  // target "auto": artis → genre → playlist → judul
  const artist = V.findArtist(tracks, query);
  if (artist) {
    const list = V.sortByTitle(artist.tracks);
    return play('artist', artist.name, list, shuffle, `Memutar ${plural(list.length)} ${artist.name}.`);
  }
  if (V.isKnownGenreWord(query) || V.findGenre(tracks, query).tracks.length) return playGenre(tracks, query, shuffle);
  const pl = V.findPlaylist(lists, query, 0.85);
  if (pl) {
    const list = playlistTracks(pl.id, map);
    if (list.length) return { ...play('playlist', pl.name, list, shuffle, `Memutar playlist ${pl.name} (${plural(list.length)}).`), playlist: { id: pl.id, name: pl.name } };
  }
  const titles = V.findTitles(tracks, query);
  if (titles.length) {
    const top = titles[0].score;
    const list = titles.filter((x) => x.score >= top - 0.05).map((x) => x.track);
    const first = list[0];
    return play('title', first.title, list, false, list.length === 1
      ? `Memutar ${first.title} oleh ${first.artist}.`
      : `Memutar ${plural(list.length)} yang cocok dengan "${query}".`);
  }
  return { action: 'none', message: `Maaf, saya tidak menemukan artis, genre, playlist, atau lagu "${query}" di pustaka Anda.` };
}

function playGenre(tracks, query, shuffle) {
  const { tracks: list, label } = V.findGenre(tracks, query);
  if (!list.length) {
    const genres = [...new Set(tracks.map((t) => t.genre).filter(Boolean))].slice(0, 8);
    const pending = tracks.filter((t) => !t.genre).length;
    let msg = `Belum ada lagu bergenre ${query} di pustaka Anda.`;
    if (genres.length) msg += ` Genre yang ada: ${genres.join(', ')}.`;
    if (pending) msg += ` ${pending} lagu belum punya data genre — sedang dilengkapi otomatis, atau atur manual lewat menu lagu.`;
    return { action: 'none', message: msg };
  }
  const name = titleCase(query);
  // Genre berisi banyak artis — default diacak agar variatif
  return play('genre', name, list, shuffle || true, `Memutar ${plural(list.length)} bergenre ${name}${label && V.clean(label) !== V.clean(name) ? ` (${label})` : ''}.`);
}

r.post('/', A.requireAuth(), wrap(async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Perintah kosong.' });
  const intent = V.parse(text);
  try {
    const out = await execute(req.user, intent, sanitizeLocal(req.body?.localTracks));
    res.json({ heard: text, intent: intent.action, ...out });
  } catch (e) {
    if (e instanceof D.DriveError) return res.json({ heard: text, intent: intent.action, action: 'none', code: e.code, message: e.message });
    throw e;
  }
}));

module.exports = r;

'use strict';
/**
 * Genre lagu.
 * - Otomatis: dicari di iTunes Search API (gratis, tanpa API key) berdasarkan artis + judul,
 *   diproses bertahap di latar belakang (1 permintaan / 3 detik) lalu disimpan di DB.
 * - Manual: pengguna bisa mengubah genre lewat menu lagu (source = "user", tidak ditimpa otomatis).
 */
const { db } = require('./db');

const ENABLED = String(process.env.GENRE_LOOKUP ?? 'true').toLowerCase() !== 'false';
const COUNTRY = process.env.GENRE_LOOKUP_COUNTRY || 'ID';
const RETRY_NONE_MS = 30 * 24 * 3600 * 1000; // coba lagi lagu tanpa hasil setelah 30 hari

const getMeta = db.prepare('SELECT * FROM track_meta WHERE file_id = ?');
const upsert = db.prepare(`INSERT INTO track_meta (file_id, genre, source, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(file_id) DO UPDATE SET genre = excluded.genre, source = excluded.source, updated_at = excluded.updated_at`);
const upsertAuto = db.prepare(`INSERT INTO track_meta (file_id, genre, source, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(file_id) DO UPDATE SET genre = excluded.genre, source = excluded.source, updated_at = excluded.updated_at
  WHERE track_meta.source <> 'user'`);

const queue = [];
const queued = new Set();
let timer = null;

/** Tempelkan genre ke daftar lagu & antrekan yang belum punya genre. */
function attach(tracks) {
  const now = Date.now();
  return tracks.map((t) => {
    const m = getMeta.get(t.id);
    if (!m || (m.source === 'none' && now - m.updated_at > RETRY_NONE_MS)) enqueue(t);
    return { ...t, genre: m?.genre || null };
  });
}

function enqueue(t) {
  if (!ENABLED || queued.has(t.id)) return;
  queued.add(t.id);
  queue.push({ id: t.id, artist: t.artist === 'Tidak diketahui' ? '' : t.artist, title: t.title });
  if (!timer) { timer = setInterval(work, 3000); timer.unref?.(); }
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function lookup(artist, title) {
  const term = `${artist} ${title}`.trim().slice(0, 120);
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=5&country=${COUNTRY}&term=${encodeURIComponent(term)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  const data = await res.json();
  const results = data.results || [];
  // Utamakan hasil yang nama artisnya cocok
  const a = norm(artist);
  const best = (a && results.find((r) => norm(r.artistName).includes(a) || a.includes(norm(r.artistName)))) || results[0];
  return best?.primaryGenreName || null;
}

async function work() {
  const item = queue.shift();
  if (!item) { clearInterval(timer); timer = null; return; }
  try {
    const genre = await lookup(item.artist, item.title);
    upsertAuto.run(item.id, genre, genre ? 'itunes' : 'none', Date.now());
  } catch {
    // jaringan gagal: lepas dari daftar agar dicoba lagi pada pemuatan pustaka berikutnya
  } finally {
    queued.delete(item.id);
  }
}

function setGenre(fileId, genre) {
  const g = String(genre || '').trim().slice(0, 60);
  upsert.run(fileId, g || null, g ? 'user' : 'none', Date.now());
  return g || null;
}

/** Kata dalam bahasa Indonesia/umum → potongan nama genre yang dicocokkan. */
const GENRE_ALIASES = {
  rock: ['rock'], metal: ['metal'], pop: ['pop'], jazz: ['jazz'], blues: ['blues'], soul: ['soul'],
  dangdut: ['dangdut'], keroncong: ['keroncong'], reggae: ['reggae'], country: ['country'], folk: ['folk'],
  indie: ['indie'], punk: ['punk'], latin: ['latin'], 'k pop': ['k-pop', 'k pop', 'korean'], kpop: ['k-pop', 'k pop', 'korean'],
  korea: ['k-pop', 'korean'], 'j pop': ['j-pop', 'japan'], jpop: ['j-pop', 'japan'], anime: ['anime'],
  'hip hop': ['hip-hop', 'hip hop', 'rap'], hiphop: ['hip-hop', 'hip hop', 'rap'], rap: ['rap', 'hip-hop'],
  'r b': ['r&b', 'rnb'], rnb: ['r&b', 'rnb'], elektronik: ['electronic', 'dance', 'edm', 'house', 'techno'],
  electronic: ['electronic', 'dance', 'edm'], edm: ['electronic', 'dance', 'edm'], dance: ['dance', 'electronic'],
  klasik: ['classical'], classical: ['classical'], religi: ['religious', 'christian', 'gospel', 'islam', 'religi', 'nasyid', 'sholawat'],
  rohani: ['christian', 'gospel'], alternatif: ['alternative'], alternative: ['alternative'], akustik: ['acoustic', 'singer'],
  soundtrack: ['soundtrack'], ost: ['soundtrack'], anak: ['children', 'kids'], instrumental: ['instrumental'],
};

/** Cocokkan kata genre yang diucapkan dengan genre lagu. */
function genreMatches(spoken, trackGenre) {
  if (!trackGenre) return false;
  const s = norm(spoken);
  const g = norm(trackGenre.replace(/&/g, ' & '));
  const keys = GENRE_ALIASES[s] || [s];
  return keys.some((k) => g.includes(norm(k)));
}

const isKnownGenreWord = (spoken) => Boolean(GENRE_ALIASES[norm(spoken)]);

module.exports = { attach, setGenre, genreMatches, isKnownGenreWord, norm };

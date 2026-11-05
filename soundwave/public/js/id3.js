/**
 * Pembaca tag ID3v2.2 / 2.3 / 2.4 minimal (judul, artis, album, genre, tahun, gambar sampul).
 * Tanpa dependensi & tanpa TextDecoder (versi yang sama dipakai di aplikasi mobile).
 */

// Daftar genre ID3v1 (untuk TCON berisi angka, mis. "(17)" = Rock)
const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age',
  'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks',
  'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid',
  'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative',
  'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk',
  'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle',
  'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk',
  'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];

const synchsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const be32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

function utf8(b) {
  let out = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else {
      const cp = (((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}
function utf16(b, littleEndian) {
  let out = '';
  for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode(littleEndian ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  return out;
}

/** Dekode teks sesuai byte encoding ID3 (0 latin1, 1 UTF-16+BOM, 2 UTF-16BE, 3 UTF-8). */
function decode(b, enc) {
  if (enc === 1) {
    if (b[0] === 0xff && b[1] === 0xfe) return utf16(b.subarray(2), true);
    if (b[0] === 0xfe && b[1] === 0xff) return utf16(b.subarray(2), false);
    return utf16(b, true);
  }
  if (enc === 2) return utf16(b, false);
  if (enc === 3) return utf8(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Posisi akhir string ber-terminator null (1 byte untuk latin1/UTF-8, 2 byte untuk UTF-16). */
function termEnd(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
  return b.length;
}

function text(data) {
  if (!data.length) return '';
  const s = decode(data.subarray(1), data[0]);
  return s.split('\u0000').map((x) => x.trim()).filter(Boolean)[0] || '';
}

function genreName(raw) {
  if (!raw) return null;
  const m = raw.match(/^\((\d+)\)(.*)$/);
  if (m) return m[2].trim() || GENRES[Number(m[1])] || null;
  if (/^\d+$/.test(raw)) return GENRES[Number(raw)] || null;
  return raw;
}

const FRAMES = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumArtist', TP2: 'albumArtist',
  TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre', TYER: 'year', TYE: 'year', TDRC: 'year',
};

/** Ukuran total tag ID3v2 (termasuk header) dari 10 byte pertama file, atau 0 jika tidak ada tag. */
export function id3Size(head) {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  return 10 + synchsafe(head, 6) + (head[5] & 0x10 ? 10 : 0);
}

/**
 * Urai tag ID3v2 dari byte awal file.
 * @param {Uint8Array} buf  byte awal file (idealnya seluruh tag; frame yang terpotong diabaikan)
 * @returns {{title?, artist?, album?, albumArtist?, genre?, year?, picture?: {mime: string, data: Uint8Array}} | null}
 */
export function parseId3(buf) {
  if (!id3Size(buf)) return null;
  const ver = buf[3];
  const flags = buf[5];
  const end = Math.min(buf.length, 10 + synchsafe(buf, 6));
  let b = buf;
  if (ver === 3 && flags & 0x80) {
    // Unsynchronisation v2.3: buang 0x00 setelah 0xFF
    const out = [];
    for (let i = 0; i < end; i++) { out.push(buf[i]); if (buf[i] === 0xff && buf[i + 1] === 0x00) i++; }
    b = Uint8Array.from(out);
  }
  let pos = 10;
  if (flags & 0x40 && ver >= 3) pos += ver === 4 ? synchsafe(b, 10) : be32(b, 10) + 4;
  const tag = {};
  const hdr = ver === 2 ? 6 : 10;
  const limit = Math.min(b.length, end);

  while (pos + hdr <= limit) {
    if (b[pos] === 0) break; // padding
    let id; let size;
    if (ver === 2) { id = ascii(b, pos, 3); size = (b[pos + 3] << 16) | (b[pos + 4] << 8) | b[pos + 5]; }
    else {
      id = ascii(b, pos, 4);
      size = ver === 4 ? synchsafe(b, pos + 4) : be32(b, pos + 4);
      // Sebagian penulis tag v2.4 memakai ukuran biasa; pakai bila synchsafe tidak masuk akal
      if (ver === 4 && pos + hdr + size > end && pos + hdr + be32(b, pos + 4) <= end) size = be32(b, pos + 4);
    }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || size <= 0) break;
    const start = pos + hdr;
    pos = start + size;
    if (start + size > b.length) { if (id === 'APIC' || id === 'PIC') continue; break; }
    const data = b.subarray(start, start + size);
    const key = FRAMES[id];
    if (key && !tag[key]) {
      const v = text(data);
      if (v) tag[key] = key === 'genre' ? genreName(v) : v;
    } else if ((id === 'APIC' || id === 'PIC') && !tag.picture && data.length > 4) {
      const enc = data[0];
      let i; let mime;
      if (id === 'PIC') { const fmt = ascii(data, 1, 3).toLowerCase(); mime = fmt === 'png' ? 'image/png' : 'image/jpeg'; i = 4; }
      else { const e = termEnd(data, 1, 0); mime = ascii(data, 1, e - 1).toLowerCase() || 'image/jpeg'; i = e + 1; }
      i += 1; // jenis gambar
      i = termEnd(data, i, enc) + (enc === 1 || enc === 2 ? 2 : 1); // deskripsi
      if (i < data.length) tag.picture = { mime: mime.includes('/') ? mime : `image/${mime}`, data: data.subarray(i) };
    }
  }
  if (!tag.artist && tag.albumArtist) tag.artist = tag.albumArtist;
  return tag;
}

/* ---------- Metadata dari nama file ---------- */
const NOISE = /\s*[([【]([^)\]】]*?(official|video|audio|lyric|lirik|visuali[sz]er|\bmv\b|\bhd\b|\b4k\b|\bhq\b|music)[^)\]】]*)[)\]】]/gi;

/** "01. The Corrs - Breathless (Official Video).mp3" → { artist: "The Corrs", title: "Breathless" } */
export function parseFileName(name) {
  let base = String(name).replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  base = base.replace(/^\s*\d{1,3}\s*[-.)]\s*/, '');
  let artist = '';
  let title = base;
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) { artist = m[1].trim(); title = m[2].trim(); }
  title = title.replace(NOISE, '').replace(/\s+\|\s+.*$/, '').replace(/\s{2,}/g, ' ').trim() || base;
  return { artist, title };
}

/** Hash string → ID pendek stabil (FNV-1a 2x32 bit, base36). */
export function hashId(s) {
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36) + s.length.toString(36);
}

export const AUDIO_EXT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', weba: 'audio/webm', mp4: 'video/mp4', m4v: 'video/mp4' };

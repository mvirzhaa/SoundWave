/**
 * Perintah suara di web (Web Speech API, tersedia di Chrome/Edge/Safari).
 * Teks dikirim ke /api/voice; hasilnya dieksekusi di pemutar & dibacakan.
 */
import { h, icon, toast, openOverlay, closeOverlay } from './ui.js';
import { post } from './api.js';
import { playList, pause, resume, next, prev, openFull, current } from './player.js';
import { toggleLyrics } from './lyrics.js';
import { invalidateTracks } from './store.js';
import { localSummary, localById } from './local.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = Boolean(SR);

function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'id-ID';
  const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith('id'));
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** Jalankan teks perintah (dipakai juga oleh input teks manual). */
export async function runCommand(text, statusEl) {
  try {
    const r = await post('/api/voice', { text, localTracks: localSummary() });
    if (r.action === 'play') {
      // Lagu lokal: pakai objek hasil pindai folder (punya akses file)
      r.tracks = r.tracks.map((t) => (t.local && localById(t.id)) || t);
      playList(r.tracks, r.shuffle ? null : 0, { shuffle: r.shuffle, source: r.label });
    } else if (r.action === 'control') {
      ({ pause, resume, next: () => next(false), previous: prev,
        lyrics: () => { if (!current()) { toast('Belum ada lagu yang diputar.'); return; } openFull(); toggleLyrics(true); } })[r.command]?.();
    } else if (r.action === 'playlist_created' || r.action === 'added') {
      invalidateTracks();
    }
    if (statusEl) statusEl.textContent = r.message || 'Selesai.';
    if (r.message) { speak(r.message); toast(r.message, r.playlist ? { action: { label: 'Buka playlist', run: () => { location.hash = `#/playlist/${r.playlist.id}`; } } } : {}); }
    return r;
  } catch (e) {
    if (statusEl) statusEl.textContent = e.message;
    toast(e.message, { type: 'error' });
    return null;
  }
}

/** Buka panel mendengarkan. */
export function openVoice() {
  const heard = h('p.voice-heard', { text: '' });
  const status = h('p.voice-status', { text: voiceSupported ? 'Mendengarkan… silakan bicara' : 'Browser ini tidak mendukung pengenal suara. Ketik perintah di bawah.' });
  const orb = h('button.voice-orb', { type: 'button', 'aria-label': 'Mulai/berhenti mendengarkan' }, icon('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3'));
  const text = h('input', { placeholder: 'atau ketik: putarkan lagu the corrs', 'aria-label': 'Perintah' });
  const examples = h('div.voice-ex', {}, ['putarkan lagu The Corrs', 'putarkan lagu rock', 'putarkan playlist nostalgia', 'buatkan playlist kenangan', 'masukkan lagu Dewa ke playlist kenangan', 'putar surat Al-Mulk', 'kapan maghrib']
    .map((x) => h('button.chip', { type: 'button', text: `“${x}”`, onclick: () => submit(x) })));
  let rec = null;
  let submitted = false; // perintah sudah dikirim → abaikan error/akhir dari pengenal suara

  async function submit(t) {
    if (!t.trim()) return;
    submitted = true;
    stop();
    heard.textContent = `“${t}”`;
    status.textContent = 'Memproses…';
    const r = await runCommand(t, status);
    if (r && r.action !== 'none') setTimeout(closeOverlay, 1400);
  }
  function stop() { try { rec?.abort(); } catch { /* abaikan */ } rec = null; orb.classList.remove('listening'); }
  function start() {
    if (!SR) return;
    stop();
    submitted = false;
    rec = new SR();
    rec.lang = 'id-ID';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    orb.classList.add('listening');
    status.textContent = 'Mendengarkan… silakan bicara';
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      heard.textContent = `“${res[0].transcript}”`;
      if (res.isFinal) submit(res[0].transcript);
    };
    rec.onerror = (e) => {
      orb.classList.remove('listening');
      if (submitted) return;
      status.textContent = e.error === 'not-allowed' ? 'Izin mikrofon ditolak. Izinkan mikrofon di pengaturan browser.'
        : e.error === 'no-speech' ? 'Tidak terdengar suara. Ketuk mikrofon untuk mencoba lagi.' : `Pengenal suara error: ${e.error}`;
    };
    rec.onend = () => orb.classList.remove('listening');
    rec.start();
  }
  orb.addEventListener('click', () => (orb.classList.contains('listening') ? stop() : start()));

  openOverlay(h('div.voice', {},
    h('h3', { text: 'Perintah suara' }), orb, heard, status,
    h('form.voice-form', { onsubmit: (e) => { e.preventDefault(); submit(text.value); } }, text, h('button.btn', { type: 'submit', text: 'Kirim' })),
    examples), { onClose: stop });
  start();
}

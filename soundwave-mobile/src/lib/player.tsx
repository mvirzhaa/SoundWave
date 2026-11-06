/**
 * Pemutar musik berbasis AudioPlaylist (expo-audio):
 * antrean native → lagu tetap berpindah otomatis saat aplikasi di latar belakang,
 * dan tombol next/previous di layar kunci / notifikasi berfungsi.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { AudioPlaylist, AudioSource, createAudioPlaylist, setAudioModeAsync } from 'expo-audio';
import { getServer, mediaToken, ytThumb } from './api';
import { offlineUri } from './offline';
import { useLibrary } from './library';
import type { Track } from './types';
import { T } from './i18n';

type Repeat = 'off' | 'all' | 'one';

type PlayerCtx = {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  buffering: boolean;
  shuffle: boolean;
  repeat: Repeat;
  source: string;
  playList: (tracks: Track[], index?: number | null, opts?: { shuffle?: boolean; source?: string; repeat?: Repeat }) => Promise<void>;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  jumpTo: (i: number) => void;
  removeAt: (i: number) => void;
  playNext: (t: Track) => Promise<void>;
  addToQueue: (t: Track) => Promise<void>;
  setShuffle: (on: boolean) => void;
  cycleRepeat: () => Repeat;
  setRepeatMode: (m: Repeat) => void;
  stop: () => void;
  /** Pesan singkat dari pemutar (mis. stasiun radio tidak merespons) — ditampilkan sebagai toast. */
  notice: { id: number; text: string } | null;
};
/** Posisi & durasi dipisah dari status utama: berubah 2×/detik, hanya pemutar/lirik/mini player yang perlu. */
type ProgressCtx = { position: number; duration: number };

const Ctx = createContext<PlayerCtx>(null as unknown as PlayerCtx);
const ProgCtx = createContext<ProgressCtx>({ position: 0, duration: 0 });
export const usePlayer = () => useContext(Ctx);
export const usePlayerProgress = () => useContext(ProgCtx);
const RADIO_TIMEOUT = 20000;

const shuffled = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const LOOP: Record<Repeat, 'none' | 'all' | 'single'> = { off: 'none', all: 'all', one: 'single' };

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { recordPlay } = useLibrary();
  // Simpan di ref: fungsi dari useLibrary berganti identitas setiap pustaka berubah, dan TIDAK boleh
  // memicu pembuatan ulang pemutar (dulu pemutar lama tetap berbunyi tanpa bisa dijeda).
  const recordPlayRef = useRef(recordPlay);
  recordPlayRef.current = recordPlay;
  const pl = useRef<AudioPlaylist | null>(null);
  const playSeq = useRef(0);
  const tokenRef = useRef<string>('');
  const queueRef = useRef<Track[]>([]);
  const originalRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const lastRecorded = useRef<string | null>(null);
  const lockActive = useRef(false);
  // Radio: antrean native hanya berisi 1 stasiun (berpindah stasiun jadi instan); daftar stasiun disimpan di sini
  const radioList = useRef<Track[]>([]);
  const radioWatch = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const say = (text: string) => setNotice({ id: Date.now(), text });

  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const repeatRef = useRef<Repeat>('off');
  repeatRef.current = repeat;
  const [source, setSource] = useState('Pustaka');

  const sourceFor = useCallback((t: Track): AudioSource => {
    if (t.local && t.uri) return { uri: t.uri }; // file di penyimpanan HP
    const local = offlineUri(t.id);
    if (local) return { uri: local };
    if (t.url && /^(quran|radio)-/.test(t.id)) return { uri: t.url }; // murottal (CDN) / siaran radio
    return { uri: `${getServer()}/api/library/stream/${encodeURIComponent(t.id)}?t=${encodeURIComponent(tokenRef.current)}` };
  }, []);

  const meta = (t: Track) => ({ title: t.title, artist: t.artist, albumTitle: t.album || 'SoundWave', artworkUrl: ytThumb(t.ytId, true) || t.coverUri || undefined, ...(t.quran ? { albumTitle: 'Hapalan Quran' } : {}) });

  const onTrack = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
    const t = queueRef.current[i];
    if (!t) return;
    if (lockActive.current) pl.current?.updateLockScreenMetadata(meta(t));
    if (!t.radio && lastRecorded.current !== t.id) { lastRecorded.current = t.id; recordPlayRef.current(t); }
  }, []);

  /* ---------- Pemutar native ----------
   * expo-audio (ExoPlayer) tidak bisa dipulihkan dari JS setelah error (mis. lagu streaming gagal saat offline):
   * pemutar masuk status IDLE dan lagu apa pun sesudahnya tidak berbunyi. Karena itu setiap kali pengguna memilih
   * lagu, dan setiap kali terjadi error, pemutar native dibuat BARU (yang lama dihentikan & dilepas lebih dulu). */
  const detachRef = useRef<(() => void) | null>(null);
  const errored = useRef(false);
  const failStreak = useRef(0);

  const attach = (p: AudioPlaylist) => {
    const s1 = p.addListener('playlistStatusUpdate', (st) => {
      if (pl.current !== p) return;
      if ((st as any).error && !errored.current) { errored.current = true; setTimeout(() => handleErrorRef.current(), 0); return; }
      if (AppState.currentState !== 'active') { // latar belakang: cukup lacak lagu aktif (layar kunci)
        if (st.currentIndex !== indexRef.current && st.currentIndex >= 0) onTrack(st.currentIndex);
        return;
      }
      setPlaying(st.playing);
      setBuffering(st.isBuffering);
      setPosition(st.currentTime || 0);
      setDuration(st.duration || 0);
      if (st.currentIndex !== indexRef.current && st.currentIndex >= 0) onTrack(st.currentIndex);
    });
    const s2 = p.addListener('trackChanged', ({ currentIndex }) => { if (pl.current === p) onTrack(currentIndex); });
    return () => { s1.remove(); s2.remove(); };
  };

  /** Lepas pemutar lama dengan aman lalu buat yang baru. */
  const fresh = (): AudioPlaylist => {
    const old = pl.current;
    if (old) {
      detachRef.current?.();
      try { old.pause(); old.clear(); if (lockActive.current) old.clearLockScreenControls(); } catch { /* abaikan */ }
      try { old.destroy(); } catch { /* abaikan */ }
    }
    lockActive.current = false;
    const p = createAudioPlaylist({ sources: [], updateInterval: 500, loop: 'none' });
    pl.current = p;
    detachRef.current = attach(p);
    errored.current = false;
    return p;
  };

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    fresh();
    // Pengaman: baca status langsung dari pemutar tiap 500 ms (waktu, ikon play/pause, lirik tetap bergerak
    // walaupun event status dari sistem terlambat/tidak terkirim di sebagian HP Android).
    // Hanya saat aplikasi aktif di layar — di latar belakang tidak ada yang perlu digambar.
    const last = { t: -1, d: -1, pl: false, b: false };
    let poll: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const p = pl.current;
      if (!p) return;
      try {
        const cur = p.currentTime || 0;
        if (cur > 1.5) failStreak.current = 0; // lagu benar-benar berbunyi
        const t = Math.round(cur * 4) / 4;
        const d = p.duration || 0;
        const pl2 = !!p.playing && !errored.current;
        const b = !!p.isBuffering;
        if (t !== last.t) { last.t = t; setPosition(cur); }
        if (d !== last.d) { last.d = d; setDuration(d); }
        if (pl2 !== last.pl) { last.pl = pl2; setPlaying(pl2); }
        if (b !== last.b) { last.b = b; setBuffering(b); }
        const ci = p.currentIndex;
        if (ci >= 0 && ci !== indexRef.current && ci < queueRef.current.length) onTrack(ci);
      } catch { /* pemutar sedang dilepas */ }
    };
    const startPoll = () => { if (!poll) poll = setInterval(tick, 500); };
    const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
    if (AppState.currentState === 'active') startPoll();
    const s3 = AppState.addEventListener('change', (st) => { if (st === 'active') { tick(); startPoll(); } else stopPoll(); });
    return () => {
      stopPoll();
      s3.remove();
      if (radioWatch.current) clearTimeout(radioWatch.current);
      detachRef.current?.();
      const p = pl.current;
      // Hentikan suara dulu sebelum dilepas, agar tidak ada audio "yatim" yang terus berbunyi
      if (p) { try { p.pause(); p.clear(); p.clearLockScreenControls(); } catch { /* abaikan */ } p.destroy(); }
      pl.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Bisa diputar tanpa internet: file di HP atau lagu yang sudah diunduh untuk offline. */
  const playableOffline = (t: Track) => Boolean((t.local && t.uri) || offlineUri(t.id));
  const needsNet = (t: Track) => !playableOffline(t);

  /** Bangun ulang pemutar dengan antrean q dan mulai dari indeks i. */
  const restartAt = (q: Track[], i: number) => {
    const p = fresh();
    commitQueue(q);
    q.forEach((t) => p.add(sourceFor(t)));
    p.loop = LOOP[repeatRef.current];
    p.skipTo(i);
    p.play();
    setPlaying(true);
    setPosition(0); setDuration(0);
    p.setActiveForLockScreen(true, meta(q[i]), { showNextTrack: true, showPreviousTrack: true });
    lockActive.current = true;
    onTrack(i);
  };

  /** Lagu gagal dimuat → lanjut ke lagu berikutnya yang bisa diputar (bila gagal karena jaringan: hanya lagu offline). */
  const handleErrorRef = useRef<() => void>(() => {});
  handleErrorRef.current = () => {
    const q = queueRef.current;
    const i = indexRef.current;
    const bad = q[i];
    setPlaying(false); setBuffering(false);
    if (!bad) return;
    if (bad.radio) { say(T('{s}: stasiun tidak merespons. Coba stasiun lain.', { s: bad.title })); return; }
    failStreak.current += 1;
    const net = needsNet(bad);
    say(net ? T('“{t}” tidak bisa dimuat — periksa koneksi internet.', { t: bad.title }) : T('“{t}” tidak bisa diputar.', { t: bad.title }));
    if (failStreak.current >= 3) return; // berhenti, jangan melompati seluruh antrean
    if (net) {
      // Kemungkinan offline: lanjutkan hanya dengan lagu yang tersimpan di HP
      const rest = q.slice(i + 1).filter(playableOffline);
      if (rest.length) restartAt(rest, 0);
      return;
    }
    if (i + 1 < q.length) restartAt(q, i + 1);
  };

  const commitQueue = (q: Track[]) => { queueRef.current = q; setQueue(q); };

  const playList = async (tracks: Track[], start: number | null = 0, opts: { shuffle?: boolean; source?: string; repeat?: Repeat } = {}) => {
    if (!pl.current) return;
    const wanted = start == null ? null : tracks[start];
    const list = tracks.filter((t) => t && t.available !== false && (!t.local || t.uri));
    if (!list.length) return;
    if (list.every((t) => t.radio)) return playRadio(list, wanted ? Math.max(0, list.indexOf(wanted)) : 0, opts.source);
    radioList.current = [];
    if (radioWatch.current) { clearTimeout(radioWatch.current); radioWatch.current = null; }
    const seq = ++playSeq.current;
    // Token hanya perlu untuk streaming dari server; lagu di HP / offline / murottal langsung diputar tanpa menunggu
    let list2 = list;
    const needsToken = list.some((t) => !(t.local && t.uri) && !offlineUri(t.id) && !(t.url && /^(quran|radio)-/.test(t.id)));
    if (needsToken) {
      try {
        tokenRef.current = await Promise.race([mediaToken(), new Promise<string>((_, no) => setTimeout(() => no(Object.assign(new Error('timeout'), { status: 0 })), 6000))]);
      } catch (e: any) {
        // Tidak ada koneksi ke server → antrean hanya berisi lagu yang bisa diputar offline
        if (e?.status === 0 || !tokenRef.current) {
          list2 = list.filter(playableOffline);
          if (wanted && !playableOffline(wanted)) {
            if (seq === playSeq.current) say(T('Sedang offline. “{t}” belum diunduh untuk offline.', { t: wanted.title }));
            return;
          }
          if (!list2.length) { if (seq === playSeq.current) say(T('Sedang offline dan belum ada lagu yang diunduh.')); return; }
        }
      }
    }
    // Pengguna mengetuk lagu lain selagi menunggu token → hanya ketukan terakhir yang dipakai
    if (seq !== playSeq.current) return;
    failStreak.current = 0;
    const p = fresh();
    const sh = opts.shuffle ?? shuffle;
    setShuffleState(sh);
    setSource(opts.source || 'Pustaka');
    originalRef.current = list2;
    const startIdx = wanted == null ? Math.floor(Math.random() * list2.length) : Math.max(0, list2.indexOf(wanted));
    const q = sh ? [list2[startIdx], ...shuffled(list2.filter((_, i) => i !== startIdx))] : list2;
    const begin = sh ? 0 : startIdx;
    commitQueue(q);
    q.forEach((t) => p.add(sourceFor(t)));
    const rep = opts.repeat ?? repeat;
    if (rep !== repeat) setRepeat(rep);
    p.loop = LOOP[rep];
    p.skipTo(begin);
    p.play();
    p.setActiveForLockScreen(true, meta(q[begin]), { showNextTrack: true, showPreviousTrack: true });
    lockActive.current = true;
    lastRecorded.current = null;
    onTrack(begin);
  };

  /** Radio: ganti stasiun tanpa membangun ulang antrean panjang; pengawas 20 detik untuk stasiun yang mati. */
  function playRadio(list: Track[], i: number, src?: string) {
    if (!pl.current) return;
    const seq = ++playSeq.current;
    radioList.current = list;
    const t = list[i];
    setShuffleState(false);
    setSource(src || 'Radio');
    commitQueue([t]);
    const p = fresh();
    p.add(sourceFor(t));
    p.loop = 'none';
    setRepeat('off');
    p.skipTo(0);
    p.play();
    setPlaying(true);
    setBuffering(true);
    setPosition(0); setDuration(0);
    p.setActiveForLockScreen(true, meta(t), { showNextTrack: false, showPreviousTrack: false });
    lockActive.current = true;
    onTrack(0);
    if (radioWatch.current) clearTimeout(radioWatch.current);
    radioWatch.current = setTimeout(() => {
      radioWatch.current = null;
      if (seq !== playSeq.current) return;
      const cur = pl.current;
      // Masih belum bersuara → hentikan agar tidak menggantung, beri tahu pengguna
      if (cur && (cur.isBuffering || !cur.currentTime)) {
        cur.pause();
        setPlaying(false); setBuffering(false);
        say(T('{s}: stasiun tidak merespons. Coba stasiun lain.', { s: t.title }));
      }
    }, RADIO_TIMEOUT);
  }
  const radioStep = (d: number) => {
    const list = radioList.current;
    const cur = queueRef.current[0];
    if (!list.length || !cur) return false;
    const i = list.findIndex((x) => x.id === cur.id);
    playRadio(list, (i + d + list.length) % list.length, source);
    return true;
  };

  /** Pemutar sempat error (IDLE) → bangun ulang dari lagu i; mengembalikan true bila sudah ditangani. */
  const recover = (i: number) => {
    if (!errored.current) return false;
    const q = queueRef.current;
    if (!q.length) return true;
    const j = Math.min(Math.max(0, i), q.length - 1);
    if (q[j].radio) { playRadio(radioList.current.length ? radioList.current : [q[j]], Math.max(0, radioList.current.findIndex((x) => x.id === q[j].id)), source); return true; }
    failStreak.current = 0;
    restartAt(q, j);
    return true;
  };

  const toggle = () => {
    const p = pl.current;
    if (!p || !queueRef.current.length) return;
    if (recover(indexRef.current)) return;
    if (p.playing) { p.pause(); setPlaying(false); } else { p.play(); setPlaying(true); }
  };
  const pause = () => { pl.current?.pause(); setPlaying(false); };
  const resume = () => { if (queueRef.current.length) { if (recover(indexRef.current)) return; pl.current?.play(); setPlaying(true); } };
  const next = () => {
    if (radioStep(1)) return;
    if (recover(indexRef.current + 1 < queueRef.current.length ? indexRef.current + 1 : 0)) return;
    pl.current?.next();
  };
  const prev = () => {
    if (radioStep(-1)) return;
    if (recover(indexRef.current - 1)) return;
    const p = pl.current; if (!p) return;
    if (p.currentTime > 3 || indexRef.current === 0) p.seekTo(0); else p.previous();
  };
  const seek = (sec: number) => { pl.current?.seekTo(Math.max(0, sec)); setPosition(sec); };
  const jumpTo = (i: number) => { if (recover(i)) return; pl.current?.skipTo(i); pl.current?.play(); };

  const removeAt = (i: number) => {
    if (i === indexRef.current) return;
    pl.current?.remove(i);
    const q = [...queueRef.current]; q.splice(i, 1); commitQueue(q);
    if (i < indexRef.current) { indexRef.current--; setIndex(indexRef.current); }
  };

  const ensureToken = async () => { if (!tokenRef.current) try { tokenRef.current = await mediaToken(); } catch { /* abaikan */ } };
  const playNext = async (t: Track) => {
    if (!queueRef.current.length) return playList([t]);
    await ensureToken();
    const at = indexRef.current + 1;
    pl.current?.insert(sourceFor(t), at);
    const q = [...queueRef.current]; q.splice(at, 0, t); commitQueue(q);
  };
  const addToQueue = async (t: Track) => {
    if (!queueRef.current.length) return playList([t]);
    await ensureToken();
    pl.current?.add(sourceFor(t));
    commitQueue([...queueRef.current, t]);
  };

  /** Acak / kembalikan urutan lagu SESUDAH lagu yang sedang diputar (lagu sekarang tidak terputus). */
  const setShuffle = (on: boolean) => {
    setShuffleState(on);
    const p = pl.current;
    const cur = indexRef.current;
    if (!p || cur < 0) return;
    const now = queueRef.current[cur];
    const played = queueRef.current.slice(0, cur + 1);
    const remaining = on
      ? shuffled(queueRef.current.slice(cur + 1))
      : originalRef.current.filter((t) => !played.includes(t) || t === now).filter((t) => t !== now);
    for (let i = p.trackCount - 1; i > cur; i--) p.remove(i);
    remaining.forEach((t) => p.add(sourceFor(t)));
    commitQueue([...played, ...remaining]);
  };

  const cycleRepeat = () => {
    const nextMode: Repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    setRepeat(nextMode);
    if (pl.current) pl.current.loop = LOOP[nextMode];
    return nextMode;
  };

  const setRepeatMode = (m: Repeat) => { setRepeat(m); if (pl.current) pl.current.loop = LOOP[m]; };

  const stop = () => {
    if (!pl.current) return;
    playSeq.current++;
    radioList.current = [];
    if (radioWatch.current) { clearTimeout(radioWatch.current); radioWatch.current = null; }
    fresh(); // lepas pemutar lama (termasuk yang sedang error) dan siapkan yang baru
    setPlaying(false);
    setBuffering(false);
    setPosition(0); setDuration(0);
    commitQueue([]);
    indexRef.current = -1;
    setIndex(-1);
  };

  const current = queue[index] || null;
  const value = useMemo(() => ({
    queue, index, current, playing, buffering, shuffle, repeat, source, notice,
    playList, toggle, pause, resume, next, prev, seek, jumpTo, removeAt, playNext, addToQueue, setShuffle, cycleRepeat, setRepeatMode, stop,
  }), [queue, index, current, playing, buffering, shuffle, repeat, source, notice]); // eslint-disable-line react-hooks/exhaustive-deps
  const progress = useMemo(() => ({ position, duration }), [position, duration]);

  return <Ctx.Provider value={value}><ProgCtx.Provider value={progress}>{children}</ProgCtx.Provider></Ctx.Provider>;
}

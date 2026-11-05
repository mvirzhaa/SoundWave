/**
 * Pemutar musik berbasis AudioPlaylist (expo-audio):
 * antrean native → lagu tetap berpindah otomatis saat aplikasi di latar belakang,
 * dan tombol next/previous di layar kunci / notifikasi berfungsi.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AudioPlaylist, AudioSource, createAudioPlaylist, setAudioModeAsync } from 'expo-audio';
import { getServer, mediaToken, ytThumb } from './api';
import { offlineUri } from './offline';
import { useLibrary } from './library';
import type { Track } from './types';

type Repeat = 'off' | 'all' | 'one';

type PlayerCtx = {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  source: string;
  playList: (tracks: Track[], index?: number | null, opts?: { shuffle?: boolean; source?: string }) => Promise<void>;
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
  stop: () => void;
};

const Ctx = createContext<PlayerCtx>(null as unknown as PlayerCtx);
export const usePlayer = () => useContext(Ctx);

const shuffled = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const LOOP: Record<Repeat, 'none' | 'all' | 'single'> = { off: 'none', all: 'all', one: 'single' };

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { recordPlay } = useLibrary();
  const pl = useRef<AudioPlaylist | null>(null);
  const tokenRef = useRef<string>('');
  const queueRef = useRef<Track[]>([]);
  const originalRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const lastRecorded = useRef<string | null>(null);
  const lockActive = useRef(false);

  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const [source, setSource] = useState('Pustaka');

  const sourceFor = useCallback((t: Track): AudioSource => {
    if (t.local && t.uri) return { uri: t.uri }; // file di penyimpanan HP
    const local = offlineUri(t.id);
    if (local) return { uri: local };
    if (t.url && t.id.startsWith('quran-')) return { uri: t.url }; // murottal langsung dari CDN
    return { uri: `${getServer()}/api/library/stream/${encodeURIComponent(t.id)}?t=${encodeURIComponent(tokenRef.current)}` };
  }, []);

  const meta = (t: Track) => ({ title: t.title, artist: t.artist, albumTitle: t.album || 'SoundWave', artworkUrl: ytThumb(t.ytId, true) || t.coverUri || undefined, ...(t.quran ? { albumTitle: 'Hapalan Quran' } : {}) });

  const onTrack = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
    const t = queueRef.current[i];
    if (!t) return;
    if (lockActive.current) pl.current?.updateLockScreenMetadata(meta(t));
    if (lastRecorded.current !== t.id) { lastRecorded.current = t.id; recordPlay(t); }
  }, [recordPlay]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    const p = createAudioPlaylist({ sources: [], updateInterval: 500, loop: 'none' });
    pl.current = p;
    const s1 = p.addListener('playlistStatusUpdate', (st) => {
      setPlaying(st.playing);
      setBuffering(st.isBuffering);
      setPosition(st.currentTime || 0);
      setDuration(st.duration || 0);
      if (st.currentIndex !== indexRef.current && st.currentIndex >= 0) onTrack(st.currentIndex);
    });
    const s2 = p.addListener('trackChanged', ({ currentIndex }) => onTrack(currentIndex));
    return () => { s1.remove(); s2.remove(); p.destroy(); pl.current = null; };
  }, [onTrack]);

  const commitQueue = (q: Track[]) => { queueRef.current = q; setQueue(q); };

  const playList = async (tracks: Track[], start: number | null = 0, opts: { shuffle?: boolean; source?: string } = {}) => {
    const p = pl.current;
    if (!p) return;
    const wanted = start == null ? null : tracks[start];
    const list = tracks.filter((t) => t && t.available !== false && (!t.local || t.uri));
    if (!list.length) return;
    try { tokenRef.current = await mediaToken(); } catch { /* lagu offline tetap bisa diputar */ }
    const sh = opts.shuffle ?? shuffle;
    setShuffleState(sh);
    setSource(opts.source || 'Pustaka');
    originalRef.current = list;
    const startIdx = wanted == null ? Math.floor(Math.random() * list.length) : Math.max(0, list.indexOf(wanted));
    const q = sh ? [list[startIdx], ...shuffled(list.filter((_, i) => i !== startIdx))] : list;
    const begin = sh ? 0 : startIdx;
    commitQueue(q);
    p.clear();
    q.forEach((t) => p.add(sourceFor(t)));
    p.loop = LOOP[repeat];
    p.skipTo(begin);
    p.play();
    p.setActiveForLockScreen(true, meta(q[begin]), { showNextTrack: true, showPreviousTrack: true });
    lockActive.current = true;
    lastRecorded.current = null;
    onTrack(begin);
  };

  const toggle = () => { const p = pl.current; if (!p || !queueRef.current.length) return; p.playing ? p.pause() : p.play(); };
  const pause = () => pl.current?.pause();
  const resume = () => { if (queueRef.current.length) pl.current?.play(); };
  const next = () => pl.current?.next();
  const prev = () => {
    const p = pl.current; if (!p) return;
    if (p.currentTime > 3 || indexRef.current === 0) p.seekTo(0); else p.previous();
  };
  const seek = (sec: number) => { pl.current?.seekTo(Math.max(0, sec)); setPosition(sec); };
  const jumpTo = (i: number) => { pl.current?.skipTo(i); pl.current?.play(); };

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

  const stop = () => {
    const p = pl.current;
    if (!p) return;
    p.pause();
    p.clear();
    if (lockActive.current) { p.clearLockScreenControls(); lockActive.current = false; }
    commitQueue([]);
    indexRef.current = -1;
    setIndex(-1);
  };

  const current = queue[index] || null;
  const value = useMemo(() => ({
    queue, index, current, playing, buffering, position, duration, shuffle, repeat, source,
    playList, toggle, pause, resume, next, prev, seek, jumpTo, removeAt, playNext, addToQueue, setShuffle, cycleRepeat, stop,
  }), [queue, index, current, playing, buffering, position, duration, shuffle, repeat, source]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

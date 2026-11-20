/**
 * Menghubungkan pemutar + pustaka dengan widget layar utama (Android):
 *  - mendaftarkan kontrol (putar/jeda, berikutnya, sebelumnya, acak, putar lagu) agar tombol widget bekerja;
 *  - menyimpan status & daftar lagu lalu menggambar ulang widget saat ada perubahan.
 * Saat offline, daftar widget hanya berisi lagu yang sudah diunduh / ada di HP.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../lib/auth';
import { useLibrary } from '../lib/library';
import { useOnline } from '../lib/net';
import { isOffline } from '../lib/offline';
import { usePlayer } from '../lib/player';
import type { Track } from '../lib/types';
import { setWidgetControls, type WidgetCommand } from './bridge';
import { clearState, EMPTY, writeState, type WState } from './state';

const SORT_KEY = 'sw-lib-sort'; // sama dengan urutan yang dipilih di Pustaka
const MAX_ROWS = 100;
const byTitle = (a: Track, b: Track) => (a.title || '').localeCompare(b.title || '', 'id', { sensitivity: 'base', numeric: true });
const addedAt = (t: Track & { createdTime?: string }) => (t.createdTime ? Date.parse(t.createdTime) : t.added || 0);
const playableOffline = (t: Track) => Boolean((t.local && t.uri) || isOffline(t.id));

function order(list: Track[], sort: string) {
  const out = [...list];
  if (sort === 'az') out.sort(byTitle);
  else if (sort === 'za') out.sort((a, b) => byTitle(b, a));
  else if (sort === 'artis') out.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'id', { sensitivity: 'base' }) || byTitle(a, b));
  else if (sort === 'lama') out.sort((a, b) => addedAt(a) - addedAt(b));
  else out.sort((a, b) => addedAt(b) - addedAt(a));
  return out;
}

export function WidgetSync() {
  const { user } = useAuth();
  const lib = useLibrary();
  const player = usePlayer();
  const online = useOnline();

  const pRef = useRef(player); pRef.current = player;
  const lRef = useRef(lib); lRef.current = lib;
  const onlineRef = useRef(online); onlineRef.current = online;
  const userRef = useRef(user); userRef.current = user;
  const sortRef = useRef('baru');

  /** Daftar lagu yang boleh diputar lewat widget (urut sesuai pilihan Pustaka; offline → hanya yang tersimpan). */
  const listNow = (): Track[] => {
    const d = userRef.current?.drive;
    const driveReady = Boolean(d?.ready ?? (d?.connected && d?.folderId));
    const all = [...(driveReady ? lRef.current.tracks || [] : []), ...lRef.current.localTracks].filter((t) => t.available !== false);
    return order(onlineRef.current ? all : all.filter(playableOffline), sortRef.current);
  };

  const stateNow = (): WState => {
    const list = listNow();
    const p = pRef.current;
    return {
      login: Boolean(userRef.current),
      title: p.current?.title || '',
      artist: p.current?.artist || '',
      playing: p.playing,
      shuffle: p.shuffle,
      hasQueue: p.queue.length > 0 && !p.current?.radio,
      online: onlineRef.current,
      tracks: list.slice(0, MAX_ROWS).map((t) => ({ id: t.id, t: t.title || t.name, a: t.artist || '', o: playableOffline(t) ? 1 : 0 })),
      total: list.length,
    };
  };

  // Daftarkan kontrol untuk widget (stabil; selalu membaca nilai terbaru lewat ref)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const run = (cmd: WidgetCommand, id?: string) => {
      const p = pRef.current;
      const list = listNow();
      const start = (i: number | null, shuffle?: boolean) => { if (list.length) p.playList(list, i, { source: 'Widget', ...(shuffle !== undefined ? { shuffle } : {}) }); };
      const active = p.queue.length > 0 && !p.current?.radio;
      switch (cmd) {
        case 'toggle': return active ? p.toggle() : start(0);
        case 'next': return active ? p.next() : start(0);
        case 'prev': return active ? p.prev() : start(list.length ? list.length - 1 : 0);
        case 'shuffle': return active ? p.setShuffle(!p.shuffle) : start(null, true);
        case 'play': { const i = list.findIndex((t) => t.id === id); if (i >= 0) start(i); return; }
      }
    };
    setWidgetControls({ run, state: stateNow });
    return () => setWidgetControls(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Simpan status + gambar ulang widget (ditunda sebentar agar perubahan beruntun digabung)
  const seq = useRef(0);
  const trackId = player.current?.id;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const my = ++seq.current;
    const h = setTimeout(async () => {
      try { const v = await SecureStore.getItemAsync(SORT_KEY); if (v) sortRef.current = v; } catch { /* pakai urutan terakhir */ }
      if (my !== seq.current) return;
      if (!userRef.current) clearState(); else writeState(stateNow());
      try { const { updateWidgets } = await import('./update'); await updateWidgets(); } catch { /* widget tidak tersedia */ }
    }, 350);
    return () => clearTimeout(h);
  }, [user, lib.tracks, lib.localTracks, lib.offlineVersion, online, trackId, player.playing, player.shuffle, player.queue.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export { EMPTY };

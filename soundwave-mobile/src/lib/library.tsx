/** Cache pustaka Google Drive + favorit + penanda perubahan playlist. */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { del, get, patch, post, put } from './api';
import { useAuth } from './auth';
import { loadOffline, offlineTracks, subscribeOffline, updateOfflineMeta } from './offline';
import { clearMembership, refreshMembership } from './membership';
import * as Local from './local';
import type { Track } from './types';

type LibCtx = {
  tracks: Track[] | null;
  loading: boolean;
  error: string | null;
  usingOffline: boolean; // daftar diambil dari unduhan offline karena server/Drive tak terjangkau
  favorites: Set<string>;
  offlineVersion: number;
  playlistsVersion: number;
  load: (refresh?: boolean) => Promise<void>;
  toggleFavorite: (t: Track) => Promise<boolean>;
  setGenre: (t: Track, genre: string) => Promise<string | null>;
  trashTrack: (t: Track) => Promise<void>;
  renameTrack: (t: Track, name: string) => Promise<Track>;
  bumpPlaylists: () => void;
  recordPlay: (t: Track) => void;
  // --- musik lokal di HP ---
  localTracks: Track[];
  localSettings: Local.LocalSettings;
  localScan: { busy: boolean; done: number; errors: string[] };
  scanLocal: () => Promise<void>;
  setDeviceScan: (on: boolean) => Promise<void>;
  addFolder: () => Promise<boolean>;
  removeFolder: (uri: string) => Promise<void>;
  importLocal: () => Promise<number>;
  setLocalGenre: (t: Track, genre: string) => void;
  removeImported: (t: Track) => void;
};

const Ctx = createContext<LibCtx>(null as unknown as LibCtx);
export const useLibrary = () => useContext(Ctx);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingOffline, setUsingOffline] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [playlistsVersion, setPV] = useState(0);
  const [offlineVersion, setOV] = useState(0);

  useEffect(() => { loadOffline(); return subscribeOffline(() => setOV((v) => v + 1)); }, []);

  /* ---------- Musik lokal ---------- */
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [localSettings, setLocalSettings] = useState<Local.LocalSettings>({ device: false, folders: [] });
  const [localScan, setLocalScan] = useState({ busy: false, done: 0, errors: [] as string[] });

  const scanLocal = useCallback(async () => {
    setLocalScan({ busy: true, done: 0, errors: [] });
    try {
      const r = await Local.scanAll((done) => setLocalScan((s) => ({ ...s, done })));
      setLocalTracks(r.tracks);
      setLocalScan({ busy: false, done: r.tracks.length, errors: r.errors });
    } catch (e: any) {
      setLocalScan({ busy: false, done: 0, errors: [e.message] });
    }
  }, []);

  useEffect(() => {
    // Tampilkan hasil pindaian terakhir seketika, lalu pindai ulang di latar belakang
    const s = Local.loadSaved();
    setLocalSettings(s.settings);
    setLocalTracks(s.tracks);
    if (s.settings.device || s.settings.folders.length) scanLocal();
    else setLocalTracks(Local.scanImported());
  }, [scanLocal]);

  const updateSettings = async (next: Local.LocalSettings) => { Local.setSettings(next); setLocalSettings(next); await scanLocal(); };
  const setDeviceScan = (on: boolean) => updateSettings({ ...Local.getSettings(), device: on });
  const addFolder = async () => {
    const f = await Local.pickFolder();
    if (!f) return false;
    const cur = Local.getSettings();
    if (!cur.folders.some((x) => x.uri === f.uri)) await updateSettings({ ...cur, folders: [...cur.folders, f] });
    return true;
  };
  const removeFolder = (uri: string) => { const cur = Local.getSettings(); return updateSettings({ ...cur, folders: cur.folders.filter((x) => x.uri !== uri) }); };
  const importLocal = async () => { const n = await Local.importFiles(); if (n) await scanLocal(); return n; };
  const setLocalGenre = (t: Track, genre: string) => setLocalTracks(Local.setLocalGenre(t.id, genre.trim()));
  const removeImported = (t: Track) => { Local.deleteImported(t); setLocalTracks((l) => l.filter((x) => x.id !== t.id)); };

  const driveReady = Boolean(user?.drive.ready ?? (user?.drive.connected && user?.drive.folderId));

  const load = useCallback(async (refresh = false) => {
    if (!user) return;
    if (!driveReady) { setTracks([]); setError(null); return; }
    setLoading(true);
    try {
      const r = await get<{ tracks: Track[] }>(`/api/library/tracks${refresh ? '?refresh=1' : ''}`, { timeout: 45000 });
      setTracks(r.tracks);
      setFavorites((prev) => new Set([...r.tracks.filter((t) => t.favorite).map((t) => t.id), ...[...prev].filter((id) => id.startsWith('local-'))]));
      setError(null);
      setUsingOffline(false);
    } catch (e: any) {
      const off = offlineTracks();
      if (off.length && e.status === 0) { setTracks(off); setUsingOffline(true); setError(null); }
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, driveReady]);

  // Penanda playlist: muat saat pengguna masuk, kosongkan saat keluar
  useEffect(() => { if (user) refreshMembership(); else clearMembership(); }, [user?.id]);
  useEffect(() => { setTracks(null); if (user) load(); }, [user?.id, user?.drive.folderId, user?.drive.connected, user?.drive.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Favorit lagu lokal (ID-nya disimpan server, file tetap di HP)
  useEffect(() => {
    if (!user) return;
    get<{ items: Track[] }>('/api/library/playlists/favorites')
      .then((p) => setFavorites((prev) => new Set([...prev, ...p.items.filter((x) => x.id.startsWith('local-')).map((x) => x.id)])))
      .catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFavorite = async (t: Track) => {
    const fav = favorites.has(t.id);
    if (fav) await del(`/api/library/favorites/${t.id}`);
    else await put(`/api/library/favorites/${t.id}`, { track: t });
    setFavorites((s) => { const n = new Set(s); fav ? n.delete(t.id) : n.add(t.id); return n; });
    setPV((v) => v + 1);
    return !fav;
  };

  const setGenre = async (t: Track, genre: string) => {
    const r = await put<{ genre: string | null }>(`/api/library/tracks/${t.id}/genre`, { genre });
    setTracks((list) => list?.map((x) => (x.id === t.id ? { ...x, genre: r.genre } : x)) || list);
    return r.genre;
  };

  const trashTrack = async (t: Track) => {
    await del(`/api/library/tracks/${t.id}`);
    setTracks((list) => list?.filter((x) => x.id !== t.id) || list);
    setPV((v) => v + 1);
  };

  /** Ganti nama file di Google Drive; judul & artis di daftar ikut diperbarui. */
  const renameTrack = async (t: Track, name: string) => {
    const r = await patch<{ track: Track }>(`/api/library/tracks/${t.id}`, { name });
    const upd = { name: r.track.name, title: r.track.title, artist: r.track.artist };
    setTracks((list) => list?.map((x) => (x.id === t.id ? { ...x, ...upd } : x)) || list);
    updateOfflineMeta(t.id, upd);
    setPV((v) => v + 1);
    return { ...t, ...upd };
  };

  const recordPlay = (t: Track) => { post(`/api/library/recent/${t.id}`, { track: t }).then(() => setPV((v) => v + 1)).catch(() => {}); };

  return (
    <Ctx.Provider value={{
      tracks, loading, error, usingOffline, favorites, offlineVersion, playlistsVersion,
      load, toggleFavorite, setGenre, trashTrack, renameTrack, bumpPlaylists: () => { setPV((v) => v + 1); refreshMembership(); }, recordPlay,
      localTracks, localSettings, localScan, scanLocal, setDeviceScan, addFolder, removeFolder, importLocal, setLocalGenre, removeImported,
    }}>
      {children}
    </Ctx.Provider>
  );
}

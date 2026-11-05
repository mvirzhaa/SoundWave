/** Menu ⋮ untuk satu lagu — dipakai di daftar lagu, playlist, dan pemutar penuh. */
import React from 'react';
import { Linking, Text, View } from 'react-native';
import { router } from 'expo-router';
import { get, post, put, del } from '../lib/api';
import { useLibrary } from '../lib/library';
import { usePlayer } from '../lib/player';
import { useUi } from '../lib/ui';
import { useSholat } from '../lib/sholat';
import { downloadOffline, isOffline, removeOffline } from '../lib/offline';
import { C } from '../lib/theme';
import { Cover } from './Cover';
import type { PlaylistSummary, Track } from '../lib/types';

export type MenuCtx = {
  fromPlayer?: boolean;
  playlist?: { id: number | string; name: string; special?: boolean };
  list?: Track[];
  index?: number;
  onChange?: () => void;
};

export function useTrackMenu() {
  const ui = useUi();
  const lib = useLibrary();
  const player = usePlayer();
  const sholat = useSholat();

  const addToPlaylist = async (tracks: Track[]) => {
    let data: { playlists: PlaylistSummary[] };
    try { data = await get('/api/library/playlists'); } catch (e: any) { ui.toast(e.message, true); return; }
    const add = async (p: { id: number | string; name: string }) => {
      try {
        const r = await post<{ added: number }>(`/api/library/playlists/${p.id}/items`, { tracks });
        lib.bumpPlaylists();
        ui.toast(r.added ? `Ditambahkan ke “${p.name}”` : `Sudah ada di “${p.name}”`);
      } catch (e: any) { ui.toast(e.message, true); }
    };
    ui.sheet({
      title: 'Tambah ke playlist',
      subtitle: tracks.length > 1 ? `${tracks.length} lagu` : tracks[0]?.title,
      items: [
        { label: 'Playlist baru…', icon: 'add', onPress: async () => {
          const name = await ui.prompt({ title: 'Playlist baru', placeholder: 'Nama playlist', ok: 'Buat' });
          if (!name) return;
          try { const p = await post<{ id: number; name: string }>('/api/library/playlists', { name }); await add(p); } catch (e: any) { ui.toast(e.message, true); }
        } },
        ...data.playlists.map((p) => ({ label: `${p.name} (${p.count})`, icon: 'musical-notes-outline' as const, onPress: () => add(p) })),
      ],
    });
  };

  /** Hafalan: putar surat ayat demi ayat, tiap ayat diulang n kali. */
  const hafalan = (t: Track) => {
    const run = async (ulang: number) => {
      try {
        const qari = t.id.split('-')[1];
        const r = await get<{ surat: { namaLatin: string }; items: Track[] }>(`/api/quran/hafalan/${t.quran!.surat}?qari=${qari}&ulang=${ulang}`);
        await player.playList(r.items, 0, { shuffle: false, source: `Hafalan ${r.surat.namaLatin}` });
        ui.toast(`Hafalan ${r.surat.namaLatin}: tiap ayat ${ulang}×`);
      } catch (e: any) { ui.toast(e.message, true); }
    };
    ui.sheet({
      title: `Hafalan per ayat · ${t.title}`,
      subtitle: 'Teks ayat tampil di tab Lirik pemutar',
      items: [1, 3, 5, 7].map((n) => ({ label: n === 1 ? 'Putar per ayat (tanpa ulang)' : `Ulangi tiap ayat ${n}×`, icon: 'repeat' as const, onPress: () => run(n) })),
    });
  };

  const open = (t: Track, ctx: MenuCtx = {}) => {
    const fav = lib.favorites.has(t.id);
    const offline = isOffline(t.id);
    const pl = ctx.playlist && !ctx.playlist.special ? ctx.playlist : null;
    const idx = ctx.index ?? -1;
    const list = ctx.list || [];

    const move = async (dir: number) => {
      const ids = list.map((x) => x.itemId);
      const [it] = ids.splice(idx, 1);
      ids.splice(idx + dir, 0, it);
      try { await put(`/api/library/playlists/${pl!.id}/order`, { itemIds: ids }); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
    };

    ui.sheet({
      header: (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <Cover ytId={t.ytId} uri={t.coverUri} quran={t.quran?.surat} seed={t.artist + t.title} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>{t.title}</Text>
            <Text style={{ color: C.muted }} numberOfLines={1}>{t.artist}{t.genre ? ` · ${t.genre}` : ''}</Text>
          </View>
        </View>
      ),
      items: [
        !ctx.fromPlayer && { label: 'Putar berikutnya', icon: 'play-forward-outline', onPress: () => { player.playNext(t); ui.toast(`“${t.title}” diputar berikutnya`); } },
        !ctx.fromPlayer && { label: 'Tambah ke antrean', icon: 'list-outline', onPress: () => { player.addToQueue(t); ui.toast('Ditambahkan ke antrean'); } },
        { label: 'Tambah ke playlist…', icon: 'add-circle-outline', onPress: () => addToPlaylist([t]) },
        { label: fav ? 'Hapus dari Favorit' : 'Tambah ke Favorit', icon: fav ? 'heart' : 'heart-outline', onPress: async () => {
          try { const f = await lib.toggleFavorite(t); ui.toast(f ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit'); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
        t.local ? false : offline
          ? { label: 'Hapus unduhan offline', icon: 'cloud-offline-outline', onPress: () => { removeOffline(t.id); ui.toast('Unduhan offline dihapus'); } }
          : { label: 'Simpan untuk offline', icon: 'download-outline', onPress: async () => {
            ui.toast('Mengunduh untuk offline…');
            try { await downloadOffline(t); ui.toast(`“${t.title}” tersedia offline`); } catch (e: any) { ui.toast(`Gagal mengunduh: ${e.message}`, true); }
          } },
        t.quran && !t.quran.ayat && { label: 'Hafalan per ayat…', icon: 'school-outline', onPress: () => hafalan(t) },
        !t.quran && { label: 'Jadikan suara adzan', icon: 'moon-outline', onPress: async () => {
          try { await sholat.savePrefs({ sholat: { adzan: { suara: { jenis: 'lagu', id: t.id, title: t.title, local: !!t.local } } } }); ui.toast(`“${t.title}” dipakai sebagai suara adzan`); } catch (e: any) { ui.toast(e.message, true); }
        } },
        !t.quran && !!t.artist && t.artist !== 'Tidak diketahui' && { label: `Lihat artis: ${t.artist}`, icon: 'person-outline', onPress: () => router.push({ pathname: '/group/[kind]/[name]', params: { kind: 'artis', name: t.artist } }) },
        !t.quran && { label: `Ubah genre${t.genre ? ` (${t.genre})` : ''}`, icon: 'pricetag-outline', onPress: async () => {
          const g = await ui.prompt({ title: 'Genre lagu', value: t.genre || '', placeholder: 'mis. Pop, Rock, Dangdut, Jazz' });
          if (g == null) return;
          if (t.local) { lib.setLocalGenre(t, g); ui.toast(`Genre: ${g || t.tagGenre || '—'}`); ctx.onChange?.(); return; }
          try { const r = await lib.setGenre(t, g); ui.toast(`Genre: ${r || '—'}`); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
        pl && idx > 0 && { label: 'Naikkan', icon: 'arrow-up', onPress: () => move(-1) },
        pl && idx >= 0 && idx < list.length - 1 && { label: 'Turunkan', icon: 'arrow-down', onPress: () => move(1) },
        pl && { label: `Hapus dari “${pl.name}”`, icon: 'remove-circle-outline', onPress: async () => {
          try { await del(`/api/library/playlists/${pl.id}/items/${t.itemId}`); lib.bumpPlaylists(); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
        t.local && { label: `Lokasi: ${t.path || t.name}`, icon: 'folder-open-outline', onPress: () => ui.toast(t.path || t.uri || t.name) },
        t.local && t.source === 'import' && { label: 'Hapus file impor dari aplikasi', icon: 'trash-outline', danger: true, onPress: async () => {
          if (await ui.confirm({ title: 'Hapus file impor?', message: `“${t.name}” dihapus dari penyimpanan SoundWave.`, ok: 'Hapus', danger: true })) lib.removeImported(t);
        } },
        !t.local && !t.quran && { label: 'Buka di Google Drive', icon: 'open-outline', onPress: () => Linking.openURL(`https://drive.google.com/file/d/${t.id}/view`) },
        !t.local && !t.quran && { label: 'Hapus dari Google Drive', icon: 'trash-outline', danger: true, onPress: async () => {
          const ok = await ui.confirm({ title: 'Hapus dari Google Drive?', message: `“${t.name || t.title}” akan dipindahkan ke Sampah Google Drive.`, ok: 'Pindahkan', danger: true });
          if (!ok) return;
          try { await lib.trashTrack(t); removeOffline(t.id); ui.toast('Dipindahkan ke Sampah Drive'); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
      ],
    });
  };

  return { open, addToPlaylist, hafalan };
}

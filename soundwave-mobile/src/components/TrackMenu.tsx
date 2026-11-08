/** Menu ⋮ untuk satu lagu — dipakai di daftar lagu, playlist, dan pemutar penuh. */
import React from 'react';
import { Linking, Text, View } from 'react-native';
import { router } from 'expo-router';
import { get, post, put, del } from '../lib/api';
import { useLibrary } from '../lib/library';
import { usePlayer } from '../lib/player';
import { useUi } from '../lib/ui';
import { useSholat } from '../lib/sholat';
import { useAuth } from '../lib/auth';
import { isFavRadio, toggleRadioFav } from '../lib/radio';
import { T } from '../lib/i18n';
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
  const { user } = useAuth();

  const addToPlaylist = async (tracks: Track[], onDone?: () => void) => {
    let data: { playlists: PlaylistSummary[] };
    try { data = await get('/api/library/playlists'); } catch (e: any) { ui.toast(e.message, true); return; }
    const add = async (p: { id: number | string; name: string }) => {
      try {
        const r = await post<{ added: number; skipped?: number }>(`/api/library/playlists/${p.id}/items`, { tracks });
        lib.bumpPlaylists();
        if (tracks.length > 1) ui.toast(r.added ? T('{n} lagu ditambahkan ke “{p}”', { n: r.added, p: p.name }) : T('Semua lagu sudah ada di “{p}”', { p: p.name }));
        else ui.toast(r.added ? T('Ditambahkan ke “{p}”', { p: p.name }) : T('Sudah ada di “{p}”', { p: p.name }));
        onDone?.();
      } catch (e: any) { ui.toast(e.message, true); }
    };
    ui.sheet({
      title: T('Tambah ke playlist'),
      subtitle: tracks.length > 1 ? T('{n} lagu', { n: tracks.length }) : tracks[0]?.title,
      items: [
        { label: T('Playlist baru…'), icon: 'add', onPress: async () => {
          const name = await ui.prompt({ title: T('Playlist baru'), placeholder: T('Nama playlist'), ok: T('Buat') });
          if (!name) return;
          try { const p = await post<{ id: number; name: string }>('/api/library/playlists', { name }); await add(p); } catch (e: any) { ui.toast(e.message, true); }
        } },
        ...data.playlists.map((p) => ({ label: `${p.name} (${p.count})`, icon: 'musical-notes-outline' as const, onPress: () => add(p) })),
      ],
    });
  };

  /** Hafalan: ulangi surat utuh, atau putar ayat demi ayat dengan tiap ayat diulang n kali. */
  const hafalan = (tr: Track) => {
    const qari = tr.id.split('-')[1];
    const perAyat = async (ulang: number, dari = 1) => {
      try {
        const r = await get<{ surat: { namaLatin: string; jumlahAyat: number }; items: Track[]; dari: number; sampai: number; terpotong: boolean }>(
          `/api/quran/hafalan/${tr.quran!.surat}?qari=${qari}&ulang=${ulang}&dari=${dari}`);
        await player.playList(r.items, 0, { shuffle: false, source: T('Hafalan {s}', { s: r.surat.namaLatin }), repeat: 'off' });
        ui.toast(r.terpotong
          ? T('Hafalan {s} ayat {a}–{b}, tiap ayat {n}×. Lanjutkan dari menu ⋮ setelah selesai.', { s: r.surat.namaLatin, a: r.dari, b: r.sampai, n: ulang })
          : T('Hafalan {s}: tiap ayat {n}×', { s: r.surat.namaLatin, n: ulang }));
      } catch (e: any) { ui.toast(e.message, true); }
    };
    ui.sheet({
      title: T('Ulangi hafalan · {s}', { s: tr.title }),
      subtitle: T('Teks Arab, Latin & terjemahan tampil di tab Ayat pemutar'),
      items: [
        { label: T('Ulangi surat utuh (tanpa per ayat)'), icon: 'repeat' as const, onPress: async () => {
          await player.playList([tr], 0, { shuffle: false, source: T('Hapalan Quran'), repeat: 'one' });
          ui.toast(T('{s} diulang terus. Matikan lewat tombol ulangi di pemutar.', { s: tr.title }));
        } },
        ...[3, 7, 11, 20, 40].map((n) => ({ label: T('Ulangi tiap ayat {n}×', { n }), icon: 'repeat' as const, onPress: () => perAyat(n) })),
      ],
    });
  };

  const open = (t: Track, ctx: MenuCtx = {}) => {
    if (t.radio) {
      const st = t.radio;
      const fav = isFavRadio(st.uuid);
      ui.sheet({
        title: t.title, subtitle: t.artist,
        items: [
          { label: fav ? T('Hapus dari favorit radio') : T('Tambah ke favorit radio'), icon: fav ? 'heart-dislike-outline' : 'heart-outline', onPress: async () => {
            try { const f = await toggleRadioFav(st); ui.toast(f ? T('Ditambahkan ke favorit radio') : T('Dihapus dari favorit radio')); } catch (e: any) { ui.toast(e.message, true); }
          } },
          ...(st.homepage ? [{ label: T('Buka situs stasiun'), icon: 'open-outline' as const, onPress: () => { Linking.openURL(st.homepage!); } }] : []),
          { label: T('Lihat semua radio'), icon: 'radio-outline' as const, onPress: () => router.navigate('/radio') },
        ],
      });
      return;
    }
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
        !ctx.fromPlayer && { label: T('Putar berikutnya'), icon: 'play-forward-outline', onPress: () => { player.playNext(t); ui.toast(T('“{t}” diputar berikutnya', { t: t.title })); } },
        !ctx.fromPlayer && { label: T('Tambah ke antrean'), icon: 'list-outline', onPress: () => { player.addToQueue(t); ui.toast(T('Ditambahkan ke antrean')); } },
        { label: T('Tambah ke playlist…'), icon: 'add-circle-outline', onPress: () => addToPlaylist([t]) },
        { label: fav ? T('Hapus dari Favorit') : T('Tambah ke Favorit'), icon: fav ? 'heart' : 'heart-outline', onPress: async () => {
          try { const f = await lib.toggleFavorite(t); ui.toast(f ? T('Ditambahkan ke Favorit') : T('Dihapus dari Favorit')); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
        t.local ? false : offline
          ? { label: T('Hapus unduhan offline'), icon: 'cloud-offline-outline', onPress: () => { removeOffline(t.id); ui.toast(T('Unduhan offline dihapus')); } }
          : { label: T('Simpan untuk offline'), icon: 'download-outline', onPress: async () => {
            ui.toast(T('Mengunduh untuk offline…'));
            try { await downloadOffline(t); ui.toast(T('“{t}” tersedia offline', { t: t.title })); } catch (e: any) { ui.toast(T('Gagal mengunduh: {e}', { e: e.message }), true); }
          } },
        t.quran && { label: T('Baca teks surat'), icon: 'book-outline', onPress: () => router.push(`/surat/${t.quran!.surat}?qari=${t.id.split('-')[1]}`) },
        t.quran && !t.quran.ayat && { label: T('Ulangi / hafalan…'), icon: 'school-outline', onPress: () => hafalan(t) },
        !t.quran && !sholat.paksa && { label: T('Jadikan suara adzan'), icon: 'moon-outline', onPress: async () => {
          try { await sholat.savePrefs({ sholat: { adzan: { suara: { jenis: 'lagu', id: t.id, title: t.title, local: !!t.local } } } }); ui.toast(T('“{t}” dipakai sebagai suara adzan', { t: t.title })); } catch (e: any) { ui.toast(e.message, true); }
        } },
        !t.quran && !!t.artist && t.artist !== 'Tidak diketahui' && { label: T('Lihat artis: {a}', { a: t.artist }), icon: 'person-outline', onPress: () => router.push({ pathname: '/group/[kind]/[name]', params: { kind: 'artis', name: t.artist } }) },
        !t.local && !t.quran && !user?.drive.readOnly && { label: T('Ganti nama…'), icon: 'create-outline', onPress: async () => {
          const cur = (t.name || t.title || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '');
          const v = await ui.prompt({ title: T('Ganti nama lagu'), value: cur, placeholder: T('mis. Natalie Imbruglia - Torn'), ok: T('Ganti nama') });
          if (v == null || !v.trim() || v.trim() === cur) return;
          try { const r = await lib.renameTrack(t, v.trim()); ui.toast(T('Nama diganti menjadi “{n}”', { n: r.name })); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
        !t.quran && { label: `${T('Ubah genre')}${t.genre ? ` (${t.genre})` : ''}`, icon: 'pricetag-outline', onPress: async () => {
          const g = await ui.prompt({ title: T('Genre lagu'), value: t.genre || '', placeholder: T('mis. Pop, Rock, Dangdut, Jazz') });
          if (g == null) return;
          if (t.local) { lib.setLocalGenre(t, g); ui.toast(`Genre: ${g || t.tagGenre || '—'}`); ctx.onChange?.(); return; }
          try { const r = await lib.setGenre(t, g); ui.toast(`Genre: ${r || '—'}`); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
        pl && idx > 0 && { label: T('Naikkan'), icon: 'arrow-up', onPress: () => move(-1) },
        pl && idx >= 0 && idx < list.length - 1 && { label: T('Turunkan'), icon: 'arrow-down', onPress: () => move(1) },
        pl && { label: `Hapus dari “${pl.name}”`, icon: 'remove-circle-outline', onPress: async () => {
          try { await del(`/api/library/playlists/${pl.id}/items/${t.itemId}`); lib.bumpPlaylists(); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
        t.local && { label: `Lokasi: ${t.path || t.name}`, icon: 'folder-open-outline', onPress: () => ui.toast(t.path || t.uri || t.name) },
        t.local && t.source === 'import' && { label: T('Hapus file impor dari aplikasi'), icon: 'trash-outline', danger: true, onPress: async () => {
          if (await ui.confirm({ title: T('Hapus file impor?'), message: T('“{t}” dihapus dari penyimpanan SoundWave.', { t: t.name }), ok: T('Hapus'), danger: true })) lib.removeImported(t);
        } },
        !t.local && !t.quran && { label: T('Buka di Google Drive'), icon: 'open-outline', onPress: () => Linking.openURL(`https://drive.google.com/file/d/${t.id}/view`) },
        !t.local && !t.quran && !user?.drive.readOnly && { label: T('Hapus dari Google Drive'), icon: 'trash-outline', danger: true, onPress: async () => {
          const ok = await ui.confirm({ title: T('Hapus dari Google Drive?'), message: T('“{t}” akan dipindahkan ke Sampah Google Drive.', { t: t.name || t.title }), ok: T('Pindahkan'), danger: true });
          if (!ok) return;
          try { await lib.trashTrack(t); removeOffline(t.id); ui.toast(T('Dipindahkan ke Sampah Drive')); ctx.onChange?.(); } catch (e: any) { ui.toast(e.message, true); }
        } },
      ],
    });
  };

  return { open, addToPlaylist, hafalan };
}

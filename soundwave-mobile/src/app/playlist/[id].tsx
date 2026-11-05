/** Detail playlist (termasuk Favorit & Terakhir Diputar). */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { del, get, patch } from '../../lib/api';
import { useLibrary } from '../../lib/library';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { downloadOffline, isOffline } from '../../lib/offline';
import { TrackRow } from '../../components/TrackRow';
import { useTrackMenu } from '../../components/TrackMenu';
import { Collage } from '../../components/Cover';
import { Button, Empty } from '../../components/Common';
import { C, fmtDur } from '../../lib/theme';
import type { PlaylistDetail } from '../../lib/types';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lib = useLibrary();
  const player = usePlayer();
  const ui = useUi();
  const menu = useTrackMenu();
  const [p, setP] = useState<PlaylistDetail | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    get<PlaylistDetail>(`/api/library/playlists/${encodeURIComponent(String(id))}`).then((r) => { setP(r); setErr(''); }).catch((e) => setErr(e.message));
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load, lib.playlistsVersion]));

  if (err) return <Text style={{ color: C.danger, padding: 24 }}>{err}</Text>;
  if (!p) return <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />;

  // Lagu lokal: cocokkan dengan musik yang ada di HP ini
  const localMap = new Map(lib.localTracks.map((t) => [t.id, t]));
  p.items = p.items.map((x) => {
    if (!x.local) return x;
    const lt = localMap.get(x.id);
    return lt ? { ...lt, itemId: x.itemId, available: true } : { ...x, available: false };
  });
  const missingLocal = p.items.filter((x) => x.local && x.available === false).length;

  const playable = p.items.filter((x) => x.available !== false);
  const total = p.items.reduce((sum, x) => sum + (x.duration || 0), 0);

  const plMenu = () => ui.sheet({
    title: p.name,
    items: [
      { label: 'Simpan semua untuk offline', icon: 'download-outline', onPress: async () => {
        const todo = playable.filter((t) => !t.local && !isOffline(t.id));
        ui.toast(`Mengunduh ${todo.length} lagu…`);
        for (const t of todo) { try { await downloadOffline(t); } catch { /* lanjut */ } }
        ui.toast('Selesai mengunduh untuk offline');
      } },
      !p.special && { label: 'Ubah nama', icon: 'create-outline', onPress: async () => {
        const name = await ui.prompt({ title: 'Ubah nama playlist', value: p.name });
        if (!name) return;
        try { await patch(`/api/library/playlists/${p.id}`, { name }); lib.bumpPlaylists(); load(); } catch (e: any) { ui.toast(e.message, true); }
      } },
      !p.special && { label: 'Hapus playlist', icon: 'trash-outline', danger: true, onPress: async () => {
        if (!(await ui.confirm({ title: 'Hapus playlist?', message: `“${p.name}” akan dihapus. Lagu di Drive tidak ikut terhapus.`, ok: 'Hapus', danger: true }))) return;
        try { await del(`/api/library/playlists/${p.id}`); lib.bumpPlaylists(); router.back(); } catch (e: any) { ui.toast(e.message, true); }
      } },
    ],
  });

  return (
    <>
      <Stack.Screen options={{
        title: '',
        headerRight: () => <Pressable onPress={plMenu} hitSlop={10}><Ionicons name="ellipsis-vertical" size={22} color={C.text} /></Pressable>,
      }} />
      <FlatList
        data={p.items}
        keyExtractor={(t) => String(t.itemId)}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={s.head}>
            <Collage ids={p.items.map((t) => t.ytId).filter(Boolean) as string[]} size={170} radius={18}
              icon={p.id === 'favorites' ? 'heart' : p.id === 'recent' ? 'time-outline' : 'musical-notes'} />
            <Text style={s.eyebrow}>{p.special ? 'PLAYLIST OTOMATIS' : 'PLAYLIST'}</Text>
            <Text style={s.title}>{p.name}</Text>
            <Text style={s.muted}>{p.items.length} lagu{total ? ` · ${fmtDur(total)}` : ''}</Text>
            {missingLocal ? <Text style={[s.muted, { textAlign: 'center', fontSize: 13 }]}>{missingLocal} lagu lokal tidak ditemukan di HP ini (mungkin disimpan dari perangkat lain).</Text> : null}
            <View style={s.actions}>
              <Button label="Putar" icon="play" disabled={!playable.length} onPress={() => player.playList(p.items, 0, { shuffle: false, source: p.name })} style={{ flex: 1 }} />
              <Button label="Acak" icon="shuffle" kind="ghost" disabled={!playable.length} onPress={() => player.playList(p.items, null, { shuffle: true, source: p.name })} style={{ flex: 1 }} />
            </View>
          </View>
        }
        ListEmptyComponent={<Empty title="Playlist masih kosong" text={p.special ? undefined : 'Tambahkan lagu lewat menu ⋮ di Pustaka, atau ucapkan “masukkan lagu … ke playlist …”.'} />}
        renderItem={({ item, index }) => (
          <TrackRow track={item} active={player.current?.id === item.id} favorite={lib.favorites.has(item.id)} showSource
            onPress={() => player.playList(p.items, index, { source: p.name })}
            onMore={() => menu.open(item, { playlist: p, list: p.items, index, onChange: load })} />
        )}
        extraData={player.current?.id}
      />
    </>
  );
}

const s = StyleSheet.create({
  head: { alignItems: 'center', padding: 16, gap: 6 },
  eyebrow: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 10 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  muted: { color: C.muted },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 10 },
});

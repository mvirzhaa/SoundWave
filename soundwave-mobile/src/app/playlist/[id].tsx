/** Detail playlist (termasuk Favorit & Terakhir Diputar). */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { T } from '../../lib/i18n';
import { ActivityIndicator, Animated, FlatList, GestureResponderEvent, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { del, get, patch, put } from '../../lib/api';
import { useLibrary } from '../../lib/library';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { downloadOffline, isOffline } from '../../lib/offline';
import { TrackRow } from '../../components/TrackRow';
import { useTrackMenu } from '../../components/TrackMenu';
import { Collage } from '../../components/Cover';
import { Button, Empty } from '../../components/Common';
import { C, fmtDur, themed } from '../../lib/theme';
import type { PlaylistDetail, Track } from '../../lib/types';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lib = useLibrary();
  const player = usePlayer();
  const ui = useUi();
  const menu = useTrackMenu();
  const [p, setP] = useState<PlaylistDetail | null>(null);
  const [err, setErr] = useState('');

  /* ---------- Seret untuk mengurutkan (tahan lagu ±0,4 detik lalu geser) ----------
   * Tanpa modul native tambahan: induk FlatList mengambil alih sentuhan setelah tekan lama,
   * baris "melayang" mengikuti jari, baris lain bergeser, urutan disimpan saat jari dilepas. */
  const wrapRef = useRef<React.ComponentRef<typeof View>>(null);
  const listRef = useRef<FlatList<Track>>(null);
  const wrapTop = useRef(0);
  const wrapH = useRef(0);
  const rowH = useRef(66);
  const scrollY = useRef(0);
  const headH = useRef(0);
  const d = useRef<{ from: number; startPageY: number; startScroll: number; rowTop: number; pageY: number; owned: boolean } | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const [drag, setDrag] = useState<{ from: number; to: number; rowTop: number } | null>(null);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);

  const measureWrap = () => wrapRef.current?.measureInWindow((_x, y, _w, h) => { wrapTop.current = y; wrapH.current = h; });
  const targetOf = (pageY: number) => {
    const g = d.current!;
    const delta = pageY - g.startPageY + (scrollY.current - g.startScroll);
    const n = p?.items.length || 1;
    return Math.max(0, Math.min(n - 1, g.from + Math.round(delta / rowH.current)));
  };
  const update = (pageY: number) => {
    const g = d.current;
    if (!g) return;
    g.pageY = pageY;
    dragY.setValue(g.rowTop + (pageY - g.startPageY));
    const to = targetOf(pageY);
    setDrag((cur) => (cur && cur.to !== to ? { ...cur, to } : cur));
    // Gulir otomatis saat jari dekat tepi atas/bawah
    const yIn = pageY - wrapTop.current;
    const dir = yIn < 70 ? -1 : yIn > wrapH.current - 70 ? 1 : 0;
    if (dir && !autoScroll.current) {
      autoScroll.current = setInterval(() => {
        const gg = d.current;
        if (!gg) return;
        const yy = gg.pageY - wrapTop.current;
        const dd = yy < 70 ? -1 : yy > wrapH.current - 70 ? 1 : 0;
        if (!dd) { if (autoScroll.current) clearInterval(autoScroll.current); autoScroll.current = null; return; }
        listRef.current?.scrollToOffset({ offset: Math.max(0, scrollY.current + dd * 14), animated: false });
        const to = targetOf(gg.pageY);
        setDrag((cur) => (cur && cur.to !== to ? { ...cur, to } : cur));
      }, 30);
    }
  };
  const finish = async () => {
    if (autoScroll.current) { clearInterval(autoScroll.current); autoScroll.current = null; }
    const g = d.current;
    d.current = null;
    if (!g || !p) { setDrag(null); return; }
    const to = targetOf(g.pageY);
    setDrag(null);
    if (to === g.from) return;
    const items = [...p.items];
    const [it] = items.splice(g.from, 1);
    items.splice(to, 0, it);
    setP({ ...p, items });
    try {
      await put(`/api/library/playlists/${p.id}/order`, { itemIds: items.map((x) => x.itemId) });
      ui.toast(T('Urutan disimpan'));
    } catch (e: any) { ui.toast(e.message, true); load(); }
  };
  const startDrag = (index: number, e: GestureResponderEvent) => {
    const { pageY } = e.nativeEvent;
    measureWrap();
    // Semua baris sama tinggi → posisi baris dihitung dari indeks (lebih andal daripada locationY elemen anak)
    const rowTop = headH.current + index * rowH.current - scrollY.current;
    d.current = { from: index, startPageY: pageY, startScroll: scrollY.current, rowTop, pageY, owned: false };
    dragY.setValue(rowTop);
    setDrag({ from: index, to: index, rowTop });
    Vibration.vibrate(15);
  };
  useEffect(() => () => { if (autoScroll.current) clearInterval(autoScroll.current); }, []);

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
      { label: T('Simpan semua untuk offline'), icon: 'download-outline', onPress: async () => {
        const todo = playable.filter((t) => !t.local && !isOffline(t.id));
        ui.toast(`Mengunduh ${todo.length} lagu…`);
        for (const t of todo) { try { await downloadOffline(t); } catch { /* lanjut */ } }
        ui.toast(T('Selesai mengunduh untuk offline'));
      } },
      !p.special && { label: T('Ubah nama'), icon: 'create-outline', onPress: async () => {
        const name = await ui.prompt({ title: T('Ubah nama playlist'), value: p.name });
        if (!name) return;
        try { await patch(`/api/library/playlists/${p.id}`, { name }); lib.bumpPlaylists(); load(); } catch (e: any) { ui.toast(e.message, true); }
      } },
      !p.special && { label: T('Hapus playlist'), icon: 'trash-outline', danger: true, onPress: async () => {
        if (!(await ui.confirm({ title: T('Hapus playlist?'), message: T('“{p}” akan dihapus. Lagu di Drive tidak ikut terhapus.', { p: p.name }), ok: T('Hapus'), danger: true }))) return;
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
      <View ref={wrapRef} style={{ flex: 1 }} onLayout={measureWrap}
        onStartShouldSetResponderCapture={() => false}
        onMoveShouldSetResponderCapture={() => d.current != null}
        onResponderGrant={() => { if (d.current) d.current.owned = true; }}
        onResponderMove={(e) => update(e.nativeEvent.pageY)}
        onResponderRelease={finish}
        onResponderTerminate={finish}
        onResponderTerminationRequest={() => false}>
      <FlatList
        ref={listRef}
        data={p.items}
        keyExtractor={(t) => String(t.itemId)}
        scrollEnabled={!drag}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={s.head} onLayout={(e) => { headH.current = e.nativeEvent.layout.height; }}>
            <Collage ids={p.items.map((t) => t.ytId).filter(Boolean) as string[]} size={170} radius={18}
              icon={p.id === 'favorites' ? 'heart' : p.id === 'recent' ? 'time-outline' : 'musical-notes'} />
            <Text style={s.eyebrow}>{p.special ? T('PLAYLIST OTOMATIS') : T('PLAYLIST')}</Text>
            <Text style={s.title}>{p.name}</Text>
            <Text style={s.muted}>{p.items.length} {T('lagu')}{total ? ` · ${fmtDur(total)}` : ''}</Text>
            {missingLocal ? <Text style={[s.muted, { textAlign: 'center', fontSize: 13 }]}>{missingLocal} lagu lokal tidak ditemukan di HP ini (mungkin disimpan dari perangkat lain).</Text> : null}
            <View style={s.actions}>
              <Button label={T("Putar")} icon="play" disabled={!playable.length} onPress={() => player.playList(p.items, 0, { shuffle: false, source: p.name })} style={{ flex: 1 }} />
              <Button label={T("Acak")} icon="shuffle" kind="ghost" disabled={!playable.length} onPress={() => player.playList(p.items, null, { shuffle: true, source: p.name })} style={{ flex: 1 }} />
            </View>
          </View>
        }
        ListEmptyComponent={<Empty title={T("Playlist masih kosong")} text={p.special ? undefined : T('Tambahkan lagu lewat menu ⋮ di Pustaka, atau ucapkan “masukkan lagu … ke playlist …”.')} />}
        renderItem={({ item, index }) => {
          // Baris lain bergeser memberi tempat bagi lagu yang sedang diseret
          let shift = 0;
          if (drag && index !== drag.from) {
            if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -rowH.current;
            if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = rowH.current;
          }
          return (
            <View onLayout={index === 0 ? (e) => { rowH.current = e.nativeEvent.layout.height || 66; } : undefined}
              style={[shift ? { transform: [{ translateY: shift }] } : null, drag?.from === index && { opacity: 0 }]}>
              <TrackRow track={item} active={player.current?.id === item.id} favorite={lib.favorites.has(item.id)} showSource
                lead={p.special ? undefined : <Ionicons name="reorder-three" size={20} color={C.muted} />}
                onLongPress={p.special ? undefined : (e?: any) => e && startDrag(index, e)}
                onPressOut={() => { setTimeout(() => { if (d.current && !d.current.owned) finish(); }, 60); }}
                onPress={() => { if (!d.current) player.playList(p.items, index, { source: p.name }); }}
                onMore={() => menu.open(item, { playlist: p, list: p.items, index, onChange: load })} />
            </View>
          );
        }}
        ListFooterComponent={!p.special && p.items.length > 1 ? <Text style={s.hint}>{T('Tahan lalu geser lagu untuk mengubah urutan.')}</Text> : undefined}
        extraData={`${player.current?.id}-${drag ? `${drag.from}-${drag.to}` : ''}`}
      />
      {drag && p.items[drag.from] ? (
        <Animated.View pointerEvents="none" style={[s.floating, { transform: [{ translateY: dragY }] }]}>
          <TrackRow track={p.items[drag.from]} dragging showSource lead={<Ionicons name="reorder-three" size={20} color={C.accent} />}
            onPress={() => {}} onMore={() => {}} />
        </Animated.View>
      ) : null}
      </View>
    </>
  );
}

const s = themed(() => StyleSheet.create({
  head: { alignItems: 'center', padding: 16, gap: 6 },
  eyebrow: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 10 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  muted: { color: C.muted },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 10 },
  floating: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: C.surface2, borderRadius: 12, elevation: 10, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  hint: { color: C.muted, fontSize: 12, textAlign: 'center', paddingVertical: 14 },
}));

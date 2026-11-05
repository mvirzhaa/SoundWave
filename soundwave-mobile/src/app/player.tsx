/** Pemutar penuh: sampul, posisi, kontrol, favorit, acak, ulangi, antrean. */
import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { usePlayer } from '../lib/player';
import { useLibrary } from '../lib/library';
import { useUi } from '../lib/ui';
import { useTrackMenu } from '../components/TrackMenu';
import { Cover } from '../components/Cover';
import { SeekBar } from '../components/Common';
import { Lyrics } from '../components/Lyrics';
import { isOffline } from '../lib/offline';
import { C, fmtDur } from '../lib/theme';

export default function PlayerScreen() {
  const p = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const menu = useTrackMenu();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ lyrics?: string }>();
  const [view, setView] = useState<'art' | 'queue' | 'lyrics'>(params.lyrics === '1' ? 'lyrics' : 'art');
  const showQueue = view === 'queue';
  const toggleView = (v: 'queue' | 'lyrics') => setView((cur) => (cur === v ? 'art' : v));
  const t = p.current;

  if (!t) {
    return (
      <SafeAreaView style={s.wrap}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Ionicons name="chevron-down" size={28} color={C.text} /></Pressable>
        <Text style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>Tidak ada lagu yang diputar.</Text>
      </SafeAreaView>
    );
  }
  const fav = lib.favorites.has(t.id);
  const art = Math.min(width - 56, 380);

  return (
    <SafeAreaView style={s.wrap}>
      <View style={s.top}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} accessibilityLabel="Tutup"><Ionicons name="chevron-down" size={28} color={C.text} /></Pressable>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={s.eyebrow}>MEMUTAR DARI</Text>
          <Text style={s.source} numberOfLines={1}>{p.source}</Text>
        </View>
        <Pressable onPress={() => menu.open(t, { fromPlayer: true })} style={s.iconBtn} accessibilityLabel="Menu"><Ionicons name="ellipsis-vertical" size={22} color={C.text} /></Pressable>
      </View>

      {view === 'lyrics' ? (
        <View style={{ flex: 1, marginTop: 8 }}><Lyrics track={t} /></View>
      ) : showQueue ? (
        <FlatList
          style={{ flex: 1, marginTop: 8 }}
          data={p.queue}
          keyExtractor={(x, i) => `${x.id}-${i}`}
          initialScrollIndex={Math.max(0, p.index)}
          getItemLayout={(_, i) => ({ length: 58, offset: 58 * i, index: i })}
          ListHeaderComponent={<Text style={s.qHead}>Antrean · {p.queue.length} lagu</Text>}
          renderItem={({ item, index }) => (
            <Pressable style={[s.qRow, index === p.index && { backgroundColor: C.surface }]} onPress={() => p.jumpTo(index)}>
              <Text style={[s.qNum, index === p.index && { color: C.accent }]}>{index === p.index ? '▶' : index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.qTitle, index === p.index && { color: C.accent }]} numberOfLines={1}>{item.title}</Text>
                <Text style={s.qArtist} numberOfLines={1}>{item.artist}</Text>
              </View>
              {index !== p.index ? (
                <Pressable hitSlop={8} onPress={() => p.removeAt(index)}><Ionicons name="close" size={20} color={C.muted} /></Pressable>
              ) : null}
            </Pressable>
          )}
        />
      ) : (
        <View style={s.artWrap}>
          <Cover ytId={t.ytId} uri={t.coverUri} seed={t.artist + t.title} size={art} radius={22} hq />
        </View>
      )}

      <View style={s.meta}>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{t.title}</Text>
          <Text style={s.artist} numberOfLines={1}>{t.artist}{isOffline(t.id) ? '  ·  offline' : ''}</Text>
        </View>
        <Pressable hitSlop={10} accessibilityLabel="Favorit" onPress={async () => {
          try { const f = await lib.toggleFavorite(t); ui.toast(f ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit'); } catch (e: any) { ui.toast(e.message, true); }
        }}>
          <Ionicons name={fav ? 'heart' : 'heart-outline'} size={28} color={fav ? C.accent : C.text} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 24 }}>
        <SeekBar value={p.position} max={p.duration || t.duration || 0} onSeek={p.seek} />
        <View style={s.times}><Text style={s.time}>{fmtDur(p.position)}</Text><Text style={s.time}>{fmtDur(p.duration || t.duration || 0)}</Text></View>
      </View>

      <View style={s.ctl}>
        <Pressable hitSlop={8} onPress={() => p.setShuffle(!p.shuffle)} accessibilityLabel="Acak">
          <Ionicons name="shuffle" size={26} color={p.shuffle ? C.accent : C.muted} />
        </Pressable>
        <Pressable hitSlop={8} onPress={p.prev} accessibilityLabel="Sebelumnya"><Ionicons name="play-skip-back" size={34} color={C.text} /></Pressable>
        <Pressable onPress={p.toggle} style={s.play} accessibilityLabel={p.playing ? 'Jeda' : 'Putar'}>
          {p.buffering && !p.playing ? <ActivityIndicator color="#fff" /> : <Ionicons name={p.playing ? 'pause' : 'play'} size={36} color="#fff" style={!p.playing && { marginLeft: 4 }} />}
        </Pressable>
        <Pressable hitSlop={8} onPress={p.next} accessibilityLabel="Berikutnya"><Ionicons name="play-skip-forward" size={34} color={C.text} /></Pressable>
        <Pressable hitSlop={8} onPress={() => { const m = p.cycleRepeat(); ui.toast({ off: 'Ulangi: mati', all: 'Ulangi semua', one: 'Ulangi satu lagu' }[m]); }} accessibilityLabel="Ulangi">
          <View>
            <Ionicons name="repeat" size={26} color={p.repeat === 'off' ? C.muted : C.accent} />
            {p.repeat === 'one' ? <Text style={s.one}>1</Text> : null}
          </View>
        </Pressable>
      </View>

      <View style={s.bottom}>
        <Pressable style={[s.pill, view === 'lyrics' && { borderColor: C.accent }]} onPress={() => toggleView('lyrics')}>
          <Ionicons name="document-text-outline" size={18} color={view === 'lyrics' ? C.accent : C.text} />
          <Text style={[s.pillText, view === 'lyrics' && { color: C.accent }]}>Lirik</Text>
        </Pressable>
        <Pressable style={[s.pill, showQueue && { borderColor: C.accent }]} onPress={() => toggleView('queue')}>
          <Ionicons name="list" size={18} color={showQueue ? C.accent : C.text} />
          <Text style={[s.pillText, showQueue && { color: C.accent }]}>Antrean</Text>
        </Pressable>
        <Pressable style={s.pill} onPress={() => router.push('/voice')} accessibilityLabel="Perintah suara">
          <Ionicons name="mic" size={18} color={C.accent} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#120f33' },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  source: { color: C.text, fontWeight: '700' },
  artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginTop: 12, gap: 12 },
  title: { color: C.text, fontSize: 24, fontWeight: '800' },
  artist: { color: C.muted, fontSize: 16, marginTop: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: C.muted, fontSize: 12 },
  ctl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, marginTop: 10 },
  play: { width: 74, height: 74, borderRadius: 37, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  one: { position: 'absolute', right: -6, top: -6, color: C.accent, fontSize: 11, fontWeight: '800' },
  bottom: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 18 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: C.border },
  pillText: { color: C.text, fontWeight: '600' },
  qHead: { color: C.muted, fontWeight: '700', paddingHorizontal: 20, paddingVertical: 8 },
  qRow: { height: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  qNum: { width: 24, color: C.muted, textAlign: 'center' },
  qTitle: { color: C.text, fontWeight: '600' },
  qArtist: { color: C.muted, fontSize: 13 },
});

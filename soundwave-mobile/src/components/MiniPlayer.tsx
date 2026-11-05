import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Cover } from './Cover';
import { usePlayer } from '../lib/player';
import { C } from '../lib/theme';

/** Mini player di atas tab bar (ketuk untuk membuka pemutar penuh). */
export function MiniPlayer() {
  const p = usePlayer();
  const t = p.current;
  if (!t) return null;
  const ratio = p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
  return (
    <View style={s.wrap}>
      <View style={s.progress}><View style={[s.fill, { width: `${ratio * 100}%` }]} /></View>
      <Pressable style={s.info} onPress={() => router.push('/player')}>
        <Cover ytId={t.ytId} uri={t.coverUri} seed={t.artist + t.title} size={44} radius={8} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{t.title}</Text>
          <Text style={s.artist} numberOfLines={1}>{t.artist}</Text>
        </View>
      </Pressable>
      <Pressable hitSlop={6} onPress={p.toggle} style={s.play} accessibilityLabel={p.playing ? 'Jeda' : 'Putar'}>
        {p.buffering && !p.playing ? <ActivityIndicator color="#fff" size="small" />
          : <Ionicons name={p.playing ? 'pause' : 'play'} size={22} color="#fff" />}
      </Pressable>
      <Pressable hitSlop={6} onPress={p.next} style={s.btn} accessibilityLabel="Berikutnya">
        <Ionicons name="play-skip-forward" size={22} color={C.text} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 8, marginBottom: 6, paddingRight: 8,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden', height: 62,
  },
  progress: { position: 'absolute', left: 0, right: 0, top: 0, height: 2.5 },
  fill: { height: '100%', backgroundColor: C.accent },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 9, minWidth: 0 },
  title: { color: C.text, fontWeight: '700', fontSize: 15 },
  artist: { color: C.muted, fontSize: 13 },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});

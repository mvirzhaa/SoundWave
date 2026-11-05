import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Cover } from './Cover';
import { C, fmtDur } from '../lib/theme';
import { isDownloading, isOffline } from '../lib/offline';
import type { Track } from '../lib/types';

type Props = {
  track: Track;
  active?: boolean;
  favorite?: boolean;
  onPress: () => void;
  onMore: () => void;
  onOffline?: () => void;
  showSource?: boolean; // tandai lagu lokal saat daftar campuran
};

function Row({ track: t, active, favorite, onPress, onMore, onOffline, showSource }: Props) {
  const offline = isOffline(t.id);
  const busy = isDownloading(t.id);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: C.surface }, t.available === false && { opacity: 0.45 }]}>
      <Cover ytId={t.ytId} uri={t.coverUri} quran={t.quran?.surat} seed={t.artist + t.title} size={50} />
      <View style={s.text}>
        <Text style={[s.title, active && { color: C.accent }]} numberOfLines={1}>
          {t.title}{t.isVideo ? '  ' : ''}{t.isVideo ? <Text style={s.badge}> MP4 </Text> : null}
          {showSource && t.local ? <Text style={s.local}>  HP</Text> : null}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {[t.artist, fmtDur(t.duration), t.available === false ? (t.local ? 'tidak ada di HP ini' : 'tidak ada di Drive') : ''].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {favorite ? <Ionicons name="heart" size={15} color={C.accent} /> : null}
      {onOffline ? (
        <Pressable hitSlop={8} onPress={onOffline} style={s.icon} accessibilityLabel={offline ? 'Tersedia offline' : 'Simpan untuk offline'}>
          {busy ? <ActivityIndicator size="small" color={C.accent} />
            : <Ionicons name={offline ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={22} color={offline ? C.ok : C.muted} />}
        </Pressable>
      ) : null}
      <Pressable hitSlop={8} onPress={onMore} style={s.icon} accessibilityLabel="Menu lagu">
        <Ionicons name="ellipsis-vertical" size={20} color={C.muted} />
      </Pressable>
    </Pressable>
  );
}

export const TrackRow = memo(Row);

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  text: { flex: 1, minWidth: 0 },
  title: { color: C.text, fontSize: 16, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  badge: { fontSize: 10, color: C.muted, backgroundColor: C.surface2 },
  local: { fontSize: 11, color: C.ok, fontWeight: '800' },
  icon: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
});

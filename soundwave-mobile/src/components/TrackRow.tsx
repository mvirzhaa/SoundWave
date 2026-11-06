import React, { memo } from 'react';
import { T } from '../lib/i18n';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Cover } from './Cover';
import { C, fmtDur, themed } from '../lib/theme';
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
  extra?: React.ReactNode; // elemen tambahan di kanan (mis. nama surat dalam huruf Arab)
};

function Row({ track: t, active, favorite, onPress, onMore, onOffline, showSource, extra }: Props) {
  const offline = isOffline(t.id);
  const busy = isDownloading(t.id);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: C.surface }, t.available === false && { opacity: 0.45 }]}>
      <Cover ytId={t.ytId} uri={t.coverUri} quran={t.quran?.surat} radio={t.radio ? t.radio.freq || '' : undefined} seed={t.artist + t.title} size={50} />
      <View style={s.text}>
        <Text style={[s.title, active && { color: C.accent }]} numberOfLines={1}>
          {t.title}{t.isVideo ? '  ' : ''}{t.isVideo ? <Text style={s.badge}> {T('MP4')} </Text> : null}
          {showSource && t.local ? <Text style={s.local}>  {T('HP')}</Text> : null}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {[t.artist, fmtDur(t.duration), t.available === false ? (t.local ? T('tidak ada di HP ini') : T('tidak ada di Drive')) : ''].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {extra}
      {favorite ? <Ionicons name="heart" size={15} color={C.accent} /> : null}
      {onOffline ? (
        <Pressable hitSlop={8} onPress={onOffline} style={s.icon} accessibilityLabel={offline ? T('Tersedia offline') : T('Simpan untuk offline')}>
          {busy ? <ActivityIndicator size="small" color={C.accent} />
            : <Ionicons name={offline ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={22} color={offline ? C.ok : C.muted} />}
        </Pressable>
      ) : null}
      <Pressable hitSlop={8} onPress={onMore} style={s.icon} accessibilityLabel={T("Menu lagu")}>
        <Ionicons name="ellipsis-vertical" size={20} color={C.muted} />
      </Pressable>
    </Pressable>
  );
}

export const TrackRow = memo(Row);

const s = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  text: { flex: 1, minWidth: 0 },
  title: { color: C.text, fontSize: 16, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  badge: { fontSize: 10, color: C.muted, backgroundColor: C.surface2 },
  local: { fontSize: 11, color: C.ok, fontWeight: '800' },
  icon: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
}));

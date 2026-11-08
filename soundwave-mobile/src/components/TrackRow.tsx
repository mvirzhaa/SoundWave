import React, { memo } from 'react';
import { T } from '../lib/i18n';
import { ActivityIndicator, GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Cover } from './Cover';
import { C, currentScheme, fmtDur, themed } from '../lib/theme';
import { PlMark, usePlaylistMarks } from '../lib/membership';
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
  onLongPress?: (e?: GestureResponderEvent) => void;
  onPressOut?: () => void;
  /** undefined = bukan mode pilih; true/false = mode pilih (lingkaran centang tampil) */
  selected?: boolean;
  /** Elemen di kiri (mis. pegangan seret) */
  lead?: React.ReactNode;
  dragging?: boolean;
  /** Tampilkan lingkaran inisial playlist yang sudah memuat lagu ini (dipakai di Pustaka) */
  showPlaylists?: boolean;
};

function Row({ track: t, active, favorite, onPress, onMore, onOffline, showSource, extra, onLongPress, onPressOut, selected, lead, dragging, showPlaylists }: Props) {
  const marks = usePlaylistMarks(t.id, Boolean(showPlaylists) && !t.quran);
  const offline = isOffline(t.id);
  const busy = isDownloading(t.id);
  const selecting = selected !== undefined;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} onPressOut={onPressOut} delayLongPress={380}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: C.surface }, t.available === false && { opacity: 0.45 },
        selected && s.selected, dragging && s.dragging]}>
      {selecting ? (
        <View style={[s.check, selected && s.checkOn]}>{selected ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}</View>
      ) : null}
      {lead}
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
      {marks.length ? <PlDots marks={marks} /> : null}
      {favorite ? <Ionicons name="heart" size={15} color={C.accent} /> : null}
      {onOffline && !selecting ? (
        <Pressable hitSlop={8} onPress={onOffline} style={s.icon} accessibilityLabel={offline ? T('Tersedia offline') : T('Simpan untuk offline')}>
          {busy ? <ActivityIndicator size="small" color={C.accent} />
            : <Ionicons name={offline ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={22} color={offline ? C.ok : C.muted} />}
        </Pressable>
      ) : null}
      {selecting ? null : (
        <Pressable hitSlop={8} onPress={onMore} style={s.icon} accessibilityLabel={T("Menu lagu")}>
          <Ionicons name="ellipsis-vertical" size={20} color={C.muted} />
        </Pressable>
      )}
    </Pressable>
  );
}

/** Lingkaran kecil berisi inisial playlist yang sudah memuat lagu ini (maks. 3; lebih dari itu "+N"). */
function PlDots({ marks }: { marks: PlMark[] }) {
  const dark = currentScheme() === 'dark';
  const shown = marks.length > 3 ? marks.slice(0, 2) : marks;
  const names = marks.map((m) => m.name).join(', ');
  return (
    <View style={s.dots} accessible accessibilityLabel={T('Ada di playlist: {n}', { n: names })}>
      {shown.map((m, i) => (
        <View key={m.id} style={[s.dot, i > 0 && s.dotOverlap, { backgroundColor: dark ? `hsl(${m.hue}, 55%, 34%)` : `hsl(${m.hue}, 70%, 86%)` }]}>
          <Text style={[s.dotText, { color: dark ? `hsl(${m.hue}, 85%, 88%)` : `hsl(${m.hue}, 60%, 22%)` }]} numberOfLines={1}>{m.initials}</Text>
        </View>
      ))}
      {marks.length > 3 ? (
        <View style={[s.dot, s.dotOverlap, { backgroundColor: C.surface2 }]}><Text style={[s.dotText, { color: C.muted }]}>+{marks.length - 2}</Text></View>
      ) : null}
    </View>
  );
}

export const TrackRow = memo(Row);

const s = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dotOverlap: {},
  dotText: { fontSize: 9, fontWeight: '800', letterSpacing: -0.2 },
  text: { flex: 1, minWidth: 0 },
  title: { color: C.text, fontSize: 16, fontWeight: '600' },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  badge: { fontSize: 10, color: C.muted, backgroundColor: C.surface2 },
  local: { fontSize: 11, color: C.ok, fontWeight: '800' },
  icon: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: 'rgba(139,109,255,.16)' },
  dragging: { backgroundColor: C.surface2, elevation: 8, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.accent, borderColor: C.accent },
}));

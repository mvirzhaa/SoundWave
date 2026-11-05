import React, { useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { C } from '../lib/theme';

export function Button({ label, icon, onPress, kind = 'primary', disabled, loading, style }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? C.accent : kind === 'danger' ? C.danger : C.surface2;
  return (
    <Pressable disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, kind === 'ghost' && s.ghost, style]}>
      {loading ? <ActivityIndicator color="#fff" size="small" /> : icon ? <Ionicons name={icon} size={18} color={kind === 'ghost' ? C.text : '#fff'} /> : null}
      <Text style={[s.btnText, kind === 'ghost' && { color: C.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ icon = 'musical-notes', title, text, cta }: {
  icon?: keyof typeof Ionicons.glyphMap; title: string; text?: string; cta?: { label: string; href: string };
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIco}><Ionicons name={icon} size={30} color="#fff" /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      {text ? <Text style={s.emptyText}>{text}</Text> : null}
      {cta ? <Button label={cta.label} onPress={() => router.push(cta.href as any)} style={{ marginTop: 6 }} /> : null}
    </View>
  );
}

/** Slider posisi lagu (tanpa dependensi tambahan). */
export function SeekBar({ value, max, onSeek }: { value: number; max: number; onSeek: (v: number) => void }) {
  const [w, setW] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef({ w: 1, max: 1, onSeek });
  ref.current = { w, max, onSeek };
  const clamp = (x: number) => Math.max(0, Math.min(1, x / ref.current.w));
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setDrag(clamp(e.nativeEvent.locationX)),
    onPanResponderMove: (e) => setDrag(clamp(e.nativeEvent.locationX)),
    onPanResponderRelease: (e) => { const r = clamp(e.nativeEvent.locationX); setDrag(null); ref.current.onSeek(r * ref.current.max); },
    onPanResponderTerminate: () => setDrag(null),
  })).current;
  const ratio = drag ?? (max > 0 ? Math.min(1, value / max) : 0);
  return (
    <View style={s.seekWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
      <View style={s.track} pointerEvents="none">
        <View style={[s.fill, { width: `${ratio * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[s.thumb, { left: ratio * w - 8, transform: [{ scale: drag != null ? 1.3 : 1 }] }]} />
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { borderColor: C.accent, backgroundColor: 'rgba(139,109,255,.15)' }]}>
      <Text style={[s.chipText, active && { color: C.accent }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  ghost: { borderWidth: 1, borderColor: C.border },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { alignItems: 'center', padding: 36, gap: 8 },
  emptyIco: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: C.muted, textAlign: 'center', lineHeight: 20, marginBottom: 6 },
  seekWrap: { height: 28, justifyContent: 'center' },
  track: { height: 5, borderRadius: 3, backgroundColor: C.surface2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.accent },
  thumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  chipText: { color: C.text, fontWeight: '600', fontSize: 14 },
});

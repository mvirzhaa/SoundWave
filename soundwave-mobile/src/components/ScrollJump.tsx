/**
 * Tombol lompat ke lagu paling atas / paling bawah untuk daftar panjang.
 * "Atas" tampil setelah daftar digulir, "Bawah" tampil selama belum sampai ujung.
 */
import React, { useCallback, useRef, useState } from 'react';
import { FlatList, NativeScrollEvent, NativeSyntheticEvent, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '../lib/i18n';
import { C, themed } from '../lib/theme';

const EDGE = 240; // px dari ujung dianggap "sudah di atas/bawah"

export function useScrollJump<T>(count: number, opts: { bottom?: number; min?: number; ref?: React.RefObject<FlatList<T> | null> } = {}) {
  const own = useRef<FlatList<T>>(null);
  const ref = opts.ref || own;
  const [flags, setFlags] = useState({ top: true, end: false, scrollable: false });
  const flagsRef = useRef(flags);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const next = {
      top: contentOffset.y < EDGE,
      end: contentOffset.y + layoutMeasurement.height > contentSize.height - EDGE,
      scrollable: contentSize.height > layoutMeasurement.height * 1.8,
    };
    const cur = flagsRef.current;
    // Hanya render ulang saat status berubah (bukan di setiap piksel gulir)
    if (next.top !== cur.top || next.end !== cur.end || next.scrollable !== cur.scrollable) { flagsRef.current = next; setFlags(next); }
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    // Daftar baru dimuat: anggap di atas; tombol "bawah" tampil bila daftar cukup panjang
    const cur = flagsRef.current;
    const scrollable = h > 1200;
    if (scrollable !== cur.scrollable) { const next = { ...cur, scrollable }; flagsRef.current = next; setFlags(next); }
  }, []);

  const toTop = () => ref.current?.scrollToOffset({ offset: 0, animated: count < 300 });
  const toEnd = () => {
    const animated = count < 150;
    ref.current?.scrollToEnd({ animated });
    // Daftar virtual: baris bawah baru dirender setelah lompatan pertama → lompat sekali lagi agar pas di ujung
    setTimeout(() => ref.current?.scrollToEnd({ animated: false }), animated ? 450 : 120);
  };

  const enabled = count >= (opts.min ?? 12) && flags.scrollable;
  const node = enabled && (!flags.top || !flags.end) ? (
    <View style={[s.wrap, { bottom: opts.bottom ?? 18 }]} pointerEvents="box-none">
      {!flags.top ? (
        <Pressable onPress={toTop} style={({ pressed }) => [s.btn, pressed && s.pressed]} hitSlop={6}
          accessibilityRole="button" accessibilityLabel={T('Ke lagu paling atas')}>
          <Ionicons name="arrow-up" size={20} color={C.text} />
        </Pressable>
      ) : null}
      {!flags.end ? (
        <Pressable onPress={toEnd} style={({ pressed }) => [s.btn, pressed && s.pressed]} hitSlop={6}
          accessibilityRole="button" accessibilityLabel={T('Ke lagu paling bawah')}>
          <Ionicons name="arrow-down" size={20} color={C.text} />
        </Pressable>
      ) : null}
    </View>
  ) : null;

  return { ref, onScroll, onContentSizeChange, node };
}

const s = themed(() => StyleSheet.create({
  wrap: { position: 'absolute', right: 24, gap: 10, alignItems: 'center' },
  btn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
}));

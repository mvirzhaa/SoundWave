/** Bagian lipat (akordion) untuk halaman Akun. Status buka/tutup diingat per bagian. */
import React, { useEffect, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { C, themed } from '../lib/theme';

const KEY = 'sw-accordion';
let memo: Record<string, boolean> | null = null;
const readAll = async () => {
  if (memo) return memo;
  try { memo = JSON.parse((await SecureStore.getItemAsync(KEY)) || '{}'); } catch { memo = {}; }
  return memo!;
};

type Props = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  /** Paksa terbuka (mis. dibuka lewat tautan dari layar lain) */
  force?: boolean;
  children: React.ReactNode;
};

export function Accordion({ id, icon, title, summary, defaultOpen = false, force, children }: Props) {
  const [open, setOpen] = useState<boolean>(force || (memo?.[id] ?? defaultOpen));
  useEffect(() => { if (force) { setOpen(true); return; } readAll().then((m) => { if (m[id] != null) setOpen(m[id]); }); }, [id, force]);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
    const next = !open;
    setOpen(next);
    readAll().then((m) => { m[id] = next; SecureStore.setItemAsync(KEY, JSON.stringify(m)).catch(() => {}); });
  };
  return (
    <View style={s.card}>
      <Pressable onPress={toggle} style={s.head} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={s.ico}><Ionicons name={icon} size={19} color={C.accent} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>{title}</Text>
          {summary ? <Text style={s.summary} numberOfLines={1}>{summary}</Text> : null}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={C.muted} />
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  ico: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 16, fontWeight: '700' },
  summary: { color: C.muted, fontSize: 13, marginTop: 2 },
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
}));

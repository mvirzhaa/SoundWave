/** Kartu info "sedang offline" untuk fitur yang butuh internet (radio, TV, pencarian, lirik). */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '../lib/i18n';
import { C, themed } from '../lib/theme';

export function OfflineNotice({ title, text }: { title: string; text?: string }) {
  return (
    <View style={s.box} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={22} color={C.warn} />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.text}>{text || T('Sambungkan HP ke internet. Halaman ini otomatis dimuat ulang saat koneksi kembali.')}</Text>
      </View>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  box: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginHorizontal: 14, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.warn, backgroundColor: C.surface },
  title: { color: C.text, fontWeight: '800', fontSize: 15 },
  text: { color: C.muted, marginTop: 2, lineHeight: 19 },
}));

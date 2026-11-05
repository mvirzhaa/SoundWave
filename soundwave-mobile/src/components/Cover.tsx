import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ytThumb } from '../lib/api';
import { C, hueColor } from '../lib/theme';

type Props = {
  ytId?: string | null;
  uri?: string | null; // sampul lokal (dari tag ID3 file di HP)
  seed?: string;
  size: number;
  radius?: number;
  hq?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  quran?: number | string; // nomor surat → sampul hijau bernomor
};

export const QURAN_GREEN = '#0f8a64';

/** Sampul lagu: thumbnail YouTube (dipotong persegi) atau warna dari judul + ikon. */
export function Cover({ ytId, uri: localUri, seed = '', size, radius = 10, hq, icon = 'musical-notes', quran }: Props) {
  const [failed, setFailed] = useState(false);
  if (quran != null) {
    const label = String(quran);
    return (
      <View style={[st.box, { width: size, height: size, borderRadius: radius, backgroundColor: QURAN_GREEN }]}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: label.length > 3 ? size * 0.26 : size * (label.length > 2 ? 0.3 : 0.36) }}>{label}</Text>
      </View>
    );
  }
  const uri = !failed ? ytThumb(ytId, hq) || localUri || null : null;
  const zoom = ytId ? 1.35 : 1; // thumbnail YouTube punya letterbox; sampul album sudah persegi
  return (
    <View style={[st.box, { width: size, height: size, borderRadius: radius, backgroundColor: uri ? C.surface2 : hueColor(seed || 'x') }]}>
      {uri ? (
        // Diperbesar 1.35x agar letterbox hitam thumbnail YouTube terpotong
        <Image source={{ uri }} style={{ width: size * zoom, height: size * zoom }} contentFit="cover"
          transition={150} onError={() => setFailed(true)} />
      ) : (
        <Ionicons name={icon} size={size * 0.42} color="rgba(255,255,255,.92)" />
      )}
    </View>
  );
}

/** Kolase 2x2 untuk playlist. */
export function Collage({ ids, size, radius = 14, icon = 'musical-notes' }: { ids: string[]; size: number; radius?: number; icon?: keyof typeof Ionicons.glyphMap }) {
  const list = ids.slice(0, 4);
  if (list.length < 4) return <Cover ytId={list[0]} seed={icon} size={size} radius={radius} icon={icon} />;
  const half = size / 2;
  return (
    <View style={[st.grid, { width: size, height: size, borderRadius: radius }]}>
      {list.map((id) => <Cover key={id} ytId={id} size={half} radius={0} />)}
    </View>
  );
}

const st = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  grid: { overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.surface2 },
});

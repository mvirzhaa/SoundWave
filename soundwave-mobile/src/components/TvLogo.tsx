/** Logo saluran TV dengan cadangan inisial berwarna (logo dari ribuan penyiar sering hilang/lambat). */
import React, { memo, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { hueOf, initials } from '../lib/tv';

type Props = { name: string; uri?: string | null; style?: ViewStyle; fontSize?: number };

function Logo({ name, uri, style, fontSize = 22 }: Props) {
  const [failed, setFailed] = useState(false);
  const h = hueOf(name);
  return (
    <View style={[s.box, { backgroundColor: `hsla(${h}, 45%, 22%, 0.55)` }, style]}>
      {uri && !failed ? (
        <Image source={{ uri }} style={s.img} contentFit="contain" cachePolicy="memory-disk" recyclingKey={uri}
          transition={120} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={[s.ini, { fontSize, color: `hsl(${h}, 75%, 72%)` }]} numberOfLines={1}>{initials(name)}</Text>
      )}
    </View>
  );
}

export const TvLogo = memo(Logo);

const s = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: '72%', height: '64%' },
  ini: { fontWeight: '800', letterSpacing: 0.5 },
});

/** Baca surat: teks Arab, Latin & terjemahan Kemenag. Ketuk ayat untuk memutar mulai dari ayat itu. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { get } from '../../lib/api';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { Button } from '../../components/Common';
import { C, themed } from '../../lib/theme';
import { T } from '../../lib/i18n';
import type { Track } from '../../lib/types';

type Ayat = { nomorAyat: number; teksArab: string; teksLatin: string; teksIndonesia: string };
type Surat = { nomor: number; nama: string; namaLatin: string; arti: string; jumlahAyat: number; ayat: Ayat[] };

export default function SuratScreen() {
  const { n, qari = '05' } = useLocalSearchParams<{ n: string; qari?: string }>();
  const player = usePlayer();
  const ui = useUi();
  const [data, setData] = useState<Surat | null>(null);
  const [err, setErr] = useState('');
  const [latin, setLatin] = useState(true);
  const [arti, setArti] = useState(true);
  const list = useRef<FlatList<Ayat>>(null);

  const load = () => { setErr(''); get<Surat>(`/api/quran/surat/${n}`, { timeout: 30000 }).then(setData).catch((e) => setErr(e.message)); };
  useEffect(load, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = player.current?.quran;
  const activeAyat = cur && String(cur.surat) === String(n) ? cur.ayat || 0 : 0;
  useEffect(() => {
    if (activeAyat > 0 && data) list.current?.scrollToIndex({ index: activeAyat - 1, viewPosition: 0.25, animated: true });
  }, [activeAyat, data]);

  const playFrom = async (dari: number, ulang = 1) => {
    try {
      const r = await get<{ items: Track[]; surat: { namaLatin: string } }>(`/api/quran/hafalan/${n}?qari=${qari}&ulang=${ulang}&dari=${dari}`);
      await player.playList(r.items, 0, { shuffle: false, source: r.surat.namaLatin, repeat: 'off' });
    } catch (e: any) { ui.toast(e.message, true); }
  };

  if (err) return <View style={s.center}><Text style={{ color: C.danger, textAlign: 'center' }}>{err}</Text><Button label={T('Coba lagi')} kind="ghost" onPress={load} /></View>;
  if (!data) return <View style={s.center}><ActivityIndicator color={C.accent} /></View>;

  return (
    <>
      <Stack.Screen options={{ title: `${data.nomor}. ${data.namaLatin}` }} />
      <FlatList
        ref={list}
        data={data.ayat}
        keyExtractor={(a) => String(a.nomorAyat)}
        onScrollToIndexFailed={() => {}}
        contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 40 }}
        extraData={`${activeAyat}-${latin}-${arti}`}
        ListHeaderComponent={
          <View style={s.head}>
            <Text style={s.nama}>{data.nama}</Text>
            <Text style={s.muted}>{data.arti} · {data.jumlahAyat} {T('ayat')}</Text>
            {data.nomor !== 1 && data.nomor !== 9 ? <Text style={s.basmalah}>بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ</Text> : null}
            <View style={s.tools}>
              <Button label={T('Putar dari awal')} icon="play" onPress={() => playFrom(1)} style={{ flex: 1 }} />
              <Pressable style={[s.toggle, latin && s.toggleOn]} onPress={() => setLatin((v) => !v)}><Text style={[s.toggleText, latin && { color: C.accent }]}>Latin</Text></Pressable>
              <Pressable style={[s.toggle, arti && s.toggleOn]} onPress={() => setArti((v) => !v)}><Text style={[s.toggleText, arti && { color: C.accent }]}>{T('Arti')}</Text></Pressable>
            </View>
            <Text style={s.hint}>{T('Ketuk ayat untuk memutar mulai dari ayat itu. Tekan lama untuk mengulang ayat itu 3×.')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => playFrom(item.nomorAyat)} onLongPress={() => playFrom(item.nomorAyat, 3)}
            style={({ pressed }) => [s.ayat, item.nomorAyat === activeAyat && s.ayatOn, pressed && { opacity: 0.8 }]}>
            <View style={s.numRow}>
              <View style={s.num}><Text style={s.numText}>{item.nomorAyat}</Text></View>
              {item.nomorAyat === activeAyat ? <Ionicons name="volume-high" size={18} color={C.ok} /> : null}
            </View>
            <Text style={s.arab}>{item.teksArab}</Text>
            {latin ? <Text style={s.latin}>{item.teksLatin}</Text> : null}
            {arti ? <Text style={s.arti}>{item.teksIndonesia}</Text> : null}
          </Pressable>
        )}
        ListFooterComponent={<Text style={[s.hint, { textAlign: 'center', marginTop: 10 }]}>{T("Teks Al-Qur'an & terjemahan: Kemenag RI, melalui equran.id.")}</Text>}
      />
    </>
  );
}

const s = themed(() => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  head: { alignItems: 'center', gap: 6, marginBottom: 6 },
  nama: { color: C.ok, fontSize: 40, lineHeight: 70 },
  muted: { color: C.muted },
  basmalah: { color: C.text, fontSize: 26, lineHeight: 50, marginTop: 6 },
  tools: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 8 },
  toggle: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: C.border },
  toggleOn: { borderColor: C.accent },
  toggleText: { color: C.muted, fontWeight: '700' },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17 },
  ayat: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 },
  ayatOn: { borderColor: C.ok },
  numRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  num: { minWidth: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: C.ok, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  numText: { color: C.ok, fontWeight: '800', fontSize: 12 },
  arab: { color: C.text, fontSize: 30, lineHeight: 58, textAlign: 'right', writingDirection: 'rtl' },
  latin: { color: C.accent2, fontStyle: 'italic', fontSize: 14, lineHeight: 21 },
  arti: { color: C.muted, fontSize: 14, lineHeight: 21 },
}));

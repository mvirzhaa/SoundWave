/** Playlist bawaan "Hapalan Quran": murottal Juz 30 + Al-Fatihah atau 114 surat, pilih qari, hafalan per ayat. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { get } from '../lib/api';
import { usePlayer } from '../lib/player';
import { useSholat } from '../lib/sholat';
import { useUi } from '../lib/ui';
import { useLibrary } from '../lib/library';
import { TrackRow } from '../components/TrackRow';
import { useTrackMenu } from '../components/TrackMenu';
import { Cover } from '../components/Cover';
import { Button, Chip } from '../components/Common';
import { C } from '../lib/theme';
import type { Track } from '../lib/types';

type QuranPl = { id: 'quran'; name: string; special: true; semua: boolean; qari: string; qariList: { id: string; name: string }[]; items: Track[] };
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ'`-]/g, '');

export default function QuranScreen() {
  const player = usePlayer();
  const lib = useLibrary();
  const ui = useUi();
  const menu = useTrackMenu();
  const { savePrefs } = useSholat();
  const [p, setP] = useState<QuranPl | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback((q: { qari?: string; semua?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (q.qari) qs.set('qari', q.qari);
    if (q.semua != null) qs.set('semua', q.semua ? '1' : '0');
    get<QuranPl>(`/api/library/playlists/quran?${qs}`).then((r) => { setP(r); setErr(''); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    if (!p) return [];
    const f = norm(filter.trim());
    return f ? p.items.filter((t) => norm(`${t.title} ${t.quran?.arti} ${t.quran?.surat}`).includes(f)) : p.items;
  }, [p, filter]);

  if (err) return <Text style={{ color: C.danger, padding: 24 }}>{err}</Text>;
  if (!p) return <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />;
  const qariName = p.qariList.find((x) => x.id === p.qari)?.name || '';

  const pickQari = () => ui.sheet({
    title: 'Pilih qari',
    items: p.qariList.map((x) => ({ label: x.id === p.qari ? `✓  ${x.name}` : x.name, icon: 'mic-outline' as const, onPress: () => {
      savePrefs({ quran: { qari: x.id } }).catch(() => {});
      load({ qari: x.id, semua: p.semua });
    } })),
  });
  const setScope = (semua: boolean) => { savePrefs({ quran: { semua } }).catch(() => {}); load({ qari: p.qari, semua }); };

  return (
    <FlatList
      data={items}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={s.head}>
          <Cover quran="القرآن" size={150} radius={18} />
          <Text style={s.eyebrow}>PLAYLIST BAWAAN</Text>
          <Text style={s.title}>Hapalan Quran</Text>
          <Text style={s.muted}>{p.items.length} surat · {qariName}</Text>
          <View style={s.actions}>
            <Button label="Putar" icon="play" onPress={() => player.playList(p.items, 0, { shuffle: false, source: 'Hapalan Quran' })} style={{ flex: 1 }} />
            <Button label="Acak" icon="shuffle" kind="ghost" onPress={() => player.playList(p.items, null, { shuffle: true, source: 'Hapalan Quran' })} style={{ flex: 1 }} />
          </View>
          <Pressable style={s.qari} onPress={pickQari}>
            <Ionicons name="mic-outline" size={20} color={C.accent} />
            <Text style={{ color: C.text, flex: 1, fontWeight: '600' }}>Qari: {qariName}</Text>
            <Ionicons name="chevron-down" size={18} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
            <Chip label="Juz 30 + Al-Fatihah" active={!p.semua} onPress={() => setScope(false)} />
            <Chip label="Semua 114 surat" active={p.semua} onPress={() => setScope(true)} />
          </View>
          <TextInput style={s.input} value={filter} onChangeText={setFilter} placeholder="Cari surat…" placeholderTextColor={C.muted} />
          <Text style={s.hint}>Ketuk ⋮ → “Hafalan per ayat” untuk mengulang tiap ayat. Teks Arab, Latin & terjemahan tampil di tab Lirik pemutar.</Text>
        </View>
      }
      renderItem={({ item, index }) => (
        <TrackRow track={{ ...item, artist: `${item.quran?.arti} · ${item.quran?.jumlahAyat} ayat` }}
          active={player.current?.id === item.id} favorite={lib.favorites.has(item.id)}
          onPress={() => player.playList(items, index, { source: 'Hapalan Quran' })}
          onMore={() => menu.open(item, { playlist: p, list: items, index })} />
      )}
      ListFooterComponent={<Text style={[s.hint, { padding: 16 }]}>Teks Al-Qur'an & terjemahan: Kemenag RI. Audio murottal melalui equran.id.</Text>}
      extraData={player.current?.id}
    />
  );
}

const s = StyleSheet.create({
  head: { alignItems: 'center', padding: 16, gap: 8 },
  eyebrow: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 8 },
  title: { color: C.text, fontSize: 28, fontWeight: '800' },
  muted: { color: C.muted },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 6 },
  qari: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  input: { alignSelf: 'stretch', borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: C.text, fontSize: 15, backgroundColor: C.surface },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17, alignSelf: 'stretch' },
});

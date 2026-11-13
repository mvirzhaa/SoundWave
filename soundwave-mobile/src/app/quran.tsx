/** Playlist bawaan "Hapalan Quran": murottal Juz 30 + Al-Fatihah atau 114 surat, pilih qari, hafalan per ayat. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { T } from '../lib/i18n';
import { errText } from '../lib/api';
import { getCached } from '../lib/cache';
import { useOnline } from '../lib/net';
import { isOffline } from '../lib/offline';
import { DownloadAll } from '../components/DownloadAll';
import { usePlayer } from '../lib/player';
import { useSholat } from '../lib/sholat';
import { useUi } from '../lib/ui';
import { useLibrary } from '../lib/library';
import { TrackRow } from '../components/TrackRow';
import { useTrackMenu } from '../components/TrackMenu';
import { Cover } from '../components/Cover';
import { Button, Chip } from '../components/Common';
import { C, themed } from '../lib/theme';
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
  const [stale, setStale] = useState(false);
  const online = useOnline();

  const load = useCallback((q: { qari?: string; semua?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (q.qari) qs.set('qari', q.qari);
    if (q.semua != null) qs.set('semua', q.semua ? '1' : '0');
    getCached<QuranPl>(`quran-${qs}`, `/api/library/playlists/quran?${qs}`)
      .then(({ data, stale: st }) => { setP(data); setStale(st); setErr(''); }).catch((e) => setErr(errText(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    if (!p) return [];
    const f = norm(filter.trim());
    const all = online ? p.items : p.items.map((t) => (isOffline(t.id) ? t : { ...t, available: false, unavailableReason: T('belum diunduh — butuh internet') }));
    return f ? all.filter((t) => norm(`${t.title} ${t.quran?.arti} ${t.quran?.surat}`).includes(f)) : all;
  }, [p, filter, online, lib.offlineVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Text style={{ color: C.danger, padding: 24 }}>{err}</Text>;
  if (!p) return <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />;
  const qariName = p.qariList.find((x) => x.id === p.qari)?.name || '';

  const pickQari = () => ui.sheet({
    title: T('Pilih qari'),
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
          <Text style={s.eyebrow}>{T('PLAYLIST BAWAAN')}</Text>
          <Text style={s.title}>{T('Hapalan Quran')}</Text>
          <Text style={s.muted}>{p.items.length} surat · {qariName}</Text>
          <View style={s.actions}>
            <Button label={T("Putar")} icon="play" onPress={() => player.playList(items, Math.max(0, items.findIndex((t) => t.available !== false)), { shuffle: false, source: 'Hapalan Quran' })} style={{ flex: 1 }} />
            <Button label={T("Acak")} icon="shuffle" kind="ghost" onPress={() => player.playList(items, null, { shuffle: true, source: 'Hapalan Quran' })} style={{ flex: 1 }} />
          </View>
          {stale || !online ? <Text style={s.offNote}>{T('Sedang offline — hanya surat yang sudah diunduh yang bisa diputar.')}</Text> : null}
          <DownloadAll id={`quran-${p.qari}-${p.semua ? 'semua' : 'juz30'}`} label={T('Hapalan Quran')} tracks={p.items} />
          <Pressable style={s.qari} onPress={pickQari}>
            <Ionicons name="mic-outline" size={20} color={C.accent} />
            <Text style={{ color: C.text, flex: 1, fontWeight: '600' }}>Qari: {qariName}</Text>
            <Ionicons name="chevron-down" size={18} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
            <Chip label={T("Juz 30 + Al-Fatihah")} active={!p.semua} onPress={() => setScope(false)} />
            <Chip label={T("Semua 114 surat")} active={p.semua} onPress={() => setScope(true)} />
          </View>
          <View style={{ alignSelf: 'stretch', justifyContent: 'center' }}>
            <TextInput style={s.input} value={filter} onChangeText={setFilter} placeholder={T("Cari surat…")} placeholderTextColor={C.muted} />
            {filter ? (
              <Pressable onPress={() => setFilter('')} hitSlop={10} style={s.clear} accessibilityLabel={T('Hapus pencarian')}>
                <Ionicons name="close-circle" size={18} color={C.muted} />
              </Pressable>
            ) : null}
          </View>
          <Text style={s.hint}>{T('Ketuk nama Arab untuk membaca surat, atau ⋮ → “Ulangi / hafalan” untuk mengulang. Teks Arab, Latin & terjemahan juga tampil di tab Ayat pemutar.')}</Text>
        </View>
      }
      renderItem={({ item, index }) => (
        <TrackRow track={{ ...item, artist: `${item.quran?.arti} · ${item.quran?.jumlahAyat} ${T('ayat')}` }}
          extra={
            <Pressable hitSlop={6} onPress={() => router.push(`/surat/${item.quran?.surat}?qari=${p.qari}`)} style={s.arabBtn} accessibilityLabel={T('Baca teks surat')}>
              <Text style={s.arab}>{item.quran?.nama}</Text>
              <Ionicons name="book-outline" size={16} color={C.ok} />
            </Pressable>
          }
          active={player.current?.id === item.id} favorite={lib.favorites.has(item.id)}
          onPress={() => player.playList(items, index, { source: 'Hapalan Quran' })}
          onMore={() => menu.open(item, { playlist: p, list: items, index })} />
      )}
      ListFooterComponent={<Text style={[s.hint, { padding: 16 }]}>{T('Teks Al-Qur\'an & terjemahan: Kemenag RI. Audio murottal melalui equran.id.')}</Text>}
      extraData={player.current?.id}
    />
  );
}

const s = themed(() => StyleSheet.create({
  head: { alignItems: 'center', padding: 16, gap: 8 },
  offNote: { color: C.warn, fontSize: 13, textAlign: 'center' },
  clear: { position: 'absolute', right: 12 },
  eyebrow: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 8 },
  title: { color: C.text, fontSize: 28, fontWeight: '800' },
  muted: { color: C.muted },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 6 },
  qari: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  input: { alignSelf: 'stretch', borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: C.text, fontSize: 15, backgroundColor: C.surface },
  arabBtn: { alignItems: 'center', paddingHorizontal: 4 },
  arab: { color: C.ok, fontSize: 20, lineHeight: 30 },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17, alignSelf: 'stretch' },
}));

/** Tab Radio: stasiun populer Indonesia, cari nama / kota / frekuensi (mis. "101.1"), favorit. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { get, post, errText, isOnline } from '../../lib/api';
import { useOnline } from '../../lib/net';
import { OfflineNotice } from '../../components/OfflineNotice';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { isFavRadio, loadRadioFav, stationTrack, toggleRadioFav, useRadioFav } from '../../lib/radio';
import { Cover } from '../../components/Cover';
import { Chip } from '../../components/Common';
import { C, themed } from '../../lib/theme';
import { T } from '../../lib/i18n';
import type { Station } from '../../lib/types';

const NEGARA_KEY = 'sw-radio-negara';

export default function RadioScreen() {
  const player = usePlayer();
  const ui = useUi();
  const favorit = useRadioFav();
  const [q, setQ] = useState('');
  const [negara, setNegara] = useState<'ID' | ''>('ID');
  const [list, setList] = useState<Station[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const online = useOnline();

  useEffect(() => { SecureStore.getItemAsync(NEGARA_KEY).then((v) => { if (v === '' || v === 'ID') setNegara(v); }).catch(() => {}); loadRadioFav(); }, []);

  const cari = async () => {
    const my = ++seq.current;
    if (!isOnline()) { setLoading(false); return; } // radio butuh internet; daftar dimuat saat online kembali
    setLoading(true);
    try {
      const r = await get<{ stasiun: Station[] }>(`/api/radio?q=${encodeURIComponent(q.trim())}&negara=${negara}`, { timeout: 30000 });
      if (my === seq.current) { setList(r.stasiun); setErr(''); }
    } catch (e: any) { if (my === seq.current) { setErr(errText(e)); setList([]); } }
    finally { if (my === seq.current) setLoading(false); }
  };
  useEffect(() => { const t = setTimeout(cari, q ? 400 : 0); return () => clearTimeout(t); }, [q, negara, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (st: Station, from: Station[]) => {
    if (!isOnline()) { ui.toast(T('Radio tidak bisa diputar saat offline. Sambungkan ke internet lalu coba lagi.'), true); return; }
    player.playList(from.map(stationTrack), from.indexOf(st), { shuffle: false, repeat: 'off', source: T('Radio') });
    post(`/api/radio/klik/${st.uuid}`).catch(() => {});
  };
  const fav = async (st: Station) => {
    try { const f = await toggleRadioFav(st); ui.toast(f ? T('{s} ditambahkan ke favorit', { s: st.name }) : T('{s} dihapus dari favorit', { s: st.name })); }
    catch (e: any) { ui.toast(errText(e), true); }
  };
  const setN = (n: 'ID' | '') => { setNegara(n); SecureStore.setItemAsync(NEGARA_KEY, n).catch(() => {}); };

  const Row = ({ st, from }: { st: Station; from: Station[] }) => {
    const active = player.current?.id === `radio-${st.uuid}`;
    const isFav = isFavRadio(st.uuid);
    return (
      <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.surface }]} onPress={() => play(st, from)}>
        <Cover uri={st.favicon} radio={st.freq || ''} size={50} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.name, active && { color: C.accent }]} numberOfLines={1}>
            {st.name}{st.freq ? <Text style={s.freq}>{`  ${st.freq} FM`}</Text> : null}
          </Text>
          <Text style={s.sub} numberOfLines={1}>
            {[[st.state, st.country].filter(Boolean).join(', '), st.codec && `${st.codec}${st.bitrate ? ` ${st.bitrate} kbps` : ''}`, ...st.tags.slice(0, 2)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {active && player.buffering ? <ActivityIndicator color={C.accent} size="small" /> : null}
        <Pressable hitSlop={8} onPress={() => fav(st)} style={s.icon} accessibilityLabel={isFav ? T('Hapus dari favorit') : T('Tambah ke favorit')}>
          <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={22} color={isFav ? C.accent : C.muted} />
        </Pressable>
      </Pressable>
    );
  };

  const head = q.trim()
    ? T('Hasil “{q}” · {n} stasiun', { q: q.trim(), n: list?.length ?? 0 })
    : negara ? T('Populer di Indonesia') : T('Populer di seluruh dunia');

  return (
    <FlatList
      data={online ? list || [] : []}
      keyExtractor={(x) => x.uuid}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={loading && !!list} onRefresh={cari} tintColor={C.accent} />}
      ListHeaderComponent={
        <View style={{ gap: 10, paddingTop: 4 }}>
          <View style={s.search}>
            <Ionicons name="search" size={18} color={C.muted} />
            <TextInput style={s.input} value={q} onChangeText={setQ} placeholder={T('Nama stasiun, kota, atau frekuensi (101.1)')}
              placeholderTextColor={C.muted} returnKeyType="search" onSubmitEditing={cari} autoCorrect={false} />
            {q ? <Pressable hitSlop={8} onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color={C.muted} /></Pressable> : null}
          </View>
          {!online ? <OfflineNotice title={T('Radio tidak bisa diputar saat offline')} /> : null}
          <View style={s.chips}>
            <Chip label="Indonesia" active={negara === 'ID'} onPress={() => setN('ID')} />
            <Chip label={T('Semua negara')} active={negara === ''} onPress={() => setN('')} />
          </View>
          {favorit.length && !q.trim() ? (
            <View>
              <Text style={s.h3}>{T('Favorit')}</Text>
              {favorit.map((st) => <Row key={`f-${st.uuid}`} st={st} from={favorit} />)}
            </View>
          ) : null}
          {online ? <Text style={s.h3}>{err || head}</Text> : null}
          {loading && !list ? <ActivityIndicator color={C.accent} style={{ marginTop: 20 }} /> : null}
          {list && !list.length && !err && !loading ? <Text style={s.empty}>{T('Stasiun tidak ditemukan. Coba nama lain, atau pilih “Semua negara”.')}</Text> : null}
        </View>
      }
      renderItem={({ item }) => <Row st={item} from={list || []} />}
      ListFooterComponent={<Text style={s.hint}>{T('Radio internet dari direktori terbuka Radio Browser. Frekuensi FM diambil dari nama stasiun; siaran diputar lewat internet (memakai kuota data), bukan tuner FM.')}</Text>}
      extraData={`${player.current?.id}-${favorit.length}-${player.buffering}`}
    />
  );
}

const s = themed(() => StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  input: { flex: 1, color: C.text, fontSize: 16, paddingVertical: 12 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  h3: { color: C.muted, fontSize: 13, fontWeight: '700', paddingHorizontal: 14, marginTop: 6, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  freq: { color: C.accent, fontSize: 12, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  empty: { color: C.muted, paddingHorizontal: 14 },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17, padding: 16 },
}));

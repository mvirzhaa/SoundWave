/** Tab TV: Pilihan (YouTube Live resmi & saluran admin), Indonesia, Dunia, Favorit, Link M3U milik pengguna. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errText, isOnline } from '../../lib/api';
import { useOnline } from '../../lib/net';
import { OfflineNotice } from '../../components/OfflineNotice';
import { ActivityIndicator, FlatList, Keyboard, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../../lib/i18n';
import { useUi } from '../../lib/ui';
import { C, themed } from '../../lib/theme';
import { TvLogo } from '../../components/TvLogo';
import { catName, isFavTv, loadTvFav, M3uLink, setTvQueue, toggleTvFav, TvItem, TvMeta, tvApi, useTvFav } from '../../lib/tv';

type Tab = 'pilihan' | 'id' | 'dunia' | 'favorit' | 'm3u';
const TABS: [Tab, string][] = [['pilihan', 'Pilihan'], ['id', 'Indonesia'], ['dunia', 'Dunia'], ['favorit', 'Favorit'], ['m3u', 'Link saya']];
const UI_KEY = 'sw-tv-ui';
type UiState = { tab: Tab; negara: string; kategori: string; m3u: number | null };

// Data yang jarang berubah disimpan di memori selama aplikasi hidup
const mem: { meta: TvMeta | null; pilihan: TvItem[] | null } = { meta: null, pilihan: null };

export default function TvScreen() {
  const ui = useUi();
  const { width } = useWindowDimensions();
  const favs = useTvFav();
  const [st, setSt] = useState<UiState>({ tab: 'pilihan', negara: '', kategori: '', m3u: null });
  const [q, setQ] = useState('');
  const [items, setItems] = useState<TvItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [meta, setMeta] = useState<TvMeta | null>(mem.meta);
  const [links, setLinks] = useState<M3uLink[]>([]);
  const [picker, setPicker] = useState<null | 'negara' | 'kategori' | 'm3u'>(null);
  // Daftar negara & kategori: dimuat ulang bila gagal (mis. server masih menyiapkan daftar TV / sedang offline)
  const [metaState, setMetaState] = useState<'idle' | 'loading' | 'error'>('idle');
  const metaBusy = useRef(false);
  const loadMeta = useCallback(() => {
    if (mem.meta || metaBusy.current) return;
    metaBusy.current = true;
    setMetaState('loading');
    tvApi.meta().then((m) => { mem.meta = m; setMeta(m); setMetaState('idle'); })
      .catch(() => setMetaState('error')).finally(() => { metaBusy.current = false; });
  }, []);
  // Filter untuk tab Pilihan & Favorit (disaring di HP; tidak disimpan)
  const [lf, setLf] = useState({ negara: '', kategori: '' });
  const [srcAll, setSrcAll] = useState<TvItem[]>([]);
  const seq = useRef(0);
  const [ready, setReady] = useState(false);

  const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const cardW = (width - 16 * 2 - 12 * (cols - 1)) / cols;

  /* ---------- Muat pengaturan terakhir & data pendukung ---------- */
  useEffect(() => {
    SecureStore.getItemAsync(UI_KEY).then((v) => {
      if (v) { try { setSt((s) => ({ ...s, ...JSON.parse(v) })); } catch { /* abaikan */ } }
    }).catch(() => {}).finally(() => setReady(true));
    loadMeta();
    loadTvFav();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { tvApi.m3uLinks().then(setLinks).catch(() => {}); loadMeta(); }, [loadMeta]));
  const update = (patch: Partial<UiState>) => setSt((s) => {
    const n = { ...s, ...patch };
    SecureStore.setItemAsync(UI_KEY, JSON.stringify(n)).catch(() => {});
    return n;
  });

  /* ---------- Memuat daftar (halaman 60) ---------- */
  const fetchPage = async (offset: number) => {
    if (st.tab === 'id') return tvApi.list({ negara: 'ID', kategori: st.kategori, q, offset });
    if (st.tab === 'dunia') return tvApi.list({ negara: st.negara, kategori: st.kategori, q, offset });
    if (st.tab === 'm3u') {
      if (!st.m3u) return { total: 0, offset: 0, items: [] };
      return tvApi.m3uChannels(st.m3u, q, offset);
    }
    const src = st.tab === 'pilihan' ? (mem.pilihan = mem.pilihan || await tvApi.pilihan()) : await loadTvFav(true);
    setSrcAll(src);
    const f = q.trim().toLowerCase();
    const list = src.filter((x) => (!f || x.name.toLowerCase().includes(f))
      && (!lf.negara || x.country === lf.negara) && (!lf.kategori || (x.cats || []).includes(lf.kategori)));
    return { total: list.length, offset: 0, items: list };
  };

  const online = useOnline();
  useEffect(() => { if (online) loadMeta(); }, [online, loadMeta]);
  const load = useCallback(async (reset: boolean) => {
    if (!ready) return;
    if (!isOnline()) { setLoading(false); setMore(false); return; } // TV butuh internet
    if (!reset && (more || loading || items.length >= total)) return;
    const my = ++seq.current;
    if (reset) { setLoading(true); setErr(''); } else setMore(true);
    try {
      const r = await fetchPage(reset ? 0 : items.length);
      if (my !== seq.current) return;
      setItems((cur) => (reset ? r.items : [...cur, ...r.items]));
      setTotal(r.total);
    } catch (e: any) {
      if (my !== seq.current) return;
      if (reset) { setItems([]); setTotal(0); }
      setErr(errText(e) || T('Gagal memuat saluran.'));
    } finally {
      if (my === seq.current) { setLoading(false); setMore(false); }
    }
  }, [ready, st, q, lf, items.length, total, more, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ganti tab/filter → muat ulang; ketik cari → tunggu 400 ms
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(true), q ? 400 : 0);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [ready, st.tab, st.negara, st.kategori, st.m3u, q, online, lf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (links.length && !links.some((l) => l.id === st.m3u)) update({ m3u: links[0].id });
    if (!links.length && st.tab === 'm3u' && ready) update({ tab: 'pilihan' });
  }, [links]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab Favorit ikut berubah saat ♥ ditekan
  useEffect(() => { if (st.tab === 'favorit' && !loading) { setItems(favs); setTotal(favs.length); } }, [favs]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (i: number) => {
    Keyboard.dismiss();
    if (!isOnline()) { ui.toast(T('TV tidak bisa diputar saat offline. Sambungkan ke internet lalu coba lagi.'), true); return; }
    setTvQueue(items, i);
    router.push('/tv-player');
  };
  const fav = async (it: TvItem) => {
    try { const on = await toggleTvFav(it); ui.toast(on ? T('{n} ditambahkan ke favorit', { n: it.name }) : T('{n} dihapus dari favorit', { n: it.name })); }
    catch (e: any) { ui.toast(errText(e), true); }
  };

  const favSet = useMemo(() => new Set(favs.map((f) => f.id)), [favs]);
  const linkName = links.find((l) => l.id === st.m3u)?.name;
  const countryName = (code: string) => meta?.countries.find((c) => c.code === code)?.name || code;
  const flagOf = (code: string) => meta?.countries.find((c) => c.code === code)?.flag || '';
  const local = st.tab === 'pilihan' || st.tab === 'favorit';
  const curNegara = local ? lf.negara : st.negara;
  const curKategori = local ? lf.kategori : st.kategori;
  /** Pilihan negara & kategori untuk pemilih. Tab Pilihan/Favorit: hanya yang ada di daftarnya. */
  const negaraOpts = (() => {
    const all = meta?.countries || [];
    if (local) {
      const cnt: Record<string, number> = {};
      srcAll.forEach((x) => { if (x.country) cnt[x.country] = (cnt[x.country] || 0) + 1; });
      return [{ value: '', label: T('Semua negara'), sub: String(srcAll.length) },
        ...Object.keys(cnt).sort((a, b) => countryName(a).localeCompare(countryName(b))).map((c) => ({ value: c, label: `${flagOf(c)} ${countryName(c)}`.trim(), sub: String(cnt[c]) }))];
    }
    return [{ value: '', label: T('Semua negara'), sub: meta ? String(meta.total) : '' }, ...all.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}`, sub: String(c.count) }))];
  })();
  const kategoriOpts = (() => {
    if (local) {
      const cnt: Record<string, number> = {};
      srcAll.forEach((x) => (x.cats || []).forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; }));
      return [{ value: '', label: T('Semua kategori'), sub: '' }, ...Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map((k) => ({ value: k, label: catName(k), sub: String(cnt[k]) }))];
    }
    return [{ value: '', label: T('Semua kategori'), sub: '' }, ...(meta?.categories || []).map((c) => ({ value: c.id, label: catName(c.id), sub: st.tab === 'dunia' ? String(c.count) : '' }))];
  })();
  const metaMissing = !local && !meta;

  /* ---------- Bagian atas ---------- */
  const header = (
    <View>
      <View style={s.search}>
        <Ionicons name="search" size={18} color={C.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={T('Cari saluran TV…')} placeholderTextColor={C.muted}
          style={s.input} returnKeyType="search" autoCorrect={false} />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={C.muted} /></Pressable> : null}
      </View>
      {!online ? <View style={{ marginTop: 12 }}><OfflineNotice title={T('TV tidak bisa diputar saat offline')} /></View> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs} keyboardShouldPersistTaps="handled">
        {TABS.filter(([k]) => k !== 'm3u' || links.length).map(([k, label]) => (
          <Pressable key={k} onPress={() => { if (k !== st.tab) { setLf({ negara: '', kategori: '' }); update({ tab: k }); } }}
            style={[s.tab, st.tab === k && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: st.tab === k }}>
            <Text style={[s.tabText, st.tab === k && { color: C.accent }]}>{T(label)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {/* Filter negara & kategori — tersedia di semua tab kecuali Link saya (yang punya pemilih link) */}
      {st.tab !== 'm3u' ? (
        <View style={s.filters}>
          <Pressable style={s.filter} onPress={() => { loadMeta(); setPicker('negara'); }} accessibilityRole="button" accessibilityLabel={T('Pilih negara')}>
            <Ionicons name="globe-outline" size={16} color={C.accent} />
            <Text style={s.filterText} numberOfLines={1}>
              {st.tab === 'id' ? `${flagOf('ID')} Indonesia`.trim() : curNegara ? `${flagOf(curNegara)} ${countryName(curNegara)}`.trim() : T('Semua negara')}
            </Text>
            <Ionicons name="chevron-down" size={16} color={C.muted} />
          </Pressable>
          <Pressable style={s.filter} onPress={() => { loadMeta(); setPicker('kategori'); }} accessibilityRole="button" accessibilityLabel={T('Pilih kategori')}>
            <Ionicons name="pricetag-outline" size={16} color={C.accent} />
            <Text style={s.filterText} numberOfLines={1}>{curKategori ? catName(curKategori) : T('Semua kategori')}</Text>
            <Ionicons name="chevron-down" size={16} color={C.muted} />
          </Pressable>
        </View>
      ) : links.length > 1 ? (
        <View style={s.filters}>
          <Pressable style={s.filter} onPress={() => setPicker('m3u')}>
            <Ionicons name="link-outline" size={16} color={C.accent} />
            <Text style={s.filterText} numberOfLines={1}>{linkName || T('Pilih link')}</Text>
            <Ionicons name="chevron-down" size={16} color={C.muted} />
          </Pressable>
        </View>
      ) : null}
      {!loading && !err && items.length ? (
        <Text style={s.count}>
          {({ pilihan: T('Siaran resmi & pilihan admin'), id: 'Indonesia', dunia: st.negara ? countryName(st.negara) : T('Seluruh dunia'), favorit: T('Favorit'), m3u: linkName || T('Link saya') } as Record<Tab, string>)[st.tab]}
          {local && curNegara ? ` · ${countryName(curNegara)}` : ''}{curKategori && st.tab !== 'm3u' ? ` · ${catName(curKategori)}` : ''} · {T('{n} saluran', { n: total })}
        </Text>
      ) : null}
    </View>
  );

  const empty = !online ? undefined : loading ? (
    <View style={s.grid}>
      {Array.from({ length: cols * 3 }, (_, i) => <View key={i} style={[s.skel, { width: cardW, height: cardW * 9 / 16 }]} />)}
    </View>
  ) : err ? (
    <View style={s.empty}>
      <Ionicons name="cloud-offline-outline" size={34} color={C.warn} />
      <Text style={s.emptyTitle}>{err}</Text>
      <Pressable style={s.retry} onPress={() => load(true)}><Text style={s.retryText}>{T('Coba lagi')}</Text></Pressable>
    </View>
  ) : (
    <View style={s.empty}>
      <Ionicons name={st.tab === 'favorit' ? 'heart-outline' : 'tv-outline'} size={34} color={C.muted} />
      <Text style={s.emptyTitle}>{st.tab === 'favorit' ? T('Belum ada favorit') : q ? T('Tidak ada saluran “{q}”', { q }) : T('Tidak ada saluran')}</Text>
      <Text style={s.muted}>{st.tab === 'favorit' ? T('Ketuk ♥ pada saluran untuk menyimpannya di sini — tersimpan di akun, sama di web & HP.') : T('Coba kata lain atau pilih kategori/negara lain.')}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        key={`cols-${cols}`}
        data={loading ? [] : items}
        keyExtractor={(it) => it.id}
        numColumns={cols}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 14, paddingBottom: 28 }}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        onEndReachedThreshold={0.7}
        onEndReached={() => load(false)}
        refreshControl={<RefreshControl refreshing={false} tintColor={C.accent} colors={[C.accent]} onRefresh={() => { mem.pilihan = null; load(true); }} />}
        ListFooterComponent={more ? <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} /> : !loading && items.length ? (
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {!links.length ? (
              <Pressable style={s.m3uHint} onPress={() => router.navigate({ pathname: '/account', params: { buka: 'm3u' } })}>
                <Ionicons name="link-outline" size={18} color={C.accent} />
                <Text style={{ color: C.text, flex: 1 }}>{T('Punya link M3U sendiri? Tambahkan di Akun → Link TV.')}</Text>
                <Ionicons name="chevron-forward" size={16} color={C.muted} />
              </Pressable>
            ) : null}
            <Text style={s.foot}>{T('Siaran gratis dari daftar publik iptv-org, siaran langsung resmi di YouTube, dan saluran pilihan admin. Sebagian dibatasi wilayah atau tidak siaran 24 jam.')}</Text>
          </View>
        ) : undefined}
        renderItem={({ item, index }) => (
          <Card item={item} width={cardW} fav={favSet.has(item.id)} onPress={() => open(index)} onFav={() => fav(item)} showCountry={st.tab !== 'id' && !item.m3u} />
        )}
        extraData={favSet}
      />

      <Picker
        visible={picker != null}
        title={picker === 'negara' ? T('Pilih negara') : picker === 'kategori' ? T('Pilih kategori') : T('Pilih link')}
        options={picker === 'negara' ? negaraOpts : picker === 'kategori' ? kategoriOpts : links.map((l) => ({ value: String(l.id), label: l.name, sub: '' }))}
        value={picker === 'negara' ? (st.tab === 'id' ? 'ID' : curNegara) : picker === 'kategori' ? curKategori : String(st.m3u)}
        searchable={picker === 'negara'}
        status={picker !== 'm3u' && metaMissing ? (metaState === 'error' ? 'error' : 'loading') : undefined}
        onRetry={loadMeta}
        onClose={() => setPicker(null)}
        onPick={(v) => {
          if (picker === 'negara') {
            if (local) setLf((f) => ({ ...f, negara: v }));
            else if (st.tab === 'id') { if (v !== 'ID') update({ tab: 'dunia', negara: v }); } // negara lain → tab Dunia
            else update(v === 'ID' ? { tab: 'id' } : { negara: v });
          } else if (picker === 'kategori') {
            if (local) setLf((f) => ({ ...f, kategori: v })); else update({ kategori: v });
          } else update({ m3u: Number(v) });
          setPicker(null);
        }}
      />
    </View>
  );
}

/* ---------- Kartu saluran ---------- */
const Card = React.memo(function Card({ item, width, fav, onPress, onFav, showCountry }: {
  item: TvItem; width: number; fav: boolean; onPress: () => void; onFav: () => void; showCountry: boolean;
}) {
  const badges = [
    item.kind === 'youtube' ? { t: 'YouTube', bg: '#e3212b' } : null,
    item.q ? { t: item.q, bg: 'rgba(5,8,22,.72)' } : null,
    item.geo ? { t: T('Geo'), bg: 'rgba(160,110,0,.9)' } : null,
    item.part ? { t: T('Tidak 24 jam'), bg: 'rgba(160,110,0,.9)' } : null,
  ].filter(Boolean) as { t: string; bg: string }[];
  const sub = [(item.cats || []).map(catName).slice(0, 2).join(', '), showCountry ? item.country : ''].filter(Boolean).join(' · ');
  return (
    <View style={{ width }}>
      <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]} accessibilityRole="button" accessibilityLabel={T('Tonton {n}', { n: item.name })}>
        <TvLogo name={item.name} uri={item.logo} style={[s.logo, { height: width * 9 / 16 }] as any} />
        {badges.length ? (
          <View style={s.badges}>{badges.map((b) => <Text key={b.t} style={[s.badge, { backgroundColor: b.bg }]}>{b.t}</Text>)}</View>
        ) : null}
        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        <Text style={s.sub} numberOfLines={1}>{sub || ' '}</Text>
      </Pressable>
      <Pressable onPress={onFav} hitSlop={6} style={s.favBtn} accessibilityLabel={fav ? T('Hapus dari favorit') : T('Tambah ke favorit')}>
        <Ionicons name={fav ? 'heart' : 'heart-outline'} size={17} color={fav ? C.accent : '#fff'} />
      </Pressable>
    </View>
  );
});

/* ---------- Pemilih (negara / kategori / link) dengan pencarian ---------- */
function Picker({ visible, title, options, value, searchable, status, onRetry, onClose, onPick }: {
  visible: boolean; title: string; options: { value: string; label: string; sub: string }[]; value: string;
  searchable?: boolean; status?: 'loading' | 'error'; onRetry?: () => void; onClose: () => void; onPick: (v: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [f, setF] = useState('');
  useEffect(() => { if (!visible) setF(''); }, [visible]);
  const list = f ? options.filter((o) => o.label.toLowerCase().includes(f.toLowerCase())) : options;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={s.grabber} />
        <Text style={s.sheetTitle}>{title}</Text>
        {searchable ? (
          <View style={[s.search, { marginHorizontal: 8, marginTop: 4 }]}>
            <Ionicons name="search" size={16} color={C.muted} />
            <TextInput value={f} onChangeText={setF} placeholder={T('Cari…')} placeholderTextColor={C.muted} style={s.input} autoCorrect={false} />
          </View>
        ) : null}
        {status ? (
          <View style={s.pickStatus}>
            {status === 'loading' ? <ActivityIndicator color={C.accent} /> : <Ionicons name="cloud-offline-outline" size={20} color={C.warn} />}
            <Text style={[s.muted, { flex: 1, textAlign: 'left' }]}>
              {status === 'loading' ? T('Memuat daftar negara & kategori…') : T('Daftar negara & kategori belum bisa dimuat (server masih menyiapkan daftar TV atau koneksi terputus).')}
            </Text>
            {status === 'error' && onRetry ? <Pressable onPress={onRetry} style={s.retrySm}><Text style={s.retryText}>{T('Coba lagi')}</Text></Pressable> : null}
          </View>
        ) : null}
        <FlatList
          data={list}
          keyExtractor={(o) => o.value || '_'}
          style={{ maxHeight: 460 }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          renderItem={({ item: o }) => (
            <Pressable onPress={() => onPick(o.value)} style={({ pressed }) => [s.opt, pressed && { backgroundColor: C.surface2 }]}>
              <Text style={[s.optText, o.value === value && { color: C.accent, fontWeight: '800' }]} numberOfLines={1}>{o.label}</Text>
              {o.sub ? <Text style={s.muted}>{o.sub}</Text> : null}
              {o.value === value ? <Ionicons name="checkmark" size={18} color={C.accent} /> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const s = themed(() => StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 4, paddingHorizontal: 14, height: 44, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  input: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 0 },
  tabs: { gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  tabOn: { borderColor: C.accent, backgroundColor: 'rgba(139,109,255,.15)' },
  tabText: { color: C.muted, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  filter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  filterText: { flex: 1, color: C.text, fontWeight: '600' },
  count: { color: C.muted, fontSize: 13, paddingHorizontal: 16, marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 },
  skel: { borderRadius: 14, backgroundColor: C.surface2, marginBottom: 40 },
  logo: { width: '100%', borderRadius: 14, borderWidth: 1, borderColor: C.border },
  badges: { position: 'absolute', left: 6, top: 6, flexDirection: 'row', gap: 4, flexWrap: 'wrap', maxWidth: '75%' },
  badge: { color: '#fff', fontSize: 10, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, overflow: 'hidden' },
  name: { color: C.text, fontWeight: '700', fontSize: 14, marginTop: 6 },
  sub: { color: C.muted, fontSize: 12 },
  favBtn: { position: 'absolute', right: 5, top: 5, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(5,8,22,.55)', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 40 },
  emptyTitle: { color: C.text, fontWeight: '700', fontSize: 16, textAlign: 'center' },
  muted: { color: C.muted, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, backgroundColor: C.accent },
  retryText: { color: '#fff', fontWeight: '700' },
  m3uHint: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  foot: { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 8, paddingTop: 8, borderWidth: 1, borderColor: C.border },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 8 },
  sheetTitle: { color: C.text, fontWeight: '800', fontSize: 17, paddingHorizontal: 12, paddingVertical: 6 },
  pickStatus: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginVertical: 8, padding: 12, borderRadius: 12, backgroundColor: C.bg },
  retrySm: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.accent },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12 },
  optText: { flex: 1, color: C.text, fontSize: 15 },
}));

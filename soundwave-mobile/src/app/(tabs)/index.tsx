/**
 * Tab Pustaka. Sumber: Semua / Google Drive / HP (penyimpanan lokal).
 * Tab: Lagu / Playlist / Artis / Genre. Mode offline (unduhan Drive), acak semua.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { T } from '../../lib/i18n';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useLibrary } from '../../lib/library';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { downloadOffline, isOffline, offlineTracks, removeOffline } from '../../lib/offline';
import { TrackRow } from '../../components/TrackRow';
import { useTrackMenu } from '../../components/TrackMenu';
import { Collage, Cover } from '../../components/Cover';
import { Button, Empty } from '../../components/Common';
import { C, themed } from '../../lib/theme';
import type { PlaylistSummary, Track } from '../../lib/types';

type Tab = 'lagu' | 'playlist' | 'artis' | 'genre';
type Source = 'semua' | 'drive' | 'hp';
const TABS: [Tab, string][] = [['lagu', 'Lagu'], ['playlist', 'Playlist'], ['artis', 'Artis'], ['genre', 'Genre']];
const SOURCES: [Source, string, keyof typeof Ionicons.glyphMap][] = [['semua', 'Semua', 'albums-outline'], ['drive', 'Drive', 'logo-google'], ['hp', 'HP', 'phone-portrait-outline']];
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const addedAt = (t: Track & { createdTime?: string }) => (t.createdTime ? Date.parse(t.createdTime) : t.added || 0);

export default function LibraryScreen() {
  const { user } = useAuth();
  const lib = useLibrary();
  const player = usePlayer();
  const ui = useUi();
  const menu = useTrackMenu();
  const [tab, setTab] = useState<Tab>('lagu');
  const [src, setSrc] = useState<Source>('semua');
  const [filter, setFilter] = useState('');
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [playlists, setPlaylists] = useState<{ special: PlaylistSummary[]; playlists: PlaylistSummary[] } | null>(null);
  const { width } = useWindowDimensions();

  const [plError, setPlError] = useState('');
  const [plLoading, setPlLoading] = useState(false);
  const loadPlaylists = useCallback(async (attempt = 0): Promise<void> => {
    setPlLoading(true);
    try {
      const r = await get<{ special: PlaylistSummary[]; playlists: PlaylistSummary[] }>('/api/library/playlists', { timeout: 20000 });
      setPlaylists({ special: r.special || [], playlists: r.playlists || [] });
      setPlError('');
    } catch (e: any) {
      // Satu kali coba ulang otomatis (jaringan sesaat terputus / server sibuk), lalu tampilkan pesan
      if (attempt < 1) { await new Promise((ok) => setTimeout(ok, 1500)); return loadPlaylists(attempt + 1); }
      setPlError(e.message || T('Gagal memuat playlist.'));
    } finally { setPlLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (tab === 'playlist') loadPlaylists(); }, [tab, lib.playlistsVersion, loadPlaylists]));

  const d = user?.drive;
  const driveReady = Boolean(d?.ready ?? (d?.connected && d?.folderId));
  const hasLocalSetup = lib.localSettings.device || lib.localSettings.folders.length > 0 || lib.localTracks.length > 0;

  /** Semua lagu dari sumber terpilih (sebelum filter). */
  const base: Track[] = useMemo(() => {
    const drive = offlineOnly ? offlineTracks() : driveReady ? lib.tracks || [] : [];
    if (src === 'drive') return drive;
    if (src === 'hp') return lib.localTracks;
    return [...drive, ...lib.localTracks].sort((a, b) => addedAt(b) - addedAt(a));
  }, [src, offlineOnly, driveReady, lib.tracks, lib.localTracks, lib.offlineVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const f = norm(filter);
    return f ? base.filter((t) => norm(`${t.title} ${t.artist} ${t.album || ''} ${t.name}`).includes(f)) : base;
  }, [base, filter]);

  const groups = useMemo(() => {
    if (tab !== 'artis' && tab !== 'genre') return [];
    const key = tab === 'artis' ? 'artist' : 'genre';
    const m = new Map<string, Track[]>();
    base.forEach((t) => {
      const k = (t[key] as string) || (key === 'genre' ? 'Tanpa genre' : 'Tidak diketahui');
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    });
    const f = norm(filter);
    return [...m.entries()].filter(([k]) => !f || norm(k).includes(f)).sort((a, b) => a[0].localeCompare(b[0], 'id'));
  }, [tab, base, filter]);

  const toggleOffline = async (t: Track) => {
    if (isOffline(t.id)) { removeOffline(t.id); ui.toast(T('Unduhan offline dihapus')); return; }
    try { await downloadOffline(t); ui.toast(T('“{t}” tersedia offline', { t: t.title })); } catch (e: any) { ui.toast(T('Gagal mengunduh: {e}', { e: e.message }), true); }
  };

  /** Menu pengaturan sumber HP: pindai HP, tambah folder, impor file. */
  const localMenu = () => ui.sheet({
    title: T('Musik di HP'),
    subtitle: `${lib.localTracks.length} lagu`,
    items: [
      Platform.OS === 'android' && {
        label: lib.localSettings.device ? T('Berhenti memindai semua lagu di HP') : T('Pindai semua lagu di HP'),
        icon: 'phone-portrait-outline',
        onPress: () => lib.setDeviceScan(!lib.localSettings.device).catch((e) => ui.toast(e.message, true)),
      },
      { label: T('Tambah folder musik…'), icon: 'folder-open-outline', onPress: () => lib.addFolder().catch((e) => ui.toast(e.message, true)) },
      { label: T('Impor file audio…'), icon: 'document-attach-outline', onPress: async () => {
        try { const n = await lib.importLocal(); if (n) ui.toast(T('{n} file diimpor', { n })); } catch (e: any) { ui.toast(e.message, true); }
      } },
      ...lib.localSettings.folders.map((f) => ({ label: T('Hapus folder: {f}', { f: f.name }), icon: 'remove-circle-outline' as const, onPress: () => lib.removeFolder(f.uri) })),
      { label: T('Pindai ulang'), icon: 'refresh', onPress: () => lib.scanLocal() },
    ],
  });

  /* ---------- Kepala halaman ---------- */
  const sourceStatus = (() => {
    const items: React.ReactNode[] = [];
    if (src !== 'hp' && (d?.configured || d?.linkAvailable) && !driveReady) {
      items.push(
        <Pressable key="drive" style={s.notice} onPress={() => router.push('/account')}>
          <Ionicons name="cloud-outline" size={18} color={C.warn} />
          <Text style={s.noticeText}>{d.connected ? T('Folder Google Drive belum diatur.') : T('Google Drive belum dihubungkan.')}</Text>
          <Text style={s.link}>{d.connected ? T('Atur') : T('Hubungkan')}</Text>
        </Pressable>,
      );
    }
    if (src !== 'drive') {
      if (!hasLocalSetup) {
        items.push(
          <View key="local" style={[s.localCard, src === 'hp' && s.localBig]}>
            <Ionicons name="phone-portrait-outline" size={src === 'hp' ? 34 : 20} color={C.accent} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.localTitle}>{T('Putar musik dari penyimpanan HP')}</Text>
              {src === 'hp' ? <Text style={s.muted}>{T('File tetap di HP — tidak diunggah. Judul, artis, album, genre, dan sampul dibaca dari tag MP3.')}</Text> : null}
            </View>
            {src === 'hp' ? (
              <View style={{ gap: 8, alignSelf: 'stretch' }}>
                {Platform.OS === 'android' ? <Button label={T("Pindai semua lagu di HP")} icon="search" onPress={() => lib.setDeviceScan(true).catch((e) => ui.toast(e.message, true))} /> : null}
                <Button label={T("Pilih folder musik")} icon="folder-open-outline" kind="ghost" onPress={() => lib.addFolder().catch((e) => ui.toast(e.message, true))} />
                <Button label={T("Impor file audio")} icon="document-attach-outline" kind="ghost" onPress={async () => { try { const n = await lib.importLocal(); if (n) ui.toast(T('{n} file diimpor', { n })); } catch (e: any) { ui.toast(e.message, true); } }} />
                {Platform.OS === 'ios' ? <Text style={s.hint}>{T('Di iPhone, lagu dari aplikasi Musik (Apple Music) tidak bisa diakses aplikasi lain. Gunakan folder di app File atau impor file.')}</Text> : null}
              </View>
            ) : <Pressable onPress={localMenu} hitSlop={8}><Text style={s.link}>{T('Tambah')}</Text></Pressable>}
          </View>,
        );
      } else {
        items.push(
          <Pressable key="local" style={s.notice} onPress={localMenu}>
            {lib.localScan.busy ? <ActivityIndicator size="small" color={C.accent} /> : <Ionicons name="phone-portrait-outline" size={18} color={C.accent} />}
            <Text style={s.noticeText} numberOfLines={1}>
              {lib.localScan.busy ? T('Memindai HP… {n} lagu', { n: lib.localScan.done }) : `${T('HP: {n} lagu', { n: lib.localTracks.length })}${lib.localSettings.folders.length ? ` · ${lib.localSettings.folders.length} folder` : ''}`}
            </Text>
            <Ionicons name="settings-outline" size={18} color={C.muted} />
          </Pressable>,
        );
        lib.localScan.errors.forEach((e, i) => items.push(<Text key={`e${i}`} style={[s.banner, { color: C.danger }]}>{e}</Text>));
      }
    }
    return items;
  })();

  const header = (
    <View>
      <View style={s.sources}>
        {SOURCES.map(([k, label, icon]) => (
          <Pressable key={k} onPress={() => setSrc(k)} style={[s.srcChip, src === k && s.srcOn]}>
            <Ionicons name={icon} size={14} color={src === k ? C.accent : C.muted} />
            <Text style={[s.srcText, src === k && { color: C.accent }]}>{T(label)}</Text>
          </Pressable>
        ))}
      </View>
      {sourceStatus}
      <View style={s.tabs}>
        {TABS.map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}>
            <Text style={[s.tabText, tab === k && { color: C.accent }]}>{T(label)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.tools}>
        <View style={s.filter}>
          <Ionicons name="search" size={16} color={C.muted} />
          <TextInput value={filter} onChangeText={setFilter} placeholder={tab === 'playlist' ? T('Cari playlist…') : T('Cari judul, artis, album…')}
            placeholderTextColor={C.muted} style={s.filterInput} />
        </View>
        {tab !== 'playlist' && src !== 'hp' && driveReady ? (
          <Pressable onPress={() => setOfflineOnly((v) => !v)} style={[s.offBtn, offlineOnly && { borderColor: C.ok }]} accessibilityLabel={T("Mode offline Drive")}>
            <Ionicons name={offlineOnly ? 'cloud-done' : 'cloud-download-outline'} size={20} color={offlineOnly ? C.ok : C.muted} />
          </Pressable>
        ) : null}
      </View>
      {lib.usingOffline && src !== 'hp' ? <Text style={s.banner}>{T('Server tidak terjangkau — lagu Drive diambil dari unduhan offline.')}</Text> : null}
      {offlineOnly && src !== 'hp' ? <Text style={s.banner}>{T('Mode offline: lagu Drive yang sudah diunduh ke HP.')}</Text> : null}
      {lib.error && src !== 'hp' ? <Text style={[s.banner, { color: C.danger }]}>{lib.error}</Text> : null}
    </View>
  );

  const refreshing = lib.loading || lib.localScan.busy;
  const refresh = (
    <RefreshControl refreshing={refreshing} tintColor={C.accent} colors={[C.accent]} onRefresh={() => {
      if (src !== 'hp' && driveReady) lib.load(true);
      if (src !== 'drive' && hasLocalSetup) lib.scanLocal();
      if (tab === 'playlist') loadPlaylists();
    }} />
  );

  /* ---- Tab Playlist ---- */
  if (tab === 'playlist') {
    const col = Math.max(2, Math.floor((width - 28) / 170));
    const size = (width - 28 - (col - 1) * 14) / col;
    const f = norm(filter);
    // Playlist bawaan selalu tampil walau daftar dari server belum/tidak termuat
    const special: PlaylistSummary[] = playlists?.special?.length ? playlists.special : [
      { id: 'recent', name: 'Terakhir Diputar', count: 0, covers: [], special: true },
      { id: 'favorites', name: 'Favorit', count: lib.favorites.size, covers: [], special: true },
      { id: 'quran', name: 'Hapalan Quran', count: 38, covers: [], special: true, quran: true },
    ];
    const all = [...special, ...(playlists?.playlists || [])].filter((p) => !f || norm(T(p.name)).includes(f) || norm(p.name).includes(f));
    const createPl = async () => {
      const name = await ui.prompt({ title: T('Playlist baru'), placeholder: T('Nama playlist'), ok: T('Buat') });
      if (!name) return;
      try { const p = await post<{ id: number }>('/api/library/playlists', { name }); lib.bumpPlaylists(); router.push(`/playlist/${p.id}`); } catch (e: any) { ui.toast(e.message, true); }
    };
    return (
      <ScrollView refreshControl={refresh} contentContainerStyle={{ paddingBottom: 24 }}>
        {header}
        {plError ? (
          <Pressable style={s.plErr} onPress={() => loadPlaylists()}>
            <Ionicons name="cloud-offline-outline" size={20} color={C.warn} />
            <Text style={{ color: C.text, flex: 1 }}>{plError}</Text>
            <Text style={{ color: C.accent, fontWeight: '700' }}>{plLoading ? '…' : T('Coba lagi')}</Text>
          </Pressable>
        ) : null}
        <View style={[s.grid, { gap: 14 }]}>
          <Pressable onPress={createPl} style={{ width: size }}>
            <View style={[s.newPl, { width: size, height: size }]}><Ionicons name="add" size={44} color={C.accent} /></View>
            <Text style={s.plName}>{T('Playlist baru')}</Text>
          </Pressable>
          {all.map((p) => (
            <Pressable key={String(p.id)} style={{ width: size }} onPress={() => router.push(p.quran ? '/quran' : `/playlist/${p.id}`)}>
              {p.quran ? <Cover quran="القرآن" size={size} radius={14} />
                : <Collage ids={p.covers} size={size} icon={p.id === 'favorites' ? 'heart' : p.id === 'recent' ? 'time-outline' : 'musical-notes'} />}
              <Text style={s.plName} numberOfLines={1}>{p.special ? T(p.name) : p.name}</Text>
              <Text style={s.plCount}>{p.count} {p.quran ? T('surat') : T('lagu')}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  const emptyText = src === 'hp'
    ? (hasLocalSetup ? T('Tidak ada lagu ditemukan. Tarik ke bawah untuk memindai ulang.') : undefined)
    : T('Unduh lagu dari tab Cari lalu simpan ke Google Drive, atau tambahkan musik dari HP.');
  const empty = (lib.tracks === null && src !== 'hp' && driveReady) || (src === 'hp' && !hasLocalSetup)
    ? undefined
    : <Empty title={offlineOnly ? T('Belum ada lagu offline') : T('Belum ada lagu')} text={emptyText} />;

  /* ---- Tab Artis / Genre ---- */
  if (tab === 'artis' || tab === 'genre') {
    return (
      <FlatList data={groups} keyExtractor={([k]) => k} refreshControl={refresh} ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={empty}
        ListFooterComponent={tab === 'genre' && groups.some(([k]) => k === 'Tanpa genre')
          ? <Text style={s.hint}>{T('Genre lagu Drive diisi otomatis oleh server; lagu HP memakai tag genre di file. Ubah lewat menu ⋮ pada lagu.')}</Text> : undefined}
        renderItem={({ item: [name, items] }) => (
          <Pressable style={s.group} onPress={() => router.push({ pathname: '/group/[kind]/[name]', params: { kind: tab, name } })}>
            <Collage ids={items.map((t) => t.ytId).filter(Boolean) as string[]} size={52} radius={tab === 'artis' ? 26 : 10} icon={tab === 'artis' ? 'person' : 'pricetag'} />
            <View style={{ flex: 1 }}>
              <Text style={s.groupName} numberOfLines={1}>{name}</Text>
              <Text style={s.plCount}>{items.length} lagu</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        )} />
    );
  }

  /* ---- Tab Lagu ---- */
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        refreshControl={refresh}
        ListHeaderComponent={<>{header}{list.length ? <Text style={s.count}>{list.length} lagu</Text> : null}</>}
        contentContainerStyle={{ paddingBottom: 100 }}
        initialNumToRender={20}
        windowSize={11}
        ListEmptyComponent={empty}
        renderItem={({ item, index }) => (
          <TrackRow track={item} active={player.current?.id === item.id} favorite={lib.favorites.has(item.id)} showSource={src === 'semua'}
            onPress={() => player.playList(list, index, { source: src === 'hp' ? 'Musik di HP' : offlineOnly ? T('Offline') : T('Semua lagu') })}
            onMore={() => menu.open(item, { list, index })}
            onOffline={item.local ? undefined : () => toggleOffline(item)} />
        )}
        extraData={`${player.current?.id}-${lib.offlineVersion}-${lib.favorites.size}`}
      />
      {list.length ? (
        <Pressable style={s.fab} onPress={() => player.playList(list, null, { shuffle: true, source: 'Acak semua' })} accessibilityLabel={T("Putar acak")}>
          <Ionicons name="shuffle" size={26} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  plErr: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginBottom: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  sources: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  srcChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  srcOn: { borderColor: C.accent, backgroundColor: 'rgba(139,109,255,.14)' },
  srcText: { color: C.muted, fontWeight: '700', fontSize: 14 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  noticeText: { color: C.text, flex: 1, fontSize: 14 },
  localCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 14, marginBottom: 8, padding: 14, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  localBig: { flexDirection: 'column', alignItems: 'center', padding: 22 },
  localTitle: { color: C.text, fontWeight: '700', fontSize: 16, textAlign: 'center' },
  muted: { color: C.muted, textAlign: 'center', lineHeight: 20 },
  link: { color: C.accent, fontWeight: '700' },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: C.accent },
  tabText: { color: C.muted, fontWeight: '700', fontSize: 15 },
  tools: { flexDirection: 'row', gap: 10, padding: 14, paddingBottom: 6 },
  filter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  filterInput: { flex: 1, color: C.text, paddingVertical: 10, fontSize: 15 },
  offBtn: { width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  banner: { color: C.warn, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  count: { color: C.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 4 },
  hint: { color: C.muted, fontSize: 13, padding: 16, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, paddingTop: 8 },
  newPl: { borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  plName: { color: C.text, fontWeight: '700', fontSize: 15, marginTop: 8 },
  plCount: { color: C.muted, fontSize: 13 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  groupName: { color: C.text, fontWeight: '600', fontSize: 16 },
  fab: { position: 'absolute', right: 18, bottom: 18, width: 58, height: 58, borderRadius: 29, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
}));

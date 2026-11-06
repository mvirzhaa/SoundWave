/** Lirik tersinkron (karaoke) di pemutar penuh: LRCLIB → subtitle YouTube. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../lib/i18n';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { get } from '../lib/api';
import { usePlayer, usePlayerProgress } from '../lib/player';
import { C, themed } from '../lib/theme';
import type { Track } from '../lib/types';

type Line = { t: number; text: string };
type LyricsData = { found: boolean; source?: string; synced?: boolean; instrumental?: boolean; lines?: Line[]; plain?: string };

const SOURCE_LABEL: Record<string, string> = {
  lrclib: 'Lirik dari LRCLIB', // diterjemahkan saat ditampilkan
  youtube: 'Subtitle YouTube',
  'youtube-auto': 'Subtitle otomatis YouTube — mungkin kurang akurat',
};

/* Geser timing per lagu, disimpan di HP */
const offsetFile = new File(Paths.document, 'lyrics-offset.json');
let offsets: Record<string, number> | null = null;
function loadOffsets() {
  if (offsets) return offsets;
  try { offsets = offsetFile.exists ? JSON.parse(offsetFile.textSync() || '{}') : {}; } catch { offsets = {}; }
  return offsets!;
}
function saveOffset(id: string, v: number) {
  const o = loadOffsets();
  if (Math.abs(v) < 0.01) delete o[id]; else o[id] = Math.round(v * 10) / 10;
  try { if (!offsetFile.exists) offsetFile.create(); offsetFile.write(JSON.stringify(o)); } catch { /* abaikan */ }
}

const ROW_H = 52;

export function Lyrics({ track }: { track: Track }) {
  if (track.quran) return <QuranText track={track} />;
  return <SongLyrics track={track} />;
}

/* ---------- Teks Al-Qur'an (murottal) ---------- */
type Ayat = { nomorAyat: number; teksArab: string; teksLatin: string; teksIndonesia: string };
type Surat = { nomor: number; namaLatin: string; arti: string; jumlahAyat: number; ayat: Ayat[] };
const suratCache = new Map<number, Surat>();

function QuranText({ track }: { track: Track }) {
  const n = track.quran!.surat;
  const active = track.quran!.ayat || 0;
  const [data, setData] = useState<Surat | null>(suratCache.get(n) || null);
  const [err, setErr] = useState('');
  const listRef = useRef<FlatList<Ayat>>(null);
  const load = () => {
    setErr('');
    get<Surat>(`/api/quran/surat/${n}`, { timeout: 30000 }).then((r) => { suratCache.set(n, r); setData(r); }).catch((e) => setErr(e.message));
  };
  useEffect(() => { const c = suratCache.get(n); if (c) setData(c); else { setData(null); load(); } }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (data && active > 0) setTimeout(() => listRef.current?.scrollToIndex({ index: active - 1, viewPosition: 0.2, animated: true }), 250);
  }, [data, active]);
  if (err) return <Center icon="cloud-offline-outline" text={err} onRetry={load} />;
  if (!data) return <View style={s.center}><ActivityIndicator color={C.accent} /><Text style={s.muted}>{T('Memuat teks surat…')}</Text></View>;
  return (
    <View style={{ flex: 1 }}>
      <View style={s.head}><Text style={s.source} numberOfLines={1}>{data.namaLatin} · {data.arti} · {data.jumlahAyat} ayat — teks & terjemahan Kemenag RI</Text></View>
      <FlatList
        ref={listRef}
        data={data.ayat}
        keyExtractor={(a) => String(a.nomorAyat)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 200, gap: 6 }}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item }) => (
          <View style={[s.ayat, item.nomorAyat === active && s.ayatOn]}>
            <Text style={s.arab}>{item.teksArab} <Text style={{ color: C.ok, fontSize: 20 }}>﴿{item.nomorAyat.toLocaleString('ar-EG')}﴾</Text></Text>
            <Text style={s.latin}>{item.teksLatin}</Text>
            <Text style={s.arti}><Text style={{ fontWeight: '800' }}>{item.nomorAyat}. </Text>{item.teksIndonesia}</Text>
          </View>
        )}
        extraData={active}
      />
    </View>
  );
}

function SongLyrics({ track }: { track: Track }) {
  const p = usePlayer();
  const prog = usePlayerProgress();
  const [data, setData] = useState<LyricsData | null>(null);
  const [err, setErr] = useState('');
  const [offset, setOffset] = useState(() => loadOffsets()[track.id] || 0);
  const listRef = useRef<FlatList<Line>>(null);
  const userScrollAt = useRef(0);
  const reqSeq = useRef(0);

  const load = async (refresh = false) => {
    const seq = ++reqSeq.current;
    setData(null); setErr('');
    const dur = prog.duration > 0 ? prog.duration : track.duration;
    const q = new URLSearchParams({ title: track.title, artist: track.artist || '' });
    if (track.album) q.set('album', track.album);
    if (dur) q.set('duration', String(Math.round(dur)));
    if (track.ytId) q.set('ytId', track.ytId);
    if (refresh) q.set('refresh', '1');
    try {
      const r = await get<LyricsData>(`/api/lyrics?${q}`, { timeout: 90000 });
      if (seq === reqSeq.current) setData(r);
    } catch (e: any) {
      if (seq === reqSeq.current) setErr(e.message);
    }
  };

  // Muat ulang saat lagu berganti; tunggu sebentar agar durasi asli file terbaca
  useEffect(() => {
    setOffset(loadOffsets()[track.id] || 0);
    const t = setTimeout(() => load(), prog.duration > 0 ? 0 : 800);
    return () => clearTimeout(t);
  }, [track.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => (data?.synced ? data.lines || [] : []), [data]);
  const active = useMemo(() => {
    const now = prog.position + offset;
    let i = -1; let lo = 0; let hi = lines.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= now) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    return i;
  }, [prog.position, offset, lines]);

  useEffect(() => {
    if (active < 0 || Date.now() - userScrollAt.current < 3500) return;
    listRef.current?.scrollToIndex({ index: active, viewPosition: 0.4, animated: true });
  }, [active]);

  const nudge = (dv: number) => { const v = offset + dv; setOffset(v); saveOffset(track.id, v); userScrollAt.current = 0; };

  if (err) return <Center icon="cloud-offline-outline" text={err} onRetry={() => load(true)} />;
  if (!data) return <View style={s.center}><ActivityIndicator color={C.accent} /><Text style={s.muted}>{T('Mencari lirik…')}</Text></View>;
  if (!data.found) return <Center icon="document-text-outline" text={T("Lirik belum tersedia untuk lagu ini.")} sub={track.ytId ? T('Dicari di LRCLIB dan subtitle YouTube.') : T('Dicari di LRCLIB.')} onRetry={() => load(true)} />;
  if (data.instrumental) return <Center icon="musical-notes-outline" text={T("♪ Lagu instrumental ♪")} />;

  const head = (
    <View style={s.head}>
      <Text style={s.source} numberOfLines={1}>{T(SOURCE_LABEL[data.source || ''] || data.source || '')}</Text>
      {data.synced ? (
        <View style={s.offset}>
          <Pressable hitSlop={8} onPress={() => nudge(-0.5)} accessibilityLabel={T("Lirik lebih awal")}><Ionicons name="remove" size={18} color={C.text} /></Pressable>
          <Text style={s.offText}>{offset ? `${offset > 0 ? '+' : ''}${offset.toFixed(1)} ${T('dtk')}` : 'Pas'}</Text>
          <Pressable hitSlop={8} onPress={() => nudge(0.5)} accessibilityLabel={T("Lirik lebih lambat")}><Ionicons name="add" size={18} color={C.text} /></Pressable>
        </View>
      ) : null}
      <Pressable hitSlop={8} onPress={() => load(true)}><Ionicons name="refresh" size={18} color={C.muted} /></Pressable>
    </View>
  );

  if (!data.synced) {
    return <View style={{ flex: 1 }}>{head}<ScrollView contentContainerStyle={{ padding: 20 }}><Text style={s.plain}>{data.plain}</Text></ScrollView></View>;
  }
  return (
    <View style={{ flex: 1 }}>
      {head}
      <FlatList
        ref={listRef}
        data={lines}
        keyExtractor={(l, i) => `${i}-${l.t}`}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 260 }}
        onScrollBeginDrag={() => { userScrollAt.current = Date.now(); }}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => p.seek(Math.max(0, item.t - offset + 0.05))}>
            <Text style={[s.line, index === active && s.lineOn]}>{item.text || '♪'}</Text>
          </Pressable>
        )}
        extraData={active}
      />
    </View>
  );
}

function Center({ icon, text, sub, onRetry }: { icon: keyof typeof Ionicons.glyphMap; text: string; sub?: string; onRetry?: () => void }) {
  return (
    <View style={s.center}>
      <Ionicons name={icon} size={40} color={C.muted} />
      <Text style={s.centerText}>{text}</Text>
      {sub ? <Text style={s.muted}>{sub}</Text> : null}
      {onRetry ? <Pressable onPress={onRetry} style={s.retry}><Text style={{ color: C.accent, fontWeight: '700' }}>{T('Cari ulang')}</Text></Pressable> : null}
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  centerText: { color: C.text, fontWeight: '600', textAlign: 'center', fontSize: 16 },
  muted: { color: C.muted, textAlign: 'center' },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, marginTop: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
  source: { color: C.muted, fontSize: 12, flex: 1 },
  offset: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  offText: { color: C.muted, fontSize: 12, minWidth: 54, textAlign: 'center' },
  line: { color: 'rgba(232,235,255,.36)', fontSize: 24, fontWeight: '800', lineHeight: 31, paddingVertical: 8, minHeight: ROW_H },
  lineOn: { color: C.text },
  plain: { color: C.text, fontSize: 18, lineHeight: 30 },
  ayat: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  ayatOn: { borderColor: 'rgba(52,211,153,.5)', backgroundColor: 'rgba(52,211,153,.1)' },
  arab: { color: C.text, fontSize: 28, lineHeight: 52, textAlign: 'right', writingDirection: 'rtl' },
  latin: { color: C.accent2, fontStyle: 'italic', fontSize: 14, lineHeight: 20, marginTop: 6 },
  arti: { color: C.muted, fontSize: 14, lineHeight: 21, marginTop: 4 },
}));

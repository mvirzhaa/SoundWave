/** Tab Cari: cari YouTube, pratinjau, konversi MP3/MP4, unduh ke HP atau simpan ke Google Drive. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { embedUrl, get, jobFileUrl, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useLibrary } from '../../lib/library';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { Button, Chip } from '../../components/Common';
import { C, fmtDur, fmtSize } from '../../lib/theme';
import type { Job, SearchResult } from '../../lib/types';

const QUALITIES = { mp3: [128, 192, 256, 320], mp4: [360, 480, 720, 1080] } as const;

export default function SearchScreen() {
  const [q, setQ] = useState('');
  const [sugg, setSugg] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const player = usePlayer();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2 || /^https?:\/\//i.test(term)) { setSugg([]); return; }
    timer.current = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      try { setSugg(await get<string[]>(`/api/suggest?q=${encodeURIComponent(term)}`, { signal: abort.current.signal })); } catch { /* abaikan */ }
    }, 200);
  }, [q]);

  const search = async (term: string) => {
    if (!term.trim()) return;
    Keyboard.dismiss();
    setQ(term); setSugg([]); setErr(''); setLoading(true); setOpen(null); setPreview(null);
    try {
      const r = await get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(term.trim())}`, { timeout: 45000 });
      setResults(r.results);
    } catch (e: any) { setErr(e.message); setResults(null); } finally { setLoading(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={s.searchBox}>
        <Ionicons name="search" size={20} color={C.muted} />
        <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Judul lagu, artis, atau link YouTube"
          placeholderTextColor={C.muted} returnKeyType="search" onSubmitEditing={() => search(q)} autoCorrect={false} />
        {q ? <Pressable onPress={() => { setQ(''); setSugg([]); }} hitSlop={8}><Ionicons name="close-circle" size={20} color={C.muted} /></Pressable> : null}
      </View>

      {sugg.length ? (
        <View style={s.sugg}>
          {sugg.map((t) => (
            <Pressable key={t} style={s.suggItem} onPress={() => search(t)}>
              <Ionicons name="search-outline" size={16} color={C.muted} />
              <Text style={s.suggText} numberOfLines={1}>{t}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {loading ? <ActivityIndicator color={C.accent} style={{ marginTop: 32 }} /> : null}
      {err ? <Text style={s.err}>{err}</Text> : null}
      {!loading && !results && !err ? (
        <View style={s.hero}>
          <Text style={s.heroTitle}>Sound<Text style={{ color: C.accent }}>Wave</Text></Text>
          <Text style={s.heroText}>Cari, dengarkan dulu, lalu unduh MP3 sampai 320 kbps atau MP4 sampai 1080p.</Text>
          <Text style={s.legal}>Gunakan untuk konten milik Anda, berlisensi bebas, atau yang sudah mendapat izin.</Text>
        </View>
      ) : null}

      {results && !loading ? (
        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={<Text style={s.err}>Tidak ada hasil.</Text>}
          renderItem={({ item }) => (
            <ResultCard item={item} open={open === item.id} previewing={preview === item.id}
              onToggle={() => setOpen(open === item.id ? null : item.id)}
              onPreview={() => {
                const on = preview !== item.id;
                setPreview(on ? item.id : null);
                setOpen(item.id);
                if (on) player.pause();
              }} />
          )}
        />
      ) : null}
    </View>
  );
}

function ResultCard({ item, open, previewing, onToggle, onPreview }: {
  item: SearchResult; open: boolean; previewing: boolean; onToggle: () => void; onPreview: () => void;
}) {
  return (
    <View style={[s.card, open && { borderColor: C.accent }]}>
      <View style={s.cardRow}>
        <Pressable onPress={onPreview} style={s.thumb}>
          <Image source={{ uri: item.thumbnail }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          {item.duration ? <Text style={s.dur}>{fmtDur(item.duration)}</Text> : null}
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={2}>{item.title}</Text>
          <Text style={s.sub} numberOfLines={1}>{item.channel}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable style={[s.smallBtn, previewing && { borderColor: C.accent }]} onPress={onPreview}>
              <Ionicons name={previewing ? 'stop' : 'play'} size={14} color={previewing ? C.accent : C.text} />
              <Text style={[s.smallBtnText, previewing && { color: C.accent }]}>{previewing ? 'Stop' : 'Putar'}</Text>
            </Pressable>
            <Pressable style={s.smallBtn} onPress={onToggle}>
              <Ionicons name="download-outline" size={14} color={C.accent} />
              <Text style={[s.smallBtnText, { color: C.accent }]}>Unduh</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {previewing ? (
        <View style={s.preview}>
          <WebView source={{ uri: embedUrl(item.id) }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo style={{ backgroundColor: '#000' }} />
        </View>
      ) : null}
      {open ? <ConvertPanel item={item} /> : null}
    </View>
  );
}

function ConvertPanel({ item }: { item: SearchResult }) {
  const { user } = useAuth();
  const lib = useLibrary();
  const ui = useUi();
  const [format, setFormat] = useState<'mp3' | 'mp4'>('mp3');
  const [quality, setQuality] = useState<number>(320);
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<'' | 'convert' | 'drive' | 'device'>('');
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);
  const reset = () => { if (poll.current) clearTimeout(poll.current); setJob(null); setErr(''); setDriveLink(null); };

  const track = async (id: string) => {
    try {
      const j = await get<Job>(`/api/jobs/${id}`);
      setJob(j);
      if (j.status === 'error') setErr(j.error || 'Konversi gagal.');
      else if (j.status !== 'done') poll.current = setTimeout(() => track(id), 1000);
      else if (j.driveLink) setDriveLink(j.driveLink);
    } catch (e: any) { setErr(e.message); }
  };

  const convert = async () => {
    reset(); setBusy('convert');
    try {
      const j = await post<Job>('/api/convert', { videoId: item.id, format, quality });
      setJob(j);
      if (j.status !== 'done') track(j.id); else if (j.driveLink) setDriveLink(j.driveLink);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const saveDrive = async () => {
    if (!job) return;
    setBusy('drive');
    try {
      const r = await post<{ link: string }>(`/api/jobs/${job.id}/drive`);
      setDriveLink(r.link);
      ui.toast('Tersimpan ke Google Drive');
      lib.load(true);
    } catch (e: any) { ui.toast(e.message, true); } finally { setBusy(''); }
  };

  const saveDevice = async () => {
    if (!job?.filename) return;
    setBusy('device');
    try {
      const safe = job.filename.replace(/[\\/:*?"<>|]/g, '_');
      const dest = new File(Paths.cache, safe);
      const file = await File.downloadFileAsync(await jobFileUrl(job.id), dest, { idempotent: true });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: format === 'mp3' ? 'audio/mpeg' : 'video/mp4', dialogTitle: 'Simpan file', UTI: format === 'mp3' ? 'public.mp3' : 'public.mpeg-4' });
      } else ui.toast(`Tersimpan: ${file.uri}`);
    } catch (e: any) { ui.toast(`Gagal mengunduh: ${e.message}`, true); } finally { setBusy(''); }
  };

  const driveReady = user?.drive.connected && user?.drive.folderId;
  const done = job?.status === 'done';
  const running = job && (job.status === 'queued' || job.status === 'running');

  return (
    <View style={s.panel}>
      <View style={s.seg}>
        {(['mp3', 'mp4'] as const).map((f) => (
          <Pressable key={f} onPress={() => { setFormat(f); setQuality(f === 'mp3' ? 320 : 720); reset(); }} style={[s.segBtn, format === f && s.segOn]}>
            <Text style={[s.segText, format === f && { color: C.text }]}>{f === 'mp3' ? 'MP3 · Audio' : 'MP4 · Video'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.qualities}>
        {QUALITIES[format].map((v) => (
          <Chip key={v} active={quality === v} label={format === 'mp3' ? `${v} kbps` : `${v}p`} onPress={() => { setQuality(v); reset(); }} />
        ))}
      </View>

      {!job || job.status === 'error' ? <Button label={job ? 'Coba lagi' : 'Konversi'} onPress={convert} loading={busy === 'convert'} /> : null}
      {running ? (
        <View style={{ width: '100%', gap: 6 }}>
          <View style={s.bar}><View style={[s.barFill, { width: `${Math.max(3, job!.progress)}%` }]} /></View>
          <Text style={s.stage}>{job!.stage} · {job!.progress}%</Text>
        </View>
      ) : null}
      {done ? (
        <View style={{ width: '100%', gap: 10, alignItems: 'center' }}>
          <Text style={s.ready}>File siap!</Text>
          <Text style={s.stage} numberOfLines={1}>{job!.filename} · {fmtSize(job!.size)}</Text>
          <Button label="Unduh ke HP" icon="phone-portrait-outline" onPress={saveDevice} loading={busy === 'device'} style={{ alignSelf: 'stretch' }} />
          {driveLink ? (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ color: C.ok, fontWeight: '600' }}>Tersimpan di Google Drive</Text>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Text style={s.link} onPress={() => Linking.openURL(driveLink)}>Buka di Drive</Text>
                <Text style={s.link} onPress={() => router.push('/library')}>Lihat di Pustaka</Text>
              </View>
            </View>
          ) : driveReady ? (
            <Button label="Simpan ke Google Drive" icon="cloud-upload-outline" kind="ghost" onPress={saveDrive} loading={busy === 'drive'} style={{ alignSelf: 'stretch' }} />
          ) : user?.drive.configured ? (
            <Text style={s.stage}>
              {user.drive.connected ? 'Atur folder Drive di ' : 'Hubungkan Google Drive di '}
              <Text style={s.link} onPress={() => router.push('/account')}>tab Akun</Text> untuk menyimpan ke Drive.
            </Text>
          ) : null}
        </View>
      ) : null}
      {err ? <Text style={s.errSmall}>{err}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 4, marginBottom: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  input: { flex: 1, color: C.text, fontSize: 16, paddingVertical: 12 },
  sugg: { marginHorizontal: 14, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 4, marginBottom: 8 },
  suggItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  suggText: { color: C.text, fontSize: 15, flex: 1 },
  hero: { alignItems: 'center', padding: 32, gap: 10 },
  heroTitle: { color: C.text, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  heroText: { color: C.muted, textAlign: 'center', lineHeight: 21 },
  legal: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 12, opacity: 0.8 },
  err: { color: C.danger, textAlign: 'center', padding: 24 },
  errSmall: { color: C.danger, textAlign: 'center' },
  card: { marginHorizontal: 14, marginBottom: 12, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', gap: 12, padding: 12 },
  thumb: { width: 128, aspectRatio: 16 / 9, borderRadius: 10, overflow: 'hidden', backgroundColor: C.surface2 },
  dur: { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,.75)', color: '#fff', fontSize: 11, fontWeight: '700', paddingHorizontal: 5, borderRadius: 5, overflow: 'hidden' },
  title: { color: C.text, fontWeight: '700', fontSize: 15, lineHeight: 20 },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
  smallBtnText: { color: C.text, fontWeight: '600', fontSize: 13 },
  preview: { aspectRatio: 16 / 9, backgroundColor: '#000' },
  panel: { borderTopWidth: 1, borderTopColor: C.border, padding: 14, gap: 12, alignItems: 'center', backgroundColor: '#0d1330' },
  seg: { flexDirection: 'row', backgroundColor: C.surface2, borderRadius: 999, padding: 4 },
  segBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  segOn: { backgroundColor: C.surface },
  segText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  qualities: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.surface2, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: C.accent },
  stage: { color: C.muted, fontSize: 13, textAlign: 'center' },
  ready: { color: C.text, fontWeight: '700', fontSize: 16 },
  link: { color: C.accent, fontWeight: '700' },
});

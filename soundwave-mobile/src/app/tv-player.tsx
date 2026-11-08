/**
 * Pemutar TV (HP). HLS/stream video lewat expo-video, YouTube Live lewat WebView (halaman /embed server).
 * Pengaman agar tidak hang:
 *  - setiap pindah saluran membatalkan pemuatan sebelumnya (nomor urut `seq`);
 *  - 15 detik tanpa gambar → coba sumber cadangan berikutnya, lalu tampilkan pesan + tombol;
 *  - buffering > 20 detik saat menonton → sambung ulang otomatis;
 *  - masuk latar belakang → video dijeda (kecuali Picture-in-Picture), musik SoundWave dijeda saat TV mulai.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
import { getServer } from '../lib/api';
import { T } from '../lib/i18n';
import { usePlayer } from '../lib/player';
import { useUi } from '../lib/ui';
import { catName, getTvQueue, isFavTv, toggleTvFav, TvItem, tvApi, useTvFav } from '../lib/tv';
import { TvLogo } from '../components/TvLogo';

const STREAM_TIMEOUT = 15000;
const STALL_TIMEOUT = 20000;
const ROW_H = 58;

type Phase = { kind: 'loading'; text: string } | { kind: 'playing' } | { kind: 'error'; text: string } | { kind: 'idle' };

export default function TvPlayerScreen() {
  const music = usePlayer();
  const ui = useUi();
  const { width, height } = useWindowDimensions();
  useTvFav();
  const [{ list }] = useState(getTvQueue);
  const [index, setIndex] = useState(() => getTvQueue().index);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', text: T('Menyambungkan…') });
  const [yt, setYt] = useState<{ videoId: string; page: string } | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stall = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef({ i: 0, streams: [] as string[] });
  const pip = useRef(false);
  const listRef = useRef<FlatList<TvItem>>(null);
  const landscape = width > height;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.staysActiveInBackground = false;
    p.keepScreenOnWhilePlaying = true;
    p.showNowPlayingNotification = false;
  });

  const it: TvItem | undefined = list[index];
  const clearTimers = () => {
    if (timer.current) clearTimeout(timer.current);
    if (stall.current) clearTimeout(stall.current);
    timer.current = stall.current = null;
  };

  /* ---------- Coba stream ke-i; gagal/terlalu lama → stream berikutnya ---------- */
  const tryStream = useCallback(async (my: number) => {
    if (my !== seq.current) return;
    clearTimers();
    const { i, streams } = attempt.current;
    if (i >= streams.length) {
      try { player.pause(); } catch { /* abaikan */ }
      setPhase({ kind: 'error', text: T('Saluran tidak merespons. Siaran mungkin sedang off-air atau dibatasi wilayah.') });
      return;
    }
    setPhase({ kind: 'loading', text: i > 0 ? T('Mencoba sumber cadangan {a}/{b}…', { a: i + 1, b: streams.length }) : T('Menyambungkan…') });
    timer.current = setTimeout(() => { if (my === seq.current) { attempt.current.i += 1; tryStream(my); } }, STREAM_TIMEOUT);
    const uri = streams[i];
    try {
      await player.replaceAsync({ uri, contentType: /m3u8/i.test(uri) ? 'hls' : 'auto' });
      if (my !== seq.current) return;
      player.play();
    } catch {
      if (my === seq.current) { attempt.current.i += 1; tryStream(my); }
    }
  }, [player]);

  /* ---------- Ganti saluran ---------- */
  useEffect(() => {
    if (!it) return;
    const my = ++seq.current;
    clearTimers();
    setYt(null);
    try { player.pause(); } catch { /* abaikan */ }
    if (music.playing) music.pause(); // jangan tumpang tindih dengan musik/radio
    if (it.kind === 'youtube') {
      try { player.replace(null, true); } catch { /* abaikan */ }
      setPhase({ kind: 'loading', text: T('Mencari siaran langsung…') });
      tvApi.yt(it.id).then((r) => {
        if (my !== seq.current) return;
        setYt(r);
        setPhase({ kind: 'loading', text: T('Memuat pemutar YouTube…') });
        timer.current = setTimeout(() => { if (my === seq.current) setPhase((p) => (p.kind === 'loading' ? { kind: 'playing' } : p)); }, 6000);
      }).catch((e) => { if (my === seq.current) setPhase({ kind: 'error', text: e.message }); });
    } else {
      const streams = (it.streams || []).map((x) => x.u);
      if (!streams.length) { setPhase({ kind: 'error', text: T('Saluran ini tidak punya alamat siaran.') }); return; }
      attempt.current = { i: 0, streams };
      tryStream(my);
    }
    setTimeout(() => { try { listRef.current?.scrollToIndex({ index, viewPosition: 0.4, animated: true }); } catch { /* abaikan */ } }, 300);
    return clearTimers;
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Status pemutar video ---------- */
  useEffect(() => {
    const a = player.addListener('statusChange', ({ status, error }) => {
      const my = seq.current;
      if (status === 'error' || error) {
        if (it?.kind !== 'youtube') { attempt.current.i += 1; tryStream(my); }
      } else if (status === 'loading' && phaseRef.current.kind === 'playing') {
        // Macet di tengah siaran → sambung ulang bila lebih dari 20 detik
        if (stall.current) clearTimeout(stall.current);
        stall.current = setTimeout(() => {
          if (my !== seq.current) return;
          setPhase({ kind: 'loading', text: T('Sinyal lemah — menyambung ulang…') });
          tryStream(my);
        }, STALL_TIMEOUT);
      }
    });
    const b = player.addListener('playingChange', ({ isPlaying }) => {
      if (!isPlaying) return;
      if (timer.current) clearTimeout(timer.current);
      if (stall.current) clearTimeout(stall.current);
      timer.current = stall.current = null;
      setPhase({ kind: 'playing' });
    });
    return () => { a.remove(); b.remove(); };
  }, [player, it?.kind, tryStream]);

  // Musik/radio SoundWave diputar lagi (mis. dari mini player) → jeda TV agar suara tidak bertumpuk
  useEffect(() => { if (music.playing) { try { player.pause(); } catch { /* abaikan */ } } }, [music.playing, player]);

  /* ---------- Latar belakang: jeda (kecuali PiP) ---------- */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && !pip.current) { try { player.pause(); } catch { /* abaikan */ } }
    });
    return () => { sub.remove(); ++seq.current; clearTimers(); };
  }, [player]);

  const step = (d: number) => { if (list.length > 1) setIndex((i) => (i + d + list.length) % list.length); };
  const retry = () => {
    if (!it) return;
    const my = ++seq.current;
    if (it.kind === 'youtube') { setYt(null); tvApi.yt(it.id).then((r) => { if (my === seq.current) { setYt(r); setPhase({ kind: 'playing' }); } }).catch((e) => setPhase({ kind: 'error', text: e.message })); setPhase({ kind: 'loading', text: T('Mencari siaran langsung…') }); return; }
    attempt.current.i = 0;
    tryStream(my);
  };
  const fav = async () => {
    if (!it) return;
    try { const on = await toggleTvFav(it); ui.toast(on ? T('{n} ditambahkan ke favorit', { n: it.name }) : T('{n} dihapus dari favorit', { n: it.name })); } catch (e: any) { ui.toast(e.message, true); }
  };

  if (!it) {
    return (
      <SafeAreaView style={s.wrap}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}><Ionicons name="chevron-down" size={28} color="#fff" /></Pressable>
        <Text style={s.msg}>{T('Tidak ada saluran.')}</Text>
      </SafeAreaView>
    );
  }

  const stageH = landscape ? height : (width * 9) / 16;
  const sub = [it.official ? (it.kind === 'youtube' ? T('YouTube Live resmi') : T('Saluran pilihan')) : '', it.m3u ? `${T('Link')}: ${it.m3u}` : '', ...(it.cats || []).map(catName), it.q || ''].filter(Boolean).join(' · ');

  const stage = (
    <View style={[s.stage, { height: stageH, width }]}>
      {it.kind === 'youtube' ? (
        yt ? (
          <WebView
            key={yt.videoId}
            source={{ uri: `${getServer()}/embed/${yt.videoId}?bridge=1` }}
            style={{ flex: 1, backgroundColor: '#000' }}
            allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} allowsFullscreenVideo
            onMessage={(e) => {
              try {
                const m = JSON.parse(e.nativeEvent.data);
                if (m.type === 'error') setPhase({ kind: 'error', text: [101, 150, 152, 153].includes(Number(m.code)) ? T('Pemilik siaran tidak mengizinkan diputar di luar YouTube.') : T('Siaran YouTube tidak dapat diputar.') });
                else if (m.type === 'state' && m.state === 1) setPhase({ kind: 'playing' });
              } catch { /* abaikan */ }
            }}
            onError={() => setPhase({ kind: 'error', text: T('Pemutar YouTube gagal dimuat. Periksa koneksi.') })}
          />
        ) : null
      ) : (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
          fullscreenOptions={{ enable: true, orientation: 'landscape' }}
          allowsPictureInPicture
          onPictureInPictureStart={() => { pip.current = true; }}
          onPictureInPictureStop={() => { pip.current = false; }}
        />
      )}
      {phase.kind === 'loading' || phase.kind === 'error' ? (
        <View style={s.overlay} pointerEvents={phase.kind === 'error' ? 'auto' : 'none'}>
          {phase.kind === 'loading' ? <ActivityIndicator size="large" color="#fff" /> : <Ionicons name="warning-outline" size={34} color="#fbbf24" />}
          <Text style={s.msg}>{phase.text}</Text>
          {phase.kind === 'error' ? (
            <View style={s.actions}>
              <Pressable style={[s.act, s.actPrimary]} onPress={retry}><Text style={s.actText}>{T('Coba lagi')}</Text></Pressable>
              {list.length > 1 ? <Pressable style={s.act} onPress={() => step(1)}><Text style={s.actText}>{T('Saluran berikutnya')}</Text></Pressable> : null}
              {it.ytPage ? <Pressable style={s.act} onPress={() => Linking.openURL(it.ytPage!)}><Text style={s.actText}>{T('Buka di YouTube')}</Text></Pressable> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  // Mode lanskap: video memenuhi layar, kontrol tersembunyi (pakai kontrol bawaan video)
  if (landscape) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <StatusBar hidden />
        {stage}
        <Pressable style={[s.iconBtn, s.floatClose]} onPress={() => router.back()} accessibilityLabel={T('Tutup TV')}><Ionicons name="close" size={24} color="#fff" /></Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={s.head}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} hitSlop={8} accessibilityLabel={T('Tutup TV')}><Ionicons name="chevron-down" size={28} color="#fff" /></Pressable>
        <TvLogo name={it.name} uri={it.logo} style={s.headLogo} fontSize={13} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{it.name}</Text>
          {sub ? <Text style={s.sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
        <Pressable onPress={fav} style={s.iconBtn} hitSlop={8} accessibilityLabel={isFavTv(it.id) ? T('Hapus dari favorit') : T('Tambah ke favorit')}>
          <Ionicons name={isFavTv(it.id) ? 'heart' : 'heart-outline'} size={24} color={isFavTv(it.id) ? '#8b6dff' : '#fff'} />
        </Pressable>
      </View>
      {stage}
      <View style={s.bar}>
        <Pressable onPress={() => step(-1)} style={s.iconBtn} disabled={list.length < 2} accessibilityLabel={T('Saluran sebelumnya')}>
          <Ionicons name="play-skip-back" size={26} color={list.length < 2 ? '#555' : '#fff'} />
        </Pressable>
        <Text style={s.pos}>{list.length > 1 ? `${index + 1} / ${list.length}` : ''}</Text>
        <Pressable onPress={() => step(1)} style={s.iconBtn} disabled={list.length < 2} accessibilityLabel={T('Saluran berikutnya')}>
          <Ionicons name="play-skip-forward" size={26} color={list.length < 2 ? '#555' : '#fff'} />
        </Pressable>
      </View>
      {list.length > 1 ? (
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(x) => x.id}
          getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
          initialScrollIndex={Math.max(0, Math.min(index, list.length - 1))}
          onScrollToIndexFailed={() => {}}
          windowSize={9}
          removeClippedSubviews
          renderItem={({ item, index: i }) => (
            <Pressable style={[s.row, i === index && s.rowOn]} onPress={() => setIndex(i)} accessibilityState={{ selected: i === index }}>
              <TvLogo name={item.name} uri={item.logo} style={s.rowLogo} fontSize={12} />
              <Text style={[s.rowName, i === index && { color: '#a48bff' }]} numberOfLines={1}>{item.name}</Text>
              <Text style={s.rowSub} numberOfLines={1}>{(item.cats || []).map(catName)[0] || ''}</Text>
            </Pressable>
          )}
          extraData={index}
        />
      ) : <View style={{ flex: 1 }} />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#05060f' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingVertical: 6 },
  headLogo: { width: 52, height: 32, borderRadius: 8 },
  title: { color: '#fff', fontWeight: '800', fontSize: 16 },
  sub: { color: '#9aa3c7', fontSize: 12 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  floatClose: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,.5)', borderRadius: 22 },
  stage: { backgroundColor: '#000' },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, backgroundColor: 'rgba(0,0,0,.55)' },
  msg: { color: '#fff', fontWeight: '600', textAlign: 'center', maxWidth: 420 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 },
  act: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,.3)', backgroundColor: 'rgba(255,255,255,.12)' },
  actPrimary: { backgroundColor: '#8b6dff', borderColor: '#8b6dff' },
  actText: { color: '#fff', fontWeight: '700' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1b2244', backgroundColor: '#0b0f24' },
  pos: { color: '#9aa3c7', minWidth: 70, textAlign: 'center' },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  rowOn: { backgroundColor: 'rgba(139,109,255,.16)' },
  rowLogo: { width: 60, height: 34, borderRadius: 8 },
  rowName: { flex: 1, color: '#e8ebff', fontWeight: '600' },
  rowSub: { color: '#9aa3c7', fontSize: 12, maxWidth: 110 },
});

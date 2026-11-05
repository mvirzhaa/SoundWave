/**
 * Perintah suara. Ucapan diubah ke teks oleh pengenal suara perangkat (bahasa Indonesia),
 * lalu dikirim ke server (/api/voice) yang menafsirkan & mengeksekusinya.
 * Hasilnya dibacakan dengan text-to-speech.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { post } from '../lib/api';
import { useLibrary } from '../lib/library';
import { summarize } from '../lib/local';
import { usePlayer } from '../lib/player';
import { C } from '../lib/theme';
import type { VoiceResult } from '../lib/types';

const EXAMPLES = [
  'putarkan lagu The Corrs', 'putarkan lagu rock', 'putarkan lagu dari playlist nostalgia',
  'buatkan playlist kenangan', 'masukkan lagu Dewa ke playlist kenangan', 'masukkan lagu fly me to the moon ke playlist kenangan', 'putar surat Al-Mulk', 'putarkan hapalan quran', 'kapan maghrib',
];

export default function VoiceScreen() {
  const player = usePlayer();
  const lib = useLibrary();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [status, setStatus] = useState('Ketuk mikrofon lalu bicara');
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<VoiceResult | null>(null);
  const wasPlaying = useRef(false);
  const handled = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!listening) { pulse.stopAnimation(); pulse.setValue(0); return; }
    Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true })).start();
  }, [listening, pulse]);

  useSpeechRecognitionEvent('start', () => { setListening(true); setStatus('Mendengarkan… silakan bicara'); });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript || '';
    setHeard(text);
    if (e.isFinal && text && !handled.current) { handled.current = true; run(text); }
  });
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    setStatus(e.error === 'no-speech' || e.error === 'speech-timeout' ? 'Tidak terdengar suara. Ketuk mikrofon untuk mencoba lagi.'
      : e.error === 'not-allowed' ? 'Izin mikrofon ditolak. Izinkan di Pengaturan HP.'
        : e.error === 'language-not-supported' ? 'Bahasa Indonesia belum tersedia di pengenal suara HP ini.'
          : `Pengenal suara: ${e.message || e.error}`);
    if (wasPlaying.current) player.resume();
  });

  const start = async () => {
    Speech.stop();
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { setStatus('Izin mikrofon & pengenal suara diperlukan.'); return; }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) { setStatus('Pengenal suara tidak tersedia di perangkat ini. Ketik perintah di bawah.'); return; }
    // Jeda musik saat mendengarkan agar ucapan terdengar jelas
    wasPlaying.current = player.playing;
    if (player.playing) player.pause();
    handled.current = false;
    setHeard(''); setResult(null);
    ExpoSpeechRecognitionModule.start({ lang: 'id-ID', interimResults: true, continuous: false, maxAlternatives: 1 });
  };

  useEffect(() => { start(); return () => { ExpoSpeechRecognitionModule.abort(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (msg: string, after?: () => void) => {
    if (!msg) { after?.(); return; }
    Speech.speak(msg, { language: 'id-ID', rate: 1.0, onDone: after, onStopped: after, onError: after });
  };

  async function run(text: string) {
    setHeard(text);
    setStatus('Memproses…');
    try {
      const r = await post<VoiceResult>('/api/voice', { text, localTracks: summarize(lib.localTracks) });
      // Lagu lokal dari hasil server → objek lengkap (dengan uri file di HP)
      if (r.tracks) { const m = new Map(lib.localTracks.map((t) => [t.id, t])); r.tracks = r.tracks.map((t) => (t.local && m.get(t.id)) || t); }
      setResult(r);
      setStatus(r.message || 'Selesai.');
      if (r.action === 'play' && r.tracks?.length) {
        // Bacakan dulu, baru putar agar suara TTS tidak bertabrakan dengan musik
        say(r.message, () => { player.playList(r.tracks!, r.shuffle ? null : 0, { shuffle: !!r.shuffle, source: r.label || 'Perintah suara' }); });
        setTimeout(() => router.back(), 1600);
        return;
      }
      if (r.action === 'control') {
        if (r.command === 'pause') player.pause();
        else if (r.command === 'resume') player.resume();
        else if (r.command === 'next') { player.next(); if (wasPlaying.current) player.resume(); }
        else if (r.command === 'previous') { player.prev(); if (wasPlaying.current) player.resume(); }
        else if (r.command === 'lyrics') {
          if (wasPlaying.current) player.resume();
          if (!player.current) { setStatus('Belum ada lagu yang diputar.'); return; }
          router.back();
          setTimeout(() => router.push({ pathname: '/player', params: { lyrics: '1' } }), 350);
          return;
        }
        setTimeout(() => router.back(), 500);
        return;
      }
      if (r.action === 'playlist_created' || r.action === 'added') lib.bumpPlaylists();
      say(r.message, () => { if (wasPlaying.current) player.resume(); });
    } catch (e: any) {
      setStatus(e.message);
      if (wasPlaying.current) player.resume();
    }
  }

  const ring = { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }) };

  return (
    <View style={s.backdrop}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.top}>
            <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="close" size={28} color={C.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={s.center} keyboardShouldPersistTaps="handled">
            <Text style={s.h1}>Perintah suara</Text>
            <View style={s.orbWrap}>
              {listening ? <Animated.View style={[s.ring, ring]} /> : null}
              <Pressable onPress={() => (listening ? ExpoSpeechRecognitionModule.stop() : start())} style={[s.orb, listening && { backgroundColor: C.accent2 }]}
                accessibilityLabel={listening ? 'Berhenti mendengarkan' : 'Mulai mendengarkan'}>
                <Ionicons name={listening ? 'mic' : 'mic-outline'} size={46} color="#fff" />
              </Pressable>
            </View>
            <Text style={s.heard}>{heard ? `“${heard}”` : ' '}</Text>
            <Text style={[s.status, result && result.action !== 'none' && { color: C.ok }]}>{status}</Text>
            {result?.playlist ? (
              <Pressable style={s.openPl} onPress={() => { router.back(); router.push(`/playlist/${result.playlist!.id}`); }}>
                <Ionicons name="musical-notes" size={16} color={C.accent} />
                <Text style={{ color: C.accent, fontWeight: '700' }}>Buka playlist {result.playlist.name}</Text>
              </Pressable>
            ) : null}

            <View style={s.form}>
              <TextInput style={s.input} value={typed} onChangeText={setTyped} placeholder="atau ketik perintah…" placeholderTextColor={C.muted}
                returnKeyType="send" onSubmitEditing={() => { if (typed.trim()) { ExpoSpeechRecognitionModule.abort(); run(typed.trim()); setTyped(''); } }} />
            </View>
            <View style={s.examples}>
              {EXAMPLES.map((x) => (
                <Pressable key={x} style={s.chip} onPress={() => { ExpoSpeechRecognitionModule.abort(); run(x); }}>
                  <Text style={s.chipText}>“{x}”</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(7,11,29,.97)' },
  top: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16 },
  center: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 32, gap: 12 },
  h1: { color: C.text, fontSize: 22, fontWeight: '800' },
  orbWrap: { width: 170, height: 170, alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: C.accent },
  orb: { width: 120, height: 120, borderRadius: 60, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  heard: { color: C.text, fontSize: 20, fontWeight: '700', textAlign: 'center', minHeight: 28 },
  status: { color: C.muted, textAlign: 'center', lineHeight: 21 },
  openPl: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  form: { alignSelf: 'stretch', marginTop: 12 },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, color: C.text, fontSize: 15 },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: C.muted, fontSize: 13 },
});

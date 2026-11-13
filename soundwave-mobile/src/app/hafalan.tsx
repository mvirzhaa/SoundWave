/**
 * Hafalan rentang ayat: pilih surat → ayat awal & akhir → tiap ayat diulang n kali,
 * opsional rentang diulang terus. Pengulangan bisa dimulai dari ayat mana pun.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { errText, get } from '../lib/api';
import { useOnline } from '../lib/net';
import { T } from '../lib/i18n';
import { usePlayer } from '../lib/player';
import { useUi } from '../lib/ui';
import { C, themed } from '../lib/theme';
import { Button, Chip } from '../components/Common';
import { OfflineNotice } from '../components/OfflineNotice';
import type { Track } from '../lib/types';

type Ayat = { nomorAyat: number; teksArab: string; teksIndonesia: string };
type Surat = { nomor: number; namaLatin: string; nama: string; arti: string; jumlahAyat: number; ayat: Ayat[] };
type Queue = { surat: { namaLatin: string; jumlahAyat: number }; items: Track[]; dari: number; sampai: number; terpotong: boolean; ulang: number };

const PREF = 'sw-hafalan';
const ULANG = [1, 3, 7, 11, 20, 40];

export default function HafalanScreen() {
  const { surat: suratParam, qari = '05', dari: dariParam } = useLocalSearchParams<{ surat: string; qari?: string; dari?: string }>();
  const n = Number(suratParam) || 1;
  const player = usePlayer();
  const ui = useUi();
  const online = useOnline();
  const [data, setData] = useState<Surat | null>(null);
  const [err, setErr] = useState('');
  const [dari, setDari] = useState(Number(dariParam) || 1);
  const [sampai, setSampai] = useState(0);
  const [ulang, setUlang] = useState(3);
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(PREF).then((v) => {
      if (!v) return;
      try { const p = JSON.parse(v); if (ULANG.includes(p.ulang)) setUlang(p.ulang); setLoop(Boolean(p.loop)); } catch { /* abaikan */ }
    }).catch(() => {});
  }, []);

  const load = () => {
    setErr('');
    get<Surat>(`/api/quran/surat/${n}`, { timeout: 30000 }).then((r) => {
      setData(r);
      setDari((d) => Math.min(Math.max(1, d), r.jumlahAyat));
      setSampai((sp) => (sp ? Math.min(sp, r.jumlahAyat) : Math.min(r.jumlahAyat, Math.max(Number(dariParam) || 1, 1) + 4)));
    }).catch((e) => setErr(errText(e)));
  };
  useEffect(load, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (online && !data) load(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const max = data?.jumlahAyat || 1;
  const a = Math.min(dari, sampai || dari);
  const b = Math.max(dari, sampai || dari);
  const count = b - a + 1;
  const plays = count * ulang;

  const setFrom = (v: number) => { const x = Math.min(max, Math.max(1, Math.round(v) || 1)); setDari(x); if (sampai < x) setSampai(x); };
  const setTo = (v: number) => { const x = Math.min(max, Math.max(1, Math.round(v) || 1)); setSampai(x); if (dari > x) setDari(x); };

  const presets = useMemo(() => (data ? [
    { label: T('Seluruh surat'), f: 1, t: max },
    { label: T('5 ayat pertama'), f: 1, t: Math.min(5, max) },
    { label: T('10 ayat pertama'), f: 1, t: Math.min(10, max) },
    { label: T('5 ayat terakhir'), f: Math.max(1, max - 4), t: max },
  ].filter((p, i, arr) => arr.findIndex((x) => x.f === p.f && x.t === p.t) === i) : []), [data, max]);

  const start = async () => {
    setBusy(true);
    SecureStore.setItemAsync(PREF, JSON.stringify({ ulang, loop })).catch(() => {});
    try {
      const r = await get<Queue>(`/api/quran/hafalan/${n}?qari=${encodeURIComponent(qari)}&ulang=${ulang}&dari=${a}&sampai=${b}`, { timeout: 30000 });
      await player.playList(r.items, 0, { shuffle: false, source: T('Hafalan {s} {a}–{b}', { s: r.surat.namaLatin, a: r.dari, b: r.sampai }), repeat: loop ? 'all' : 'off' });
      ui.toast(r.terpotong
        ? T('Hafalan {s} ayat {a}–{b} (dipotong karena terlalu panjang), tiap ayat {n}×.', { s: r.surat.namaLatin, a: r.dari, b: r.sampai, n: ulang })
        : T('Hafalan {s} ayat {a}–{b}, tiap ayat {n}×{l}', { s: r.surat.namaLatin, a: r.dari, b: r.sampai, n: ulang, l: loop ? T(', diulang terus') : '' }));
      router.back();
    } catch (e: any) { ui.toast(errText(e), true); } finally { setBusy(false); }
  };

  const preview = (no: number) => data?.ayat.find((x) => x.nomorAyat === no);

  return (
    <>
      <Stack.Screen options={{ title: data ? T('Hafalan · {s}', { s: data.namaLatin }) : T('Hafalan') }} />
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        {!online ? <OfflineNotice title={T('Hafalan butuh internet')} text={T('Audio per ayat diputar langsung dari internet. Surat utuh yang sudah diunduh tetap bisa diputar dari Hapalan Quran.')} /> : null}
        {err && online ? <Text style={s.err}>{err}</Text> : null}
        {!data && !err ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} /> : null}
        {data ? (
          <>
            <View style={s.card}>
              <Text style={s.arabTitle}>{data.nama}</Text>
              <Text style={s.muted}>{data.namaLatin} · {data.arti} · {T('{n} ayat', { n: max })}</Text>
            </View>

            <Text style={s.h3}>{T('Rentang ayat')}</Text>
            <View style={s.card}>
              <Stepper label={T('Dari ayat')} value={dari} max={max} onChange={setFrom} />
              <AyatPreview ayat={preview(a)} />
              <View style={s.sep} />
              <Stepper label={T('Sampai ayat')} value={sampai || dari} max={max} onChange={setTo} />
              <AyatPreview ayat={preview(b)} />
              <View style={s.chips}>
                {presets.map((p) => <Chip key={p.label} label={p.label} active={a === p.f && b === p.t} onPress={() => { setDari(p.f); setSampai(p.t); }} />)}
              </View>
            </View>

            <Text style={s.h3}>{T('Ulangi tiap ayat')}</Text>
            <View style={[s.card, s.chips]}>
              {ULANG.map((u) => <Chip key={u} label={u === 1 ? T('Sekali') : `${u}×`} active={ulang === u} onPress={() => setUlang(u)} />)}
            </View>

            <View style={[s.card, s.row]}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{T('Ulangi rentang terus-menerus')}</Text>
                <Text style={s.muted}>{T('Setelah ayat terakhir, kembali ke ayat awal sampai dihentikan.')}</Text>
              </View>
              <Switch value={loop} onValueChange={setLoop} trackColor={{ true: C.accent, false: C.border }} thumbColor="#fff" />
            </View>

            <View style={s.summary}>
              <Ionicons name="repeat" size={18} color={C.accent} />
              <Text style={s.summaryText}>
                {T('Ayat {a}–{b} · {c} ayat × {u} = {p} putaran', { a, b, c: count, u: ulang, p: plays })}{loop ? ` · ${T('berulang')}` : ''}
              </Text>
            </View>
            <Button label={busy ? T('Menyiapkan…') : T('Mulai hafalan')} icon="play" loading={busy} disabled={!online || busy} onPress={start} />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <View style={s.row}>
      <Text style={[s.label, { flex: 1 }]}>{label}</Text>
      <Pressable style={s.step} onPress={() => onChange(value - 1)} disabled={value <= 1} accessibilityLabel={T('Kurangi')}>
        <Ionicons name="remove" size={20} color={value <= 1 ? C.border : C.text} />
      </Pressable>
      <TextInput value={text} onChangeText={(v) => setText(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" style={s.num}
        onEndEditing={() => onChange(Number(text) || 1)} onSubmitEditing={() => onChange(Number(text) || 1)} selectTextOnFocus
        accessibilityLabel={label} />
      <Pressable style={s.step} onPress={() => onChange(value + 1)} disabled={value >= max} accessibilityLabel={T('Tambah')}>
        <Ionicons name="add" size={20} color={value >= max ? C.border : C.text} />
      </Pressable>
    </View>
  );
}

function AyatPreview({ ayat }: { ayat?: Ayat }) {
  if (!ayat) return null;
  return (
    <View style={s.preview}>
      <Text style={s.arab} numberOfLines={2}>{ayat.teksArab}</Text>
      <Text style={s.muted} numberOfLines={1}>{ayat.nomorAyat}. {ayat.teksIndonesia}</Text>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  wrap: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, gap: 10 },
  arabTitle: { color: C.text, fontSize: 30, textAlign: 'center', fontFamily: 'serif' },
  h3: { color: C.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: C.text, fontWeight: '700', fontSize: 15 },
  muted: { color: C.muted, fontSize: 13, textAlign: 'left' },
  step: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  num: { width: 64, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.accent, color: C.text, fontSize: 18, fontWeight: '800', textAlign: 'center', paddingVertical: 0 },
  preview: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: C.bg, gap: 2 },
  arab: { color: C.text, fontSize: 20, textAlign: 'right', lineHeight: 34 },
  sep: { height: 1, backgroundColor: C.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginTop: 4 },
  summaryText: { color: C.text, fontWeight: '600', flex: 1 },
  err: { color: C.danger },
}));

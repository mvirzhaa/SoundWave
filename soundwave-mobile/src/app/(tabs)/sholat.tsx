/** Tab Sholat: wilayah (GPS real time / manual), hitung mundur, jadwal hari ini, pengaturan adzan. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { get } from '../../lib/api';
import { Kota, useSholat } from '../../lib/sholat';
import { useUi } from '../../lib/ui';
import { Button, Chip } from '../../components/Common';
import { C } from '../../lib/theme';
import { fmtJam, formatTanggal, hariIni, namaWaktu, titleCase, todayIn, WAJIB, WAKTU, Wajib } from '../../lib/prayer';

export default function SholatScreen() {
  const S = useSholat();
  const ui = useUi();
  const [picker, setPicker] = useState(false);
  const p = S.prefs?.sholat;
  const j = S.jadwal;
  const d = hariIni(j);
  const adz = p?.adzan;
  const auto = p?.mode === 'auto';

  const save = (patch: any) => S.savePrefs(patch).catch((e) => ui.toast(e.message, true));
  const setWaktu = (k: Wajib) => save({ sholat: { adzan: { waktu: { [k]: !adz?.waktu[k] } } } });
  const vol = Math.round((adz?.volume ?? 0.9) * 10) / 10;

  const lokasi = j?.lokasi || p?.kota?.lokasi || p?.koordinat?.nama || '';
  const sumber = j ? (j.sumber === 'kemenag' ? 'Jadwal resmi Kemenag RI' : 'Dihitung dari koordinat GPS') : '';
  const gpsNama = auto && p?.koordinat?.nama ? p.koordinat.nama : '';

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={S.loading} onRefresh={() => (auto ? S.locateNow() : S.reload())} tintColor={C.accent} />}>
        {/* Wilayah */}
        <View style={s.card}>
          <View style={s.row}>
            <Ionicons name={auto ? 'navigate' : 'location'} size={24} color={C.accent} />
            <View style={{ flex: 1 }}>
              <Text style={s.region} numberOfLines={2}>{lokasi ? titleCase(lokasi) : 'Wilayah belum diatur'}</Text>
              <Text style={s.muted} numberOfLines={2}>
                {j ? [titleCase(j.daerah), j.zona, sumber].filter(Boolean).join(' · ') : 'Gunakan lokasi HP atau pilih kabupaten/kota.'}
              </Text>
              {gpsNama && j?.sumber === 'kemenag' && titleCase(gpsNama) !== titleCase(lokasi) ? <Text style={s.small}>Posisi GPS: {gpsNama}</Text> : null}
              {S.offline ? <Text style={[s.small, { color: C.warn }]}>Offline — jadwal dari HP</Text> : null}
            </View>
            {S.locating ? <ActivityIndicator color={C.accent} /> : null}
          </View>
          <View style={s.seg}>
            <Chip label="📍 Lokasi HP" active={auto} onPress={() => S.locateNow()} />
            <Chip label="Pilih manual" active={!auto && !!p?.kota} onPress={() => setPicker(true)} />
          </View>
          {S.locError ? <Text style={[s.small, { color: C.danger }]}>{S.locError}</Text> : null}
          {auto ? <Text style={s.small}>Wilayah diperbarui otomatis mengikuti posisi Anda (saat aplikasi dibuka & saat berpindah ±3 km).</Text> : null}
        </View>

        {S.error && !j ? <Text style={{ color: C.danger }}>{S.error}</Text> : null}

        {j ? <Countdown /> : null}

        {d ? (
          <View style={s.card}>
            <Text style={s.h3}>Hari ini · {formatTanggal(todayIn(j!.tz))}</Text>
            {WAKTU.map(([k, label]) => {
              const wajib = (WAJIB as string[]).includes(k);
              const on = wajib && adz?.aktif && adz.waktu[k as Wajib];
              const isNext = S.next?.key === k && S.next.date === d.date;
              return (
                <View key={k} style={[s.jrow, isNext && s.jrowNext]}>
                  <Text style={[s.jname, !wajib && s.sunnah, isNext && { color: C.accent }]}>{label}</Text>
                  <Text style={[s.jtime, !wajib && s.sunnahTime, isNext && { color: C.accent }]}>{fmtJam(d[k])}</Text>
                  {wajib ? (
                    <Pressable hitSlop={8} style={s.bell} onPress={() => setWaktu(k as Wajib)} accessibilityLabel={`Adzan ${label} ${on ? 'aktif' : 'mati'}`}>
                      <Ionicons name={on ? 'notifications' : 'notifications-off-outline'} size={20} color={on ? C.accent : C.muted} />
                    </Pressable>
                  ) : <View style={s.bell} />}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Adzan */}
        {adz ? (
          <View style={s.card}>
            <Text style={s.h3}>Adzan</Text>
            <ToggleRow label="Putar adzan saat masuk waktu sholat" value={adz.aktif} onChange={(v) => save({ sholat: { adzan: { aktif: v } } })} />
            <ToggleRow label="Jeda musik saat adzan, lanjutkan sesudahnya" value={adz.jedaMusik !== false} onChange={(v) => save({ sholat: { adzan: { jedaMusik: v } } })} />
            <View style={s.row}>
              <Text style={[s.label, { flex: 1 }]}>Volume adzan</Text>
              <Pressable hitSlop={8} onPress={() => save({ sholat: { adzan: { volume: Math.max(0.1, vol - 0.1) } } })}><Ionicons name="remove-circle-outline" size={28} color={C.text} /></Pressable>
              <Text style={s.vol}>{Math.round(vol * 100)}%</Text>
              <Pressable hitSlop={8} onPress={() => save({ sholat: { adzan: { volume: Math.min(1, vol + 0.1) } } })}><Ionicons name="add-circle-outline" size={28} color={C.text} /></Pressable>
            </View>
            <View style={s.row}>
              <View style={[s.dot, { backgroundColor: C.ok }]} />
              <Text style={[s.label, { flex: 1 }]} numberOfLines={2}>
                {adz.suara.jenis === 'lagu' ? `Suara: ${adz.suara.title || 'lagu dari pustaka'}` : 'Suara adzan bawaan server'}
              </Text>
              {adz.suara.jenis === 'lagu' ? <Pressable onPress={() => save({ sholat: { adzan: { suara: { jenis: 'bawaan' } } } })}><Text style={s.link}>Bawaan</Text></Pressable> : null}
            </View>
            <Text style={s.small}>Ganti suara adzan: menu ⋮ pada lagu/file adzan di Pustaka → “Jadikan suara adzan”.</Text>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <Button label={S.playing ? 'Hentikan' : 'Uji suara adzan'} icon={S.playing ? 'stop' : 'play'} kind="ghost"
                onPress={() => (S.playing ? S.stopAdzan() : S.playAdzan('dzuhur', { test: true }))} />
              {S.notifGranted === false ? <Button label="Izinkan notifikasi" icon="notifications-outline" onPress={async () => {
                if (!(await S.requestNotif())) ui.toast('Izin notifikasi ditolak. Aktifkan di Pengaturan HP → Aplikasi → SoundWave.', true);
              }} /> : null}
            </View>
            <Text style={s.small}>
              Saat aplikasi terbuka atau sedang memutar musik, adzan diputar penuh. Saat aplikasi tertutup, notifikasi tetap berbunyi tepat waktu
              {Platform.OS === 'android' ? ' (izinkan “Alarm & pengingat” dan matikan optimasi baterai untuk SoundWave agar tidak terlambat)' : ''}.
            </Text>
          </View>
        ) : null}

        <Pressable style={[s.card, s.row]} onPress={() => router.push('/quran')}>
          <View style={s.quranIco}><Text style={{ color: '#fff', fontWeight: '800' }}>القرآن</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Hapalan Quran</Text>
            <Text style={s.muted}>Murottal Juz 30, hafalan per ayat dengan pengulangan</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={C.muted} />
        </Pressable>
      </ScrollView>
      <RegionPicker visible={picker} onClose={() => setPicker(false)} onPick={async (k) => {
        setPicker(false);
        try { await S.setManual(k); ui.toast(`Wilayah: ${titleCase(k.lokasi)}`); } catch (e: any) { ui.toast(e.message, true); }
      }} />
    </>
  );
}

function Countdown() {
  const S = useSholat();
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const n = S.next;
  if (!n) return null;
  const sec = Math.max(0, Math.floor((n.at - Date.now()) / 1000));
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return (
    <View style={[s.card, { alignItems: 'center', gap: 2 }]}>
      <Text style={s.muted}>Menuju</Text>
      <Text style={s.cdName}>{namaWaktu[n.key]}</Text>
      <Text style={s.cdTime}>{hh}:{mm}:{ss}</Text>
      <Text style={s.muted}>pukul {fmtJam(n.jam)} {S.jadwal?.zona}</Text>
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.row}>
      <Text style={[s.label, { flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.accent, false: C.surface2 }} thumbColor="#fff" />
    </View>
  );
}

/** Pencarian kabupaten/kota (daftar resmi Kemenag via server). */
function RegionPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (k: Kota) => void }) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Kota[]>([]);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    if (!visible) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      get<{ kota: Kota[] }>(`/api/sholat/kota?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { if (my === seq.current) { setList(r.kota); setErr(r.kota.length ? '' : 'Wilayah tidak ditemukan.'); } })
        .catch((e) => my === seq.current && setErr(e.message));
    }, 220);
    return () => clearTimeout(t);
  }, [q, visible]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(3,5,15,.6)' }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 8 }]}>
          <Text style={[s.h3, { paddingHorizontal: 6 }]}>Pilih wilayah</Text>
          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Ketik nama kota/kabupaten, mis. Bogor" placeholderTextColor={C.muted} autoFocus />
          {err ? <Text style={[s.small, { paddingHorizontal: 6 }]}>{err}</Text> : null}
          <FlatList style={{ maxHeight: 380 }} data={list} keyExtractor={(k) => k.id} keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={({ pressed }) => [s.item, pressed && { backgroundColor: C.surface2 }]} onPress={() => onPick(item)}>
                <Ionicons name="location-outline" size={20} color={C.muted} />
                <Text style={s.label}>{titleCase(item.lokasi)}</Text>
              </Pressable>
            )} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  seg: { flexDirection: 'row', gap: 8 },
  region: { color: C.text, fontSize: 18, fontWeight: '800' },
  muted: { color: C.muted, fontSize: 13 },
  small: { color: C.muted, fontSize: 12, lineHeight: 17 },
  h3: { color: C.text, fontSize: 17, fontWeight: '800' },
  label: { color: C.text, fontSize: 15 },
  link: { color: C.accent, fontWeight: '700' },
  vol: { color: C.text, width: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cdName: { color: C.text, fontSize: 22, fontWeight: '800' },
  cdTime: { color: C.accent2, fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  jrow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, marginHorizontal: -6 },
  jrowNext: { backgroundColor: 'rgba(139,109,255,.15)' },
  jname: { color: C.text, fontWeight: '700', fontSize: 16, flex: 1 },
  jtime: { color: C.text, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] },
  sunnah: { color: C.muted, fontWeight: '500' },
  sunnahTime: { color: C.muted, fontSize: 15, fontWeight: '600' },
  bell: { width: 40, alignItems: 'flex-end' },
  quranIco: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#0f8a64', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 12, gap: 10, borderWidth: 1, borderColor: C.border },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 16, backgroundColor: C.bg },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10, paddingVertical: 13, borderRadius: 12 },
});

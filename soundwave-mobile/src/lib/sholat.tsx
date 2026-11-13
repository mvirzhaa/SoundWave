/**
 * Jadwal sholat & adzan di HP.
 * - Wilayah otomatis dari GPS (real time: diperbarui saat aplikasi dibuka & ketika berpindah ≥ 3 km),
 *   atau dipilih manual dari daftar kabupaten/kota Kemenag. Pengaturan disimpan di server (sama dengan web).
 * - Adzan: saat aplikasi hidup (layar depan atau sedang memutar musik di latar belakang) adzan diputar penuh
 *   dan musik dijeda lalu dilanjutkan. Selain itu notifikasi lokal terjadwal tetap berbunyi tepat waktu.
 * - Jadwal & suara adzan disimpan di HP sehingga tetap jalan saat offline.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { T } from './i18n';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { get, getServer, mediaToken, put, errText } from './api';
import { useAuth } from './auth';
import { useLibrary } from './library';
import { usePlayer } from './player';
import { offlineUri } from './offline';
import { C, themed } from './theme';
import { deviceTz, fmtJam, hitungBulan, jarakKm, Jadwal, namaWaktu, Next, titleCase, todayIn, upcoming, Wajib } from './prayer';

export type Kota = { id: string; lokasi: string; daerah?: string };
export type Suara = { jenis: 'bawaan' } | { jenis: 'lagu'; id: string; title?: string; local?: boolean };
export type Prefs = {
  sholat: {
    mode: 'manual' | 'auto';
    kota: Kota | null;
    koordinat: { lat: number; lon: number; nama: string; tz: number } | null;
    adzan: { aktif: boolean; waktu: Record<Wajib, boolean>; volume: number; jedaMusik: boolean; suara: Suara };
    pengingat: number;
  };
  quran: { qari: string; semua: boolean };
};
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> | null : T[K] };

type Ctx = {
  prefs: Prefs | null;
  jadwal: Jadwal | null;
  next: Next | null;
  error: string;
  loading: boolean;
  locating: boolean;
  locError: string;
  offline: boolean;
  playing: Wajib | null;
  notifGranted: boolean | null;
  /** Admin memaksa semua akun memakai suara adzan global (pilihan lagu pengguna diabaikan). */
  paksa: boolean;
  reload: () => Promise<void>;
  savePrefs: (patch: DeepPartial<Prefs>) => Promise<Prefs | null>;
  locateNow: () => Promise<void>;
  setManual: (k: Kota) => Promise<void>;
  playAdzan: (key: Wajib, opts?: { test?: boolean; jam?: string }) => Promise<void>;
  stopAdzan: () => void;
  requestNotif: () => Promise<boolean>;
};
const SholatCtx = createContext<Ctx>(null as unknown as Ctx);
export const useSholat = () => useContext(SholatCtx);

/* ---------- Cache di HP ---------- */
const cacheFile = new File(Paths.document, 'sholat.json');
const adzanFile = (jenis: 'umum' | 'subuh') => new File(Paths.document, `adzan-${jenis}.mp3`);
type GlobalAdzan = { tersedia: boolean; subuh: boolean; versi: string | null; paksa: boolean };
type Cache = { prefs?: Prefs; jadwal?: Jadwal; global?: GlobalAdzan; notifSig?: string };
function readCache(): Cache {
  try { return cacheFile.exists ? JSON.parse(cacheFile.textSync() || '{}') : {}; } catch { return {}; }
}
function writeCache(c: Cache) {
  try { if (!cacheFile.exists) cacheFile.create(); cacheFile.write(JSON.stringify(c)); } catch { /* abaikan */ }
}

/* ---------- Notifikasi ---------- */
const CHANNEL = 'adzan';
// Opsional: suara adzan khusus untuk notifikasi (harus dibundel lewat plugin expo-notifications "sounds")
const NOTIF_SOUND = process.env.EXPO_PUBLIC_ADZAN_SOUND || '';
const MAX_NOTIF = 60; // iOS membatasi 64 notifikasi terjadwal per aplikasi

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const adzan = n.request.content.data?.sw === 'adzan';
    // Aplikasi sedang terbuka → adzan diputar oleh aplikasi sendiri, notifikasi cukup tampil tanpa suara
    const active = AppState.currentState === 'active';
    return { shouldShowBanner: !(adzan && active), shouldShowList: true, shouldPlaySound: !(adzan && active), shouldSetBadge: false };
  },
});

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: T('Adzan waktu sholat'),
    importance: Notifications.AndroidImportance.MAX,
    sound: NOTIF_SOUND || 'default',
    vibrationPattern: [0, 400, 250, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: { usage: Notifications.AndroidAudioUsage.ALARM, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
  });
}

/** Jadwalkan ulang notifikasi hanya bila daftar waktunya berubah (menghindari puluhan panggilan native tiap aplikasi dibuka). */
async function scheduleNotifications(j: Jadwal | null, p: Prefs | null) {
  try {
    const a0 = p?.sholat.adzan;
    const sig = !j || !a0?.aktif ? 'off'
      : JSON.stringify([j.lokasi, j.tz, upcoming(j, 200).filter((n) => a0.waktu[n.key]).slice(0, MAX_NOTIF).map((n) => n.at), T('Waktu {w} telah tiba', { w: '' })]);
    const cache = readCache();
    if (cache.notifSig === sig) {
      // Sudah terjadwal sama persis; cek cepat jumlahnya masih ada
      const have = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.identifier.startsWith('adzan-')).length;
      if (sig === 'off' || have > 0) return have;
    }
    writeCache({ ...cache, notifSig: sig });
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(all.filter((n) => n.identifier.startsWith('adzan-')).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    const a = p?.sholat.adzan;
    if (!j || !a?.aktif) return 0;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return 0;
    await ensureChannel();
    const list = upcoming(j, 200).filter((n) => a.waktu[n.key]).slice(0, MAX_NOTIF);
    const lokasi = titleCase(j.lokasi);
    for (const n of list) {
      await Notifications.scheduleNotificationAsync({
        identifier: `adzan-${n.date}-${n.key}`,
        content: {
          title: T('Waktu {w} telah tiba', { w: T(namaWaktu[n.key]) }),
          body: `${fmtJam(n.jam)} ${j.zona}${lokasi ? ` · ${lokasi}` : ''}`,
          data: { sw: 'adzan', key: n.key, jam: n.jam, at: n.at },
          sound: NOTIF_SOUND || 'default',
          ...(Platform.OS === 'android' ? { priority: Notifications.AndroidNotificationPriority.MAX } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId: CHANNEL },
      });
    }
    return list.length;
  } catch { return 0; }
}

/* ---------- Provider ---------- */
export function SholatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const lib = useLibrary();
  const player = usePlayer();
  const insets = useSafeAreaInsets();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [jadwal, setJadwal] = useState<Jadwal | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [offline, setOffline] = useState(false);
  const [playing, setPlaying] = useState<Wajib | null>(null);
  const [banner, setBanner] = useState<{ key: Wajib; jam: string; test: boolean } | null>(null);
  const [notifGranted, setNotifGranted] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);
  const [global, setGlobal] = useState<GlobalAdzan | null>(() => readCache().global || null);
  const globalRef = useRef<GlobalAdzan | null>(global); globalRef.current = global;
  const lastAdzanCheck = useRef(0);

  const prefsRef = useRef<Prefs | null>(null); prefsRef.current = prefs;
  const jadwalRef = useRef<Jadwal | null>(null); jadwalRef.current = jadwal;
  const playerRef = useRef(player); playerRef.current = player;
  const libRef = useRef(lib); libRef.current = lib;
  const adzanPlayer = useRef<AudioPlayer | null>(null);
  const resumeAfter = useRef(false);
  const played = useRef(new Set<string>()); // "<tanggal>-<waktu>" yang sudah diadzankan
  const watchSub = useRef<Location.LocationSubscription | null>(null);
  const lastFix = useRef<{ lat: number; lon: number; at: number } | null>(null);

  const persist = (c: Cache) => writeCache({ ...readCache(), ...c });

  /* ---- Jadwal ---- */
  const fetchJadwal = useCallback(async (p: Prefs | null): Promise<Jadwal | null> => {
    const now = new Date();
    const tz = p?.sholat.koordinat?.tz ?? jadwalRef.current?.tz ?? 420;
    const today = todayIn(tz);
    const [y, m, d] = today.split('-').map(Number);
    const months: [number, number][] = [[y, m]];
    if (d >= 24) months.push(m === 12 ? [y + 1, 1] : [y, m + 1]); // cukup untuk notifikasi ±12 hari ke depan
    try {
      const parts = await Promise.all(months.map(([yy, mm]) => get<Jadwal>(`/api/sholat/jadwal?tahun=${yy}&bulan=${mm}`)));
      const j = { ...parts[0], jadwal: parts.flatMap((x) => x.jadwal) };
      setOffline(false);
      return j;
    } catch (e: any) {
      if (e.code === 'NO_REGION') return null;
      // Server tidak terjangkau: hitung sendiri dari koordinat terakhir
      const k = p?.sholat.koordinat;
      setOffline(true);
      if (k) {
        const parts = months.map(([yy, mm]) => hitungBulan(k.lat, k.lon, yy, mm, k.tz));
        return { ...parts[0], lokasi: k.nama || `${k.lat.toFixed(3)}, ${k.lon.toFixed(3)}`, jadwal: parts.flatMap((x) => x.jadwal) };
      }
      const cached = readCache().jadwal;
      if (cached?.jadwal.some((x) => x.date >= todayIn(cached.tz))) return cached;
      throw e;
    } finally { void now; }
  }, []);

  const applyJadwal = (j: Jadwal | null) => { setJadwal(j); if (j) persist({ jadwal: j }); };

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    let p = prefsRef.current;
    try {
      p = await get<Prefs>('/api/sholat/pengaturan');
      setPrefs(p); persist({ prefs: p });
    } catch (e: any) {
      if (!p) p = readCache().prefs || null;
      if (p) setPrefs(p);
    }
    try { applyJadwal(await fetchJadwal(p)); } catch (e: any) { setError(errText(e)); }
    setLoading(false);
  }, [fetchJadwal]);

  const savePrefs = useCallback(async (patch: DeepPartial<Prefs>) => {
    try {
      const p = await put<Prefs>('/api/sholat/pengaturan', patch);
      setPrefs(p); persist({ prefs: p });
      const s = patch.sholat;
      if (s && ('kota' in s || 'mode' in s || 'koordinat' in s)) applyJadwal(await fetchJadwal(p).catch(() => jadwalRef.current));
      return p;
    } catch (e: any) { setError(errText(e)); throw e; }
  }, [fetchJadwal]);

  /* ---- Lokasi real time ---- */
  const locate = useCallback(async (opts: { interactive: boolean; pos?: Location.LocationObject }) => {
    setLocError('');
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && opts.interactive) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setLocError(T('Izin lokasi belum diberikan. Aktifkan di Pengaturan HP atau pilih wilayah secara manual.')); return; }
      setLocating(true);
      const pos = opts.pos || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .catch(() => Location.getLastKnownPositionAsync({ maxAge: 30 * 60000 }));
      if (!pos) throw new Error(T('Lokasi tidak terdeteksi. Pastikan GPS/lokasi HP aktif.'));
      const lat = pos.coords.latitude; const lon = pos.coords.longitude;
      lastFix.current = { lat, lon, at: Date.now() };
      const prev = prefsRef.current?.sholat.koordinat;
      // Tidak berpindah jauh & sudah mode lokasi → cukup
      if (!opts.interactive && prev && prefsRef.current?.sholat.mode === 'auto' && jarakKm(prev, { lat, lon }) < 3 && Math.abs(prev.tz - deviceTz()) < 1) return;
      let nama = ''; let subregion = ''; let city = '';
      try {
        const [g] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        subregion = g?.subregion || ''; city = g?.city || g?.district || '';
        nama = [g?.city || g?.subregion || g?.district, g?.region].filter(Boolean).join(', ');
      } catch { /* tanpa nama tempat */ }
      let kota: Kota | null = null;
      try { kota = (await get<{ kota: Kota | null }>(`/api/sholat/kota/cocok?subregion=${encodeURIComponent(subregion)}&city=${encodeURIComponent(city)}`)).kota; } catch { /* offline */ }
      const koordinat = { lat, lon, nama, tz: deviceTz() };
      try {
        await savePrefs({ sholat: { mode: 'auto', koordinat, kota: kota ? { id: kota.id, lokasi: kota.lokasi } : null } });
      } catch {
        // Offline: simpan di HP & hitung jadwal sendiri
        const base = prefsRef.current || readCache().prefs;
        if (base) {
          const p: Prefs = { ...base, sholat: { ...base.sholat, mode: 'auto', koordinat, kota: kota || base.sholat.kota } };
          setPrefs(p); persist({ prefs: p });
          applyJadwal(await fetchJadwal(p).catch(() => null));
        }
      }
    } catch (e: any) {
      setLocError(errText(e) || T('Gagal membaca lokasi.'));
    } finally { setLocating(false); }
  }, [savePrefs, fetchJadwal]);

  const locateNow = useCallback(() => locate({ interactive: true }), [locate]);
  const setManual = useCallback(async (k: Kota) => { await savePrefs({ sholat: { mode: 'manual', kota: { id: k.id, lokasi: k.lokasi } } }); }, [savePrefs]);

  // Pantau perpindahan selama aplikasi aktif (mode lokasi)
  const startWatch = useCallback(async () => {
    watchSub.current?.remove(); watchSub.current = null;
    if (prefsRef.current?.sholat.mode !== 'auto') return;
    const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (!perm?.granted) return;
    try {
      watchSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 3000, timeInterval: 10 * 60000 },
        (pos) => {
          const prev = prefsRef.current?.sholat.koordinat;
          if (!prev || jarakKm(prev, { lat: pos.coords.latitude, lon: pos.coords.longitude }) >= 3) locate({ interactive: false, pos });
        },
      );
    } catch { /* abaikan */ }
  }, [locate]);

  /* ---- Adzan ---- */
  const adzanSource = async (key: Wajib): Promise<string> => {
    const s = prefsRef.current?.sholat.adzan.suara;
    if (s?.jenis === 'lagu' && s.id && !globalRef.current?.paksa) {
      if (s.local) {
        const t = libRef.current.localTracks.find((x) => x.id === s.id);
        if (t?.uri) return t.uri;
      } else {
        const off = offlineUri(s.id);
        if (off) return off;
        try { return `${getServer()}/api/library/stream/${encodeURIComponent(s.id)}?t=${encodeURIComponent(await mediaToken())}`; } catch { /* pakai bawaan */ }
      }
    }
    const jenis = key === 'subuh' && adzanFile('subuh').exists ? 'subuh' : 'umum';
    const f = adzanFile(jenis);
    if (f.exists) return f.uri;
    const v = globalRef.current?.versi ? `&v=${encodeURIComponent(globalRef.current.versi)}` : '';
    return `${getServer()}/api/sholat/adzan/${jenis}?t=${encodeURIComponent(await mediaToken())}${v}`;
  };

  const finish = useCallback(() => {
    setPlaying(null); setBanner(null);
    if (resumeAfter.current) { resumeAfter.current = false; playerRef.current.resume(); }
  }, []);

  const stopAdzan = useCallback(() => {
    try { adzanPlayer.current?.pause(); } catch { /* abaikan */ }
    finish();
  }, [finish]);

  const playAdzan = useCallback(async (key: Wajib, opts: { test?: boolean; jam?: string } = {}) => {
    const a = prefsRef.current?.sholat.adzan;
    resumeAfter.current = false;
    if (a?.jedaMusik !== false && playerRef.current.playing) { playerRef.current.pause(); resumeAfter.current = true; }
    try {
      const uri = await adzanSource(key);
      let ap = adzanPlayer.current;
      if (!ap) {
        ap = createAudioPlayer(null, { updateInterval: 1000 });
        ap.addListener('playbackStatusUpdate', (st) => { if (st.didJustFinish) finish(); });
        adzanPlayer.current = ap;
      }
      ap.replace({ uri });
      ap.volume = a?.volume ?? 0.9;
      ap.seekTo(0);
      ap.play();
      setPlaying(key);
      setBanner({ key, jam: opts.jam || '', test: !!opts.test });
    } catch {
      setBanner({ key, jam: opts.jam || '', test: !!opts.test });
      setPlaying(null);
      if (resumeAfter.current) { resumeAfter.current = false; playerRef.current.resume(); }
    }
  }, [finish]);

  const masukWaktu = useCallback((n: Next) => {
    const id = `${n.date}-${n.key}`;
    if (played.current.has(id)) return;
    played.current.add(id);
    const a = prefsRef.current?.sholat.adzan;
    if (a?.aktif && a.waktu[n.key]) playAdzan(n.key, { jam: n.jam });
    else setBanner({ key: n.key, jam: n.jam, test: false });
  }, [playAdzan]);

  // Unduh suara adzan global agar bisa diputar offline; unduh ulang bila admin mengganti file (versi berubah)
  const cacheAdzanFiles = useCallback(async () => {
    lastAdzanCheck.current = Date.now();
    try {
      const st = await get<GlobalAdzan>('/api/sholat/adzan');
      const old = readCache().global;
      setGlobal(st);
      persist({ global: st });
      if (old?.versi !== st.versi) {
        (['umum', 'subuh'] as const).forEach((j) => { try { if (adzanFile(j).exists) adzanFile(j).delete(); } catch { /* abaikan */ } });
      }
      if (!st.subuh) { try { if (adzanFile('subuh').exists) adzanFile('subuh').delete(); } catch { /* abaikan */ } }
      const todo: ('umum' | 'subuh')[] = [];
      if (st.tersedia && !adzanFile('umum').exists) todo.push('umum');
      if (st.subuh && !adzanFile('subuh').exists) todo.push('subuh');
      const t = await mediaToken();
      for (const j of todo) await File.downloadFileAsync(`${getServer()}/api/sholat/adzan/${j}?t=${encodeURIComponent(t)}`, adzanFile(j), { idempotent: true });
    } catch { /* coba lagi lain kali */ }
  }, []);

  const requestNotif = useCallback(async () => {
    const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    setNotifGranted(r.granted);
    if (r.granted) scheduleNotifications(jadwalRef.current, prefsRef.current);
    return r.granted;
  }, []);

  /* ---- Siklus hidup ---- */
  useEffect(() => {
    if (!user) {
      setPrefs(null); setJadwal(null); watchSub.current?.remove(); watchSub.current = null;
      Notifications.getAllScheduledNotificationsAsync().then((all) => all.filter((n) => n.identifier.startsWith('adzan-'))
        .forEach((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))).catch(() => {});
      return;
    }
    const c = readCache();
    if (c.prefs) setPrefs(c.prefs);
    if (c.jadwal) setJadwal(c.jadwal);
    (async () => {
      await reload();
      if (prefsRef.current?.sholat.mode === 'auto') await locate({ interactive: false });
      startWatch();
      cacheAdzanFiles();
      const perm = await Notifications.getPermissionsAsync().catch(() => null);
      setNotifGranted(perm ? perm.granted : null);
      // Minta izin notifikasi sekali bila adzan aktif
      if (perm && !perm.granted && perm.canAskAgain && prefsRef.current?.sholat.adzan.aktif) requestNotif();
    })();
    return () => { watchSub.current?.remove(); watchSub.current = null; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kembali ke aplikasi: perbarui lokasi & jadwal
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !user) return;
      setTick((x) => x + 1);
      if (prefsRef.current?.sholat.mode === 'auto' && (!lastFix.current || Date.now() - lastFix.current.at > 5 * 60000)) locate({ interactive: false });
      const j = jadwalRef.current;
      if (!j || !j.jadwal.some((x) => x.date === todayIn(j.tz, 1))) reload();
      if (Date.now() - lastAdzanCheck.current > 30 * 60000) cacheAdzanFiles();
    });
    return () => sub.remove();
  }, [user, locate, reload, cacheAdzanFiles]);

  // Mode berubah → mulai/berhenti memantau lokasi
  useEffect(() => { if (user) startWatch(); }, [prefs?.sholat.mode, user, startWatch]);

  // Jadwalkan ulang notifikasi bila jadwal/pengaturan adzan berubah
  const adzanKey = JSON.stringify(prefs?.sholat.adzan || null);
  useEffect(() => { if (user && notifGranted) scheduleNotifications(jadwal, prefs); }, [jadwal, adzanKey, notifGranted, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Penjadwal adzan dalam aplikasi
  const next = useMemo(() => upcoming(jadwal, 1)[0] || null, [jadwal, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!next) return;
    const wait = Math.min(next.at - Date.now(), 3600000);
    const t = setTimeout(() => {
      if (Date.now() >= next.at - 1000 && Date.now() - next.at < 5 * 60000) masukWaktu(next);
      setTick((x) => x + 1);
      const j = jadwalRef.current;
      if (j && !j.jadwal.some((x) => x.date === todayIn(j.tz, 1))) reload();
    }, Math.max(1000, wait));
    return () => clearTimeout(t);
  }, [next, masukWaktu, reload]);

  // Notifikasi diterima saat aplikasi terbuka / diketuk dari luar
  useEffect(() => {
    const onNotif = (n: Notifications.Notification) => {
      const d = n.request.content.data as any;
      if (d?.sw !== 'adzan' || !d.key) return;
      const at = Number(d.at) || Date.now();
      if (Math.abs(Date.now() - at) < 10 * 60000) masukWaktu({ key: d.key, at, date: n.request.identifier.slice(6, 16), jam: d.jam });
    };
    const s1 = Notifications.addNotificationReceivedListener(onNotif);
    const s2 = Notifications.addNotificationResponseReceivedListener((r) => {
      if ((r.notification.request.content.data as any)?.sw !== 'adzan') return;
      router.push('/sholat');
      onNotif(r.notification);
    });
    return () => { s1.remove(); s2.remove(); };
  }, [masukWaktu]);

  useEffect(() => () => { adzanPlayer.current?.remove(); adzanPlayer.current = null; }, []);

  const paksa = Boolean(global?.paksa);
  const value: Ctx = useMemo(() => ({
    prefs, jadwal, next, error, loading, locating, locError, offline, playing, notifGranted, paksa,
    reload, savePrefs, locateNow, setManual, playAdzan, stopAdzan, requestNotif,
  }), [prefs, jadwal, next, error, loading, locating, locError, offline, playing, notifGranted, paksa, reload, savePrefs, locateNow, setManual, playAdzan, stopAdzan, requestNotif]);

  return (
    <SholatCtx.Provider value={value}>
      {children}
      {banner ? (
        <View style={[st.banner, { top: insets.top + 8 }]} accessibilityRole="alert">
          <Ionicons name="moon" size={24} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={st.title}>{banner.test ? T('Uji suara adzan') : T('Waktu {w} telah tiba', { w: T(namaWaktu[banner.key]) })}</Text>
            <Text style={st.sub} numberOfLines={1}>
              {banner.test ? T('Begini adzan akan terdengar saat masuk waktu sholat.') : `${fmtJam(banner.jam)} ${jadwal?.zona || ''} · ${titleCase(jadwal?.lokasi)}`}
            </Text>
          </View>
          <Pressable onPress={playing ? stopAdzan : () => setBanner(null)} style={st.btn}>
            <Text style={st.btnText}>{playing ? T('Hentikan') : T('Tutup')}</Text>
          </Pressable>
        </View>
      ) : null}
    </SholatCtx.Provider>
  );
}

const st = themed(() => StyleSheet.create({
  banner: {
    position: 'absolute', left: 12, right: 12, zIndex: 100, elevation: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 18, backgroundColor: C.accent, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
  },
  title: { color: '#fff', fontWeight: '800', fontSize: 16 },
  sub: { color: 'rgba(255,255,255,.85)', fontSize: 13, marginTop: 2 },
  btn: { backgroundColor: 'rgba(255,255,255,.22)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { color: '#fff', fontWeight: '800' },
}));

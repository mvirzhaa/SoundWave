import React, { Fragment, useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ErrorBoundaryProps, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { LibraryProvider } from '../lib/library';
import { PlayerProvider, usePlayer } from '../lib/player';
import { UiProvider, useUi } from '../lib/ui';
import { SholatProvider } from '../lib/sholat';
import { SettingsProvider, useSettings } from '../lib/settings';
import { AnnouncementPopup } from '../components/Announcements';
import { MiniPlayer } from '../components/MiniPlayer';
import { C } from '../lib/theme';
import { errText, isOnline } from '../lib/api';
import { T } from '../lib/i18n';

// Logo SoundWave tetap tampil sampai sesi & pengaturan selesai dibaca (tanpa layar kosong/berputar)
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Layar yang dibuka di atas tab (tanpa tab bar) tetap punya mini player agar suara bisa dijeda/dihentikan. */
const STACK_WITH_MINI = new Set(['playlist', 'group', 'quran', 'surat', 'pengumuman']);

function StackMini() {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  if (!STACK_WITH_MINI.has(String(segments[0] || ''))) return null;
  return <View style={{ backgroundColor: C.bg, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 6) }}><MiniPlayer /></View>;
}

/** Pesan dari pemutar (mis. stasiun radio tidak merespons) → toast. */
function PlayerNotices() {
  const { notice } = usePlayer();
  const ui = useUi();
  useEffect(() => { if (notice) ui.toast(notice.text, true); }, [notice?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function RootStack() {
  const { ready, user } = useAuth();
  const { renderKey, scheme } = useSettings();
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    // key: pasang ulang navigasi saat tema/bahasa berganti agar semua layar memakai warna & teks baru
    <Fragment key={renderKey}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Stack screenOptions={{
          headerStyle: { backgroundColor: C.bg }, headerTintColor: C.text, headerShadowVisible: false,
          contentStyle: { backgroundColor: C.bg }, headerTitleStyle: { fontWeight: '700' },
        }}>
          <Stack.Protected guard={!user}>
            <Stack.Screen name="login" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={!!user}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="playlist/[id]" options={{ title: T('Playlist') }} />
            <Stack.Screen name="group/[kind]/[name]" options={{ title: '' }} />
            <Stack.Screen name="player" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="voice" options={{ presentation: 'transparentModal', headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="drive" options={{ headerShown: false }} />
            <Stack.Screen name="quran" options={{ title: T('Hapalan Quran') }} />
            <Stack.Screen name="surat/[n]" options={{ title: '' }} />
            <Stack.Screen name="pengumuman" options={{ title: T('Pengumuman') }} />
            <Stack.Screen name="sholat" options={{ title: T('Jadwal Sholat') }} />
            <Stack.Screen name="hafalan" options={{ title: T('Hafalan'), presentation: 'modal' }} />
            <Stack.Screen name="tv-player" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'slide_from_bottom', orientation: 'all' }} />
          </Stack.Protected>
        </Stack>
        {user ? <StackMini /> : null}
      </View>
      {user ? <AnnouncementPopup /> : null}
      <PlayerNotices />
    </Fragment>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AuthProvider>
          <LibraryProvider>
            <PlayerProvider>
              <UiProvider>
                <SholatProvider>
                  <RootStack />
                </SholatProvider>
              </UiProvider>
            </PlayerProvider>
          </LibraryProvider>
        </AuthProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

/** Bila terjadi error tak terduga: tampilkan tombol muat ulang, bukan layar gelap kosong. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}); }, []);
  return (
    <View style={{ flex: 1, backgroundColor: '#070b1d', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <Text style={{ color: '#e8ebff', fontSize: 20, fontWeight: '800' }}>{T('Terjadi kesalahan')}</Text>
      <Text style={{ color: '#9aa3c7', textAlign: 'center' }}>{T('Aplikasi mengalami masalah. Ketuk muat ulang untuk melanjutkan.')}</Text>
      {/* Detail galat tanpa link/alamat server; saat offline cukup pesan offline */}
      <Text style={{ color: '#9aa3c7', fontSize: 12, textAlign: 'center' }} numberOfLines={3}>{isOnline() ? errText(error, '') : errText({ status: 0 })}</Text>
      <Pressable onPress={retry} style={{ backgroundColor: '#8b6dff', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>{T('Muat ulang')}</Text>
      </Pressable>
    </View>
  );
}

import React, { Fragment, useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { LibraryProvider } from '../lib/library';
import { PlayerProvider } from '../lib/player';
import { UiProvider } from '../lib/ui';
import { SholatProvider } from '../lib/sholat';
import { SettingsProvider, useSettings } from '../lib/settings';
import { C } from '../lib/theme';
import { T } from '../lib/i18n';

// Logo SoundWave tetap tampil sampai sesi & pengaturan selesai dibaca (tanpa layar kosong/berputar)
SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { ready, user } = useAuth();
  const { renderKey, scheme } = useSettings();
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    // key: pasang ulang navigasi saat tema/bahasa berganti agar semua layar memakai warna & teks baru
    <Fragment key={renderKey}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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
        </Stack.Protected>
      </Stack>
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

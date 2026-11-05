import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { LibraryProvider } from '../lib/library';
import { PlayerProvider } from '../lib/player';
import { UiProvider } from '../lib/ui';
import { C } from '../lib/theme';

function RootStack() {
  const { ready, user } = useAuth();
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.accent} /></View>;
  }
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: C.bg }, headerTintColor: C.text, headerShadowVisible: false,
      contentStyle: { backgroundColor: C.bg }, headerTitleStyle: { fontWeight: '700' },
    }}>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="playlist/[id]" options={{ title: 'Playlist' }} />
        <Stack.Screen name="group/[kind]/[name]" options={{ title: '' }} />
        <Stack.Screen name="player" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="voice" options={{ presentation: 'transparentModal', headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="drive" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <LibraryProvider>
          <PlayerProvider>
            <UiProvider>
              <RootStack />
            </UiProvider>
          </PlayerProvider>
        </LibraryProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

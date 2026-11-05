import React from 'react';
import { Pressable, View } from 'react-native';
import { Tabs, BottomTabBar } from 'expo-router/js-tabs';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MiniPlayer } from '../../components/MiniPlayer';
import { C } from '../../lib/theme';

/** Tombol mikrofon di header — membuka layar perintah suara. */
function MicButton() {
  return (
    <Pressable onPress={() => router.push('/voice')} hitSlop={10} style={{ marginRight: 14 }} accessibilityLabel="Perintah suara">
      <Ionicons name="mic" size={24} color={C.accent} />
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => (
        <View style={{ backgroundColor: C.bg }}>
          <MiniPlayer />
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={{
        headerStyle: { backgroundColor: C.bg },
        headerTintColor: C.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', fontSize: 22 },
        headerTitleAlign: 'left',
        headerRight: () => <MicButton />,
        tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.border },
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.muted,
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Cari', tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color as string} size={size} /> }} />
      <Tabs.Screen name="library" options={{ title: 'Pustaka', tabBarIcon: ({ color, size }) => <Ionicons name="musical-notes" color={color as string} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Akun', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color as string} size={size} /> }} />
    </Tabs>
  );
}

/**
 * Cadangan untuk tautan soundwave://drive?status=… (jika OAuth Google kembali ke aplikasi
 * di luar sesi browser, mis. di beberapa HP Android). Muat ulang profil lalu buka tab Akun.
 */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { C } from '../lib/theme';

export default function DriveReturn() {
  const { refreshUser } = useAuth();
  useEffect(() => { refreshUser().finally(() => router.replace('/account')); }, [refreshUser]);
  return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.accent} /></View>;
}

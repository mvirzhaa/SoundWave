/**
 * WebView yang tidak pernah menampilkan halaman galat bawaan Android (yang memuat alamat server/link).
 * Saat gagal dimuat (mis. offline) yang tampil adalah pesan sederhana.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView, WebViewProps } from 'react-native-webview';
import { isOnline } from '../lib/api';
import { T } from '../lib/i18n';

export function SafeWebView(props: WebViewProps & { failText?: string }) {
  const { failText, ...rest } = props;
  const fail = () => (
    <View style={s.fill}>
      <Ionicons name="cloud-offline-outline" size={30} color="#fbbf24" />
      <Text style={s.text}>{isOnline() ? (failText || T('Video tidak dapat dimuat. Coba lagi nanti.')) : T('Video tidak dapat diputar saat offline.')}</Text>
    </View>
  );
  return (
    <WebView
      {...rest}
      startInLoadingState
      renderLoading={() => <View style={s.fill}><ActivityIndicator color="#fff" /></View>}
      renderError={fail}
      setSupportMultipleWindows={false}
    />
  );
}

const s = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#000', padding: 16 },
  text: { color: '#fff', textAlign: 'center', fontWeight: '600' },
});

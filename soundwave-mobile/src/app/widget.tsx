/**
 * Pintu masuk dari widget layar utama (soundwave://widget?cmd=…): dipakai saat aplikasi belum berjalan.
 * Menjalankan perintah (putar/jeda/berikutnya/…/putar lagu tertentu) atau membuka pencarian Pustaka.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLibrary } from '../lib/library';
import { getWidgetControls, type WidgetCommand } from '../widget/bridge';
import { C } from '../lib/theme';

export default function WidgetEntry() {
  const { cmd, id } = useLocalSearchParams<{ cmd?: string; id?: string }>();
  const lib = useLibrary();
  const done = useRef(false);
  const ready = lib.tracks !== null || lib.localTracks.length > 0;

  useEffect(() => {
    if (done.current) return;
    if (cmd === 'search') { done.current = true; router.replace({ pathname: '/', params: { cari: String(Date.now()) } }); return; }
    const go = () => {
      if (done.current) return;
      done.current = true;
      if (cmd) getWidgetControls()?.run(cmd as WidgetCommand, id);
      router.replace('/');
    };
    if (ready) { const h = setTimeout(go, 150); return () => clearTimeout(h); } // beri waktu WidgetSync membaca pustaka
    const h = setTimeout(go, 7000); // pustaka tak kunjung siap (mis. offline tanpa unduhan) → tetap tutup layar ini
    return () => clearTimeout(h);
  }, [cmd, id, ready]);

  return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.accent} /></View>;
}

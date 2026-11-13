/** Daftar pengumuman dari admin (tersimpan). Membuka layar ini menandai semuanya sudah dibaca. */
import React, { useEffect, useState } from 'react';
import { errText } from '../lib/api';
import { FlatList, RefreshControl, Text } from 'react-native';
import { AnnouncementCard, loadAnnouncements, markRead, useAnnouncements } from '../components/Announcements';
import { Empty } from '../components/Common';
import { C } from '../lib/theme';
import { T } from '../lib/i18n';

export default function PengumumanScreen() {
  const { list } = useAnnouncements();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const refresh = async () => {
    setLoading(true);
    try { await loadAnnouncements(); setErr(''); } catch (e: any) { setErr(errText(e)); } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { markRead(list.filter((a) => !a.read).map((a) => a.id)); }, [list]);
  return (
    <FlatList
      data={list}
      keyExtractor={(a) => String(a.id)}
      contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.accent} />}
      ListHeaderComponent={err ? <Text style={{ color: C.danger }}>{err}</Text> : undefined}
      ListEmptyComponent={loading ? undefined : <Empty icon="megaphone-outline" title={T('Belum ada pengumuman')} text={T('Pengumuman dari admin SoundWave akan muncul di sini.')} />}
      renderItem={({ item }) => <AnnouncementCard a={item} />}
    />
  );
}

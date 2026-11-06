/**
 * Pengumuman dari superadmin:
 *  - pop-up untuk pengumuman yang belum dibaca (saat aplikasi dibuka / kembali aktif),
 *  - push notification (token Expo didaftarkan ke server),
 *  - disimpan & bisa dibaca ulang di layar Pengumuman.
 */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { del, get, post } from '../lib/api';
import { C, themed } from '../lib/theme';
import { T } from '../lib/i18n';

export type Announcement = { id: number; title: string; body: string; link: string | null; level: 'info' | 'penting'; createdAt: number; read: boolean };

/* ---------- Penyimpanan bersama (dipakai pop-up, layar daftar, badge di Akun) ---------- */
let state: { list: Announcement[]; unread: number } = { list: [], unread: 0 };
const subs = new Set<() => void>();
const set = (s: typeof state) => { state = s; subs.forEach((f) => f()); };
export const useAnnouncements = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state);

export async function loadAnnouncements() {
  const r = await get<{ pengumuman: Announcement[]; belumDibaca: number }>('/api/pengumuman', { timeout: 15000 });
  set({ list: r.pengumuman, unread: r.belumDibaca });
  return r.pengumuman;
}
export function markRead(ids: number[]) {
  if (!ids.length) return;
  const list = state.list.map((a) => (ids.includes(a.id) ? { ...a, read: true } : a));
  set({ list, unread: list.filter((a) => !a.read).length });
  post('/api/pengumuman/dibaca', { ids }).catch(() => {});
}

/* ---------- Push notification ---------- */
let pushToken: string | null = null;
async function registerPush() {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('pengumuman', {
        name: T('Pengumuman'), importance: Notifications.AndroidImportance.HIGH, sound: 'default',
      });
    }
    // Push jarak jauh butuh projectId EAS (app.json → extra.eas.projectId). Tanpa itu, pengumuman tetap tampil sebagai pop-up.
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    pushToken = data;
    await post('/api/pengumuman/push-token', { token: data, platform: Platform.OS });
  } catch { /* push tidak tersedia (emulator, izin ditolak, tanpa FCM) → pop-up saja */ }
}
/** Dipanggil saat keluar akun agar HP ini tidak menerima push akun tersebut lagi. */
export async function unregisterPush() {
  if (!pushToken) return;
  try { await del('/api/pengumuman/push-token', { token: pushToken }); } catch { /* abaikan */ }
  pushToken = null;
}

/* ---------- Pop-up ---------- */
export function AnnouncementPopup() {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    lastCheck.current = Date.now();
    try {
      const list = await loadAnnouncements();
      const unread = list.filter((a) => !a.read).reverse(); // terlama dulu
      setQueue((q) => (q.length ? q : unread));
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    check();
    registerPush();
    const s1 = AppState.addEventListener('change', (st) => { if (st === 'active' && Date.now() - lastCheck.current > 5 * 60000) check(); });
    // Push diterima saat aplikasi terbuka → langsung tampilkan
    const s2 = Notifications.addNotificationReceivedListener((n) => { if ((n.request.content.data as any)?.sw === 'pengumuman') check(); });
    // Push diketuk → buka daftar pengumuman
    const s3 = Notifications.addNotificationResponseReceivedListener((r) => {
      if ((r.notification.request.content.data as any)?.sw !== 'pengumuman') return;
      check();
      router.push('/pengumuman');
    });
    return () => { s1.remove(); s2.remove(); s3.remove(); };
  }, [check]);

  const a = queue[0];
  if (!a) return null;
  const close = () => { markRead([a.id]); setQueue((q) => q.slice(1)); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.head}>
            <View style={[s.ico, a.level === 'penting' && { backgroundColor: '#f59e0b' }]}><Ionicons name="megaphone" size={20} color="#fff" /></View>
            <Text style={s.eyebrow}>{a.level === 'penting' ? T('PENGUMUMAN PENTING') : T('PENGUMUMAN')}</Text>
          </View>
          <Text style={s.title}>{a.title}</Text>
          <ScrollView style={{ maxHeight: 320 }}><Text style={s.body}>{a.body}</Text></ScrollView>
          {a.link ? <Text style={s.link} onPress={() => Linking.openURL(a.link!)}>{T('Buka tautan')}</Text> : null}
          <Text style={s.date}>{new Date(a.createdAt).toLocaleString()}</Text>
          <Pressable style={s.btn} onPress={close}>
            <Text style={s.btnText}>{queue.length > 1 ? T('Mengerti ({n} lagi)', { n: queue.length - 1 }) : T('Mengerti')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Kartu pengumuman di layar daftar. */
export function AnnouncementCard({ a }: { a: Announcement }) {
  return (
    <View style={[s.item, a.level === 'penting' && { borderColor: '#f59e0b' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[s.itemTitle, { flex: 1 }]}>{a.title}</Text>
        {a.level === 'penting' ? <Text style={s.badge}>{T('Penting')}</Text> : null}
        {!a.read ? <View style={s.dot} /> : null}
      </View>
      <Text style={s.body}>{a.body}</Text>
      {a.link ? <Text style={s.link} onPress={() => Linking.openURL(a.link!)}>{a.link}</Text> : null}
      <Text style={s.date}>{new Date(a.createdAt).toLocaleString()}</Text>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,15,.65)', justifyContent: 'center', padding: 22 },
  card: { backgroundColor: C.surface, borderRadius: 22, padding: 20, gap: 10, borderWidth: 1, borderColor: C.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ico: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: C.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  body: { color: C.text, fontSize: 15, lineHeight: 22 },
  link: { color: C.accent, fontWeight: '700' },
  date: { color: C.muted, fontSize: 12 },
  btn: { backgroundColor: C.accent, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  item: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 8 },
  itemTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  badge: { color: '#fff', backgroundColor: '#f59e0b', fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.ok },
}));

/** Tombol "Unduh semua" untuk satu playlist: satu ketukan → seluruh lagu tersimpan untuk diputar offline. */
import React, { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '../lib/i18n';
import { useUi } from '../lib/ui';
import { C, fmtSize, themed } from '../lib/theme';
import { useOnline } from '../lib/net';
import { cancelBulk, downloadAll, downloadable, getBulk, pendingDownloads, subscribeBulk, subscribeOffline } from '../lib/offline';
import { errText } from '../lib/api';
import type { Track } from '../lib/types';

let offlineTick = 0;
subscribeOffline(() => { offlineTick += 1; });

export function DownloadAll({ id, label, tracks }: { id: string; label: string; tracks: Track[] }) {
  const ui = useUi();
  const online = useOnline();
  const bulk = useSyncExternalStore(subscribeBulk, getBulk);
  useSyncExternalStore(subscribeOffline, () => offlineTick); // segarkan saat lagu selesai diunduh
  const total = tracks.filter(downloadable).reduce((set, t) => set.add(t.id), new Set<string>()).size;
  const todo = pendingDownloads(tracks);
  if (!total) return null;
  const mine = bulk?.key === id ? bulk : null;
  const other = bulk?.running && !mine ? bulk : null;

  // Sedang mengunduh playlist ini
  if (mine?.running) {
    const pct = mine.total ? (mine.done + mine.failed) / mine.total : 0;
    return (
      <View style={s.box} accessibilityLiveRegion="polite">
        <View style={s.row}>
          <Ionicons name="cloud-download-outline" size={20} color={C.accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title}>{T('Mengunduh {a}/{b}', { a: Math.min(mine.done + mine.failed + 1, mine.total), b: mine.total })}</Text>
            <Text style={s.sub} numberOfLines={1}>{mine.cancelled ? T('Membatalkan…') : mine.current || ''}</Text>
          </View>
          <Pressable onPress={cancelBulk} style={s.cancel} hitSlop={6} disabled={mine.cancelled}>
            <Text style={s.cancelText}>{T('Batal')}</Text>
          </Pressable>
        </View>
        <View style={s.bar}><View style={[s.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
      </View>
    );
  }

  // Ringkasan setelah selesai
  if (mine && !mine.running) {
    const msg = mine.stopped === 'offline'
      ? T('Unduhan berhenti karena koneksi terputus ({n} lagu tersimpan). Ketuk Unduh semua lagi saat online.', { n: mine.done })
      : mine.cancelled ? T('Dibatalkan — {n} lagu sudah tersimpan.', { n: mine.done })
        : mine.failed ? T('{n} lagu tersimpan, {f} gagal (coba lagi nanti).', { n: mine.done, f: mine.failed })
          : T('Selesai — {n} lagu siap diputar offline.', { n: mine.done });
    return (
      <View style={[s.box, s.row]}>
        <Ionicons name={mine.failed || mine.stopped ? 'alert-circle-outline' : 'checkmark-circle'} size={20} color={mine.failed || mine.stopped ? C.warn : C.ok} />
        <Text style={[s.sub, { flex: 1, color: C.text }]}>{msg}</Text>
      </View>
    );
  }

  // Semua sudah tersimpan
  if (!todo.length) {
    return (
      <View style={[s.box, s.row]}>
        <Ionicons name="checkmark-circle" size={20} color={C.ok} />
        <Text style={[s.sub, { flex: 1, color: C.text }]}>{T('Semua {n} lagu tersedia offline', { n: total })}</Text>
      </View>
    );
  }

  const size = todo.reduce((sum, t) => sum + (t.size || 0), 0);
  const start = async () => {
    if (!online) { ui.toast(T('Sedang offline — lagu hanya bisa diunduh saat ada internet.'), true); return; }
    if (other) { ui.toast(T('Tunggu unduhan “{l}” selesai dulu.', { l: other.label }), true); return; }
    if (todo.length > 5 && !(await ui.confirm({
      title: T('Unduh {n} lagu?', { n: todo.length }),
      message: size ? T('Perkiraan ukuran {s}. Sebaiknya memakai Wi-Fi.', { s: fmtSize(size) }) : T('Sebaiknya memakai Wi-Fi.'),
      ok: T('Unduh semua'),
    }))) return;
    try { await downloadAll(id, label, tracks); } catch (e: any) { ui.toast(errText(e), true); }
  };
  return (
    <Pressable onPress={start} style={({ pressed }) => [s.box, s.row, s.btn, pressed && { opacity: 0.8 }, !online && { opacity: 0.55 }]}
      accessibilityRole="button" accessibilityLabel={T('Unduh semua lagu untuk offline')}>
      <Ionicons name="arrow-down-circle-outline" size={22} color={C.accent} />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{T('Unduh semua untuk offline')}</Text>
        <Text style={s.sub}>
          {todo.length < total ? T('{n} dari {t} lagu belum tersimpan', { n: todo.length, t: total }) : T('{n} lagu', { n: todo.length })}
          {size ? ` · ±${fmtSize(size)}` : ''}{!online ? ` · ${T('butuh internet')}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.muted} />
    </Pressable>
  );
}

const s = themed(() => StyleSheet.create({
  box: { alignSelf: 'stretch', borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: 12, marginTop: 10, gap: 8 },
  btn: { borderColor: C.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontWeight: '700' },
  sub: { color: C.muted, fontSize: 12.5 },
  cancel: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.border },
  cancelText: { color: C.text, fontWeight: '700' },
  bar: { height: 6, borderRadius: 3, backgroundColor: C.surface2, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: C.accent },
}));

/** Pengaturan link M3U (seperti "Buka stream jaringan" di VLC) — dipakai di menu Akun. */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { T } from '../lib/i18n';
import { useUi } from '../lib/ui';
import { C, themed } from '../lib/theme';
import { M3uLink, tvApi } from '../lib/tv';
import { Button } from './Common';

export function M3uLinks() {
  const ui = useUi();
  const [links, setLinks] = useState<M3uLink[] | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { tvApi.m3uLinks().then(setLinks).catch((e) => { setLinks([]); setErr(e.message); }); }, []);

  const add = async () => {
    if (!/^https?:\/\/\S+$/i.test(url.trim())) { setErr(T('Link harus diawali http:// atau https://')); return; }
    setBusy(true); setErr('');
    try {
      const r = await tvApi.m3uAdd(url.trim(), name.trim());
      ui.toast(T('{n}: {c} saluran ditambahkan', { n: r.link.name, c: r.link.count }));
      setUrl(''); setName('');
      setLinks(await tvApi.m3uLinks());
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async (l: M3uLink) => {
    if (!(await ui.confirm({ title: T('Hapus link?'), message: T('“{n}” akan dihapus dari akun Anda.', { n: l.name }), ok: T('Hapus'), danger: true }))) return;
    try { setLinks(await tvApi.m3uDel(l.id)); ui.toast(T('Link dihapus')); } catch (e: any) { ui.toast(e.message, true); }
  };
  const openIn = async (l: M3uLink) => {
    try {
      const cur = JSON.parse((await SecureStore.getItemAsync('sw-tv-ui')) || '{}');
      await SecureStore.setItemAsync('sw-tv-ui', JSON.stringify({ ...cur, tab: 'm3u', m3u: l.id }));
    } catch { /* abaikan */ }
    router.navigate('/tv');
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={s.muted}>{T('Tempel link daftar saluran (.m3u / .m3u8) yang Anda miliki — seperti “Buka stream jaringan” di VLC. Link disimpan di akun Anda saja; isi siaran menjadi tanggung jawab pemilik link.')}</Text>
      {links === null ? <ActivityIndicator color={C.accent} /> : links.length ? links.map((l) => (
        <View key={l.id} style={s.row}>
          <Ionicons name="tv-outline" size={20} color={C.accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{l.name}</Text>
            <Text style={s.url} numberOfLines={1}>{l.url}</Text>
          </View>
          <Pressable onPress={() => openIn(l)} style={s.open} hitSlop={6}><Text style={s.openText}>{T('Buka')}</Text></Pressable>
          <Pressable onPress={() => remove(l)} hitSlop={8} accessibilityLabel={T('Hapus {n}', { n: l.name })}><Ionicons name="trash-outline" size={20} color={C.danger} /></Pressable>
        </View>
      )) : <Text style={s.muted}>{T('Belum ada link. Link yang ditambahkan muncul sebagai tab “Link saya” di menu TV.')}</Text>}
      <TextInput value={url} onChangeText={setUrl} placeholder="https://…/playlist.m3u" placeholderTextColor={C.muted} style={s.input}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <TextInput value={name} onChangeText={setName} placeholder={T('Nama (opsional), mis. TV Kampus')} placeholderTextColor={C.muted} style={s.input} maxLength={60} />
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Button label={busy ? T('Memeriksa link…') : T('Tambahkan')} icon="add" loading={busy} disabled={!url.trim()} onPress={add} />
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  muted: { color: C.muted, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  name: { color: C.text, fontWeight: '700' },
  url: { color: C.muted, fontSize: 12 },
  open: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.border },
  openText: { color: C.accent, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15 },
  err: { color: C.danger },
}));

/** Tab Akun: profil, hubungkan Google Drive + folder, penyimpanan offline, kata sandi, keluar. */
import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { getServer, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { offlineSizeBytes, offlineTracks, removeOffline } from '../../lib/offline';
import { Button } from '../../components/Common';
import { C, fmtSize } from '../../lib/theme';
import type { User } from '../../lib/types';

export default function AccountScreen() {
  const { user, setUser, refreshUser, logout } = useAuth();
  const player = usePlayer();
  const ui = useUi();
  const [folder, setFolder] = useState(user?.drive.folderUrl || '');
  const [cur, setCur] = useState('');
  const [nxt, setNxt] = useState('');
  const [busy, setBusy] = useState('');
  const [folderErr, setFolderErr] = useState('');
  if (!user) return null;
  const d = user.drive;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { ui.toast(e.message, true); } finally { setBusy(''); }
  };

  /** OAuth Google dibuka di browser; server mengarahkan balik ke soundwave://drive?status=… */
  const connect = () => run('connect', async () => {
    const { url } = await post<{ url: string }>('/api/drive/connect', { client: 'mobile' });
    const res = await WebBrowser.openAuthSessionAsync(url, 'soundwave://drive');
    if (res.type === 'success') {
      const q = new URL(res.url).searchParams;
      if (q.get('status') === 'connected') ui.toast('Google Drive terhubung');
      else ui.toast(q.get('message') || 'Gagal menghubungkan Google Drive.', true);
    }
    await refreshUser();
  });

  const saveFolder = () => run('folder', async () => {
    setFolderErr('');
    try {
      const r = await put<{ user: User }>('/api/drive/folder', { folder });
      setUser(r.user);
      ui.toast(`Folder diatur: ${r.user.drive.folderName}`);
    } catch (e: any) { setFolderErr(e.message); }
  });

  const off = offlineTracks();

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={s.avatar}><Text style={s.avatarText}>{user.name.charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{user.name}</Text>
            <Text style={s.muted}>{user.email}</Text>
            <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={1}>Server: {getServer()}</Text>
          </View>
        </View>
      </View>

      <View style={s.card}>
        <View style={s.cardHead}><Ionicons name="logo-google" size={18} color={C.accent} /><Text style={s.h3}>Google Drive</Text></View>
        {!d.configured ? (
          <Text style={s.muted}>Integrasi Google Drive belum dikonfigurasi di server.</Text>
        ) : !d.connected ? (
          <>
            <Text style={s.muted}>Hubungkan akun Google Anda agar SoundWave bisa menyimpan hasil unduhan dan memutar lagu dari folder Drive pilihan Anda.</Text>
            <Button label="Hubungkan Google Drive" icon="cloud-outline" onPress={connect} loading={busy === 'connect'} />
          </>
        ) : (
          <>
            <Status ok text={`Terhubung sebagai ${d.googleEmail || 'akun Google'}`} />
            {d.folderId
              ? <Status ok text={`Folder: ${d.folderName}`} onPress={() => d.folderUrl && Linking.openURL(d.folderUrl)} />
              : <Status text="Folder penyimpanan belum diatur." />}
            <Text style={s.label}>Link folder Google Drive</Text>
            <TextInput style={s.input} value={folder} onChangeText={setFolder} placeholder="https://drive.google.com/drive/folders/…"
              placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} />
            <Text style={s.hint}>Tempel link folder (Bagikan → Salin link). Akun Google Anda harus punya akses edit.</Text>
            {folderErr ? <Text style={s.err}>{folderErr}</Text> : null}
            <Button label="Simpan folder" onPress={saveFolder} loading={busy === 'folder'} disabled={!folder.trim()} />
            <Button label="Buat folder “SoundWave” baru" kind="ghost" loading={busy === 'create'}
              onPress={() => run('create', async () => { const r = await post<{ user: User }>('/api/drive/folder', { name: 'SoundWave' }); setUser(r.user); setFolder(r.user.drive.folderUrl || ''); ui.toast('Folder “SoundWave” dibuat'); })} />
            <View style={{ flexDirection: 'row', gap: 20, marginTop: 4 }}>
              <Text style={s.link} onPress={connect}>Hubungkan ulang</Text>
              <Text style={[s.link, { color: C.danger }]} onPress={async () => {
                if (!(await ui.confirm({ title: 'Putuskan Google Drive?', message: 'File di Drive tidak terhapus.', ok: 'Putuskan', danger: true }))) return;
                run('dc', async () => { const r = await post<{ user: User }>('/api/drive/disconnect'); setUser(r.user); });
              }}>Putuskan</Text>
            </View>
          </>
        )}
      </View>

      <View style={s.card}>
        <View style={s.cardHead}><Ionicons name="cloud-download-outline" size={18} color={C.accent} /><Text style={s.h3}>Penyimpanan offline</Text></View>
        <Text style={s.muted}>{off.length} lagu · {fmtSize(offlineSizeBytes())}</Text>
        {off.length ? <Button label="Hapus semua unduhan offline" kind="ghost" onPress={async () => {
          if (!(await ui.confirm({ title: 'Hapus semua unduhan offline?', ok: 'Hapus', danger: true }))) return;
          off.forEach((t) => removeOffline(t.id)); ui.toast('Unduhan offline dihapus');
        }} /> : null}
      </View>

      <View style={s.card}>
        <View style={s.cardHead}><Ionicons name="mic-outline" size={18} color={C.accent} /><Text style={s.h3}>Perintah suara</Text></View>
        <Text style={s.muted}>Ketuk ikon mikrofon di kanan atas, lalu ucapkan misalnya:</Text>
        {['Putarkan lagu The Corrs', 'Putarkan lagu rock', 'Putarkan lagu dari playlist nostalgia', 'Buatkan playlist kenangan',
          'Masukkan lagu Dewa ke playlist kenangan', 'Masukkan lagu fly me to the moon ke playlist kenangan', 'Lagu berikutnya / jeda / lanjutkan']
          .map((x) => <Text key={x} style={s.example}>“{x}”</Text>)}
      </View>

      <View style={s.card}>
        <Text style={s.h3}>Ganti kata sandi</Text>
        <TextInput style={s.input} value={cur} onChangeText={setCur} secureTextEntry placeholder="Kata sandi lama" placeholderTextColor={C.muted} />
        <TextInput style={s.input} value={nxt} onChangeText={setNxt} secureTextEntry placeholder="Kata sandi baru (min. 8)" placeholderTextColor={C.muted} />
        <Button label="Ganti kata sandi" kind="ghost" loading={busy === 'pw'} disabled={!cur || nxt.length < 8}
          onPress={() => run('pw', async () => {
            await post('/api/auth/password', { current: cur, next: nxt });
            setCur(''); setNxt('');
            ui.toast('Kata sandi diganti. Silakan masuk lagi.');
            player.stop(); await logout();
          })} />
      </View>

      <Button label="Keluar" kind="ghost" icon="log-out-outline" onPress={async () => { player.stop(); await logout(); }} />
      <Text style={[s.link, { color: C.danger, textAlign: 'center', marginTop: 8 }]}
        onPress={async () => { player.stop(); await logout(true); }}>Keluar dari semua perangkat</Text>
    </ScrollView>
  );
}

function Status({ ok, text, onPress }: { ok?: boolean; text: string; onPress?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: ok ? C.ok : C.warn }} />
      <Text style={[{ color: C.text, flex: 1 }, onPress && { color: C.accent, fontWeight: '600' }]} onPress={onPress} numberOfLines={2}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 14, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h3: { color: C.text, fontSize: 17, fontWeight: '700' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 22 },
  name: { color: C.text, fontSize: 18, fontWeight: '700' },
  muted: { color: C.muted, lineHeight: 20 },
  label: { color: C.muted, fontWeight: '600', marginTop: 4 },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15 },
  hint: { color: C.muted, fontSize: 12 },
  err: { color: C.danger },
  link: { color: C.accent, fontWeight: '700' },
  example: { color: C.text, fontSize: 14, fontStyle: 'italic' },
});

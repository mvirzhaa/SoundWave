/** Tab Akun: profil, tampilan (tema & bahasa), Google Drive (2 mode), offline, perintah suara, kata sandi, keluar. */
import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { del, getServer, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { usePlayer } from '../../lib/player';
import { useUi } from '../../lib/ui';
import { useSettings, ThemeMode } from '../../lib/settings';
import { offlineSizeBytes, offlineTracks, removeOffline } from '../../lib/offline';
import { Button, Chip } from '../../components/Common';
import { Accordion } from '../../components/Accordion';
import { unregisterPush, useAnnouncements } from '../../components/Announcements';
import { C, fmtSize, themed } from '../../lib/theme';
import { T, Lang } from '../../lib/i18n';
import type { User } from '../../lib/types';

export default function AccountScreen() {
  const { user, setUser, refreshUser, logout } = useAuth();
  const player = usePlayer();
  const ui = useUi();
  const settings = useSettings();
  const ann = useAnnouncements();
  const [cur, setCur] = useState('');
  const [nxt, setNxt] = useState('');
  const [busy, setBusy] = useState('');
  if (!user) return null;
  const d = user.drive;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { ui.toast(e.message, true); } finally { setBusy(''); }
  };

  // Tema/bahasa berganti → layar dipasang ulang; kembali ke tab Akun sesudahnya
  const applySetting = async (fn: () => Promise<void>) => { await fn(); setTimeout(() => { try { router.navigate('/account'); } catch { /* abaikan */ } }, 80); };

  const off = offlineTracks();
  const driveSummary = d.ready
    ? `${d.mode === 'link' ? T('Link folder') : T('Login Google')} · ${d.folderName || ''}`
    : d.connected ? T('Terhubung · folder belum diatur') : T('Belum diatur');
  const themeLabel: Record<ThemeMode, string> = { system: T('Ikuti sistem'), dark: T('Gelap'), light: T('Terang') };

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <View style={s.profile}>
        <View style={s.avatar}><Text style={s.avatarText}>{user.name.charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{user.name}</Text>
          <Text style={s.muted}>{user.email}</Text>
          <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={1}>{T('Server')}: {getServer()}</Text>
        </View>
      </View>

      <Pressable style={s.annRow} onPress={() => router.push('/pengumuman')}>
        <View style={s.annIco}><Ionicons name="megaphone-outline" size={19} color={C.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.annTitle}>{T('Pengumuman')}</Text>
          <Text style={s.muted}>{ann.unread ? T('{n} belum dibaca', { n: ann.unread }) : T('{n} pengumuman', { n: ann.list.length })}</Text>
        </View>
        {ann.unread ? <View style={s.annBadge}><Text style={s.annBadgeText}>{ann.unread}</Text></View> : null}
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      </Pressable>

      <Accordion id="tampilan" icon="color-palette-outline" title={T('Tampilan & bahasa')}
        summary={`${themeLabel[settings.theme]} · ${settings.lang === 'en' ? 'English' : 'Bahasa Indonesia'}`}>
        <Text style={s.label}>{T('Tema')}</Text>
        <View style={s.chips}>
          {(['system', 'dark', 'light'] as ThemeMode[]).map((m) => (
            <Chip key={m} label={themeLabel[m]} active={settings.theme === m} onPress={() => applySetting(() => settings.setTheme(m))} />
          ))}
        </View>
        <Text style={s.label}>{T('Bahasa')}</Text>
        <View style={s.chips}>
          {([['id', 'Bahasa Indonesia'], ['en', 'English']] as [Lang, string][]).map(([l, label]) => (
            <Chip key={l} label={label} active={settings.lang === l} onPress={() => applySetting(() => settings.setLang(l))} />
          ))}
        </View>
        <Text style={s.hint}>{T('Perintah suara tetap memakai bahasa Indonesia.')}</Text>
      </Accordion>

      <Accordion id="drive" icon="logo-google" title="Google Drive" summary={driveSummary} defaultOpen={!d.ready}>
        <DriveModes d={d} busy={busy} run={run} setUser={setUser} refreshUser={refreshUser} ui={ui} />
      </Accordion>

      <Accordion id="offline" icon="cloud-download-outline" title={T('Penyimpanan offline')} summary={`${off.length} ${T('lagu')} · ${fmtSize(offlineSizeBytes()) || '0 KB'}`}>
        <Text style={s.muted}>{T('Lagu yang diunduh untuk offline bisa diputar tanpa internet.')}</Text>
        {off.length ? <Button label={T('Hapus semua unduhan offline')} kind="ghost" onPress={async () => {
          if (!(await ui.confirm({ title: T('Hapus semua unduhan offline?'), ok: T('Hapus'), danger: true }))) return;
          off.forEach((t) => removeOffline(t.id)); ui.toast(T('Unduhan offline dihapus'));
        }} /> : null}
      </Accordion>

      <Accordion id="suara" icon="mic-outline" title={T('Perintah suara')} summary={T('Contoh ucapan')}>
        <Text style={s.muted}>{T('Ketuk ikon mikrofon di kanan atas, lalu ucapkan misalnya:')}</Text>
        {['Putarkan lagu The Corrs', 'Putarkan lagu rock', 'Putarkan lagu dari playlist nostalgia', 'Buatkan playlist kenangan',
          'Masukkan lagu Dewa ke playlist kenangan', 'Masukkan lagu fly me to the moon ke playlist kenangan',
          'Putar surat Al-Mulk', 'Kapan maghrib', 'Lagu berikutnya / jeda / lanjutkan']
          .map((x) => <Text key={x} style={s.example}>“{x}”</Text>)}
      </Accordion>

      <Accordion id="sandi" icon="lock-closed-outline" title={T('Ganti kata sandi')} summary={T('Perangkat lain otomatis keluar')}>
        <TextInput style={s.input} value={cur} onChangeText={setCur} secureTextEntry placeholder={T('Kata sandi lama')} placeholderTextColor={C.muted} />
        <TextInput style={s.input} value={nxt} onChangeText={setNxt} secureTextEntry placeholder={T('Kata sandi baru (min. 8)')} placeholderTextColor={C.muted} />
        <Button label={T('Ganti kata sandi')} kind="ghost" loading={busy === 'pw'} disabled={!cur || nxt.length < 8}
          onPress={() => run('pw', async () => {
            await post('/api/auth/password', { current: cur, next: nxt });
            setCur(''); setNxt('');
            ui.toast(T('Kata sandi diganti. Silakan masuk lagi.'));
            player.stop(); await unregisterPush(); await logout();
          })} />
      </Accordion>

      <Button label={T('Keluar')} kind="ghost" icon="log-out-outline" onPress={async () => { player.stop(); await unregisterPush(); await logout(); }} />
      <Text style={[s.link, { color: C.danger, textAlign: 'center', marginTop: 4 }]}
        onPress={async () => { player.stop(); await unregisterPush(); await logout(true); }}>{T('Keluar dari semua perangkat')}</Text>
    </ScrollView>
  );
}

/* ---------- Google Drive: mode link folder (tanpa login) / login Google ---------- */
type DriveCtx = {
  d: User['drive'];
  busy: string;
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  setUser: (u: User) => void;
  refreshUser: () => Promise<unknown>;
  ui: ReturnType<typeof useUi>;
};

function DriveModes(ctx: DriveCtx) {
  const { d } = ctx;
  const [tab, setTab] = useState<'link' | 'oauth'>(d.mode === 'link' ? 'link' : d.mode === 'oauth' ? 'oauth' : d.linkAvailable && !d.configured ? 'link' : 'oauth');
  return (
    <>
      <View style={s.modes}>
        {([['link', T('Link folder'), T('Hanya memutar')], ['oauth', T('Login Google'), T('Putar + simpan')]] as const).map(([k, label, sub]) => (
          <Pressable key={k} style={[s.mode, tab === k && s.modeOn]} onPress={() => setTab(k)}>
            <Text style={[s.modeTitle, tab === k && { color: C.text }]}>{label}</Text>
            <Text style={s.modeSub}>{sub}</Text>
            {d.mode === k ? <View style={s.modeDot} /> : null}
          </Pressable>
        ))}
      </View>
      {tab === 'link' ? <LinkPane {...ctx} /> : <OauthPane {...ctx} />}
    </>
  );
}

function LinkPane({ d, busy, run, setUser, ui }: DriveCtx) {
  const active = d.mode === 'link';
  const [folder, setFolder] = useState(active ? d.folderUrl || '' : '');
  const [err, setErr] = useState('');
  if (!d.linkAvailable) return <Text style={s.muted}>{T('Mode link folder belum diaktifkan admin server (GOOGLE_API_KEY).')}</Text>;
  return (
    <>
      {active ? <Status ok text={`${T('Memutar dari folder')}: ${d.folderName}`} onPress={() => d.folderUrl && Linking.openURL(d.folderUrl)} /> : null}
      <Text style={s.label}>{T('Link folder Google Drive')}</Text>
      <TextInput style={s.input} value={folder} onChangeText={setFolder} placeholder="https://drive.google.com/drive/folders/…"
        placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} />
      <Text style={s.hint}>{T('1. Buka folder di Google Drive → Bagikan.\n2. Akses umum: “Siapa saja yang memiliki link”.\n3. Salin link, tempel di sini.')}</Text>
      <Text style={s.hint}>{T('Tanpa login Google. Lagu hanya bisa diputar — hasil unduhan tidak bisa disimpan ke folder ini, dan siapa pun yang punya link bisa melihat isinya.')}</Text>
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Button label={active ? T('Ganti folder') : T('Pakai folder ini')} loading={busy === 'link'} disabled={!folder.trim()}
        onPress={() => run('link', async () => {
          setErr('');
          try { const r = await put<{ user: User }>('/api/drive/link', { folder }); setUser(r.user); ui.toast(T('Folder terbaca: {f}', { f: r.user.drive.folderName || '' })); }
          catch (e: any) { setErr(e.message); }
        })} />
      {active ? <Text style={[s.link, { color: C.danger }]} onPress={() => run('unlink', async () => { const r = await del<{ user: User }>('/api/drive/link'); setUser(r.user); })}>{T('Lepas folder')}</Text> : null}
    </>
  );
}

function OauthPane({ d, busy, run, setUser, refreshUser, ui }: DriveCtx) {
  const active = d.mode === 'oauth';
  const [folder, setFolder] = useState(active ? d.folderUrl || '' : '');
  const [err, setErr] = useState('');
  /** OAuth Google dibuka di browser; server mengarahkan balik ke soundwave://drive?status=… */
  const connect = () => run('connect', async () => {
    const { url } = await post<{ url: string }>('/api/drive/connect', { client: 'mobile' });
    const res = await WebBrowser.openAuthSessionAsync(url, 'soundwave://drive');
    if (res.type === 'success') {
      const q = new URL(res.url).searchParams;
      if (q.get('status') === 'connected') ui.toast(T('Google Drive terhubung'));
      else ui.toast(q.get('message') || T('Gagal menghubungkan Google Drive.'), true);
    }
    await refreshUser();
  });
  if (!d.configured) return <Text style={s.muted}>{T('Login Google belum dikonfigurasi di server.')}</Text>;
  if (!d.connected) {
    return (
      <>
        <Text style={s.muted}>{T('Hubungkan akun Google Anda agar SoundWave bisa menyimpan hasil unduhan dan memutar lagu dari folder Drive pilihan Anda (folder boleh privat).')}</Text>
        <Button label={T('Login dengan Google')} icon="logo-google" onPress={connect} loading={busy === 'connect'} />
      </>
    );
  }
  return (
    <>
      <Status ok text={`${T('Terhubung sebagai')} ${d.googleEmail || 'Google'}`} />
      {active && d.folderId
        ? <Status ok text={`${T('Folder')}: ${d.folderName}`} onPress={() => d.folderUrl && Linking.openURL(d.folderUrl)} />
        : <Status text={d.mode === 'link' ? T('Sedang memakai mode link folder. Simpan folder di bawah untuk beralih.') : T('Folder penyimpanan belum diatur.')} />}
      <Text style={s.label}>{T('Link folder Google Drive')}</Text>
      <TextInput style={s.input} value={folder} onChangeText={setFolder} placeholder="https://drive.google.com/drive/folders/…"
        placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} />
      <Text style={s.hint}>{T('Tempel link folder (Bagikan → Salin link). Akun Google Anda harus punya akses edit.')}</Text>
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Button label={T('Simpan folder')} loading={busy === 'folder'} disabled={!folder.trim()}
        onPress={() => run('folder', async () => {
          setErr('');
          try { const r = await put<{ user: User }>('/api/drive/folder', { folder }); setUser(r.user); ui.toast(T('Folder diatur: {f}', { f: r.user.drive.folderName || '' })); }
          catch (e: any) { setErr(e.message); }
        })} />
      <Button label={T('Buat folder “SoundWave” baru')} kind="ghost" loading={busy === 'create'}
        onPress={() => run('create', async () => { const r = await post<{ user: User }>('/api/drive/folder', { name: 'SoundWave' }); setUser(r.user); ui.toast(T('Folder “SoundWave” dibuat')); })} />
      <View style={{ flexDirection: 'row', gap: 20, marginTop: 4 }}>
        <Text style={s.link} onPress={connect}>{T('Hubungkan ulang')}</Text>
        <Text style={[s.link, { color: C.danger }]} onPress={async () => {
          if (!(await ui.confirm({ title: T('Putuskan Google Drive?'), message: T('File di Drive tidak terhapus.'), ok: T('Putuskan'), danger: true }))) return;
          run('dc', async () => { const r = await post<{ user: User }>('/api/drive/disconnect'); setUser(r.user); });
        }}>{T('Putuskan')}</Text>
      </View>
    </>
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

const s = themed(() => StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 40 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 22 },
  name: { color: C.text, fontSize: 18, fontWeight: '700' },
  muted: { color: C.muted, lineHeight: 20 },
  label: { color: C.muted, fontWeight: '600', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15 },
  hint: { color: C.muted, fontSize: 12, lineHeight: 18 },
  err: { color: C.danger },
  link: { color: C.accent, fontWeight: '700' },
  example: { color: C.text, fontSize: 14, fontStyle: 'italic' },
  modes: { flexDirection: 'row', gap: 8, backgroundColor: C.surface2, padding: 4, borderRadius: 14 },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 },
  modeOn: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  modeTitle: { color: C.muted, fontWeight: '800' },
  modeSub: { color: C.muted, fontSize: 12, marginTop: 2 },
  annRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 },
  annIco: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  annTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  annBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  annBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  modeDot: { position: 'absolute', top: 8, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: C.ok },
}));

import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { getServer, loadSession } from '../lib/api';
import { Button } from '../components/Common';
import { C } from '../lib/theme';

const BARS = [18, 30, 46, 26, 58, 72, 50, 64, 36, 54, 70, 44, 28];

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [server, setServerInput] = useState(getServer());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadSession().then(() => setServerInput(getServer())); }, []);

  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      if (mode === 'login') await login(server, email.trim(), password);
      else await register(server, name.trim(), email.trim(), password);
    } catch (e: any) {
      setErr(e.message);
      if (e.status === 0) setShowServer(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          <View style={s.bars}>{BARS.map((h, i) => <View key={i} style={[s.bar, { height: h * 0.8, opacity: 0.55 + (i % 3) * 0.15 }]} />)}</View>
          <Text style={s.logo}>Sound<Text style={{ color: C.accent }}>Wave</Text></Text>
          <Text style={s.sub}>Masuk dengan akun yang sama seperti di website.</Text>

          <View style={s.seg}>
            {(['login', 'register'] as const).map((m) => (
              <Pressable key={m} onPress={() => { setMode(m); setErr(''); }} style={[s.segBtn, mode === m && s.segOn]}>
                <Text style={[s.segText, mode === m && { color: C.text }]}>{m === 'login' ? 'Masuk' : 'Daftar'}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'register' ? <Field label="Nama" value={name} onChange={setName} autoComplete="name" /> : null}
          <Field label="Email" value={email} onChange={setEmail} keyboard="email-address" autoComplete="email" />
          <Field label="Kata sandi" value={password} onChange={setPassword} secure autoComplete={mode === 'login' ? 'password' : 'new-password'} onSubmit={submit} />

          <Pressable onPress={() => setShowServer((v) => !v)} style={s.serverToggle}>
            <Ionicons name="server-outline" size={16} color={C.muted} />
            <Text style={s.serverText} numberOfLines={1}>Server: {server}</Text>
            <Ionicons name={showServer ? 'chevron-up' : 'chevron-down'} size={16} color={C.muted} />
          </Pressable>
          {showServer ? <Field label="Alamat server SoundWave" value={server} onChange={setServerInput} keyboard="url" placeholder="https://vr.ti.fts.uika-bogor.ac.id/soundwave" /> : null}

          {err ? <Text style={s.err}>{err}</Text> : null}
          <Button label={mode === 'login' ? 'Masuk' : 'Buat akun'} onPress={submit} loading={busy} style={{ marginTop: 6 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, secure, keyboard, autoComplete, placeholder, onSubmit }: {
  label: string; value: string; onChange: (v: string) => void; secure?: boolean; keyboard?: 'email-address' | 'url';
  autoComplete?: any; placeholder?: string; onSubmit?: () => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={onChange} secureTextEntry={secure} keyboardType={keyboard}
        autoCapitalize={keyboard || secure ? 'none' : 'words'} autoCorrect={false} autoComplete={autoComplete}
        placeholder={placeholder} placeholderTextColor={C.muted} onSubmitEditing={onSubmit} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, gap: 14, flexGrow: 1, justifyContent: 'center' },
  bars: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 64 },
  bar: { width: 5, borderRadius: 3, backgroundColor: C.accent2 },
  logo: { color: C.text, fontSize: 42, fontWeight: '800', textAlign: 'center', letterSpacing: -1.2 },
  sub: { color: C.muted, textAlign: 'center', marginBottom: 6 },
  seg: { flexDirection: 'row', alignSelf: 'center', backgroundColor: C.surface, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: C.border },
  segBtn: { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 999 },
  segOn: { backgroundColor: C.surface2 },
  segText: { color: C.muted, fontWeight: '700' },
  label: { color: C.muted, fontWeight: '600', fontSize: 14 },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: C.text, fontSize: 16 },
  serverToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  serverText: { color: C.muted, fontSize: 13, flex: 1 },
  err: { color: C.danger },
});

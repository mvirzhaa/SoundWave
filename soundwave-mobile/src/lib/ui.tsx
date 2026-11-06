/** Host UI global: menu aksi (bottom sheet), dialog input, konfirmasi, dan toast. */
import React, { createContext, useContext, useRef, useState } from 'react';
import { T } from './i18n';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, themed } from './theme';

export type SheetItem = { label: string; icon?: keyof typeof Ionicons.glyphMap; danger?: boolean; onPress: () => void };
type SheetOpts = { title?: string; subtitle?: string; header?: React.ReactNode; items: (SheetItem | false | null | undefined)[] };
type PromptOpts = { title: string; value?: string; placeholder?: string; ok?: string };
type ConfirmOpts = { title: string; message?: string; ok?: string; danger?: boolean };

type UiCtx = {
  sheet: (o: SheetOpts) => void;
  prompt: (o: PromptOpts) => Promise<string | null>;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  toast: (msg: string, error?: boolean) => void;
};
const Ctx = createContext<UiCtx>(null as unknown as UiCtx);
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [sheetOpts, setSheet] = useState<SheetOpts | null>(null);
  const [promptOpts, setPrompt] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [confirmOpts, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [promptVal, setPromptVal] = useState('');
  const [toastMsg, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api: UiCtx = {
    sheet: (o) => setSheet(o),
    prompt: (o) => new Promise((resolve) => { setPromptVal(o.value || ''); setPrompt({ ...o, resolve }); }),
    confirm: (o) => new Promise((resolve) => setConfirm({ ...o, resolve })),
    toast: (msg, error) => {
      setToast({ msg, error });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      Animated.timing(toastAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null));
      }, 3200);
    },
  };

  const closePrompt = (v: string | null) => { promptOpts?.resolve(v); setPrompt(null); };
  const closeConfirm = (v: boolean) => { confirmOpts?.resolve(v); setConfirm(null); };

  return (
    <Ctx.Provider value={api}>
      {children}

      {/* Menu aksi */}
      <Modal visible={!!sheetOpts} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={s.backdrop} onPress={() => setSheet(null)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={s.grabber} />
          {sheetOpts?.header}
          {sheetOpts?.title ? (
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle} numberOfLines={1}>{sheetOpts.title}</Text>
              {sheetOpts.subtitle ? <Text style={s.muted} numberOfLines={1}>{sheetOpts.subtitle}</Text> : null}
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 460 }}>
            {sheetOpts?.items.filter(Boolean).map((it, i) => {
              const item = it as SheetItem;
              return (
                <Pressable key={i} style={({ pressed }) => [s.item, pressed && { backgroundColor: C.surface2 }]}
                  onPress={() => { setSheet(null); setTimeout(item.onPress, 250); }}>
                  {item.icon ? <Ionicons name={item.icon} size={21} color={item.danger ? C.danger : C.muted} /> : null}
                  <Text style={[s.itemText, item.danger && { color: C.danger }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Dialog input */}
      <Modal visible={!!promptOpts} transparent animationType="fade" onRequestClose={() => closePrompt(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.center}>
          <View style={s.dialog}>
            <Text style={s.dialogTitle}>{promptOpts?.title}</Text>
            <TextInput style={s.input} value={promptVal} onChangeText={setPromptVal} placeholder={promptOpts?.placeholder}
              placeholderTextColor={C.muted} autoFocus maxLength={100} onSubmitEditing={() => promptVal.trim() && closePrompt(promptVal.trim())} />
            <View style={s.dialogActions}>
              <Pressable style={s.btn} onPress={() => closePrompt(null)}><Text style={s.btnText}>{T('Batal')}</Text></Pressable>
              <Pressable style={[s.btn, s.btnPrimary]} onPress={() => promptVal.trim() && closePrompt(promptVal.trim())}>
                <Text style={[s.btnText, { color: '#fff' }]}>{promptOpts?.ok || T('Simpan')}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Konfirmasi */}
      <Modal visible={!!confirmOpts} transparent animationType="fade" onRequestClose={() => closeConfirm(false)}>
        <View style={s.center}>
          <View style={s.dialog}>
            <Text style={s.dialogTitle}>{confirmOpts?.title}</Text>
            {confirmOpts?.message ? <Text style={s.muted}>{confirmOpts.message}</Text> : null}
            <View style={s.dialogActions}>
              <Pressable style={s.btn} onPress={() => closeConfirm(false)}><Text style={s.btnText}>{T('Batal')}</Text></Pressable>
              <Pressable style={[s.btn, confirmOpts?.danger ? { backgroundColor: C.danger } : s.btnPrimary]} onPress={() => closeConfirm(true)}>
                <Text style={[s.btnText, { color: '#fff' }]}>{confirmOpts?.ok || T('Ya')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {toastMsg ? (
        <Animated.View pointerEvents="none" style={[s.toast, { bottom: insets.bottom + 140, opacity: toastAnim,
          transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
        toastMsg.error && { backgroundColor: C.danger }]}>
          <Text style={s.toastText}>{toastMsg.msg}</Text>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

const s = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,15,.6)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 8, paddingTop: 8, borderWidth: 1, borderColor: C.border },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 8 },
  sheetHead: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  muted: { color: C.muted, fontSize: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12 },
  itemText: { color: C.text, fontSize: 16 },
  center: { flex: 1, backgroundColor: 'rgba(3,5,15,.6)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: C.surface, borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: C.border },
  dialogTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 16, backgroundColor: C.bg },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, backgroundColor: C.surface2 },
  btnPrimary: { backgroundColor: C.accent },
  btnText: { color: C.text, fontWeight: '700', fontSize: 15 },
  toast: { position: 'absolute', left: 20, right: 20, backgroundColor: C.text, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  toastText: { color: C.bg, fontWeight: '600', fontSize: 14, textAlign: 'center' },
}));

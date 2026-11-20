'use no memo';
/**
 * Penangan klik & pembaruan widget (berjalan sebagai "headless task" react-native-android-widget).
 * Dipanggil juga saat aplikasi belum dibuka, jadi tidak boleh bergantung pada komponen React aplikasi.
 */
import React from 'react';
import { Linking } from 'react-native';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { getWidgetControls, widgetLink, type WidgetCommand } from './bridge';
import { SoundWaveWidget } from './SoundWaveWidget';
import { readState } from './state';

const CMDS: WidgetCommand[] = ['toggle', 'next', 'prev', 'shuffle', 'play'];

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;
  if (widgetAction === 'WIDGET_DELETED') return;
  const withList = widgetInfo.widgetName === 'SoundWaveList';
  const controls = getWidgetControls();

  if (widgetAction === 'WIDGET_CLICK' && clickAction === 'CMD') {
    const cmd = clickActionData?.cmd as WidgetCommand;
    const id = typeof clickActionData?.id === 'string' ? clickActionData.id : undefined;
    if (CMDS.includes(cmd)) {
      if (controls) {
        try { controls.run(cmd, id); } catch { /* pemutar sedang dimuat ulang */ }
        return; // WidgetSync menggambar ulang begitu status pemutar berubah
      }
      // Aplikasi tidak sedang berjalan: coba buka aplikasi dengan perintah itu. Bila sistem melarang membuka
      // aplikasi dari latar belakang, widget digambar ulang sehingga ketukan berikutnya membuka aplikasi.
      try { await Linking.openURL(widgetLink(cmd, id)); } catch { /* ditangani lewat gambar ulang di bawah */ }
    }
  }

  const live = getWidgetControls();
  const s = live ? live.state() : { ...readState(), playing: false, hasQueue: false };
  renderWidget(<SoundWaveWidget s={s} warm={Boolean(live)} withList={withList} />);
}

'use no memo';
/** Menggambar ulang semua widget SoundWave yang terpasang di layar utama (Android saja). */
import React from 'react';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { getWidgetControls } from './bridge';
import { SoundWaveWidget } from './SoundWaveWidget';
import { readState } from './state';

export const WIDGET_NAMES = ['SoundWaveControl', 'SoundWaveList'] as const;

export async function updateWidgets() {
  const live = getWidgetControls();
  const s = live ? live.state() : { ...readState(), playing: false, hasQueue: false };
  for (const name of WIDGET_NAMES) {
    try {
      await requestWidgetUpdate({
        widgetName: name,
        renderWidget: () => <SoundWaveWidget s={s} warm={Boolean(live)} withList={name === 'SoundWaveList'} />,
      });
    } catch { /* widget belum dipasang / launcher sibuk */ }
  }
}

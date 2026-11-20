/**
 * Jembatan antara widget layar utama (Android) dan pemutar di dalam aplikasi.
 * - Saat aplikasi berjalan, `WidgetSync` mendaftarkan kontrol pemutar di sini → tombol widget langsung bekerja.
 * - Saat aplikasi belum berjalan, widget hanya menampilkan salinan terakhir (state.ts) dan membuka aplikasi.
 */
import type { WState } from './state';

export type WidgetCommand = 'toggle' | 'next' | 'prev' | 'shuffle' | 'play';

export type WidgetControls = {
  run: (cmd: WidgetCommand, id?: string) => void;
  state: () => WState;
};

let controls: WidgetControls | null = null;
export const setWidgetControls = (c: WidgetControls | null) => { controls = c; };
export const getWidgetControls = () => controls;

/** Alamat deep link untuk membuka aplikasi sambil menjalankan perintah (dipakai saat aplikasi belum berjalan). */
export const widgetLink = (cmd: WidgetCommand | 'search', id?: string) =>
  `soundwave://widget?cmd=${cmd}${id ? `&id=${encodeURIComponent(id)}` : ''}`;

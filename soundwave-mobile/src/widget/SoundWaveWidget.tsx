'use no memo';
/**
 * Tampilan widget layar utama. Dibangun dari komponen react-native-android-widget (bukan komponen React Native biasa):
 * tanpa hook, tanpa state — semua data datang dari `WState`.
 */
import React from 'react';
import { FlexWidget, ListWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import { widgetLink, type WidgetCommand } from './bridge';
import type { WState } from './state';

const BG = '#0b1030';
const SURFACE = '#161c44';
const TEXT = '#e8ebff';
const MUTED = '#9aa3c7';
const ACCENT = '#8b6dff';

const svg = (path: string, color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="${path}"/></svg>`;
const ICON = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
};

/** Aksi klik: saat aplikasi berjalan → perintah ke pemutar; saat belum berjalan → buka aplikasi lewat deep link. */
function act(warm: boolean, cmd: WidgetCommand, id?: string) {
  return warm
    ? { clickAction: 'CMD', clickActionData: { cmd, ...(id ? { id } : {}) } }
    : { clickAction: 'OPEN_URI', clickActionData: { uri: widgetLink(cmd, id) } };
}

function Btn({ path, color = TEXT, size = 22, box = 38, fill, label, ...click }: { path: string; color?: string; size?: number; box?: number; fill?: string; label: string; clickAction?: string; clickActionData?: Record<string, unknown> }) {
  return (
    <FlexWidget
      style={{ width: box, height: box, borderRadius: box / 2, alignItems: 'center', justifyContent: 'center', ...(fill ? { backgroundColor: fill as `#${string}` } : {}) }}
      accessibilityLabel={label}
      {...click}
    >
      <SvgWidget svg={svg(path, color)} style={{ width: size, height: size }} />
    </FlexWidget>
  );
}

function Controls({ s, warm, compact }: { s: WState; warm: boolean; compact: boolean }) {
  const playing = warm && s.playing;
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: compact ? 'wrap_content' : 'match_parent' }}>
      <Btn path={ICON.shuffle} color={warm && s.shuffle ? ACCENT : MUTED} size={20} label="Acak" {...act(warm, 'shuffle')} />
      <Btn path={ICON.prev} label="Lagu sebelumnya" {...act(warm, 'prev')} />
      <Btn path={playing ? ICON.pause : ICON.play} color="#ffffff" size={26} box={46} fill={ACCENT} label={playing ? 'Jeda' : 'Putar'} {...act(warm, 'toggle')} />
      <Btn path={ICON.next} label="Lagu berikutnya" {...act(warm, 'next')} />
      <Btn path={ICON.search} color={MUTED} size={20} label="Cari lagu" clickAction="OPEN_URI" clickActionData={{ uri: widgetLink('search') }} />
    </FlexWidget>
  );
}

function NowPlaying({ s, warm }: { s: WState; warm: boolean }) {
  const idle = !warm || !s.hasQueue;
  const title = !s.login ? 'Masuk ke SoundWave' : idle ? 'SoundWave' : s.title || 'Memutar…';
  const sub = !s.login ? 'Ketuk untuk membuka aplikasi'
    : idle ? (s.online ? `${s.total} lagu · ketuk ▶ untuk memutar` : `Offline · ${s.total} lagu terunduh`)
    : (s.artist || (s.online ? '' : 'Offline'));
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', justifyContent: 'center', paddingHorizontal: 10 }} clickAction="OPEN_APP">
      <TextWidget text={title} maxLines={1} truncate="END" style={{ color: TEXT, fontSize: 14, fontWeight: 'bold' }} />
      <TextWidget text={sub} maxLines={1} truncate="END" style={{ color: MUTED, fontSize: 11 }} />
    </FlexWidget>
  );
}

function Row({ t, s, warm }: { t: WState['tracks'][number]; s: WState; warm: boolean }) {
  return (
    <FlexWidget
      style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 46, paddingHorizontal: 8 }}
      {...act(warm, 'play', t.id)}
    >
      <FlexWidget style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center' }}>
        <SvgWidget svg={svg(ICON.note, ACCENT)} style={{ width: 16, height: 16 }} />
      </FlexWidget>
      <FlexWidget style={{ flex: 1, flexDirection: 'column', paddingLeft: 10 }}>
        <TextWidget text={t.t} maxLines={1} truncate="END" style={{ color: TEXT, fontSize: 13, fontWeight: '600' }} />
        <TextWidget text={t.a || 'Artis tidak diketahui'} maxLines={1} truncate="END" style={{ color: MUTED, fontSize: 11 }} />
      </FlexWidget>
      {t.o && s.online ? <TextWidget text="✓ offline" style={{ color: '#3ddc97', fontSize: 10 }} /> : null}
    </FlexWidget>
  );
}

export function SoundWaveWidget({ s, warm, withList }: { s: WState; warm: boolean; withList: boolean }) {
  const header = (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 56 }}>
      <NowPlaying s={s} warm={warm} />
      <Controls s={s} warm={warm} compact />
    </FlexWidget>
  );
  if (!withList) {
    return (
      <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: BG, borderRadius: 22, paddingHorizontal: 8, justifyContent: 'center' }}>
        {header}
      </FlexWidget>
    );
  }
  const empty = !s.login
    ? 'Masuk ke aplikasi SoundWave terlebih dahulu.'
    : s.tracks.length === 0
      ? (s.online ? 'Belum ada lagu di pustaka.' : 'Sedang offline dan belum ada lagu yang diunduh.')
      : '';
  return (
    <FlexWidget style={{ width: 'match_parent', height: 'match_parent', backgroundColor: BG, borderRadius: 22, padding: 8, flexDirection: 'column' }}>
      {header}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 24 }}>
        <TextWidget
          text={s.online ? `Daftar lagu · ${s.total}` : `Offline — hanya lagu yang sudah diunduh · ${s.total}`}
          maxLines={1} truncate="END" style={{ color: MUTED, fontSize: 11 }}
        />
        <TextWidget text="Cari…" clickAction="OPEN_URI" clickActionData={{ uri: widgetLink('search') }} style={{ color: ACCENT, fontSize: 12, fontWeight: 'bold' }} />
      </FlexWidget>
      {empty ? (
        <FlexWidget style={{ width: 'match_parent', flex: 1, alignItems: 'center', justifyContent: 'center' }} clickAction="OPEN_APP">
          <TextWidget text={empty} style={{ color: MUTED, fontSize: 12 }} />
        </FlexWidget>
      ) : (
        <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
          {s.tracks.map((t) => <Row key={t.id} t={t} s={s} warm={warm} />)}
        </ListWidget>
      )}
    </FlexWidget>
  );
}

/** Hook status koneksi ke server SoundWave (lihat api.ts). */
import { useSyncExternalStore } from 'react';
import { isOnline, subscribeOnline } from './api';

export const useOnline = () => useSyncExternalStore((cb) => subscribeOnline(() => cb()), isOnline);

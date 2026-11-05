export type DriveInfo = {
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  folderId: string | null;
  folderName: string | null;
  folderUrl: string | null;
};

export type User = { id: number; name: string; email: string; drive: DriveInfo };

export type Track = {
  id: string; // ID file Google Drive
  name: string;
  title: string;
  artist: string;
  mime: string;
  isVideo: boolean;
  size?: number | null;
  duration?: number | null;
  ytId?: string | null;
  cover?: string | null;
  genre?: string | null;
  favorite?: boolean;
  available?: boolean;
  itemId?: number | string; // id baris di playlist
  album?: string | null;
  // --- lagu lokal di HP ---
  local?: boolean;
  uri?: string; // file:// atau content:// di HP
  source?: string; // device | folder | import
  path?: string;
  tagGenre?: string | null;
  coverUri?: string | null; // sampul dari tag ID3
  added?: number;
};

export type PlaylistSummary = { id: number | string; name: string; count: number; covers: string[]; special?: boolean };
export type PlaylistDetail = { id: number | string; name: string; special: boolean; items: Track[] };

export type SearchResult = {
  id: string; title: string; channel: string; duration: number | null; views: number | null; thumbnail: string;
};

export type Job = {
  id: string; videoId: string; format: 'mp3' | 'mp4'; quality: number;
  status: 'queued' | 'running' | 'done' | 'error'; stage: string; progress: number;
  title: string | null; filename: string | null; size: number | null; error: string | null; driveLink: string | null;
};

export type VoiceResult = {
  heard: string;
  intent: string;
  action: 'play' | 'control' | 'playlist_created' | 'added' | 'none';
  kind?: string;
  label?: string;
  shuffle?: boolean;
  tracks?: Track[];
  command?: 'pause' | 'resume' | 'next' | 'previous';
  playlist?: { id: number; name: string };
  added?: number;
  message: string;
  code?: string;
};

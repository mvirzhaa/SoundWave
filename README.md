# SoundWave

| Folder | Isi |
|---|---|
| `soundwave/` | Server (Node.js) + website. Wajib dijalankan dulu — aplikasi mobile terhubung ke sini. |
| `soundwave-mobile/` | Aplikasi Android/iOS (Expo React Native), login dengan akun yang sama. |

Sumber musik: **Google Drive** (per pengguna), **folder lokal di komputer** (web), dan **penyimpanan HP** (mobile).

Urutan cepat:
1. `soundwave/README.md` → jalankan server, isi `GOOGLE_CLIENT_ID/SECRET`, daftar akun di web.
2. `soundwave-mobile/README.md` → isi `EXPO_PUBLIC_API_URL` dengan alamat server, buat development build.

# SoundWave Mobile (Expo / React Native)

Aplikasi Android & iOS untuk SoundWave. Masuk dengan **akun yang sama** seperti versi web — playlist, favorit,
folder Google Drive, dan riwayat putar tersinkron lewat server SoundWave.

Expo SDK 58 · Expo Router · expo-audio (antrean native, latar belakang, layar kunci) · expo-speech-recognition ·
expo-speech · expo-file-system · react-native-webview.

## Fitur

- **Masuk / Daftar** ke server SoundWave (alamat server bisa diubah di layar Masuk).
- **Cari**: saran otomatis, pratinjau YouTube, konversi MP3 (128–320 kbps) / MP4 (360p–1080p) dengan progress,
  **Unduh ke HP** (lewat menu Bagikan → simpan ke File/Musik) atau **Simpan ke Google Drive**.
- **Musik di HP** (sumber **Semua / Drive / HP** di Pustaka):
  - **Pindai semua lagu di HP** (Android, izin "Musik dan audio"; nada dering < 20 detik dilewati),
  - **Tambah folder musik** (pilih folder lewat dialog sistem, subfolder ikut dibaca),
  - **Impor file audio** (disalin ke penyimpanan aplikasi — cara yang dianjurkan di iPhone, karena lagu Apple Music
    tidak bisa diakses aplikasi lain).
  Judul, artis, album, genre, dan sampul dibaca dari tag ID3; hasil pindai di-cache agar langsung tampil saat aplikasi dibuka.
- **Pustaka** dari folder Drive: tab **Lagu / Playlist / Artis / Genre**, filter, tarik untuk muat ulang,
  tombol **acak**, ikon unduh per lagu untuk **offline**, dan **mode offline** (hanya lagu yang sudah diunduh;
  otomatis dipakai jika server tidak terjangkau).
- **Playlist**: Favorit & Terakhir Diputar otomatis, buat/ubah nama/hapus, tambah lagu, Naikkan/Turunkan,
  simpan seluruh playlist untuk offline.
- **Pemutar**: mini player di atas tab, pemutar penuh (seek, acak, ulangi semua/satu, favorit, antrean).
  Tetap berjalan di latar belakang; kontrol play/pause/next/previous di notifikasi & layar kunci.
- **Perintah suara** (ikon 🎤 di kanan atas atau di pemutar), bahasa Indonesia:
  - "putarkan lagu The Corrs" → semua lagu artis tersebut
  - "putarkan lagu rock" → semua lagu bergenre rock
  - "putarkan lagu dari playlist nostalgia" → isi playlist Nostalgia
  - "buatkan playlist kenangan" → playlist baru "Kenangan"
  - "masukkan lagu Dewa ke playlist kenangan" → semua lagu Dewa masuk playlist
  - "masukkan lagu fly me to the moon ke playlist kenangan" → satu lagu masuk playlist
  - "lagu berikutnya", "sebelumnya", "jeda", "lanjutkan"

  Perintah mencari di lagu Drive **dan** lagu di HP. Musik dijeda sementara saat mendengarkan, hasilnya dibacakan (text-to-speech), lalu lagu diputar.
- **Akun**: hubungkan Google Drive (login Google di browser), atur/buat folder, kelola penyimpanan offline,
  ganti sandi, keluar.

## Menjalankan (development)

Pengenal suara & audio latar belakang memakai modul native, jadi **tidak bisa di Expo Go** — pakai
*development build* (sekali build, setelah itu cukup `npx expo start`).

```powershell
cd soundwave-mobile
npm install
copy .env.example .env        # isi EXPO_PUBLIC_API_URL=http://IP-LAPTOP:3000

# Android (HP tersambung USB, atau emulator) — butuh Android Studio:
npx expo run:android

# atau build di cloud tanpa Android Studio / Xcode:
npx eas-cli@latest build --profile development --platform android
```

Lalu `npx expo start` dan buka aplikasi SoundWave (dev build) di HP.

Pastikan server SoundWave berjalan dan HP satu jaringan dengan laptop. Untuk Android, koneksi `http://`
ke IP lokal sudah diizinkan (`usesCleartextTraffic`); di produksi gunakan HTTPS.

## Build APK / rilis

```powershell
npx eas-cli@latest build --profile preview --platform android     # APK untuk dibagikan langsung
npx eas-cli@latest build --profile production --platform all      # Play Store / App Store
```

Ganti `EXPO_PUBLIC_API_URL` di `eas.json` dengan alamat server produksi Anda.

## Struktur

```
src/
├── app/                      # Expo Router — setiap file = layar
│   ├── _layout.tsx           # provider + proteksi login
│   ├── login.tsx
│   ├── (tabs)/index.tsx      # Cari
│   ├── (tabs)/library.tsx    # Pustaka
│   ├── (tabs)/account.tsx    # Akun
│   ├── playlist/[id].tsx     # detail playlist
│   ├── group/[kind]/[name].tsx  # artis / genre
│   ├── player.tsx            # pemutar penuh (modal)
│   ├── voice.tsx             # perintah suara (modal)
│   └── drive.tsx             # cadangan deep link soundwave://drive
├── lib/                      # api, auth, library, player (AudioPlaylist), offline, ui, theme, types
└── components/               # Cover, TrackRow, TrackMenu, MiniPlayer, Common
```

## Catatan

- Pengenal suara memakai layanan bawaan HP (Google di Android, Apple di iOS) dengan bahasa `id-ID`.
  Di Android, pastikan aplikasi Google terpasang dan paket bahasa Indonesia tersedia.
- Token streaming berlaku 12 jam; antrean yang sangat panjang sebaiknya diputar ulang dari Pustaka bila
  aplikasi dibiarkan berjalan lebih lama dari itu.
- Unduhan offline disimpan di penyimpanan aplikasi dan terhapus bila aplikasi dihapus.

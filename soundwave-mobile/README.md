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
- **Lirik karaoke** (tombol **Lirik** di pemutar penuh, atau ucapkan "tampilkan lirik"): dari LRCLIB, cadangan subtitle
  YouTube. Baris aktif disorot & digulir otomatis, ketuk baris untuk loncat, geser timing ±0,5 detik.
  Tetap berjalan di latar belakang; kontrol play/pause/next/previous di notifikasi & layar kunci.
- **Perintah suara** (ikon 🎤 di kanan atas atau di pemutar), bahasa Indonesia:
  - "putarkan lagu The Corrs" → semua lagu artis tersebut
  - "putarkan lagu rock" → semua lagu bergenre rock
  - "putarkan lagu dari playlist nostalgia" → isi playlist Nostalgia
  - "buatkan playlist kenangan" → playlist baru "Kenangan"
  - "masukkan lagu Dewa ke playlist kenangan" → semua lagu Dewa masuk playlist
  - "masukkan lagu fly me to the moon ke playlist kenangan" → satu lagu masuk playlist
  - "lagu berikutnya", "sebelumnya", "jeda", "lanjutkan"
  - "putar surat Al-Mulk", "putarkan hapalan quran", "jadwal sholat", "kapan maghrib"

  Perintah mencari di lagu Drive **dan** lagu di HP. Musik dijeda sementara saat mendengarkan, hasilnya dibacakan (text-to-speech), lalu lagu diputar.
- **Sholat** (tab baru):
  - **Lokasi real time**: tombol "📍 Lokasi HP" membaca GPS, mencocokkan ke kabupaten/kota Kemenag, dan
    diperbarui otomatis saat aplikasi dibuka atau Anda berpindah ±3 km (mis. saat mudik/perjalanan).
    Bila tidak cocok ke kota mana pun (atau di luar negeri), jadwal dihitung dari koordinat dengan zona waktu HP.
  - **Pilih manual** kabupaten/kota bila tidak ingin memakai GPS.
  - Hitung mundur, jadwal hari ini, lonceng adzan per waktu sholat, volume, jeda musik, uji suara adzan.
  - **Adzan otomatis**: saat aplikasi terbuka atau sedang memutar musik di latar belakang, adzan diputar penuh
    (musik dijeda lalu dilanjutkan). Saat aplikasi tertutup, **notifikasi terjadwal** tetap muncul tepat waktu
    (±12 hari ke depan dijadwalkan ulang setiap aplikasi dibuka); ketuk notifikasi untuk memutar adzan.
  - Jadwal & suara adzan disimpan di HP sehingga tetap berjalan offline.
- **Hapalan Quran** (Pustaka → Playlist, atau dari tab Sholat): Juz 30 + Al-Fatihah / 114 surat, pilih qari.
  Ketuk **nama Arab** surat untuk layar **Baca surat** (teks Arab, Latin, terjemahan; ketuk ayat untuk memutar dari
  ayat itu, tekan lama untuk ulang 3×). Menu ⋮ → **Ulangi / hafalan**: ulangi surat utuh, atau tiap ayat
  3/7/11/20/40×. Saat murottal diputar, pemutar langsung membuka tab **Ayat** dengan ayat aktif disorot.
- **Radio** (tab ke-2): stasiun populer Indonesia, cari nama / kota / frekuensi ("101.1"), semua negara, favorit.
  Siaran lewat internet (memakai kuota), bukan tuner FM.
- **Urutan tab**: Pustaka (layar pertama) · Radio · Cari · Sholat · Akun.
- **Akun** (akordion): Tampilan & bahasa (tema **Ikuti sistem / Gelap / Terang**, bahasa **Indonesia / English**),
  Google Drive dua mode (**Link folder** tanpa login, hanya memutar · **Login Google** untuk memutar + menyimpan),
  penyimpanan offline, contoh perintah suara, ganti sandi, keluar. Perintah suara tetap berbahasa Indonesia.
- Saat aplikasi dibuka tampil logo SoundWave (splash), bukan layar bawaan Expo.

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
│   ├── (tabs)/index.tsx      # Pustaka (layar pertama)
│   ├── (tabs)/radio.tsx      # Radio
│   ├── (tabs)/search.tsx     # Cari
│   ├── (tabs)/sholat.tsx     # Jadwal sholat, lokasi, adzan
│   ├── (tabs)/account.tsx    # Akun
│   ├── quran.tsx             # playlist Hapalan Quran
│   ├── surat/[n].tsx         # baca surat (Arab, Latin, terjemahan)
│   ├── playlist/[id].tsx     # detail playlist
│   ├── group/[kind]/[name].tsx  # artis / genre
│   ├── player.tsx            # pemutar penuh (modal)
│   ├── voice.tsx             # perintah suara (modal)
│   └── drive.tsx             # cadangan deep link soundwave://drive
├── lib/                      # api, auth, library, player (AudioPlaylist), offline, ui, theme, types,
│                             # sholat (lokasi + adzan + notifikasi), prayer (hitung jadwal offline),
│                             # radio, settings (tema & bahasa), i18n + i18n-en (kamus English)
└── components/               # Cover, TrackRow, TrackMenu, MiniPlayer, Common, Lyrics, Accordion
```

## Catatan

- Pengenal suara memakai layanan bawaan HP (Google di Android, Apple di iOS) dengan bahasa `id-ID`.
  Di Android, pastikan aplikasi Google terpasang dan paket bahasa Indonesia tersedia.
- Token streaming berlaku 12 jam; antrean yang sangat panjang sebaiknya diputar ulang dari Pustaka bila
  aplikasi dibiarkan berjalan lebih lama dari itu.
- Unduhan offline disimpan di penyimpanan aplikasi dan terhapus bila aplikasi dihapus.
- **Adzan saat aplikasi tertutup**: Android/iOS tidak mengizinkan aplikasi memutar audio panjang dari kondisi
  mati, jadi yang berbunyi adalah notifikasi. Di Android, izinkan **Alarm & pengingat** (Pengaturan → Aplikasi →
  SoundWave) dan matikan optimasi baterai agar notifikasi tidak terlambat. iOS membatasi 64 notifikasi
  terjadwal — aplikasi menjadwalkan 60 waktu sholat berikutnya.
- **Suara adzan di notifikasi** (opsional): taruh `assets/sounds/adzan.wav` (iOS maks. 30 detik), tambahkan ke
  `plugins → expo-notifications → sounds` di `app.json`, isi `EXPO_PUBLIC_ADZAN_SOUND=adzan.wav` di `.env`,
  lalu build ulang. Tanpa itu notifikasi memakai bunyi bawaan HP.
- Lokasi hanya dibaca saat aplikasi aktif (izin "saat aplikasi digunakan"); tidak ada pelacakan latar belakang.
- **Menambah terjemahan**: teks di kode ditulis `T('teks Indonesia')`; padanan bahasa Inggris ada di
  `src/lib/i18n-en.ts`. Teks yang belum ada di kamus tampil dalam bahasa Indonesia.
- Versi ini menambah modul native (`expo-splash-screen`, `expo-location`, `expo-notifications`): jalankan
  `npm install` lalu **build ulang** aplikasi (bukan sekadar reload).
- **Pengumuman & push**: pengumuman dari panel admin tampil sebagai pop-up saat aplikasi dibuka, tersimpan di
  **Akun → Pengumuman**, dan dikirim sebagai push notification bila proyek EAS sudah disiapkan
  (`npx eas-cli@latest init` + kredensial FCM v1 untuk Android; lihat README server). Tanpa itu pop-up tetap jalan.
- **Mini player di semua layar**: layar Hapalan Quran, Baca surat, playlist, artis/genre, dan Pengumuman juga punya
  mini player. Tombol **✕** menghentikan pemutaran sepenuhnya.
- **Radio**: antrean native hanya berisi stasiun yang sedang diputar, jadi berpindah stasiun terasa instan;
  tombol berikutnya/sebelumnya berpindah ke stasiun lain dalam daftar. Stasiun yang tidak bersuara dalam 20 detik
  dihentikan dengan pesan, tidak menggantung.
- **Stabilitas**: posisi lagu dipisah dari status pemutar utama (layar besar tidak digambar ulang 2×/detik),
  pembacaan status berhenti saat aplikasi di latar belakang, notifikasi adzan hanya dijadwalkan ulang bila jadwalnya
  berubah, perubahan tema sistem tidak memasang ulang layar saat aplikasi di latar belakang, sesi tetap terbuka saat
  offline (data akun terakhir disimpan), dan error tak terduga menampilkan tombol **Muat ulang**, bukan layar gelap.

- **Pemulihan pemutar & offline (v9)**: pemutar native (ExoPlayer) tidak bisa dipulihkan dari JS setelah satu lagu
  gagal dimuat, jadi aplikasi membuat pemutar **baru** setiap kali lagu dipilih dan setiap kali terjadi error.
  Lagu yang gagal dilewati otomatis (maks. 3 kali berturut-turut). Saat server tidak terjangkau (maks. 6 detik),
  antrean hanya berisi lagu di HP / yang sudah diunduh; lagu yang belum diunduh memberi pesan, bukan diam.
  Unduhan offline diperiksa (ukuran & isi) — bila yang terunduh ternyata pesan error, file dihapus dan muncul
  pesan "Gagal mengunduh". Unduhan rusak dari versi lama dibersihkan otomatis; unduh ulang lagu tersebut.
- **Ganti nama & urutan (v10)**: menu ⋮ lagu Drive → **Ganti nama…** (tulis `Artis - Judul`); daftar Lagu di
  Pustaka bisa diurutkan lewat tombol di atas daftar (Terbaru, Terlama, Judul A–Z / Z–A, Artis A–Z) dan
  pilihan diingat di HP. Hanya perubahan JS — cukup build ulang APK.
- **v11**: tekan lama lagu di Pustaka → pilih beberapa lagu → **Playlist** / **Antrean**; tombol & ketuk-dua-kali
  sisi sampul untuk mundur/maju 10 detik; saran pencarian tertutup otomatis setelah mencari; di halaman playlist,
  tahan lalu geser lagu untuk mengubah urutan (tanpa modul native tambahan); tab Playlist bisa tampil sebagai
  **Kartu** atau **Daftar** (diingat di HP).
- **v12 — TV**: tab **TV** setelah Radio (Pilihan YouTube Live resmi & saluran admin, Indonesia, Dunia, Favorit,
  Link saya), pemutar layar penuh dengan daftar pindah saluran, sumber cadangan otomatis, PiP, dan lanskap.
  **Jadwal Sholat** dipindah ke menu Akun; **Link TV (M3U)** diatur di Akun. Menambah modul native
  **expo-video** → **APK wajib di-build ulang** (`npx expo prebuild --clean` lalu build seperti biasa / EAS).
  Perbaikan: "Simpan ke Drive" untuk file besar tidak lagi gagal karena batas waktu 30 detik.
- **v13**: penanda playlist di Pustaka — lingkaran kecil berisi inisial playlist yang sudah memuat lagu itu
  (maks. 3, sisanya "+N"), diperbarui otomatis saat lagu ditambah/dihapus dari playlist. Hanya perubahan JS
  (bila APK v12 dengan expo-video sudah dipasang, cukup build ulang seperti biasa).

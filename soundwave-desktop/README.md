# SoundWave untuk Windows

Aplikasi desktop (Electron) yang membuka SoundWave dari **server Anda sendiri**, sehingga semua fitur sama persis
dengan versi web: pustaka Google Drive, playlist, cari & unduh MP3/MP4, radio, TV, Al-Quran & hafalan, jadwal
sholat, lirik, pengumuman, dan panel akun. Ditambah fitur khusus Windows:

- **Tombol media keyboard** (Play/Pause, Next, Previous) dan panel media Windows — lewat Media Session.
- **Ikon di tray**: Putar/Jeda, Sebelumnya, Berikutnya, Buka. Menutup jendela (✕) hanya menyembunyikan ke tray,
  musik tetap diputar. Pilih **Keluar** dari menu tray untuk benar-benar menutup.
- **Tombol di thumbnail taskbar** (⏮ ⏯ ⏭) saat kursor diarahkan ke ikon aplikasi.
- **Jalankan saat Windows menyala** (opsional, mulai langsung di tray) — dari menu tray.
- Satu jendela saja; ingat ukuran/posisi jendela; progres & notifikasi unduhan; layar penuh (F11); zoom (Ctrl +/−/0).
- Bila server tidak terjangkau: halaman "Server tidak terjangkau" yang mencoba tersambung lagi otomatis.

## Memakai

**Cara termudah (tanpa instal):** ekstrak `SoundWave-1.0.0-Windows-x64.zip`, jalankan `SoundWave.exe`.
Pertama kali dibuka, isi alamat server (mis. `http://192.168.1.10:3000` atau `https://musik.kampus.ac.id`),
lalu masuk dengan akun SoundWave Anda seperti di web.

**Installer / portable:** lihat "Membuat installer" di bawah.

> Server harus berjalan (lihat README server). Aplikasi desktop tidak memuat server di dalamnya; ia hanya
> klien, jadi pustaka & playlist selalu sama dengan di web dan HP.

## Pintasan keyboard / otomasi

| Aksi | Cara |
| --- | --- |
| Putar/Jeda, Berikutnya, Sebelumnya | Tombol media keyboard; atau `Ctrl+Alt+Space`, `Ctrl+Alt+→`, `Ctrl+Alt+←` saat jendela aktif; di halaman web juga `Spasi`, `Shift+→/←` |
| Kendalikan dari luar (AutoHotkey, Stream Deck, tugas terjadwal) | `SoundWave.exe --control=toggle` · `--control=next` · `--control=prev` |
| Mulai di tray tanpa membuka jendela | `SoundWave.exe --hidden` |
| Muat ulang / paksa muat ulang | `F5` / `Ctrl+Shift+R` |
| Ganti alamat server | Menu tray → *Ganti alamat server…* atau menu Berkas (tekan `Alt`) |

## Membuat installer (di Windows)

1. Pasang [Node.js](https://nodejs.org) 22 atau lebih baru.
2. Klik dua kali **`BUILD-WINDOWS.bat`** (atau jalankan `npm install` lalu `npm run dist`).
3. Hasilnya di folder `dist\`: `SoundWave-Setup-1.0.0.exe` (installer) dan `SoundWave-Portable-1.0.0.exe`.

Tanpa mesin Windows: unggah folder ini ke GitHub dan jalankan workflow **Build Windows** (`.github/workflows/windows.yml`);
hasilnya diunduh dari *Artifacts*.

**Alamat server bawaan untuk instalasi massal:** isi `defaults.json` (`{ "server": "https://musik.kampus.ac.id" }`)
sebelum membuat installer — pengguna tidak perlu mengetik alamat. Pengaturan pengguna tersimpan di
`%APPDATA%\SoundWave\config.json`.

## Keterbatasan yang perlu diketahui

- **Perintah suara** memakai layanan pengenalan suara milik browser Google yang tidak tersedia di Electron;
  gunakan perintah suara di aplikasi HP atau di Chrome/Edge.
- **Lokasi otomatis** untuk jadwal sholat juga tidak tersedia di Electron; pilih kota secara manual di
  *Jadwal Sholat*.
- **Menghubungkan Google Drive**: halaman login Google dibuka di browser bawaan Windows (demi keamanan Google).
  Setelah selesai, kembali ke SoundWave dan muat ulang (`F5`).
- Server dengan sertifikat HTTPS tidak tepercaya (self-signed) ditolak; gunakan HTTP di jaringan lokal atau
  sertifikat yang valid.
- Seperti versi web, aplikasi ini membutuhkan koneksi ke server (tidak ada mode offline). Mode offline hanya ada di
  aplikasi HP.
- Hak cipta: unduh & putar hanya konten yang Anda berhak memakainya.

## Pengembangan

```
npm install
npm start          # jalankan langsung
npm run check      # periksa sintaks
SW_DEBUG=1 npm start   # log status pemutar & perintah ke konsol
```

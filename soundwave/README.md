# SoundWave — Server & Web

Cari video YouTube, putar langsung, unduh **MP3 (128–320 kbps)** / **MP4 (360p–1080p)** ke perangkat atau
**Google Drive milik masing-masing pengguna**, lalu dengarkan pustaka Drive itu dengan **playlist**,
**favorit**, **artis/genre**, dan **perintah suara**. Server ini juga menjadi backend aplikasi mobile
(`soundwave-mobile`) — akun & data sama persis.

```
soundwave/
├── server.js                 # Express: keamanan, routing, halaman /embed untuk mobile
├── routes/
│   ├── auth.js               # daftar, masuk, keluar, ganti sandi, token media
│   ├── drive.js              # OAuth Google per pengguna, atur/buat folder
│   ├── library.js            # lagu dari Drive, streaming (Range), favorit, terakhir diputar, playlist
│   ├── voice.js              # POST /api/voice — eksekusi perintah suara
│   └── media.js              # cari YouTube, konversi, unduh, simpan ke Drive
├── lib/
│   ├── db.js                 # SQLite bawaan Node (node:sqlite)
│   ├── auth.js               # scrypt, JWT, cookie + CSRF, enkripsi token Google (AES-256-GCM)
│   ├── drive.js              # Drive REST API v3 (list, stream, upload resumable, trash)
│   ├── genre.js              # genre otomatis via iTunes Search API + manual
│   ├── voice.js              # pengurai perintah bahasa Indonesia + pencocokan fuzzy
│   ├── playlists.js, jobs.js, ytdlp.js, config.js
└── public/                   # web SPA (HTML/CSS/JS murni, ES modules)
```

## Fitur web

- **Masuk / Daftar** (email + kata sandi). Opsional: batasi ke domain email tertentu.
- **Cari**: autocomplete, tempel link YouTube, pratinjau player, konversi MP3/MP4 dengan progress,
  **Unduh ke perangkat** atau **Simpan ke Google Drive** (folder milik pengguna sendiri).
- **Pustaka** (seperti CloudBeats): sumber **Semua / Google Drive / Folder lokal**, tab **Lagu / Playlist / Artis / Genre**,
  filter, urutkan, tombol **Acak**.
  - **Folder lokal**: pilih folder musik di komputer (mis. `D:\Musik`, subfolder ikut dibaca). Judul, artis, album, genre,
    dan sampul dibaca dari tag ID3. File **tidak diunggah** ke server — diputar langsung dari komputer.
    Di Chrome/Edge folder diingat (cukup klik **Izinkan akses** saat membuka lagi); browser lain perlu memilih ulang.
  - Playlist otomatis **Terakhir Diputar** & **Favorit**, playlist buatan sendiri (buat, ubah nama, hapus,
    tambah lagu, urutkan dengan drag & drop atau Naikkan/Turunkan).
  - Menu ⋮ lagu: putar berikutnya, tambah ke antrean/playlist, favorit, lihat artis, ubah genre,
    buka di Drive, pindahkan ke Sampah Drive.
- **Pemutar**: mini player + pemutar penuh (seek, acak, ulangi semua/satu, favorit, antrean, volume),
  MP4 tampil sebagai video, kontrol media keyboard & layar kunci (Media Session API), sesi terakhir dipulihkan.
- **Lirik karaoke** di pemutar penuh (tombol **Lirik**): baris yang sedang dinyanyikan disorot & digulir otomatis,
  klik baris untuk loncat, geser timing ±0,5 detik bila lirik terlalu cepat/lambat (diingat per lagu).
- **Akun**: hubungkan Google Drive, tempel link folder (atau buat folder "SoundWave"), ganti sandi,
  keluar dari semua perangkat.
- **Perintah suara** (ikon mikrofon; Chrome/Edge/Safari) — logika sama dengan aplikasi mobile.
- **Hapalan Quran** (playlist bawaan di Pustaka → Playlist): murottal Juz 30 + Al-Fatihah atau seluruh 114 surat,
  6 pilihan qari, cari surat, dan menu ⋮ → **Hafalan per ayat** (tiap ayat diulang 1/3/5/7×).
  Tombol **Lirik** di pemutar menampilkan teks Arab, Latin, dan terjemahan Kemenag; ayat yang sedang diputar disorot.
- **Sholat** (menu baru): **pilih wilayah secara manual** dari ±500 kabupaten/kota (data resmi Kemenag RI),
  hitung mundur ke waktu berikutnya, jadwal hari ini (Imsak–Isya), lonceng adzan per waktu, volume, jeda musik
  saat adzan, uji suara, notifikasi browser. Chip "Maghrib 17.49 · 1 j 5 m lagi" tampil di bilah atas.
  Adzan diputar otomatis saat masuk waktu **selama tab SoundWave terbuka**; musik dijeda lalu dilanjutkan.
  Suara adzan bisa diganti dengan lagu/file apa pun dari pustaka (menu ⋮ → **Jadikan suara adzan**).
  Wilayah & pengaturan adzan tersimpan di akun, jadi sama di web dan HP.

## Perintah suara

Teks ucapan dikirim ke `POST /api/voice { text }`; server menafsirkan & mengeksekusi lalu membalas `message`
untuk dibacakan.

| Ucapan | Hasil |
|---|---|
| "putarkan lagu The Corrs" | memutar semua lagu artis The Corrs (toleran salah dengar: "the cors") |
| "putarkan lagu rock" / "putarkan lagu genre jazz" | memutar acak semua lagu dengan genre itu ("rock" juga cocok "Hard Rock") |
| "putarkan lagu dari playlist nostalgia" / "putar playlist nostalgia secara acak" | memutar playlist |
| "putar fly me to the moon" | memutar lagu berdasarkan judul |
| "putar lagu favorit" / "putar musik" | favorit / acak semua |
| "buatkan playlist kenangan" | membuat playlist "Kenangan" |
| "masukkan lagu Dewa ke playlist kenangan" | menambahkan **semua** lagu artis Dewa (juga "Dewa 19") |
| "masukkan lagu fly me to the moon ke playlist kenangan" | menambahkan **satu** lagu berdasarkan judul |
| "lagu berikutnya", "sebelumnya", "jeda", "lanjutkan" | kontrol pemutar |
| "tampilkan lirik" | membuka lirik lagu yang sedang diputar |

Perintah suara mencari di **Google Drive + folder lokal/HP** sekaligus (klien mengirim metadata lagu lokalnya, bukan
file-nya). Urutan pencocokan untuk "putarkan lagu X": **artis → genre → nama playlist → judul**. Jika playlist tujuan
"masukkan … ke playlist Y" belum ada, playlist dibuat otomatis.

### Lirik

`GET /api/lyrics?title=&artist=&album=&duration=&ytId=` mencari berurutan:

1. **LRCLIB** (lrclib.net, gratis tanpa API key) — dicocokkan dengan artis + judul + durasi; berlaku juga untuk lagu
   lokal (hanya metadata yang dikirim).
2. **Subtitle YouTube** (untuk lagu yang punya ID video, mis. hasil unduhan SoundWave) — subtitle unggahan pemilik
   video dalam **bahasa asli lagu** (bukan terjemahan); bila tidak ada, subtitle otomatis YouTube ditandai
   "mungkin kurang akurat".

Hasil disimpan di database; "tidak ditemukan" dicoba ulang setelah 3 hari, atau segera lewat tombol **Cari ulang**.
Matikan sumber YouTube dengan `LYRICS_YOUTUBE=false`. Perintah suara: "tampilkan lirik".
Lirik dilindungi hak cipta — tampilkan untuk pemutaran pribadi, jangan sediakan unduh/bagikan publik.

### Genre

Lagu lokal memakai tag genre di file MP3 (genre numerik ID3 seperti `(17)` otomatis jadi "Rock").
Lagu di Drive umumnya tidak punya data genre, jadi server mengisinya **otomatis bertahap** lewat iTunes Search
API (gratis, tanpa key, 1 permintaan per 3 detik) berdasarkan artis + judul, lalu menyimpannya di database.
Genre bisa diubah manual lewat menu ⋮ → **Ubah genre** (perubahan manual tidak ditimpa). Matikan pencarian
otomatis dengan `GENRE_LOOKUP=false`.

### Jadwal sholat & suara adzan

- Jadwal resmi diambil dari **API MyQuran** (data Bimas Islam Kemenag RI) per kabupaten/kota, di-cache 7 hari.
  Bila MyQuran tidak terjangkau dan koordinat HP diketahui, server menghitung sendiri (Subuh 20°, Isya 18°,
  Ashar Syafi'i, ihtiyat +2 menit — parameter yang lazim dipakai Kemenag).
- Mode **Lokasi HP** (dari aplikasi mobile) menyimpan koordinat GPS dan mencocokkannya ke kabupaten/kota Kemenag.
  Di web, memilih wilayah akan beralih ke mode manual.
- **Suara adzan bawaan** tidak disertakan (hak cipta rekaman). Letakkan file sendiri di folder `data/`:
  `adzan.mp3` (dipakai semua waktu) dan opsional `adzan-subuh.mp3` (adzan Subuh dengan *ash-shalatu khairum
  minan naum*). Atau isi `ADZAN_URL` / `ADZAN_SUBUH_URL` di `.env` agar diunduh otomatis sekali — rekaman
  berlisensi bebas tersedia mis. di Wikimedia Commons (Category:Adhan). Tanpa file itu, pengguna tetap bisa
  memilih lagu/file adzan dari pustakanya sendiri.
- Teks Al-Qur'an, terjemahan, dan audio murottal dari **equran.id** (API v2), di-cache di server.

## Menjalankan di Windows

1. Pasang Node.js **22.13+** (LTS terbaru disarankan), yt-dlp, dan ffmpeg:
   ```powershell
   winget install OpenJS.NodeJS.LTS yt-dlp.yt-dlp Gyan.FFmpeg
   ```
2. Di folder `soundwave`:
   ```powershell
   copy .env.example .env      # isi GOOGLE_CLIENT_ID/SECRET (lihat bawah)
   npm install
   npm run check
   npm start
   ```
3. Buka http://localhost:3000 → **Daftar** → menu **Akun** → **Hubungkan Google Drive** → tempel link folder.

Untuk diakses aplikasi mobile di HP saat development, jalankan server di laptop yang satu Wi-Fi dengan HP
lalu pakai IP laptop, mis. `http://192.168.1.10:3000` (izinkan port 3000 di Windows Firewall).

## Mengaktifkan Google Drive per pengguna

Setiap pengguna menghubungkan **akun Google-nya sendiri** dan memilih **foldernya sendiri**; refresh token
disimpan terenkripsi (AES-256-GCM) di database.

1. https://console.cloud.google.com → buat project → **APIs & Services → Library** → aktifkan **Google Drive API**.
2. **OAuth consent screen**
   - Jika semua pengguna memakai akun Google Workspace kampus (mis. @uika-bogor.ac.id), pilih **Internal** —
     tidak perlu verifikasi Google.
   - Jika **External**: tambahkan pengguna sebagai *Test users* (maks. 100) atau ajukan verifikasi aplikasi,
     karena scope `drive` termasuk scope terbatas (restricted). Saat masih *Testing*, refresh token kedaluwarsa
     setelah 7 hari — pengguna cukup **Hubungkan ulang**.
3. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized redirect URI: `<PUBLIC_URL>/api/drive/callback`
     (mis. `http://localhost:3000/api/drive/callback` dan `https://soundwave.domain-anda/api/drive/callback`).
4. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `PUBLIC_URL` di `.env`, lalu restart server.

Aplikasi mobile memakai OAuth client yang sama: login Google dibuka di browser, lalu server mengarahkan
kembali ke `soundwave://drive?...`.

## Docker (server Linux)

```bash
cp .env.example .env
docker build -t soundwave .
docker run -d --name soundwave --env-file .env -p 3000:3000 -v soundwave-data:/app/data --restart unless-stopped soundwave
```

Pasang di belakang Nginx dengan HTTPS dan set `PUBLIC_URL=https://…` (cookie otomatis `Secure`).
Volume `/app/data` menyimpan database & kunci — **wajib dibackup**. Perbarui yt-dlp berkala:
`docker exec -u root soundwave yt-dlp -U`.

## API ringkas

Semua endpoint (kecuali auth) butuh sesi: cookie `sw_session` (web, + header `X-SW-CSRF: 1` untuk
POST/PUT/PATCH/DELETE) atau `Authorization: Bearer <token>` (mobile). Streaming/unduh juga menerima
`?t=<mediaToken>` (berlaku 12 jam, dari `GET /api/auth/media-token`).

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | → `{ user, token, mediaToken }` |
| GET | `/api/auth/me` | profil + status Drive |
| POST | `/api/drive/connect` `{client:"web"\|"mobile"}` | → `{ url }` login Google |
| PUT / POST | `/api/drive/folder` | atur folder dari link / buat folder baru |
| GET | `/api/library/tracks` | lagu di folder Drive (+ genre, favorit) |
| GET | `/api/library/stream/:fileId` | streaming dengan dukungan Range (seek) |
| PUT | `/api/library/tracks/:fileId/genre` | ubah genre |
| GET/POST | `/api/library/playlists` | daftar (+ Favorit, Terakhir Diputar) / buat |
| GET/PATCH/DELETE | `/api/library/playlists/:id` | detail / ubah nama / hapus |
| POST · DELETE · PUT | `/api/library/playlists/:id/items` · `/items/:itemId` · `/order` | tambah · hapus · urutkan |
| PUT/DELETE | `/api/library/favorites/:fileId` | favorit |
| POST | `/api/voice` `{text}` | perintah suara |
| GET | `/api/lyrics?title=&artist=&duration=&ytId=` | lirik tersinkron (LRCLIB → subtitle YouTube) |
| GET | `/api/library/playlists/quran?qari=05&semua=0` | playlist Hapalan Quran |
| GET | `/api/quran/surat` · `/surat/:n` · `/hafalan/:n?qari=&ulang=3` | daftar surat · teks + audio · antrean per ayat |
| GET | `/api/sholat/kota?q=` · `/kota/cocok?subregion=&city=` | cari kabupaten/kota · cocokkan hasil GPS |
| GET | `/api/sholat/jadwal?tahun=&bulan=` (`&kota=` atau `&lat=&lon=&tz=`) | jadwal sebulan (default: wilayah tersimpan) |
| GET/PUT | `/api/sholat/pengaturan` | wilayah, adzan, qari (dipakai bersama web & mobile) |
| GET | `/api/sholat/adzan` · `/adzan/umum` · `/adzan/subuh` | status · file suara adzan bawaan |
| GET | `/api/search?q=` · `/api/suggest?q=` | pencarian YouTube |
| POST | `/api/convert` → GET `/api/jobs/:id` → `/file` · POST `/drive` | konversi, unduh, simpan ke Drive |

Perintah suara tambahan: "putar surat Al-Mulk", "putarkan hapalan quran", "jadwal sholat", "kapan maghrib".

## Keamanan

Kata sandi di-hash scrypt; JWT HS256 dengan `token_version` (ganti sandi / keluar semua perangkat mencabut
semua sesi); cookie httpOnly + SameSite=Lax + header CSRF; refresh token Google dienkripsi; rate limit
login/konversi; CSP ketat via Helmet; semua teks dirender dengan `textContent`; yt-dlp dipanggil tanpa shell
dengan ID tervalidasi; isolasi data antar pengguna diuji (playlist & job Drive per pengguna).

## Catatan

- Audio sumber YouTube ±128–160 kbps. MP3 320 kbps menjaga kualitas sumber, tetapi tidak membuatnya lebih jernih.
- Pustaka Google Drive membaca file audio/MP4 **langsung di folder** yang dipilih (belum termasuk subfolder);
  folder lokal membaca subfolder hingga 8 tingkat.
- Playlist boleh berisi campuran lagu Drive dan lagu lokal. Lagu lokal hanya bisa diputar di perangkat yang punya
  file-nya; di perangkat lain ditandai "tidak ada di folder lokal ini".
- Ketentuan Layanan YouTube melarang mengunduh kecuali diizinkan, dan sebagian besar musik dilindungi hak
  cipta. Gunakan untuk konten milik sendiri, berlisensi bebas, atau yang sudah diizinkan pemiliknya. Bila
  dibuka untuk publik, batasi pendaftaran (`ALLOWED_EMAIL_DOMAINS`) dan siapkan penanganan laporan hak cipta.

| Masalah | Solusi |
|---|---|
| `Sign in to confirm you're not a bot` | IP server ditandai YouTube; isi `YTDLP_COOKIES` dengan cookies.txt |
| Format terbatas / error JS runtime | `yt-dlp -U`; pastikan `YTDLP_JS_RUNTIME=node` |
| Hubungkan Drive gagal `redirect_uri_mismatch` | Redirect URI di Google Cloud harus persis `<PUBLIC_URL>/api/drive/callback` |
| "Akses Google Drive kedaluwarsa" | App OAuth masih *Testing* (token 7 hari) → Hubungkan ulang, atau publish/Internal |
| Genre kosong | Server perlu akses internet ke itunes.apple.com; atau isi manual |

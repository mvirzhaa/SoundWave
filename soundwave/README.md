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
- **Menu**: Pustaka (halaman pertama) · Radio · Cari · Sholat · Akun. Bagian di halaman Akun berupa akordion.
- **Radio**: cari stasiun atau frekuensi, stasiun populer Indonesia, favorit — lihat bagian Radio di bawah.
- **Hapalan Quran** (playlist bawaan di Pustaka → Playlist): murottal Juz 30 + Al-Fatihah atau seluruh 114 surat,
  6 pilihan qari, cari surat, dan menu ⋮ → **Ulangi / hafalan**: ulangi surat utuh, atau tiap ayat 3/7/11/20/40×
  (antrean dibatasi 2.000 ayat; surat panjang dipotong per bagian).
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

### Database lirik bersama

Lirik dicari di **database server dulu**, baru ke sumber luar bila belum ada:

1. **Database lirik SoundWave** (tabel `lyrics_db`): dipakai semua akun & semua HP. Judul dan artis dinormalisasi, jadi
   "The Corrs - Breathless (Official Video)", "Breathless [Lirik]", dan file `Breathless.mp3` dengan artis "The Corrs - Topic"
   dikenali sebagai lagu yang sama. Durasi ikut disimpan: lirik tersinkron hanya dipakai untuk versi lagu dengan
   durasi hampir sama (±8 detik), sehingga versi live/remix tidak mendapat timing yang meleset.
2. Bila belum ada → **LRCLIB**, lalu **subtitle YouTube**. Hasil yang ditemukan langsung disimpan ke database bersama.
   Subtitle *otomatis* YouTube hanya dikaitkan ke video asalnya karena akurasinya rendah.
3. "Tidak ditemukan" juga diingat 3 hari, supaya lagu yang sama tidak terus dicari ke luar oleh pengguna lain.

Di pemutar, lirik dari database diberi label **"tersimpan di server SoundWave"**. Tombol **Cari ulang** mencari lagi ke
sumber luar dan memperbarui database. Panel admin punya tab **Lirik** untuk melihat jumlah lagu tersimpan, berapa kali
lirik dipakai ulang tanpa mencari ke luar, pratinjau lirik, dan **menghapus lirik yang salah**.

### Radio

Menu **Radio** (web & HP) memakai direktori terbuka [Radio Browser](https://www.radio-browser.info):
stasiun populer Indonesia, cari nama / kota / frekuensi ("101.1", "98,7"), filter Indonesia atau semua negara,
dan favorit (tersimpan di akun). Radio Browser tidak punya kolom frekuensi, jadi frekuensi FM dibaca dari nama atau
tag stasiun. Siaran diputar lewat internet, bukan tuner FM HP.
Stream `http://` diteruskan lewat server (`/api/radio/stream/:id`) agar bisa diputar di halaman https; alamat ke
jaringan privat ditolak, dan jumlah stream serentak dibatasi `RADIO_MAX_STREAMS` (default 20).

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

## TV (menu setelah Radio)

Menu utama: **Pustaka → Radio → TV → Cari → Akun**. *Jadwal Sholat* kini dibuka dari menu **Akun**.

- **Pilihan** — siaran langsung resmi di YouTube (Kompas TV, CNN Indonesia, tvOne, Metro TV, iNews, CNBC
  Indonesia, Al Jazeera, DW, France 24, NHK, Sky News, CNA, TRT World, Euronews) + saluran yang ditambahkan admin
  (mis. TV kampus). Diatur di **/admin → TV** (ubah, sembunyikan, urutan, tombol *Cek* siaran langsung).
  Server mencari video siaran yang sedang berjalan dengan yt-dlp (maks. 2 proses sekaligus, cache 15 menit).
  Bila penyiar melarang pemutaran di luar YouTube, muncul tombol **Buka di YouTube**.
- **Indonesia / Dunia** — daftar publik [iptv-org](https://github.com/iptv-org/api) (±9.700 kanal dari ±180
  negara), bisa dicari dan disaring per negara & kategori. Kanal dewasa, kanal tutup, dan stream yang butuh header
  khusus dibuang. Daftar diunduh di latar belakang, diringkas ke `data/tv-cache.json`, diperbarui tiap 24 jam
  (atau tombol *Perbarui* di panel admin); permintaan pengguna tidak pernah menunggu unduhan ini.
- **Favorit** — tersimpan di akun (sama di web & HP).
- **Link saya** — link M3U milik pengguna (seperti *Buka stream jaringan* di VLC), diatur di **Akun → Link TV
  (M3U)**. Link diperiksa dulu (maks. 8 MB, 3.000 saluran, 20 detik; alamat jaringan privat ditolak), maks. 10 per
  akun.

Pemutaran: web memakai hls.js (disajikan dari `/vendor/hls.min.js`, Safari memakai HLS bawaan), HP memakai
expo-video. Pengaman agar tidak hang: tiap saluran punya hingga 4 sumber cadangan yang dicoba otomatis bila
15 detik tidak ada gambar; buffering > 20 detik saat menonton → sambung ulang; pindah saluran membatalkan
pemuatan sebelumnya; musik SoundWave dijeda saat TV mulai (dan sebaliknya). Di halaman **https**, browser
memblokir siaran **http** — kanal seperti itu ditandai "http" dan tetap bisa diputar di aplikasi HP.

Ketersediaan siaran bergantung pada penyiar: sebagian dibatasi wilayah (label *Geo*) atau tidak 24 jam. Hak
siar tetap milik penyiar; SoundWave hanya memutar siaran yang disediakan gratis untuk publik, siaran resmi di
YouTube, link dari admin, dan link M3U yang ditambahkan pengguna sendiri (tanggung jawab pemilik link).

## Hafalan rentang ayat & mode offline (v14)

- **Hafalan rentang ayat** (web & HP): menu ⋮ surat → *Ulangi / hafalan* → **Pilih rentang ayat** — ayat awal &
  akhir bebas, tiap ayat diulang sekali/3/7/11/20/40×, opsional rentang diulang terus. Pada ayat yang sedang
  diputar ada *Hafalan mulai dari ayat ini…*. API: `GET /api/quran/hafalan/:surat?qari=&ulang=&dari=&sampai=`.
- **Kolom cari** Pustaka, Cari, Radio, TV, dan daftar surat punya tombol ✕ untuk menghapus teks sekaligus.
- **Offline** (web): lirik, radio, dan TV memberi info bahwa fitur itu butuh internet; lirik dimuat otomatis saat
  online kembali. Aplikasi HP: lihat README aplikasi (unduh seluruh playlist, salinan playlist di HP, dll.).
- `GET /api/ping` — cek koneksi ringan (dipakai aplikasi HP untuk mendeteksi kembali online).

## Pilih banyak, urutkan playlist, maju/mundur 10 detik

- **Pilih banyak lagu**: tekan lama sebuah lagu (atau Ctrl/⌘-klik) di Pustaka → ketuk lagu lain → bar bawah:
  **Playlist** (tambahkan semua ke playlist yang dipilih / playlist baru), **Antrean**, pilih semua, batal (Esc).
- **Urutkan playlist**: tahan lagu ±0,4 detik (sentuh atau mouse) atau tarik pegangan ⠿, geser, lalu lepas.
  Cadangan tanpa seret: menu ⋮ → Naikkan / Turunkan.
- **Penanda playlist di Pustaka**: lagu yang sudah masuk playlist diberi lingkaran kecil berisi inisial playlist
  (mis. "LS" = Lagu Santai), warna tetap per playlist; maks. 3 lingkaran, sisanya "+N". Arahkan kursor (web) /
  pembaca layar untuk nama lengkap. API: `GET /api/library/playlists/membership`.
- **Tampilan playlist**: Kartu atau Daftar (tombol di kanan atas tab Playlist; diingat di perangkat).
- **Maju/mundur 10 detik**: tombol di pojok sampul pemutar layar penuh; di desktop juga tombol ← / →.
- Saran pencarian tertutup otomatis setelah pencarian dijalankan.
- **Lompat atas/bawah**: tombol ↑ / ↓ di kanan bawah daftar lagu Pustaka, isi playlist, Hapalan Quran, dan
  halaman artis/album (muncul untuk daftar ≥ 12 lagu yang perlu digulir).
- **Filter TV**: Negara & Kategori tersedia di semua tab TV kecuali "Link saya"; di Pilihan/Favorit menyaring
  daftar itu sendiri. Bila `/api/tv/meta` sempat gagal (mis. daftar sedang disiapkan), muncul tombol "Coba lagi"
  dan dicoba ulang otomatis.

## Ganti nama & urutan Pustaka

- Menu ⋮ lagu → **Ganti nama…** mengganti nama file di Google Drive (ekstensi tetap). Tulis `Artis - Judul`
  agar artis ikut terbaca; judul di favorit, terakhir diputar, dan playlist ikut diperbarui. Tidak tersedia di
  mode link folder (hanya baca). API: `PATCH /api/library/tracks/:fileId` body `{ "name": "…" }`.
- Pustaka bisa diurutkan: Terbaru, Terlama, Judul A–Z, Judul Z–A, Artis A–Z (web: menu Urutkan; HP: tombol di
  atas daftar lagu). Pilihan diingat di perangkat.
- Akhiran `[ID-YouTube]` dari unduhan lama tidak lagi ditampilkan pada judul.

## Panel superadmin (`/admin`)

Halaman login **terpisah** dari pengguna biasa: buka `<PUBLIC_URL>/admin`. Akun admin disimpan di tabel
tersendiri, sehingga akun pengguna biasa tidak bisa masuk ke panel ini, begitu pula sebaliknya.

**Membuat akun superadmin** (pilih salah satu):
- Isi `SUPERADMIN_EMAIL` dan `SUPERADMIN_PASSWORD` (min. 10 karakter) di `.env`, lalu restart server. Akun dibuat sekali
  saat start; mengubah `.env` sesudahnya tidak menimpa sandi yang sudah diganti di panel.
- Atau jalankan: `npm run admin -- admin@kampus.ac.id "kata-sandi-panjang" "Nama Admin"`. Perintah yang sama juga
  dipakai untuk **reset sandi** admin.

**Fitur panel:**
- **Ringkasan**: jumlah pengguna (aktif/nonaktif/aktif 7 hari), yang terhubung Drive, jumlah HP penerima push, status suara adzan, serta versi **yt-dlp** dengan tombol **Perbarui yt-dlp** (menjalankan `yt-dlp -U`; bila YouTube berubah, unduhan MP3/MP4 bisa gagal sampai yt-dlp diperbarui).
- **Pengguna**: cari, filter, lalu **aktifkan / nonaktifkan** akun. Akun yang dinonaktifkan langsung keluar dari web &
  aplikasi, tidak bisa masuk lagi, dan tidak menerima push. Data & playlist-nya tetap tersimpan.
- **Adzan**: unggah suara **adzan umum** dan **adzan Subuh** (MP3/M4A/OGG/WAV, maks. 20 MB), dengar pratinjau, hapus.
  Saklar **"Pakai di semua akun"** memaksa semua pengguna web & mobile memakai suara ini, sehingga pilihan lagu
  pribadi diabaikan. Aplikasi mobile mengunduh ulang suara adzan otomatis setiap kali file diganti.
- **Pengumuman**: tulis judul, isi, dan tautan opsional, tandai "penting", lalu kirim. Pengumuman tersimpan, tampil sebagai
  **pop-up** di aplikasi mobile & web saat dibuka (sekali per pengguna), bisa dibaca ulang di menu **Pengumuman**,
  dan dikirim sebagai **push notification** ke HP. Riwayat menampilkan jumlah yang sudah membaca & hasil push.
- Sesi admin: cookie `sw_admin` (8 jam, `SameSite=Strict`, path `/api/admin`), login dibatasi 10 percobaan / 15 menit.

### Push notification ke HP

Push dikirim lewat **Expo Push Service**. Supaya aplikasi mendapat token push:
1. Di folder `soundwave-mobile`: `npx eas-cli@latest init`. Perintah ini menulis `extra.eas.projectId` ke `app.json`.
2. Android: unggah kredensial **FCM v1** (file service account Firebase) lewat `npx eas-cli@latest credentials`.
   iOS: kredensial APNs dibuat otomatis oleh EAS saat build.
3. Build ulang aplikasi. Setelah pengguna mengizinkan notifikasi, token terdaftar otomatis ke server.

Tanpa langkah ini, pengumuman tetap muncul sebagai pop-up saat aplikasi dibuka, hanya push-nya yang tidak terkirim.

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

Di menu **Akun → Google Drive** pengguna memilih salah satu dari dua mode:

| Mode | Cara | Bisa | Butuh di server |
|---|---|---|---|
| **Link folder** | Tempel link folder yang dibagikan *"Siapa saja yang memiliki link"* | Memutar lagu dari folder | `GOOGLE_API_KEY` |
| **Login Google** | Login akun Google sendiri, pilih/buat folder (boleh privat) | Memutar **dan** menyimpan hasil unduhan, hapus file | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |

Mode link tidak bisa menyimpan ke Drive karena Google tidak mengizinkan penulisan tanpa akun yang login, dan isi
folder publik bisa dilihat siapa pun yang punya link-nya. Kedua mode boleh diaktifkan bersamaan.

### Mode link folder (API key)

1. https://console.cloud.google.com → project → **APIs & Services → Library** → aktifkan **Google Drive API**.
2. **Credentials → Create credentials → API key**. Batasi key: *API restrictions* → hanya **Google Drive API**
   (dan bila server punya IP tetap, *Application restrictions* → IP address).
3. Isi `GOOGLE_API_KEY=` di `.env`, restart server.

### Mode login Google (OAuth)

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
| PUT / DELETE | `/api/drive/link` `{folder}` | mode link folder (tanpa login Google, hanya baca) |
| GET · POST | `/api/pengumuman` · `/api/pengumuman/dibaca` `{ids}` | pengumuman pengguna · tandai dibaca |
| POST / DELETE | `/api/pengumuman/push-token` `{token, platform}` | daftarkan / lepas token push HP |
| * | `/api/admin/...` | panel superadmin (login, stats, users, adzan, lirik, pengumuman) — cookie admin terpisah |
| GET | `/api/radio?q=101.1&negara=ID` | cari stasiun (q kosong = populer; negara kosong = semua) |
| GET · PUT · DELETE | `/api/radio/favorit` · `/favorit/:uuid` | favorit radio |
| GET | `/api/radio/stream/:uuid` | proxy stream http (media token boleh) |
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
| Menu TV: "Daftar TV sedang disiapkan" | Unduhan pertama daftar iptv-org (±18 MB) belum selesai; tunggu ±1 menit. Server perlu akses ke iptv-org.github.io atau raw.githubusercontent.com |
| Saluran YouTube di tab Pilihan "tidak siaran" | Kanal sedang tidak live, atau handle berubah — perbaiki di /admin → TV lalu tekan *Cek* |
| Unduhan gagal: `… is not defined`, `Requested format is not available`, error JS runtime | YouTube mengubah sistemnya → perbarui yt-dlp: panel admin → Ringkasan → **Perbarui yt-dlp** (versi .exe/binary), atau `pip install -U "yt-dlp[default]"`. Server otomatis mencoba sekali lagi dengan `YTDLP_FALLBACK_EXTRACTOR_ARGS`. Bila tetap gagal dengan Node, pasang Deno lalu `YTDLP_JS_RUNTIME=deno` |
| Hubungkan Drive gagal `redirect_uri_mismatch` | Redirect URI di Google Cloud harus persis `<PUBLIC_URL>/api/drive/callback` |
| "Akses Google Drive kedaluwarsa" | App OAuth masih *Testing* (token 7 hari) → Hubungkan ulang, atau publish/Internal |
| Genre kosong | Server perlu akses internet ke itunes.apple.com; atau isi manual |

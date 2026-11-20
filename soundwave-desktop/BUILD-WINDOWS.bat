@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Unduh versi LTS dari https://nodejs.org lalu jalankan file ini lagi.
  pause
  exit /b 1
)
echo === Memasang komponen ===
call npm install
if errorlevel 1 goto err
echo === Membuat installer Windows ===
call npm run dist
if errorlevel 1 goto err
echo.
echo Selesai. Installer dan versi portable ada di folder "dist".
explorer dist
pause
exit /b 0
:err
echo.
echo Gagal. Periksa pesan di atas (butuh koneksi internet untuk mengunduh Electron).
pause
exit /b 1

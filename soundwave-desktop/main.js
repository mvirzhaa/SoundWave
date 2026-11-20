'use strict';
/**
 * SoundWave untuk Windows (Electron).
 * Membuka aplikasi web SoundWave dari server Anda sehingga semua fitur sama persis dengan versi web
 * (pustaka Drive, playlist, radio, TV, Quran, unduhan MP3/MP4, jadwal sholat, dll), ditambah:
 *  - tombol media keyboard (lewat Media Session — juga tampil di panel media Windows),
 *  - ikon di tray + menu kontrol, tutup jendela = tetap memutar di latar belakang,
 *  - tombol Sebelumnya / Putar-Jeda / Berikutnya di thumbnail taskbar,
 *  - jalankan saat Windows menyala (opsional), satu jendela saja (instance tunggal).
 */
const { app, BrowserWindow, Menu, Tray, shell, ipcMain, nativeImage, session, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const asset = (f) => path.join(ROOT, 'assets', f);
const page = (f) => path.join(ROOT, 'src', f);
const START_HIDDEN = process.argv.includes('--hidden');

// Samarkan "Electron/x" dari User-Agent: situs (mis. login Google) memperlakukannya seperti Chrome biasa
app.userAgentFallback = app.userAgentFallback.replace(/\s*(Electron|soundwave-desktop|SoundWave)\/\S+/gi, '');

/* ---------------- Pengaturan ---------------- */
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
let cfg = { server: '', tray: true, bounds: null, maximized: false, hintShown: false };
function loadCfg() {
  let defaults = {};
  try { defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'defaults.json'), 'utf8')); } catch { /* tanpa default */ }
  try { cfg = { ...cfg, ...defaults, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch { cfg = { ...cfg, ...defaults }; }
}
function saveCfg(patch = {}) {
  cfg = { ...cfg, ...patch };
  try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch { /* abaikan */ }
}

/** "192.168.1.10:3000" / "https://musik.kampus.ac.id/x" → origin tanpa garis miring di akhir; null bila tidak valid. */
function normalizeServer(input) {
  let v = String(input || '').trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch { return null; }
}

async function checkServer(origin) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${origin}/api/ping`, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    return r.ok ? { ok: true } : { ok: false, error: `Server menjawab dengan kode ${r.status}. Pastikan alamatnya benar dan itu server SoundWave.` };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'Server tidak menjawab (batas waktu 8 detik).' : 'Tidak dapat terhubung ke server. Periksa alamat dan koneksi internet/jaringan.' };
  }
}

/* ---------------- Jendela ---------------- */
let win = null;
let tray = null;
let quitting = false;
let status = { has: false, playing: false, title: '', artist: '' };

const isInternal = (url) => {
  try {
    if (url.startsWith('file://')) return true;
    return cfg.server && new URL(url).origin === cfg.server;
  } catch { return false; }
};
const safeExternal = (url) => { try { const p = new URL(url).protocol; if (p === 'http:' || p === 'https:' || p === 'mailto:') shell.openExternal(url); } catch { /* abaikan */ } };

function showSetup(message) {
  if (!win) return;
  win.loadFile(page('setup.html'), { query: { server: cfg.server || '', msg: message || '' } });
}
function showOffline() {
  if (!win) return;
  win.loadFile(page('offline.html'), { query: { server: cfg.server } });
}
async function openApp() {
  if (!win) return;
  if (!cfg.server) return showSetup();
  const r = await checkServer(cfg.server);
  if (!win) return;
  if (r.ok) win.loadURL(cfg.server);
  else showOffline();
}

function createWindow() {
  const b = cfg.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1180, height: b.height || 780, x: b.x, y: b.y, minWidth: 420, minHeight: 600,
    show: false, backgroundColor: '#070b1d', title: 'SoundWave', icon: asset('icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });

  let saveTimer = null;
  const persistBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) saveCfg({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }); }, 600);
  };
  win.on('resize', persistBounds); win.on('move', persistBounds);

  win.on('close', (e) => {
    if (!quitting && cfg.tray && tray) {
      e.preventDefault();
      win.hide();
      if (!cfg.hintShown) {
        saveCfg({ hintShown: true });
        if (Notification.isSupported()) new Notification({ title: 'SoundWave tetap berjalan', body: 'Musik tetap diputar di latar belakang. Klik ikon di tray untuk membuka kembali, atau pilih Keluar dari menunya.' }).show();
      }
    }
  });
  win.on('closed', () => { win = null; });
  win.on('show', () => { applyThumbar(true); });

  // Tautan keluar (http/https) dibuka di browser bawaan; halaman server sendiri tetap di jendela ini
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: asset('icon.png') } };
    safeExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!isInternal(url)) { e.preventDefault(); safeExternal(url); } });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* dibatalkan */ || url.startsWith('file://')) return;
    showOffline();
  });
  win.webContents.on('did-finish-load', () => applyThumbar(true));

  // Menu klik-kanan: salin / tempel di kolom teks
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    if (p.isEditable) items.push({ role: 'cut', label: 'Potong' }, { role: 'copy', label: 'Salin' }, { role: 'paste', label: 'Tempel' }, { type: 'separator' }, { role: 'selectAll', label: 'Pilih semua' });
    else if (p.selectionText) items.push({ role: 'copy', label: 'Salin' });
    if (p.linkURL && /^https?:/i.test(p.linkURL)) items.push({ type: 'separator' }, { label: 'Buka tautan di browser', click: () => safeExternal(p.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  openApp();
}

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

/* ---------------- Kontrol pemutar (menjalankan tombol yang sama seperti di halaman web) ---------------- */
function control(act) {
  if (process.env.SW_DEBUG) console.log('[control]', act);
  if (!win || win.isDestroyed() || !cfg.server) return;
  if (!/^(prev|toggle|next)$/.test(act)) return;
  win.webContents.executeJavaScript(`document.querySelector('.mini-ctl [data-act="${act}"]')?.click()`).catch(() => {});
}

const STATUS_JS = `(() => {
  const m = document.getElementById('media'), t = document.getElementById('miniTitle'), a = document.getElementById('miniArtist'), mini = document.getElementById('mini');
  return { has: Boolean(mini && !mini.hidden && t && t.textContent), playing: Boolean(m && !m.paused && !m.ended), title: t ? t.textContent : '', artist: a ? a.textContent : '' };
})()`;

async function pollStatus() {
  if (!win || win.isDestroyed()) return;
  let s = { has: false, playing: false, title: '', artist: '' };
  try {
    if (cfg.server && win.webContents.getURL().startsWith(cfg.server)) s = await win.webContents.executeJavaScript(STATUS_JS);
  } catch { /* halaman sedang dimuat */ }
  const changed = s.playing !== status.playing || s.title !== status.title || s.artist !== status.artist || s.has !== status.has;
  status = s;
  if (changed) { if (process.env.SW_DEBUG) console.log('[status]', JSON.stringify(s)); refreshTray(); applyThumbar(false); }
}

let thumbPlaying = null;
function applyThumbar(force) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  if (!force && thumbPlaying === status.playing) return;
  thumbPlaying = status.playing;
  const img = (n) => nativeImage.createFromPath(asset(`tb-${n}.png`));
  try {
    win.setThumbarButtons([
      { tooltip: 'Sebelumnya', icon: img('prev'), click: () => control('prev') },
      { tooltip: status.playing ? 'Jeda' : 'Putar', icon: img(status.playing ? 'pause' : 'play'), click: () => control('toggle') },
      { tooltip: 'Berikutnya', icon: img('next'), click: () => control('next') },
    ]);
  } catch { /* taskbar belum siap */ }
}

/* ---------------- Tray ---------------- */
function refreshTray() {
  if (!tray) return;
  const now = status.has ? `${status.title}${status.artist ? ' — ' + status.artist : ''}` : 'Tidak ada lagu yang diputar';
  tray.setToolTip(`SoundWave${status.has ? ' · ' + (status.playing ? 'Memutar' : 'Dijeda') : ''}\n${now}`.slice(0, 127));
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: now.length > 60 ? now.slice(0, 57) + '…' : now, enabled: false },
    { type: 'separator' },
    { label: status.playing ? 'Jeda' : 'Putar', click: () => control('toggle') },
    { label: 'Sebelumnya', click: () => control('prev') },
    { label: 'Berikutnya', click: () => control('next') },
    { type: 'separator' },
    { label: 'Buka SoundWave', click: showWindow },
    { type: 'separator' },
    { label: 'Jalankan saat Windows menyala', type: 'checkbox', checked: openAtLogin, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }); refreshTray(); } },
    { label: 'Tetap berjalan di tray saat jendela ditutup', type: 'checkbox', checked: cfg.tray, click: (i) => { saveCfg({ tray: i.checked }); refreshTray(); } },
    { label: 'Ganti alamat server…', click: () => { showWindow(); showSetup(); } },
    { type: 'separator' },
    { label: 'Keluar', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  const icon = nativeImage.createFromPath(asset('tray.png'));
  tray = new Tray(icon);
  tray.on('click', () => { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWindow(); });
  tray.on('double-click', showWindow);
  refreshTray();
}

/* ---------------- Menu aplikasi (Alt menampilkan) ---------------- */
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Berkas', submenu: [
      { label: 'Ganti alamat server…', click: () => showSetup() },
      { type: 'separator' },
      { label: 'Keluar', accelerator: 'Ctrl+Q', click: () => { quitting = true; app.quit(); } },
    ] },
    { label: 'Pemutar', submenu: [
      { label: 'Putar / Jeda', accelerator: 'Ctrl+Alt+Space', click: () => control('toggle') },
      { label: 'Lagu berikutnya', accelerator: 'Ctrl+Alt+Right', click: () => control('next') },
      { label: 'Lagu sebelumnya', accelerator: 'Ctrl+Alt+Left', click: () => control('prev') },
    ] },
    { label: 'Tampilan', submenu: [
      { label: 'Muat ulang', accelerator: 'F5', click: () => openApp() },
      { label: 'Muat ulang (kosongkan cache)', accelerator: 'Ctrl+Shift+R', click: () => { win && win.webContents.session.clearCache().then(() => openApp()); } },
      { type: 'separator' },
      { role: 'zoomIn', label: 'Perbesar', accelerator: 'Ctrl+=' },
      { role: 'zoomOut', label: 'Perkecil', accelerator: 'Ctrl+-' },
      { role: 'resetZoom', label: 'Ukuran asli', accelerator: 'Ctrl+0' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Layar penuh', accelerator: 'F11' },
      { role: 'toggleDevTools', label: 'Alat pengembang', accelerator: 'Ctrl+Shift+I' },
    ] },
    { label: 'Bantuan', submenu: [
      { label: 'Tentang SoundWave', click: () => dialog.showMessageBox(win || undefined, { type: 'info', title: 'Tentang SoundWave', message: `SoundWave untuk Windows ${app.getVersion()}`, detail: `Server: ${cfg.server || '(belum diatur)'}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}`, buttons: ['Tutup'] }) },
    ] },
  ]));
}

/* ---------------- Unduhan, izin, IPC ---------------- */
function setupSession() {
  const ses = session.defaultSession;
  ses.on('will-download', (_e, item) => {
    const name = item.getFilename();
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), name), title: 'Simpan unduhan' });
    item.on('updated', () => { const t = item.getTotalBytes(); if (win && !win.isDestroyed() && t > 0) win.setProgressBar(item.getReceivedBytes() / t); });
    item.once('done', (_ev, state) => {
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
      if (state === 'completed' && Notification.isSupported()) {
        const n = new Notification({ title: 'Unduhan selesai', body: name });
        n.on('click', () => shell.showItemInFolder(item.getSavePath()));
        n.show();
      }
    });
  });
  // Izin hanya untuk server SoundWave sendiri (mikrofon perintah suara, notifikasi, lokasi untuk jadwal sholat, layar penuh)
  const allowed = new Set(['media', 'notifications', 'geolocation', 'fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(allowed.has(permission) && isInternal(details.requestingUrl || '')));
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && isInternal(origin || ''));
}

const fromLocalPage = (e) => { try { return String(e.senderFrame.url).startsWith('file://'); } catch { return false; } };
function setupIpc() {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), server: cfg.server, platform: process.platform }));
  ipcMain.handle('server:save', async (e, url) => {
    if (!fromLocalPage(e)) return { ok: false, error: 'Tidak diizinkan.' };
    const origin = normalizeServer(url);
    if (!origin) return { ok: false, error: 'Alamat tidak valid. Contoh: http://192.168.1.10:3000 atau https://musik.kampus.ac.id' };
    const r = await checkServer(origin);
    if (!r.ok) return r;
    saveCfg({ server: origin });
    setImmediate(() => { if (win) win.loadURL(origin); });
    return { ok: true };
  });
  ipcMain.handle('server:retry', async (e) => {
    if (!fromLocalPage(e) || !cfg.server) return false;
    const r = await checkServer(cfg.server);
    if (r.ok && win) setImmediate(() => win && win.loadURL(cfg.server));
    return r.ok;
  });
  ipcMain.handle('server:change', (e) => { if (fromLocalPage(e)) showSetup(); });
}

/* ---------------- Siklus hidup ---------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // "SoundWave.exe --control=toggle|next|prev" mengendalikan pemutar yang sedang berjalan (untuk pintasan/AutoHotkey/Stream Deck)
  app.on('second-instance', (_e, argv) => {
    const c = argv.find((a) => a.startsWith('--control='));
    if (c) control(c.slice('--control='.length)); else showWindow();
  });
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('id.ac.uika.soundwave.desktop');
    loadCfg();
    setupSession();
    setupIpc();
    buildMenu();
    createTray();
    createWindow();
    setInterval(pollStatus, 2000);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('activate', showWindow);
  app.on('window-all-closed', () => { if (quitting || !cfg.tray) app.quit(); });
}

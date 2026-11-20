'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Dipakai halaman bawaan aplikasi (setup/offline). Perintah yang mengubah pengaturan hanya diterima dari file lokal.
contextBridge.exposeInMainWorld('soundwaveDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('app:info'),
  saveServer: (url) => ipcRenderer.invoke('server:save', url),
  retry: () => ipcRenderer.invoke('server:retry'),
  changeServer: () => ipcRenderer.invoke('server:change'),
});

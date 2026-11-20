'use strict';
const q = new URLSearchParams(location.search);
const input = document.getElementById('server');
const err = document.getElementById('err');
const go = document.getElementById('go');
const back = document.getElementById('back');
input.value = q.get('server') || '';
err.textContent = q.get('msg') || '';
if (q.get('server')) { back.hidden = false; back.addEventListener('click', () => window.soundwaveDesktop.retry().then((ok) => { if (!ok) err.textContent = 'Server belum dapat dihubungi.'; })); }

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!input.value.trim()) { err.textContent = 'Isi alamat server terlebih dahulu.'; input.focus(); return; }
  err.textContent = '';
  go.disabled = true;
  go.innerHTML = '<span class="spin"></span>Menghubungkan…';
  const r = await window.soundwaveDesktop.saveServer(input.value);
  if (!r.ok) { err.textContent = r.error || 'Gagal terhubung.'; go.disabled = false; go.textContent = 'Hubungkan'; input.focus(); }
});

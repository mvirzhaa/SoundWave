'use strict';
const q = new URLSearchParams(location.search);
document.getElementById('srv').textContent = q.get('server') || '';
const st = document.getElementById('st');
const btn = document.getElementById('retry');
let busy = false;

async function retry(auto) {
  if (busy) return;
  busy = true; btn.disabled = true;
  st.innerHTML = '<span class="spin"></span>Menghubungkan…';
  const ok = await window.soundwaveDesktop.retry();
  busy = false; btn.disabled = false;
  if (!ok) st.textContent = auto ? 'Belum terhubung. Mencoba lagi otomatis…' : 'Masih belum terhubung.';
}
btn.addEventListener('click', () => retry(false));
document.getElementById('change').addEventListener('click', () => window.soundwaveDesktop.changeServer());
setInterval(() => retry(true), 8000);
retry(true);

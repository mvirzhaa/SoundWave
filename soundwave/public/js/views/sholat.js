/** Halaman Sholat: wilayah (pilih manual), jadwal hari ini, hitung mundur, pengaturan adzan. */
import { h, icon, toast, openOverlay, debounce } from '../ui.js';
import { get } from '../api.js';
import { on } from '../store.js';
import { sholat, WAKTU, WAJIB, namaWaktu, fmtJam, hariIni, savePrefs, playAdzan, stopAdzan, todayIn } from '../sholat.js';

export function renderSholat(view) {
  const page = h('section.page.sholat');
  view.append(page);

  const draw = () => {
    page.textContent = '';
    const p = sholat.prefs?.sholat;
    const j = sholat.jadwal;
    page.append(h('h2', { text: 'Jadwal Sholat' }));

    /* Wilayah */
    const lokasi = j?.lokasi || p?.kota?.lokasi || '';
    page.append(h('div.panel-card.region', {},
      h('div.region-info', {},
        icon('M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
        h('div', {},
          h('b', { text: lokasi ? titleCase(lokasi) : 'Wilayah belum diatur' }),
          h('small', { text: j ? `${titleCase(j.daerah || '')}${j.daerah ? ' · ' : ''}${j.zona} · ${j.sumber === 'kemenag' ? 'Jadwal resmi Kemenag RI' : 'Dihitung dari koordinat (parameter Kemenag)'}`
            : p?.mode === 'auto' ? 'Mengikuti lokasi HP (aplikasi mobile)' : 'Pilih kabupaten/kota untuk menampilkan jadwal' }))),
      h('button.btn-primary', { type: 'button', text: lokasi ? 'Ganti wilayah' : 'Pilih wilayah', onclick: pickRegion }),
      p?.mode === 'auto' ? h('p.hint', { text: 'Wilayah sedang mengikuti lokasi HP dari aplikasi mobile. Memilih wilayah di sini akan beralih ke mode manual.' }) : null));

    if (sholat.error) page.append(h('p.state.err', { text: sholat.error }));
    if (!j) return;

    /* Hitung mundur */
    const n = sholat.next;
    const cd = h('div.countdown');
    if (n) {
      const tickCd = () => {
        const s = Math.max(0, Math.floor((n.at - Date.now()) / 1000));
        cd.textContent = '';
        cd.append(h('small', { text: 'Menuju' }), h('b', { text: namaWaktu[n.key] }),
          h('span.cd-time', { text: `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }),
          h('small', { text: `pukul ${fmtJam(n.jam)} ${j.zona}` }));
      };
      tickCd();
      const iv = setInterval(() => (cd.isConnected ? tickCd() : clearInterval(iv)), 1000);
    }

    /* Tabel hari ini */
    const d = hariIni();
    const adz = p?.adzan || {};
    const table = h('div.jadwal');
    if (d) {
      WAKTU.forEach(([k, label]) => {
        const wajib = WAJIB.includes(k);
        const on = wajib && adz.aktif && adz.waktu?.[k];
        table.append(h(`div.jrow${n?.key === k && n.date === d.date ? '.next' : ''}${wajib ? '' : '.sunnah'}`, {},
          h('span', { text: label }),
          h('b', { text: fmtJam(d[k]) }),
          wajib ? h('button.icon-btn.sm.bell', {
            type: 'button', 'aria-pressed': String(Boolean(on)), title: on ? 'Adzan aktif' : 'Adzan mati',
            'aria-label': `Adzan ${label}`,
            onclick: () => savePrefs({ sholat: { adzan: { waktu: { [k]: !adz.waktu?.[k] } } } }).catch((e) => toast(e.message, { type: 'error' })),
          }, icon(on ? 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0' : 'M6 8a6 6 0 0 1 9.3-5M18 8c0 7 3 9 3 9H9M10.3 21a1.9 1.9 0 0 0 3.4 0M2 2l20 20')) : h('span'),
        ));
      });
    }
    page.append(h('div.sholat-grid', {}, n ? h('div.panel-card', {}, cd) : null,
      h('div.panel-card', {}, h('h3', { text: `Hari ini · ${formatTanggal(todayIn(j.tz))}` }), table)));

    /* Pengaturan adzan */
    const suara = adz.suara?.jenis === 'lagu' ? `Lagu dari pustaka: ${adz.suara.title || adz.suara.id}` : 'Suara adzan bawaan server';
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: adz.volume ?? 0.9, 'aria-label': 'Volume adzan' });
    vol.addEventListener('change', () => savePrefs({ sholat: { adzan: { volume: Number(vol.value) } } }));
    page.append(h('div.panel-card', {},
      h('h3', { text: 'Adzan' }),
      toggleRow('Putar adzan saat masuk waktu sholat', adz.aktif, (v) => savePrefs({ sholat: { adzan: { aktif: v } } })),
      toggleRow('Jeda musik saat adzan, lanjutkan sesudahnya', adz.jedaMusik !== false, (v) => savePrefs({ sholat: { adzan: { jedaMusik: v } } })),
      h('label.vol-row', {}, h('span', { text: 'Volume' }), vol),
      h('div.status-line', {}, h('span.dot.ok'), h('span', { text: suara })),
      h('p.hint', { text: 'Ganti suara adzan: buka menu ⋮ pada lagu/file adzan di Pustaka → "Jadikan suara adzan".' }),
      h('div.btn-row', {},
        h('button.btn', { type: 'button', onclick: () => (sholat.playing ? stopAdzan() : playAdzan('dzuhur', { test: true })) }, icon('M8 5v14l11-7z'), 'Uji suara adzan'),
        adz.suara?.jenis === 'lagu' ? h('button.link', { type: 'button', text: 'Kembali ke suara bawaan', onclick: () => savePrefs({ sholat: { adzan: { suara: { jenis: 'bawaan' } } } }) }) : null,
        'Notification' in window && Notification.permission !== 'granted' ? h('button.link', {
          type: 'button', text: 'Aktifkan notifikasi browser',
          onclick: () => Notification.requestPermission().then((r) => { toast(r === 'granted' ? 'Notifikasi aktif' : 'Notifikasi ditolak browser'); draw(); }),
        }) : null),
      h('p.hint', { text: 'Di web, adzan berbunyi selama tab SoundWave terbuka. Untuk adzan saat aplikasi tertutup, gunakan aplikasi mobile.' })));
  };

  draw();
  // Setelah masuk waktu, penjadwal pindah ke waktu berikutnya → gambar ulang hitung mundur & sorotan
  let drawnAt = sholat.next?.at;
  const redraw = () => { drawnAt = sholat.next?.at; draw(); };
  const offs = [on('sholat', redraw), on('sholat:tick', () => { if (sholat.next?.at !== drawnAt) redraw(); })];
  return () => offs.forEach((f) => f());
}

function toggleRow(label, value, onChange) {
  const input = h('input', { type: 'checkbox', checked: Boolean(value) });
  input.addEventListener('change', () => onChange(input.checked).catch?.((e) => toast(e.message, { type: 'error' })));
  return h('label.toggle-row', {}, h('span', { text: label }), h('span.switch', {}, input, h('i')));
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Kab\./, 'Kab.');
function formatTanggal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Dialog pencarian kabupaten/kota (data Kemenag via MyQuran). */
function pickRegion() {
  const input = h('input', { type: 'search', placeholder: 'Ketik nama kota/kabupaten, mis. Bogor', 'aria-label': 'Cari wilayah' });
  const list = h('div.menu-list.region-list');
  const status = h('p.hint', { text: 'Daftar wilayah resmi Kemenag RI (±500 kabupaten/kota).' });
  const search = debounce(async () => {
    try {
      const { kota } = await get(`/api/sholat/kota?q=${encodeURIComponent(input.value.trim())}`);
      list.textContent = '';
      if (!kota.length) status.textContent = 'Wilayah tidak ditemukan.';
      kota.forEach((k) => list.append(h('button.menu-item', {
        type: 'button',
        onclick: async () => {
          close();
          try { await savePrefs({ sholat: { mode: 'manual', kota: { id: k.id, lokasi: k.lokasi } } }); toast(`Wilayah: ${titleCase(k.lokasi)}`); } catch (e) { toast(e.message, { type: 'error' }); }
        },
      }, icon('M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z'), h('span', { text: titleCase(k.lokasi) }))));
    } catch (e) { status.textContent = e.message; }
  }, 200);
  input.addEventListener('input', search);
  const close = openOverlay(h('div.dialog', {}, h('h3', { text: 'Pilih wilayah' }), input, status, list), { sheet: true });
  search();
}

'use strict';
/**
 * Buat / reset akun superadmin.
 *   npm run admin -- admin@kampus.ac.id "kata-sandi-panjang" "Nama Admin"
 * Jika email sudah ada, kata sandinya diganti (sesi admin lama otomatis keluar).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const [email, password, name] = process.argv.slice(2);
if (!email || !password) {
  console.error('Pakai: npm run admin -- <email> <kata-sandi (min. 10)> [nama]');
  process.exit(1);
}
const { createAdmin } = require('../lib/admin');
try {
  const a = createAdmin(email, password, name || 'Superadmin');
  console.log(`Superadmin siap: ${a.email}. Masuk di <PUBLIC_URL>/admin`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

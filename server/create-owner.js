import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.OWNER_PASSWORD;
const name = process.env.OWNER_NAME?.trim() || 'MIKUN Owner';

if (!email || !password || password.length < 12) {
  console.error('Set OWNER_EMAIL and an OWNER_PASSWORD of at least 12 characters.');
  process.exit(1);
}
if (db.prepare('SELECT COUNT(*) AS count FROM users WHERE role=\'owner\'').get().count > 0) {
  console.error('An owner account already exists. Use the staff management flow to add more people.');
  process.exit(1);
}
if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
  console.error('This email address already belongs to another account.');
  process.exit(1);
}

const now = new Date().toISOString();
const hash = await bcrypt.hash(password, 12);
db.prepare('INSERT INTO users (id,name,email,phone,password_hash,role,active,created_at,updated_at) VALUES (?,?,?,?,?,\'owner\',1,?,?)')
  .run(randomUUID(), name, email, '', hash, now, now);
console.log(`Created owner account for ${email}.`);

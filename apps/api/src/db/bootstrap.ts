import argon2 from 'argon2';
import { pool } from './pool.js';

const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD;
if (!email || !password || password.length < 12) throw new Error('BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD (minimum 12 characters) are required');

const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
const result = await pool.query<{ id: string }>(
  `INSERT INTO users (email, password_hash, role)
   VALUES ($1, $2, 'admin')
   ON CONFLICT (email) DO NOTHING
   RETURNING id`,
  [email, passwordHash],
);
if (result.rows[0]) {
  await pool.query('INSERT INTO user_settings (user_id) VALUES ($1)', [result.rows[0].id]);
  console.info(`Created account ${email}`);
} else {
  console.info(`Account ${email} already exists; no changes made`);
}
await pool.end();

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(join(migrationsDir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch((error) => { console.error(error); process.exitCode = 1; });
}

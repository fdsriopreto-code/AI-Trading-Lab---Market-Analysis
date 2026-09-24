import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { pool } from './db.js';
try {
  const client = await pool.connect();
  try {
  await client.query('SELECT pg_advisory_lock(73190421)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const filename of files) {
    const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
    if (rowCount) continue;
    try {
      await client.query('BEGIN');
      await client.query(await readFile(new URL(filename, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
      await client.query('COMMIT');
      console.log(`Applied migration ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log('Database schema is ready.');
  } finally {
    await client.query('SELECT pg_advisory_unlock(73190421)').catch(() => undefined);
    client.release();
  }
} finally {
  await pool.end();
}

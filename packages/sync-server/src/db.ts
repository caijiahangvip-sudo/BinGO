import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.BINGO_DATABASE_URL, max: 12 });

export async function migrate(): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationDir = resolve(currentDir, '../migrations');
  const migrationFiles = (await readdir(migrationDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  await pool.query(`CREATE TABLE IF NOT EXISTS bingo_schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const file of migrationFiles) {
    const applied = await pool.query('SELECT 1 FROM bingo_schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) continue;
    const sql = await readFile(resolve(migrationDir, file), 'utf8');
    await transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO bingo_schema_migrations (version) VALUES ($1)', [file]);
    });
  }
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

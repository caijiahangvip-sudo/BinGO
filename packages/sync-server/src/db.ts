import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.BINGO_DATABASE_URL, max: 12 });

export async function migrate(): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationPath = resolve(currentDir, '../migrations/001_init.sql');
  const sql = await readFile(migrationPath, 'utf8');
  await pool.query(sql);
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

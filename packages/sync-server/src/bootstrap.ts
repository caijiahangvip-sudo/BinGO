import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { hashPassword } from './auth.js';
import { pool } from './db.js';

export async function ensureBootstrapAdmin(): Promise<void> {
  if (!config.BINGO_BOOTSTRAP_ADMIN_EMAIL || !config.BINGO_BOOTSTRAP_ADMIN_PASSWORD) return;
  const existing = await pool.query('SELECT 1 FROM accounts LIMIT 1');
  if (existing.rowCount) return;
  const organizationId = randomUUID();
  const accountId = randomUUID();
  await pool.query(
    `WITH organization AS (
       INSERT INTO organizations (id, name) VALUES ($1, 'BinGO') RETURNING id
     )
     INSERT INTO accounts (id, organization_id, email, display_name, role, password_hash)
     SELECT $2, id, lower($3), 'BinGO Admin', 'admin', $4 FROM organization`,
    [
      organizationId,
      accountId,
      config.BINGO_BOOTSTRAP_ADMIN_EMAIL,
      await hashPassword(config.BINGO_BOOTSTRAP_ADMIN_PASSWORD),
    ],
  );
}

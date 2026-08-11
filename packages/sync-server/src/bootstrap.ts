import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { hashPassword, hashToken } from './auth.js';
import { pool } from './db.js';

export async function ensureBootstrapAdmin(): Promise<void> {
  if (!config.BINGO_BOOTSTRAP_ADMIN_EMAIL || !config.BINGO_BOOTSTRAP_ADMIN_PASSWORD) return;
  const existing = await pool.query<{ id: string; organization_id: string }>(
    `SELECT id, organization_id FROM accounts
     ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at
     LIMIT 1`,
  );
  if (existing.rowCount) {
    const account = existing.rows[0];
    await pool.query("UPDATE accounts SET username = COALESCE(username, 'admin') WHERE id = $1", [account.id]);
    if (config.BINGO_BOOTSTRAP_INVITE_CODE) {
      await pool.query(
        `UPDATE organizations
         SET invite_code_hash = COALESCE(invite_code_hash, $2),
             invite_code_updated_at = COALESCE(invite_code_updated_at, now())
         WHERE id = $1`,
        [account.organization_id, hashToken(config.BINGO_BOOTSTRAP_INVITE_CODE.trim().toLowerCase())],
      );
    }
    return;
  }
  const organizationId = randomUUID();
  const accountId = randomUUID();
  await pool.query(
    `WITH organization AS (
       INSERT INTO organizations (id, name, invite_code_hash, invite_code_updated_at)
       VALUES ($1, 'BinGO', $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)
       RETURNING id
     )
     INSERT INTO accounts (id, organization_id, email, username, display_name, role, password_hash)
     SELECT $2, id, lower($3), 'Cai', 'Cai', 'admin', $4 FROM organization`,
    [
      organizationId,
      accountId,
      config.BINGO_BOOTSTRAP_ADMIN_EMAIL,
      await hashPassword(config.BINGO_BOOTSTRAP_ADMIN_PASSWORD),
      config.BINGO_BOOTSTRAP_INVITE_CODE
        ? hashToken(config.BINGO_BOOTSTRAP_INVITE_CODE.trim().toLowerCase())
        : null,
    ],
  );
}

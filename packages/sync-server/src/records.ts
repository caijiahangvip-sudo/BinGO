import { z } from 'zod';
import { transaction } from './db.js';

export const syncRecordSchema = z.object({
  entityType: z.string().min(1).max(80),
  entityId: z.string().min(1).max(160),
  baseVersion: z.number().int().nonnegative().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  deleted: z.boolean().default(false),
});

export type SyncRecordInput = z.infer<typeof syncRecordSchema>;

export async function applySyncRecords(
  organizationId: string,
  actorId: string,
  records: SyncRecordInput[],
) {
  return transaction(async (client) => {
    const accepted: Array<{ entityType: string; entityId: string; version: number }> = [];
    const conflicts: Array<{ entityType: string; entityId: string; serverVersion: number }> = [];

    for (const record of records) {
      const current = await client.query<{ version: string }>(
        `SELECT version FROM sync_records
         WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3
         FOR UPDATE`,
        [organizationId, record.entityType, record.entityId],
      );
      const currentVersion = current.rowCount ? Number(current.rows[0].version) : 0;
      if (record.baseVersion !== null && record.baseVersion !== currentVersion) {
        conflicts.push({
          entityType: record.entityType,
          entityId: record.entityId,
          serverVersion: currentVersion,
        });
        continue;
      }
      const nextVersion = currentVersion + 1;
      await client.query(
        `INSERT INTO sync_records (
           organization_id, entity_type, entity_id, payload, version, deleted_at, updated_by
         ) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END, $7)
         ON CONFLICT (organization_id, entity_type, entity_id) DO UPDATE SET
           payload = EXCLUDED.payload,
           version = EXCLUDED.version,
           deleted_at = EXCLUDED.deleted_at,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [
          organizationId,
          record.entityType,
          record.entityId,
          record.payload,
          nextVersion,
          record.deleted,
          actorId,
        ],
      );
      accepted.push({
        entityType: record.entityType,
        entityId: record.entityId,
        version: nextVersion,
      });
    }
    return { accepted, conflicts };
  });
}

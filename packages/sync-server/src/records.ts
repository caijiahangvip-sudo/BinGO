import { z } from 'zod';
import { transaction } from './db.js';
import { dataCategoryForEntity, encryptPayload } from './privacy.js';

export const syncRecordSchema = z.object({
  entityType: z.string().min(1).max(80),
  entityId: z.string().min(1).max(160),
  baseVersion: z.number().int().nonnegative().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  deleted: z.boolean().default(false),
  visibility: z.enum(['private', 'organization']).default('private'),
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
      const current = await client.query<{ version: string; owner_account_id: string }>(
        `SELECT version, owner_account_id FROM sync_records
         WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3
           AND (($4 = 'private' AND owner_account_id = $5)
             OR ($4 = 'organization' AND visibility = 'organization'))
         FOR UPDATE`,
        [organizationId, record.entityType, record.entityId, record.visibility, actorId],
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
      const ownerAccountId = current.rows[0]?.owner_account_id ?? actorId;
      const encrypted = record.payload === null ? null : encryptPayload(record.payload);
      const dataCategory = dataCategoryForEntity(record.entityType);
      await client.query(
        `INSERT INTO sync_records (
           organization_id, owner_account_id, entity_type, entity_id, payload,
           encrypted_payload, encryption_iv, encryption_tag, encryption_key_version,
           data_category, version, visibility, deleted_at, updated_by
         ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $12 THEN now() ELSE NULL END, $13)
         ON CONFLICT (organization_id, owner_account_id, entity_type, entity_id) DO UPDATE SET
           payload = NULL,
           encrypted_payload = EXCLUDED.encrypted_payload,
           encryption_iv = EXCLUDED.encryption_iv,
           encryption_tag = EXCLUDED.encryption_tag,
           encryption_key_version = EXCLUDED.encryption_key_version,
           data_category = EXCLUDED.data_category,
           version = EXCLUDED.version,
           visibility = EXCLUDED.visibility,
           deleted_at = EXCLUDED.deleted_at,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [
          organizationId,
          ownerAccountId,
          record.entityType,
          record.entityId,
          encrypted?.encryptedPayload ?? null,
          encrypted?.iv ?? null,
          encrypted?.tag ?? null,
          encrypted?.keyVersion ?? 1,
          dataCategory,
          nextVersion,
          record.visibility,
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

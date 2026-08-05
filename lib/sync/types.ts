export type BinGoAccountRole = 'admin' | 'teacher' | 'student';

export interface BinGoAccount {
  id: string;
  organizationId: string;
  role: BinGoAccountRole;
  displayName: string;
}

export interface SyncRecord {
  entityType: string;
  entityId: string;
  payload: Record<string, unknown> | null;
  version: number;
  deletedAt: string | null;
  updatedAt: string;
}

export interface SyncRecordMutation {
  entityType: string;
  entityId: string;
  baseVersion: number | null;
  payload: Record<string, unknown> | null;
  deleted: boolean;
}

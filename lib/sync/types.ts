export type BinGoAccountRole = 'admin' | 'teacher' | 'student';

export interface BinGoAccount {
  id: string;
  organizationId: string;
  username: string | null;
  role: BinGoAccountRole;
  displayName: string;
}

export interface BinGoAuthSession {
  accessToken: string;
  refreshToken?: string;
  account: BinGoAccount;
}

export interface BinGoDevice {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
}

export interface SyncRecord {
  entityType: string;
  entityId: string;
  payload: Record<string, unknown> | null;
  version: number;
  visibility: 'private' | 'organization';
  deletedAt: string | null;
  updatedAt: string;
}

export interface SyncRecordMutation {
  entityType: string;
  entityId: string;
  baseVersion: number | null;
  payload: Record<string, unknown> | null;
  deleted: boolean;
  visibility?: 'private' | 'organization';
}

export interface SupportAccessRequest {
  id: string;
  administratorName: string;
  entityType: string;
  entityId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'consumed';
  grantType?: 'once' | 'day' | 'week' | 'persistent';
  expiresAt?: string | null;
  requestedAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
}

export interface TeachingBootstrap {
  account: BinGoAccount;
  primaryClass: { id: string; name: string; description: string } | null;
  teacherAssignments: Array<{ id: string; classId: string; className: string; subjectName: string; roleName: string; capabilities: string[] }>;
  groups: Array<{ id: string; name: string; description: string; memberRole: string }>;
  unreadNotifications: number;
}

export interface LearningTask {
  id: string;
  title: string;
  description: string;
  className?: string | null;
  groupName?: string | null;
  task_kind: 'goal' | 'practice' | 'assessment';
  requirement: 'required' | 'optional';
  due_at?: string | null;
  submissionStatus?: string | null;
  teacherGrade?: { score?: number | null; feedback?: string } | null;
}

export interface TeachingNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

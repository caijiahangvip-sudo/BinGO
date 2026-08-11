import type {
  BinGoAuthSession,
  BinGoDevice,
  SupportAccessRequest,
  TeachingBootstrap,
  TeachingNotification,
  LearningTask,
  SyncRecord,
  SyncRecordMutation,
} from './types';

export class BinGoSyncRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BinGoSyncRequestError';
  }
}

export interface BinGoSyncClientOptions {
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (
    !/^https:\/\//i.test(normalized) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)
  ) {
    throw new Error('BinGO 同步服务器必须使用 HTTPS');
  }
  return normalized;
}

export class BinGoSyncClient {
  readonly baseUrl: string;
  private readonly getAccessToken: BinGoSyncClientOptions['getAccessToken'];

  constructor(options: BinGoSyncClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.getAccessToken = options.getAccessToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new BinGoSyncRequestError(
        body.error || `BinGO sync request failed: ${response.status}`,
        response.status,
      );
    }
    return body;
  }

  health() {
    return this.request<{ ok: boolean; service: string; version: string }>('/health');
  }

  register(input: {
    inviteCode: string;
    username: string;
    password: string;
    deviceName: string;
    platform: string;
  }) {
    return this.request<BinGoAuthSession>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  login(identifier: string, password: string, deviceName: string, platform: string) {
    return this.request<BinGoAuthSession>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, deviceName, platform }),
    });
  }

  refresh(refreshToken: string) {
    return this.request<BinGoAuthSession>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  logout() {
    return this.request<void>('/v1/auth/logout', { method: 'POST' });
  }

  me() {
    return this.request<{ account: BinGoAuthSession['account'] }>('/v1/me');
  }

  devices() {
    return this.request<{ devices: BinGoDevice[] }>('/v1/devices');
  }

  revokeDevice(id: string) {
    return this.request<void>(`/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  teachingBootstrap() {
    return this.request<TeachingBootstrap>('/v1/teaching/bootstrap');
  }

  joinPrimaryClass(inviteCode: string) {
    return this.request<{ ok: true; classId: string }>('/v1/classes/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    });
  }

  listLearningTasks() {
    return this.request<{ tasks: LearningTask[] }>('/v1/tasks');
  }

  submitLearningTask(id: string, summary: string, evidence: Array<Record<string, unknown>> = []) {
    return this.request<{ submission: unknown }>(`/v1/tasks/${encodeURIComponent(id)}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ summary, evidence }),
    });
  }

  createStudyGroup(name: string, description = '') {
    return this.request<{ id: string; code: string }>('/v1/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  joinStudyGroup(inviteCode: string) {
    return this.request<{ ok: true; groupId: string }>('/v1/groups/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    });
  }

  listTeachingNotifications() {
    return this.request<{ notifications: TeachingNotification[] }>('/v1/notifications');
  }

  readTeachingNotification(id: string) {
    return this.request<{ ok: true }>(`/v1/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      body: '{}',
    });
  }

  listSupportRequests() {
    return this.request<{ requests: SupportAccessRequest[] }>('/v1/support/requests');
  }

  decideSupportRequest(id: string, decision: 'approve' | 'reject', grantType: 'once' | 'day' | 'week' | 'persistent' = 'once') {
    return this.request<{ ok: true; status: 'approved' | 'rejected' }>(
      `/v1/support/requests/${encodeURIComponent(id)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision, grantType }) },
    );
  }

  resetPassword(username: string, code: string, newPassword: string) {
    return this.request<{ ok: true }>('/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ username, code, newPassword }),
    });
  }

  inviteCodeStatus() {
    return this.request<{ enabled: boolean; updatedAt: string | null }>('/v1/admin/invite-code');
  }

  rotateInviteCode(inviteCode: string) {
    return this.request<{ enabled: boolean; inviteCode: string }>('/v1/admin/invite-code/rotate', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    });
  }

  pull(cursor: number) {
    return this.request<{ records: SyncRecord[]; cursor: number }>(
      `/v1/sync/records?cursor=${cursor}`,
    );
  }

  push(records: SyncRecordMutation[]) {
    return this.request<{
      accepted: Array<{ entityType: string; entityId: string; version: number }>;
      conflicts: Array<{ entityType: string; entityId: string; serverVersion: number }>;
    }>('/v1/sync/records', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  }
}

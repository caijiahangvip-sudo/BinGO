import type { BinGoAccount, SyncRecord, SyncRecordMutation } from './types';

export interface BinGoSyncClientOptions {
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(normalized) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
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
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(body.error || `BinGO sync request failed: ${response.status}`);
    return body;
  }

  login(email: string, password: string) {
    return this.request<{ accessToken: string; account: BinGoAccount }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  pull(cursor: number) {
    return this.request<{ records: SyncRecord[]; cursor: number }>(`/v1/sync/records?cursor=${cursor}`);
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

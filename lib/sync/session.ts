'use client';

import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '@/lib/runtime/platform';
import { BinGoSyncClient, BinGoSyncRequestError } from './client';
import type { BinGoAccount, BinGoAuthSession, SyncRecord } from './types';

const DEFAULT_BASE_URL = 'https://bingo.mido.site';
const CONFIG_KEY = 'bingo.sync.config';
const STATE_KEY = 'bingo.sync.state';
const ACCESS_TOKEN_ID = 'access-token';
const REFRESH_TOKEN_ID = 'refresh-token';
const SYNC_KEYS = ['settings-storage', 'user-profile-storage'] as const;

interface StoredConfig {
  baseUrl: string;
  account: BinGoAccount | null;
}

interface SyncState {
  cursor: number;
  versions: Record<string, number>;
  hashes: Record<string, string>;
}

function loadConfig(): StoredConfig {
  if (typeof window === 'undefined') return { baseUrl: DEFAULT_BASE_URL, account: null };
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') as Partial<StoredConfig>;
    return { baseUrl: stored.baseUrl || DEFAULT_BASE_URL, account: stored.account || null };
  } catch {
    return { baseUrl: DEFAULT_BASE_URL, account: null };
  }
}

function saveConfig(config: StoredConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

async function readSecret(id: string): Promise<string> {
  if (isTauriRuntime()) {
    return (
      (await invoke<string | null>('desktop_secret_read', { scope: 'sync', providerId: id })) || ''
    );
  }
  return sessionStorage.getItem(`bingo.sync.${id}`) || '';
}

async function writeSecret(id: string, value: string) {
  if (isTauriRuntime()) {
    await invoke('desktop_secret_write', { scope: 'sync', providerId: id, value });
    return;
  }
  sessionStorage.setItem(`bingo.sync.${id}`, value);
}

async function deleteSecret(id: string) {
  if (isTauriRuntime()) {
    await invoke('desktop_secret_delete', { scope: 'sync', providerId: id });
    return;
  }
  sessionStorage.removeItem(`bingo.sync.${id}`);
}

export function getSyncConfiguration() {
  return loadConfig();
}

export async function getAccessToken() {
  return readSecret(ACCESS_TOKEN_ID);
}

export async function createSyncClient(baseUrl = loadConfig().baseUrl) {
  return new BinGoSyncClient({ baseUrl, getAccessToken });
}

export async function saveSyncSession(baseUrl: string, session: BinGoAuthSession) {
  saveConfig({ baseUrl, account: session.account });
  await writeSecret(ACCESS_TOKEN_ID, session.accessToken);
  if (session.refreshToken) await writeSecret(REFRESH_TOKEN_ID, session.refreshToken);
}

export async function refreshSyncSession(): Promise<BinGoAuthSession | null> {
  const config = loadConfig();
  const refreshToken = await readSecret(REFRESH_TOKEN_ID);
  if (!refreshToken) return null;
  const client = await createSyncClient(config.baseUrl);
  const session = await client.refresh(refreshToken);
  await saveSyncSession(config.baseUrl, session);
  return session;
}

export async function clearSyncSession() {
  const config = loadConfig();
  saveConfig({ ...config, account: null });
  await Promise.all([deleteSecret(ACCESS_TOKEN_ID), deleteSecret(REFRESH_TOKEN_ID)]);
  localStorage.removeItem(STATE_KEY);
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function loadSyncState(): SyncState {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') as SyncState;
  } catch {
    return { cursor: 0, versions: {}, hashes: {} };
  }
}

function normalizedState(value: Partial<SyncState>): SyncState {
  return { cursor: value.cursor || 0, versions: value.versions || {}, hashes: value.hashes || {} };
}

function redactSyncedSettings(value: string): string {
  try {
    const persisted = JSON.parse(value) as { state?: Record<string, unknown> };
    const state = persisted.state;
    if (!state) return value;
    for (const key of [
      'providersConfig',
      'lightweightProvidersConfig',
      'ttsProvidersConfig',
      'asrProvidersConfig',
      'pdfProvidersConfig',
      'vectorProvidersConfig',
      'webSearchProvidersConfig',
    ]) {
      const providers = state[key];
      if (!providers || typeof providers !== 'object') continue;
      state[key] = Object.fromEntries(
        Object.entries(providers).map(([providerId, config]) => [
          providerId,
          config && typeof config === 'object' ? { ...config, apiKey: '' } : config,
        ]),
      );
    }
    state.secretsHydrated = false;
    state.secretMigrationError = null;
    return JSON.stringify(persisted);
  } catch {
    return value;
  }
}

function syncValue(key: (typeof SYNC_KEYS)[number]): string {
  const value = localStorage.getItem(key) || '';
  return key === 'settings-storage' ? redactSyncedSettings(value) : value;
}

async function performSyncClientState() {
  const config = loadConfig();
  const client = await createSyncClient(config.baseUrl);
  const state = normalizedState(loadSyncState());
  let applied = 0;
  let conflicts = 0;

  const pull = await client.pull(state.cursor);
  for (const record of pull.records) {
    if (
      record.entityType !== 'client-state' ||
      !SYNC_KEYS.includes(record.entityId as (typeof SYNC_KEYS)[number])
    )
      continue;
    const key = record.entityId as (typeof SYNC_KEYS)[number];
    const current = syncValue(key);
    const currentHash = await digest(current);
    const knownHash = state.hashes[record.entityId];
    if (knownHash && currentHash !== knownHash) {
      conflicts += 1;
      continue;
    }
    const value = typeof record.payload?.value === 'string' ? record.payload.value : '';
    localStorage.setItem(key, value);
    state.hashes[record.entityId] = await digest(value);
    state.versions[record.entityId] = record.version;
    applied += 1;
  }
  state.cursor = pull.cursor;

  const mutations = [];
  for (const key of SYNC_KEYS) {
    const value = syncValue(key);
    const nextHash = await digest(value);
    if (state.hashes[key] === nextHash) continue;
    mutations.push({
      entityType: 'client-state',
      entityId: key,
      baseVersion: state.versions[key] ?? null,
      payload: { value },
      deleted: false,
      visibility: 'private' as const,
    });
  }
  if (mutations.length) {
    const pushed = await client.push(mutations);
    conflicts += pushed.conflicts.length;
    for (const accepted of pushed.accepted) {
      const key = accepted.entityId as (typeof SYNC_KEYS)[number];
      const value = SYNC_KEYS.includes(key) ? syncValue(key) : '';
      state.versions[accepted.entityId] = accepted.version;
      state.hashes[accepted.entityId] = await digest(value);
    }
  }
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  return { applied, uploaded: mutations.length, conflicts };
}

export async function syncClientState() {
  try {
    return await performSyncClientState();
  } catch (error) {
    if (!(error instanceof BinGoSyncRequestError) || error.status !== 401) throw error;
    const refreshed = await refreshSyncSession();
    if (!refreshed) throw error;
    return performSyncClientState();
  }
}

export function applyAccountFromServer(account: BinGoAccount) {
  const config = loadConfig();
  saveConfig({ ...config, account });
}

export function serverRecordKey(record: SyncRecord) {
  return `${record.entityType}/${record.entityId}`;
}

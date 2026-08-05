import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCloudApiBaseUrl,
  getCloudApiToken,
  getSyncServerUrl,
  resolveRuntimeApiUrl,
  setCloudApiBaseUrl,
  setCloudApiToken,
  setSyncServerUrl,
} from '@/lib/runtime/api-client';
import { getRuntimeApiTarget } from '@/lib/runtime/api-policy';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('runtime API client', () => {
  it('keeps relative API paths outside iPadOS', () => {
    vi.stubGlobal('window', { localStorage: createStorage() });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome', maxTouchPoints: 0 });
    expect(resolveRuntimeApiUrl('/api/health')).toBe('/api/health');
  });

  it('uses the configured cloud API on iPadOS', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, localStorage: createStorage() });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
    });
    setCloudApiBaseUrl('https://api.bingo.example.com/');
    setCloudApiToken('secret-token');
    setSyncServerUrl('https://computer.example.com/');
    expect(getCloudApiBaseUrl()).toBe('https://api.bingo.example.com');
    expect(getSyncServerUrl()).toBeNull();
    expect(resolveRuntimeApiUrl('/api/chat')).toBe('https://api.bingo.example.com/api/chat');
    expect(getCloudApiToken()).toBe('secret-token');
  });

  it('uses the current PWA origin when no separate sync server is configured', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, localStorage: createStorage() });
    vi.stubGlobal('navigator', { userAgent: 'iPad', maxTouchPoints: 5 });
    expect(resolveRuntimeApiUrl('/api/sync')).toBe('/api/sync');
  });

  it('keeps desktop API paths relative', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, localStorage: createStorage() });
    vi.stubGlobal('navigator', { userAgent: 'Windows', maxTouchPoints: 0 });
    setCloudApiBaseUrl('https://api.bingo.example.com');
    setCloudApiToken('secret-token');
    expect(resolveRuntimeApiUrl('/api/chat')).toBe('/api/chat');
  });

  it('classifies local and cloud API work per platform', () => {
    expect(getRuntimeApiTarget('/api/chat', 'ipados')).toBe('cloud');
    expect(getRuntimeApiTarget('/api/parse-pdf', 'ipados')).toBe('ipad-local');
    expect(getRuntimeApiTarget('/api/local-services/diagnostics', 'desktop')).toBe('windows-local');
    expect(getRuntimeApiTarget('/api/local-services/diagnostics', 'ipados')).toBe('cloud');
  });
});

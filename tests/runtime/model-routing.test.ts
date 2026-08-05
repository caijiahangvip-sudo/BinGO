import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertTtsProviderAllowed, getModelExecutionTarget } from '@/lib/runtime/model-routing';

afterEach(() => vi.unstubAllGlobals());

describe('runtime model routing', () => {
  it('routes iPad language-model work to the cloud API', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'iPad', maxTouchPoints: 5 });
    expect(getModelExecutionTarget()).toBe('cloud-api');
  });

  it('allows local speech synthesis on iPad', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'iPad', maxTouchPoints: 5 });
    expect(() => assertTtsProviderAllowed('browser-native-tts')).not.toThrow();
  });

  it('keeps Windows Tauri on local model services', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { userAgent: 'Windows', maxTouchPoints: 0 });
    expect(getModelExecutionTarget()).toBe('windows-local-service');
  });
});

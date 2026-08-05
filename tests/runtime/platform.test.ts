import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimePlatform, isBrowserTtsAllowed, isTauriRuntime } from '@/lib/runtime/platform';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWindow) vi.stubGlobal('window', originalWindow);
  if (originalNavigator) vi.stubGlobal('navigator', originalNavigator);
});

describe('runtime platform detection', () => {
  it('detects a normal browser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome', maxTouchPoints: 0 });

    expect(isTauriRuntime()).toBe(false);
    expect(getRuntimePlatform()).toBe('browser');
    expect(isBrowserTtsAllowed()).toBe(true);
  });

  it('detects iPad Safari without a native wrapper', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0)', maxTouchPoints: 5 });

    expect(isTauriRuntime()).toBe(false);
    expect(getRuntimePlatform()).toBe('ipados');
    expect(isBrowserTtsAllowed()).toBe(true);
  });

  it('detects the desktop Tauri runtime', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Windows', maxTouchPoints: 0 });

    expect(getRuntimePlatform()).toBe('desktop');
    expect(isBrowserTtsAllowed()).toBe(true);
  });

  it('detects iPadOS and allows local browser TTS', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Mobile',
      maxTouchPoints: 5,
    });

    expect(getRuntimePlatform()).toBe('ipados');
    expect(isBrowserTtsAllowed()).toBe(true);
  });
});

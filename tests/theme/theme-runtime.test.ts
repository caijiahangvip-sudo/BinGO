import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COLOR_THEME_ID } from '@/lib/theme/color-themes';
import {
  applyBrowserColorTheme,
  COLOR_THEME_STORAGE_KEY,
  getCurrentColorTheme,
  getThemeInitScript,
  THEME_STORAGE_KEY,
} from '@/lib/theme/theme-runtime';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function createDocumentElement() {
  const classNames = new Set<string>();

  return {
    dataset: {} as DOMStringMap,
    style: {} as CSSStyleDeclaration,
    classList: {
      add(name: string) {
        classNames.add(name);
      },
      remove(name: string) {
        classNames.delete(name);
      },
      contains(name: string) {
        return classNames.has(name);
      },
      toggle(name: string, force?: boolean) {
        const shouldAdd = force ?? !classNames.has(name);
        if (shouldAdd) classNames.add(name);
        else classNames.delete(name);
        return shouldAdd;
      },
    },
  };
}

describe('theme runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes the saved color theme before first paint', () => {
    const documentElement = createDocumentElement();
    const storage = createMemoryStorage({
      [COLOR_THEME_STORAGE_KEY]: 'clear-tech',
      [THEME_STORAGE_KEY]: 'dark',
    });
    const windowRef = {
      matchMedia: vi.fn(() => ({ matches: false })),
    };

    new Function('document', 'localStorage', 'window', getThemeInitScript())(
      { documentElement },
      storage,
      windowRef,
    );

    expect(documentElement.dataset.colorTheme).toBe('clear-tech');
    expect(documentElement.classList.contains('dark')).toBe(true);
    expect(documentElement.style.colorScheme).toBe('dark');
  });

  it('falls back to the default color theme only when storage is invalid', () => {
    const documentElement = createDocumentElement();
    const storage = createMemoryStorage({
      [COLOR_THEME_STORAGE_KEY]: 'missing-theme',
      [THEME_STORAGE_KEY]: 'system',
    });
    const windowRef = {
      matchMedia: vi.fn(() => ({ matches: true })),
    };

    new Function('document', 'localStorage', 'window', getThemeInitScript())(
      { documentElement },
      storage,
      windowRef,
    );

    expect(documentElement.dataset.colorTheme).toBe(DEFAULT_COLOR_THEME_ID);
    expect(documentElement.classList.contains('dark')).toBe(true);
    expect(documentElement.style.colorScheme).toBe('dark');
  });

  it('uses stored color theme instead of a stale document theme', () => {
    const documentElement = createDocumentElement();
    documentElement.dataset.colorTheme = DEFAULT_COLOR_THEME_ID;
    vi.stubGlobal(
      'localStorage',
      createMemoryStorage({ [COLOR_THEME_STORAGE_KEY]: 'nature-reader' }),
    );
    vi.stubGlobal('document', { documentElement });

    expect(getCurrentColorTheme()).toBe('nature-reader');
  });

  it('writes color theme to storage and document synchronously', () => {
    const documentElement = createDocumentElement();
    const storage = createMemoryStorage({ [COLOR_THEME_STORAGE_KEY]: DEFAULT_COLOR_THEME_ID });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { documentElement });

    applyBrowserColorTheme('night-lecture');

    expect(storage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('night-lecture');
    expect(documentElement.dataset.colorTheme).toBe('night-lecture');
    expect(getCurrentColorTheme()).toBe('night-lecture');
  });
});

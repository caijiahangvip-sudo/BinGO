import {
  COLOR_THEME_IDS,
  DEFAULT_COLOR_THEME_ID,
  isColorThemeId,
  type ColorThemeId,
} from '@/lib/theme/color-themes';

export const THEME_STORAGE_KEY = 'theme';
export const COLOR_THEME_STORAGE_KEY = 'colorTheme';

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

const THEME_MODE_SET = new Set<string>(THEME_MODES);

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && THEME_MODE_SET.has(value);
}

export function resolveThemeMode(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : 'system';
}

function readLocalStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* Storage can be blocked in private or embedded contexts. */
  }
}

export function getStoredThemeMode(): ThemeMode | null {
  const stored = readLocalStorage(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : null;
}

export function getCurrentThemeMode(fallback: ThemeMode = 'system'): ThemeMode {
  return getStoredThemeMode() ?? fallback;
}

export function getSystemThemeMode(): ResolvedThemeMode {
  try {
    return globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

export function resolveThemeAppearance(
  theme: ThemeMode,
  systemTheme: ResolvedThemeMode = getSystemThemeMode(),
): ResolvedThemeMode {
  return theme === 'system' ? systemTheme : theme;
}

export function applyBrowserThemeMode(
  theme: ThemeMode,
  systemTheme: ResolvedThemeMode = getSystemThemeMode(),
  options: { persist?: boolean } = {},
) {
  const resolvedTheme = resolveThemeAppearance(theme, systemTheme);
  const root = globalThis.document?.documentElement;

  if (root) {
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }

  if (options.persist !== false) {
    writeLocalStorage(THEME_STORAGE_KEY, theme);
  }
}

export function getStoredColorTheme(): ColorThemeId | null {
  const stored = readLocalStorage(COLOR_THEME_STORAGE_KEY);
  return isColorThemeId(stored) ? stored : null;
}

export function getDocumentColorTheme(): ColorThemeId | null {
  const value = globalThis.document?.documentElement.dataset.colorTheme;
  return isColorThemeId(value) ? value : null;
}

export function getCurrentColorTheme(
  fallback: ColorThemeId = DEFAULT_COLOR_THEME_ID,
): ColorThemeId {
  return getStoredColorTheme() ?? getDocumentColorTheme() ?? fallback;
}

export function applyBrowserColorTheme(
  colorTheme: ColorThemeId,
  options: { persist?: boolean } = {},
) {
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.colorTheme = colorTheme;
  }

  if (options.persist !== false) {
    writeLocalStorage(COLOR_THEME_STORAGE_KEY, colorTheme);
  }
}

export function getThemeInitScript(): string {
  const colorThemeIds = JSON.stringify(COLOR_THEME_IDS);
  const defaultColorTheme = JSON.stringify(DEFAULT_COLOR_THEME_ID);
  const themeModes = JSON.stringify(THEME_MODES);
  const themeStorageKey = JSON.stringify(THEME_STORAGE_KEY);
  const colorThemeStorageKey = JSON.stringify(COLOR_THEME_STORAGE_KEY);

  return `(function(){try{var root=document.documentElement;var colorThemeIds=${colorThemeIds};var defaultColorTheme=${defaultColorTheme};var storedColorTheme=localStorage.getItem(${colorThemeStorageKey});var colorTheme=colorThemeIds.indexOf(storedColorTheme)>=0?storedColorTheme:defaultColorTheme;root.dataset.colorTheme=colorTheme;var themeModes=${themeModes};var storedTheme=localStorage.getItem(${themeStorageKey});var theme=themeModes.indexOf(storedTheme)>=0?storedTheme:'system';var resolvedTheme=theme==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':theme==='dark'?'dark':'light';root.classList.toggle('dark',resolvedTheme==='dark');root.style.colorScheme=resolvedTheme;}catch(error){}})();`;
}

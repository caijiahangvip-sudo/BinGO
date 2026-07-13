'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  DEFAULT_COLOR_THEME_ID,
  resolveColorThemeId,
  type ColorThemeId,
} from '@/lib/theme/color-themes';
import {
  applyBrowserColorTheme,
  applyBrowserThemeMode,
  COLOR_THEME_STORAGE_KEY,
  getCurrentColorTheme,
  getCurrentThemeMode,
  getSystemThemeMode,
  resolveThemeAppearance,
  resolveThemeMode,
  THEME_STORAGE_KEY,
  type ResolvedThemeMode,
  type ThemeMode,
} from '@/lib/theme/theme-runtime';

type Theme = ThemeMode;

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
  colorTheme: ColorThemeId;
  setColorTheme: (theme: ColorThemeId) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [systemTheme, setSystemTheme] = useState<ResolvedThemeMode>('light');
  const [colorTheme, setColorThemeState] = useState<ColorThemeId>(DEFAULT_COLOR_THEME_ID);
  const [hasHydrated, setHasHydrated] = useState(false);

  const resolvedTheme = resolveThemeAppearance(theme, systemTheme);

  // Reconcile with the pre-paint theme script without writing the default theme back over it.
  useEffect(() => {
    const nextSystemTheme = getSystemThemeMode();
    const nextTheme = getCurrentThemeMode(theme);
    const nextColorTheme = getCurrentColorTheme(colorTheme);

    setSystemTheme(nextSystemTheme);
    setThemeState(nextTheme);
    setColorThemeState(nextColorTheme);
    applyBrowserThemeMode(nextTheme, nextSystemTheme, { persist: false });
    applyBrowserColorTheme(nextColorTheme, { persist: false });
    setHasHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme to document after hydration. Setters apply immediately for same-tick UI changes.
  useEffect(() => {
    if (!hasHydrated) return;
    applyBrowserThemeMode(theme, systemTheme, { persist: false });
  }, [hasHydrated, systemTheme, theme]);

  useEffect(() => {
    if (!hasHydrated) return;
    applyBrowserColorTheme(colorTheme, { persist: false });
  }, [colorTheme, hasHydrated]);

  // Listen to system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const nextSystemTheme = mediaQuery.matches ? 'dark' : 'light';
      setSystemTheme(nextSystemTheme);
      applyBrowserThemeMode(getCurrentThemeMode(theme), nextSystemTheme, { persist: false });
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        const nextTheme = resolveThemeMode(event.newValue);
        setThemeState(nextTheme);
        applyBrowserThemeMode(nextTheme, systemTheme, { persist: false });
      }

      if (event.key === COLOR_THEME_STORAGE_KEY) {
        const nextColorTheme = resolveColorThemeId(event.newValue);
        setColorThemeState(nextColorTheme);
        applyBrowserColorTheme(nextColorTheme, { persist: false });
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [systemTheme]);

  // Save theme to localStorage
  const handleSetTheme = (newTheme: Theme) => {
    applyBrowserThemeMode(newTheme, systemTheme);
    setThemeState(newTheme);
  };

  const handleSetColorTheme = (newTheme: ColorThemeId) => {
    applyBrowserColorTheme(newTheme);
    setColorThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme: handleSetTheme,
        resolvedTheme,
        colorTheme,
        setColorTheme: handleSetColorTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

import { describe, expect, it } from 'vitest';

import {
  COLOR_THEME_IDS,
  DEFAULT_COLOR_THEME_ID,
  getColorThemePreset,
  getPresentationPalette,
  isColorThemeId,
  resolveColorThemeId,
} from '@/lib/theme/color-themes';

describe('color theme presets', () => {
  it('resolves invalid input to the default theme', () => {
    expect(resolveColorThemeId('nature-reader')).toBe('nature-reader');
    expect(resolveColorThemeId('missing-theme')).toBe(DEFAULT_COLOR_THEME_ID);
    expect(resolveColorThemeId(undefined)).toBe(DEFAULT_COLOR_THEME_ID);
  });

  it('exposes complete presets and presentation palettes for every theme', () => {
    for (const id of COLOR_THEME_IDS) {
      expect(isColorThemeId(id)).toBe(true);
      const preset = getColorThemePreset(id);
      const palette = getPresentationPalette(id);

      expect(preset.id).toBe(id);
      expect(preset.label.zh).toBeTruthy();
      expect(preset.light.primary).toMatch(/^#/);
      expect(preset.dark.primary).toMatch(/^#/);
      expect(palette.background).toMatch(/^#/);
      expect(palette.chartColors.length).toBeGreaterThanOrEqual(5);
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  CHINESE_FONT_FAMILY,
  SCREEN_ENGLISH_FONT_FAMILY,
  SCREEN_FONT_CSS_VARIABLE,
  SCREEN_FONT_STACK,
  PRINT_ENGLISH_FONT_FAMILY,
  PRINT_FONT_CSS_VARIABLE,
  PRINT_FONT_STACK,
  containsChineseText,
  getEmbeddedAppFontCss,
  getPrimaryFontFamily,
  resolvePrintFontFace,
  resolveScreenFontFamily,
} from '@/lib/constants/fonts';

describe('getPrimaryFontFamily', () => {
  it('returns empty string for undefined/null input', () => {
    expect(getPrimaryFontFamily(undefined)).toBe('');
    expect(getPrimaryFontFamily(null)).toBe('');
  });

  it('extracts the first family from a comma-separated stack', () => {
    expect(getPrimaryFontFamily('"Helvetica Now Display", "Hiragino Sans GB", sans-serif')).toBe(
      'Helvetica Now Display',
    );
  });

  it('strips wrapping quotes from a single family name', () => {
    expect(getPrimaryFontFamily('"Helvetica Now Display"')).toBe('Helvetica Now Display');
    expect(getPrimaryFontFamily("'Hiragino Sans GB'")).toBe('Hiragino Sans GB');
  });

  it('trims surrounding whitespace before stripping quotes', () => {
    expect(getPrimaryFontFamily('   "Helvetica Now Display"   ')).toBe('Helvetica Now Display');
  });
});

describe('containsChineseText', () => {
  it('returns false for empty or undefined input', () => {
    expect(containsChineseText(undefined)).toBe(false);
    expect(containsChineseText(null)).toBe(false);
    expect(containsChineseText('')).toBe(false);
  });

  it('returns false for pure ASCII text', () => {
    expect(containsChineseText('Hello World')).toBe(false);
  });

  it('returns true for CJK Unified Ideographs', () => {
    expect(containsChineseText('电子课本')).toBe(true);
    expect(containsChineseText('Grade 三年级')).toBe(true);
  });

  it('returns true for CJK Extension A characters', () => {
    expect(containsChineseText('\u3402')).toBe(true);
  });

  it('returns true for CJK Compatibility Ideographs', () => {
    expect(containsChineseText('\uf900')).toBe(true);
  });
});

describe('resolveScreenFontFamily', () => {
  it('falls back to the default screen stack when no font is provided', () => {
    expect(resolveScreenFontFamily(undefined)).toBe(SCREEN_FONT_STACK);
    expect(resolveScreenFontFamily(null)).toBe(SCREEN_FONT_STACK);
    expect(resolveScreenFontFamily('')).toBe(SCREEN_FONT_STACK);
  });

  it('falls back to the default stack when the CSS variable is passed through', () => {
    expect(resolveScreenFontFamily(SCREEN_FONT_CSS_VARIABLE)).toBe(SCREEN_FONT_STACK);
  });

  it('prioritises the Chinese family when it is the primary font', () => {
    const resolved = resolveScreenFontFamily(CHINESE_FONT_FAMILY);
    expect(resolved).toBe(
      `"${CHINESE_FONT_FAMILY}", "${SCREEN_ENGLISH_FONT_FAMILY}", system-ui, sans-serif`,
    );
  });

  it('maps the screen and print English families back to the default stack', () => {
    expect(resolveScreenFontFamily(SCREEN_ENGLISH_FONT_FAMILY)).toBe(SCREEN_FONT_STACK);
    expect(resolveScreenFontFamily(PRINT_ENGLISH_FONT_FAMILY)).toBe(SCREEN_FONT_STACK);
  });

  it('maps legacy Inter / Microsoft YaHei families to the default stack', () => {
    expect(resolveScreenFontFamily('Inter')).toBe(SCREEN_FONT_STACK);
    expect(resolveScreenFontFamily('Microsoft YaHei')).toBe(SCREEN_FONT_STACK);
    expect(resolveScreenFontFamily('Microsoft YaHei UI')).toBe(SCREEN_FONT_STACK);
  });

  it('keeps a custom font family and appends the Chinese fallback', () => {
    const resolved = resolveScreenFontFamily('Comic Sans MS');
    expect(resolved).toBe(`Comic Sans MS, "${CHINESE_FONT_FAMILY}", system-ui, sans-serif`);
  });
});

describe('resolvePrintFontFace', () => {
  it('returns the Chinese family when sample text contains Chinese', () => {
    expect(resolvePrintFontFace('Helvetica Now Text', '三年级上册')).toBe(CHINESE_FONT_FAMILY);
    expect(resolvePrintFontFace(undefined, '数学')).toBe(CHINESE_FONT_FAMILY);
  });

  it('falls back to the default print family when no font is provided', () => {
    expect(resolvePrintFontFace(undefined, 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
    expect(resolvePrintFontFace(null, 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
    expect(resolvePrintFontFace('', 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
  });

  it('falls back to the print family when a CSS variable is passed through', () => {
    expect(resolvePrintFontFace(SCREEN_FONT_CSS_VARIABLE, 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
    expect(resolvePrintFontFace(PRINT_FONT_CSS_VARIABLE, 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
  });

  it('maps the Chinese family to itself', () => {
    expect(resolvePrintFontFace(CHINESE_FONT_FAMILY, 'Hello')).toBe(CHINESE_FONT_FAMILY);
  });

  it('maps the screen English family to the print English family', () => {
    expect(resolvePrintFontFace(SCREEN_ENGLISH_FONT_FAMILY, 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
  });

  it('maps the print English family to itself', () => {
    expect(resolvePrintFontFace(PRINT_ENGLISH_FONT_FAMILY, 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
  });

  it('maps legacy Inter / Microsoft YaHei families to the print English family', () => {
    expect(resolvePrintFontFace('Inter', 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
    expect(resolvePrintFontFace('Microsoft YaHei', 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
    expect(resolvePrintFontFace('Microsoft YaHei UI', 'Hello')).toBe(PRINT_ENGLISH_FONT_FAMILY);
  });

  it('returns the custom family as-is for non-legacy fonts', () => {
    expect(resolvePrintFontFace('Georgia', 'Hello')).toBe('Georgia');
  });
});

describe('getEmbeddedAppFontCss', () => {
  it('returns a non-empty CSS string', () => {
    const css = getEmbeddedAppFontCss();
    expect(css).toBeTruthy();
    expect(css.length).toBeGreaterThan(0);
  });

  it('declares the screen English font family', () => {
    const css = getEmbeddedAppFontCss();
    expect(css).toContain(`font-family: "${SCREEN_ENGLISH_FONT_FAMILY}"`);
  });

  it('declares the print English font family', () => {
    const css = getEmbeddedAppFontCss();
    expect(css).toContain(`font-family: "${PRINT_ENGLISH_FONT_FAMILY}"`);
  });

  it('declares the Chinese font family', () => {
    const css = getEmbeddedAppFontCss();
    expect(css).toContain(`font-family: "${CHINESE_FONT_FAMILY}"`);
  });

  it('exposes the screen and print CSS variables on :root', () => {
    const css = getEmbeddedAppFontCss();
    expect(css).toContain(`--font-screen: ${SCREEN_FONT_STACK}`);
    expect(css).toContain(`--font-print: ${PRINT_FONT_STACK}`);
  });

  it('applies the screen font stack to body by default and the print stack in print media', () => {
    const css = getEmbeddedAppFontCss();
    expect(css).toMatch(/body,[^]*font-family: var\(--font-screen\) !important/);
    expect(css).toMatch(/@media print[^]*font-family: var\(--font-print\) !important/);
  });
});

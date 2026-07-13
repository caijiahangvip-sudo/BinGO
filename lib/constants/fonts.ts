export const SCREEN_ENGLISH_FONT_FAMILY = 'Helvetica Now Display';
export const PRINT_ENGLISH_FONT_FAMILY = 'Helvetica Now Text';
export const CHINESE_FONT_FAMILY = 'Hiragino Sans GB';

export const DEFAULT_SCREEN_FONT_NAME = SCREEN_ENGLISH_FONT_FAMILY;
export const DEFAULT_PRINT_FONT_NAME = PRINT_ENGLISH_FONT_FAMILY;
export const SCREEN_FONT_CSS_VARIABLE = 'var(--font-screen)';
export const PRINT_FONT_CSS_VARIABLE = 'var(--font-print)';

export const SCREEN_FONT_STACK = `"${SCREEN_ENGLISH_FONT_FAMILY}", "${CHINESE_FONT_FAMILY}", system-ui, sans-serif`;
export const PRINT_FONT_STACK = `"${PRINT_ENGLISH_FONT_FAMILY}", "${CHINESE_FONT_FAMILY}", system-ui, sans-serif`;

const CJK_TEXT_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LEGACY_SCREEN_FONT_FAMILIES = new Set(['inter', 'microsoft yahei', 'microsoft yahei ui']);

function stripWrappingQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

export function getPrimaryFontFamily(fontName?: string | null): string {
  if (!fontName) return '';
  const [firstFamily = ''] = fontName.split(',');
  return stripWrappingQuotes(firstFamily);
}

export function containsChineseText(text?: string | null): boolean {
  return Boolean(text && CJK_TEXT_PATTERN.test(text));
}

export function resolveScreenFontFamily(fontName?: string | null): string {
  const primaryFont = getPrimaryFontFamily(fontName);
  const normalizedPrimaryFont = primaryFont.toLowerCase();

  if (!primaryFont || primaryFont === SCREEN_FONT_CSS_VARIABLE) return SCREEN_FONT_STACK;

  if (primaryFont === CHINESE_FONT_FAMILY) {
    return `"${CHINESE_FONT_FAMILY}", "${SCREEN_ENGLISH_FONT_FAMILY}", system-ui, sans-serif`;
  }

  if (
    primaryFont === SCREEN_ENGLISH_FONT_FAMILY ||
    primaryFont === PRINT_ENGLISH_FONT_FAMILY ||
    LEGACY_SCREEN_FONT_FAMILIES.has(normalizedPrimaryFont)
  ) {
    return SCREEN_FONT_STACK;
  }

  return `${fontName}, "${CHINESE_FONT_FAMILY}", system-ui, sans-serif`;
}

export function resolvePrintFontFace(fontName?: string | null, sampleText?: string | null): string {
  if (containsChineseText(sampleText)) {
    return CHINESE_FONT_FAMILY;
  }

  const primaryFont = getPrimaryFontFamily(fontName);
  const normalizedPrimaryFont = primaryFont.toLowerCase();

  if (!primaryFont || primaryFont === SCREEN_FONT_CSS_VARIABLE || primaryFont === PRINT_FONT_CSS_VARIABLE) {
    return PRINT_ENGLISH_FONT_FAMILY;
  }
  if (primaryFont === CHINESE_FONT_FAMILY) return CHINESE_FONT_FAMILY;
  if (primaryFont === SCREEN_ENGLISH_FONT_FAMILY) return PRINT_ENGLISH_FONT_FAMILY;
  if (primaryFont === PRINT_ENGLISH_FONT_FAMILY) return PRINT_ENGLISH_FONT_FAMILY;
  if (LEGACY_SCREEN_FONT_FAMILIES.has(normalizedPrimaryFont)) {
    return PRINT_ENGLISH_FONT_FAMILY;
  }

  return primaryFont;
}

export function getEmbeddedAppFontCss(): string {
  return `
@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayThin.OTF");
  font-weight: 100;
  font-style: normal;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayThIt.OTF");
  font-weight: 100;
  font-style: italic;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayLight.OTF");
  font-weight: 300;
  font-style: normal;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayLtIt.OTF");
  font-weight: 300;
  font-style: italic;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplay.OTF");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayIt.OTF");
  font-weight: 400;
  font-style: italic;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayMedium.OTF");
  font-weight: 500;
  font-style: normal;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayMdIt.OTF");
  font-weight: 500;
  font-style: italic;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayBold.OTF");
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayBdIt.OTF");
  font-weight: 700;
  font-style: italic;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayBlack.OTF");
  font-weight: 900;
  font-style: normal;
}

@font-face {
  font-family: "${SCREEN_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayBlkIt.OTF");
  font-weight: 900;
  font-style: italic;
}

@font-face {
  font-family: "Inter";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplay.OTF");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "Inter";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayMedium.OTF");
  font-weight: 500;
  font-style: normal;
}

@font-face {
  font-family: "Inter";
  src: url("/fonts/custom/display/Display/HelveticaNowDisplayBold.OTF");
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextThin.OTF");
  font-weight: 100;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextThIt.OTF");
  font-weight: 100;
  font-style: italic;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextExtraLight.OTF");
  font-weight: 200;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextLight.OTF");
  font-weight: 300;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextLtIt.OTF");
  font-weight: 300;
  font-style: italic;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowText.OTF");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextIt.OTF");
  font-weight: 400;
  font-style: italic;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextMedium.OTF");
  font-weight: 500;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextMdIt.OTF");
  font-weight: 500;
  font-style: italic;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextBold.OTF");
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextBdIt.OTF");
  font-weight: 700;
  font-style: italic;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextExtraBold.OTF");
  font-weight: 800;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextBlack.OTF");
  font-weight: 900;
  font-style: normal;
}

@font-face {
  font-family: "${PRINT_ENGLISH_FONT_FAMILY}";
  src: url("/fonts/custom/text/Text/HelveticaNowTextBlkIt.OTF");
  font-weight: 900;
  font-style: italic;
}

@font-face {
  font-family: "${CHINESE_FONT_FAMILY}";
  src:
    local("Hiragino Sans GB W3"),
    local("Hiragino Sans GB"),
    url("/fonts/custom/Hiragino%20Sans%20GB.ttc#HiraginoSansGB-W3");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "${CHINESE_FONT_FAMILY}";
  src:
    local("Hiragino Sans GB W6"),
    local("Hiragino Sans GB Bold"),
    url("/fonts/custom/Hiragino%20Sans%20GB.ttc#HiraginoSansGB-W6");
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: "Microsoft YaHei";
  src:
    local("Hiragino Sans GB W3"),
    local("Hiragino Sans GB"),
    url("/fonts/custom/Hiragino%20Sans%20GB.ttc#HiraginoSansGB-W3");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "Microsoft YaHei";
  src:
    local("Hiragino Sans GB W6"),
    local("Hiragino Sans GB Bold"),
    url("/fonts/custom/Hiragino%20Sans%20GB.ttc#HiraginoSansGB-W6");
  font-weight: 700;
  font-style: normal;
}

@font-face {
  font-family: "Microsoft YaHei UI";
  src:
    local("Hiragino Sans GB W3"),
    local("Hiragino Sans GB"),
    url("/fonts/custom/Hiragino%20Sans%20GB.ttc#HiraginoSansGB-W3");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "Microsoft YaHei UI";
  src:
    local("Hiragino Sans GB W6"),
    local("Hiragino Sans GB Bold"),
    url("/fonts/custom/Hiragino%20Sans%20GB.ttc#HiraginoSansGB-W6");
  font-weight: 700;
  font-style: normal;
}

:root {
  --font-screen: ${SCREEN_FONT_STACK};
  --font-print: ${PRINT_FONT_STACK};
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
}

body,
button,
input,
textarea,
select {
  font-family: var(--font-screen) !important;
}

svg text {
  font-family: var(--font-screen);
}

@media print {
  *,
  *::before,
  *::after,
  svg text {
    font-family: var(--font-print) !important;
  }
}
`.trim();
}

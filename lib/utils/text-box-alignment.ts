const CENTER_ALIGN_REGEX = /text-align\s*:\s*center/i;
const ANY_ALIGN_REGEX = /text-align\s*:/i;
const BLOCK_CONTENT_REGEX = /<(ul|ol|li|table|blockquote|pre|h[1-6])\b/i;
const BULLET_PREFIX_REGEX = /^\s*(?:[•●▪◦·\-–—]|\d+[.)]|[A-Za-z][.)])\s+/;

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlToText(html: string): string {
  return decodeBasicHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractParagraphTexts(html: string): string[] {
  const paragraphMatches = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi));
  const rawParagraphs =
    paragraphMatches.length > 0 ? paragraphMatches.map((match) => match[0]) : [html];

  return rawParagraphs.map(stripHtmlToText).filter(Boolean);
}

function getLargestFontSize(html: string, fallback = 18): number {
  const sizes = Array.from(html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi))
    .map((match) => Number.parseFloat(match[1]))
    .filter((size) => Number.isFinite(size) && size > 0);

  return sizes.length > 0 ? Math.max(...sizes) : fallback;
}

export function getTextVisualUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) {
      units += 1;
    } else if (/[a-zA-Z0-9]/.test(char)) {
      units += 0.58;
    } else if (/\s/.test(char)) {
      units += 0.3;
    } else {
      units += 0.7;
    }
  }
  return units;
}

export function hasExplicitTextAlign(html: string): boolean {
  return ANY_ALIGN_REGEX.test(html);
}

export function hasCenteredTextAlign(html: string): boolean {
  return CENTER_ALIGN_REGEX.test(html);
}

export function ensureCenteredParagraphText(html: string): string {
  if (!html.trim()) return html;
  if (hasCenteredTextAlign(html)) return html;

  if (!/<p\b/i.test(html)) {
    return `<p style="text-align: center;">${html}</p>`;
  }

  return html.replace(/<p\b([^>]*)>/gi, (match, attrs: string) => {
    if (/style\s*=\s*"([^"]*)"/i.test(attrs)) {
      return match.replace(/style\s*=\s*"([^"]*)"/i, (_inner, styleValue: string) => {
        const normalized = styleValue.replace(/text-align\s*:\s*[^;]+;?/gi, '').trim();
        const suffix = normalized && !normalized.endsWith(';') ? ';' : '';
        return `style="text-align: center; ${normalized}${suffix}"`;
      });
    }
    if (/style\s*=\s*'([^']*)'/i.test(attrs)) {
      return match.replace(/style\s*=\s*'([^']*)'/i, (_inner, styleValue: string) => {
        const normalized = styleValue.replace(/text-align\s*:\s*[^;]+;?/gi, '').trim();
        const suffix = normalized && !normalized.endsWith(';') ? ';' : '';
        return `style="text-align: center; ${normalized}${suffix}"`;
      });
    }
    return `<p${attrs} style="text-align: center;">`;
  });
}

export function shouldAutoCenterBoxText(options: {
  html: string;
  boxWidth: number;
  boxHeight: number;
  textWidth?: number;
  textHeight?: number;
}): boolean {
  const { html, boxWidth, boxHeight, textWidth, textHeight } = options;

  if (!html.trim()) return false;
  if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight)) return false;
  if (boxWidth < 120 || boxHeight < 28) return false;
  if (BLOCK_CONTENT_REGEX.test(html)) return false;

  const paragraphs = extractParagraphTexts(html);
  if (paragraphs.length === 0 || paragraphs.length > 2) return false;
  if (paragraphs.some((paragraph) => BULLET_PREFIX_REGEX.test(paragraph))) return false;

  const combinedText = paragraphs.join(' ');
  const combinedUnits = getTextVisualUnits(combinedText);
  const isShortBoxLabel = combinedUnits <= 16;
  const isHorizontalPromptStrip = boxWidth >= 360 && boxHeight <= 110 && boxWidth / boxHeight >= 4;
  if (
    !isHorizontalPromptStrip &&
    !isShortBoxLabel &&
    boxHeight > 96 &&
    boxWidth / boxHeight < 2.4
  ) {
    return false;
  }
  const maxCombinedUnits = isHorizontalPromptStrip ? 86 : 42;
  const maxParagraphUnits = isHorizontalPromptStrip ? 76 : 30;
  if (combinedUnits > maxCombinedUnits) return false;
  if (paragraphs.some((paragraph) => getTextVisualUnits(paragraph) > maxParagraphUnits)) {
    return false;
  }
  if (getLargestFontSize(html, 16) < 14) return false;

  if (Number.isFinite(textWidth)) {
    const widthRatio = Number(textWidth) / boxWidth;
    const minWidthRatio = isHorizontalPromptStrip ? 0.18 : isShortBoxLabel ? 0.08 : 0.25;
    const maxWidthRatio = isHorizontalPromptStrip || isShortBoxLabel ? 1.05 : 0.92;
    if (widthRatio < minWidthRatio || widthRatio > maxWidthRatio) return false;
  }

  if (Number.isFinite(textHeight)) {
    const heightRatio = Number(textHeight) / boxHeight;
    if (heightRatio > 0.82) return false;
  }

  return true;
}

export function hasVisibleTextBoxFill(fill: unknown): boolean {
  if (typeof fill !== 'string') return false;

  const normalized = fill.trim().toLowerCase();
  if (!normalized || normalized === 'none' || normalized === 'transparent') return false;
  if (/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(normalized)) return false;
  if (/^#[0-9a-f]{8}$/.test(normalized) && normalized.endsWith('00')) return false;

  return true;
}

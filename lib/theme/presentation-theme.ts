import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';
import type { GeneratedSlideContent } from '@/lib/types/generation';
import type {
  Gradient,
  PPTChartElement,
  PPTElement,
  PPTShapeElement,
  PPTTableElement,
  PPTTextElement,
  SlideBackground,
  SlideTheme,
} from '@/lib/types/slides';
import {
  DEFAULT_COLOR_THEME_ID,
  getColorThemePreset,
  getPresentationPalette,
  resolveColorThemeId,
  type ColorThemeId,
  type PresentationPalette,
} from './color-themes';

type PaletteColorKey = keyof Pick<
  PresentationPalette,
  | 'background'
  | 'surface'
  | 'surfaceAlt'
  | 'title'
  | 'text'
  | 'muted'
  | 'primary'
  | 'primarySoft'
  | 'secondary'
  | 'secondarySoft'
  | 'accent'
  | 'accentSoft'
  | 'success'
  | 'successSoft'
  | 'warning'
  | 'warningSoft'
  | 'danger'
  | 'border'
  | 'divider'
>;

const DEFAULT_COLOR_ROLE: Record<string, PaletteColorKey> = {
  '#ffffff': 'background',
  '#fff': 'background',
  '#f8fafc': 'surfaceAlt',
  '#f5f8ff': 'primarySoft',
  '#eff6ff': 'primarySoft',
  '#dbeafe': 'primarySoft',
  '#bfdbfe': 'primarySoft',
  '#c7d2fe': 'primarySoft',
  '#ecfdf5': 'successSoft',
  '#dcfce7': 'successSoft',
  '#fff7ed': 'warningSoft',
  '#ffedd5': 'warningSoft',
  '#fed7aa': 'warningSoft',
  '#fef3c7': 'warningSoft',
  '#e2e8f0': 'border',
  '#e5e7eb': 'border',
  '#d1d5db': 'border',
  '#111827': 'title',
  '#0f172a': 'title',
  '#333333': 'text',
  '#334155': 'text',
  '#3730a3': 'text',
  '#475569': 'muted',
  '#5b6472': 'muted',
  '#64748b': 'muted',
  '#2563eb': 'primary',
  '#1d4ed8': 'primary',
  '#5b9bd5': 'primary',
  '#16a34a': 'success',
  '#166534': 'success',
  '#22c55e': 'success',
  '#f59e0b': 'accent',
  '#f97316': 'accent',
  '#ed7d31': 'accent',
  '#b45309': 'accent',
  '#92400e': 'accent',
  '#ffc000': 'warning',
  '#dc2626': 'danger',
  '#ef4444': 'danger',
};

function normalizeHex(value: string): string {
  return value.trim().toLowerCase();
}

function mapColor(value: unknown, palette: PresentationPalette): unknown {
  if (typeof value !== 'string') return value;
  const normalized = normalizeHex(value);
  const role = DEFAULT_COLOR_ROLE[normalized];
  return role ? palette[role] : value;
}

function replaceHtmlColors(value: string, palette: PresentationPalette): string {
  return value.replace(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g, (color) => {
    const mapped = mapColor(color, palette);
    return typeof mapped === 'string' ? mapped : color;
  });
}

function themeGradient(
  gradient: Gradient | undefined,
  palette: PresentationPalette,
): Gradient | undefined {
  if (!gradient) return undefined;
  return {
    ...gradient,
    colors: gradient.colors.map((item) => ({
      ...item,
      color: String(mapColor(item.color, palette)),
    })),
  };
}

function themeBackground(
  background: SlideBackground | GeneratedSlideContent['background'] | undefined,
  palette: PresentationPalette,
): typeof background {
  if (!background) return background;
  if (background.type === 'solid') {
    return {
      ...background,
      color:
        typeof background.color === 'string'
          ? String(mapColor(background.color, palette))
          : background.color,
    };
  }
  if (background.type === 'gradient') {
    return {
      ...background,
      gradient: themeGradient(background.gradient, palette),
    };
  }
  return background;
}

function themeElement(element: PPTElement, palette: PresentationPalette): PPTElement {
  const next = { ...element } as PPTElement;

  if ('fill' in next) {
    (next as PPTShapeElement | PPTTextElement).fill = mapColor(
      (next as PPTShapeElement | PPTTextElement).fill,
      palette,
    ) as string | undefined;
  }

  if ('outline' in next && next.outline) {
    next.outline = {
      ...next.outline,
      color: mapColor(next.outline.color, palette) as string | undefined,
    };
  }

  if ('defaultColor' in next) {
    next.defaultColor = String(mapColor(next.defaultColor, palette));
  }

  if (next.type === 'text') {
    next.content = replaceHtmlColors(next.content, palette);
  }

  if (next.type === 'shape' && next.text) {
    next.text = {
      ...next.text,
      defaultColor: String(mapColor(next.text.defaultColor, palette)),
      content:
        typeof next.text.content === 'string'
          ? replaceHtmlColors(next.text.content, palette)
          : next.text.content,
    };
  }

  if (next.type === 'shape' && next.gradient) {
    next.gradient = themeGradient(next.gradient, palette);
  }

  if (next.type === 'line') {
    next.color = String(mapColor(next.color, palette));
  }

  if (next.type === 'chart') {
    (next as PPTChartElement).themeColors = [...palette.chartColors];
  }

  if (next.type === 'table') {
    const table = next as PPTTableElement;
    const tableTheme = table.theme;
    if (!tableTheme) return next;
    table.theme = {
      ...tableTheme,
      color: String(mapColor(tableTheme.color, palette)),
    };
  }

  return next;
}

export function applyPresentationThemeToSlideContent(
  content: GeneratedSlideContent,
  visualTheme?: ColorThemeId,
): GeneratedSlideContent {
  const palette = getPresentationPalette(visualTheme);
  return {
    ...content,
    elements: content.elements.map((element) => themeElement(element, palette)),
    background: themeBackground(content.background, palette),
  };
}

export function createSlideTheme(visualTheme?: ColorThemeId): SlideTheme {
  const palette = getPresentationPalette(visualTheme);
  return {
    backgroundColor: palette.background,
    themeColors: [...palette.chartColors],
    fontColor: palette.text,
    fontName: DEFAULT_SCREEN_FONT_NAME,
    outline: { color: palette.divider, width: 2, style: 'solid' },
    shadow: { h: 0, v: 0, blur: 10, color: '#000000' },
  };
}

export function buildPresentationThemePrompt(
  visualTheme: ColorThemeId | undefined,
  language: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const themeId = resolveColorThemeId(visualTheme);
  const preset = getColorThemePreset(themeId);
  const palette = preset.presentation;
  const name = language === 'en-US' ? preset.label.en : preset.label.zh;
  const description = language === 'en-US' ? preset.description.en : preset.description.zh;

  if (language === 'en-US') {
    return [
      `Theme: ${name} (${themeId}).`,
      `Intent: ${description}.`,
      `Use this palette: background ${palette.background}, surface ${palette.surface}, text ${palette.text}, muted ${palette.muted}, primary ${palette.primary}, secondary ${palette.secondary}, accent ${palette.accent}, success ${palette.success}, warning ${palette.warning}.`,
      'Keep slides readable, restrained, and classroom-focused. Use light content panels unless the selected theme is explicitly dark.',
    ].join('\n');
  }

  return [
    `主题：${name}（${themeId}）。`,
    `风格意图：${description}。`,
    `请优先使用这些色值：背景 ${palette.background}，卡片 ${palette.surface}，正文 ${palette.text}，弱化文字 ${palette.muted}，主色 ${palette.primary}，辅助色 ${palette.secondary}，强调色 ${palette.accent}，正确/成长 ${palette.success}，提示 ${palette.warning}。`,
    '页面保持清晰、克制、适合课堂投屏；除深色主题外，主体内容区优先使用浅色面板。',
  ].join('\n');
}

export function getDefaultColorThemeId(): ColorThemeId {
  return DEFAULT_COLOR_THEME_ID;
}

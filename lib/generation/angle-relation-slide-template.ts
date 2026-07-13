import type { GeneratedSlideContent, SceneOutline } from '@/lib/types/generation';
import type { PPTElement, PPTLineElement, PPTShapeElement, PPTTextElement } from '@/lib/types/slides';
import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';

const ELLIPSE_PATH = 'M 100 0 A 100 100 0 1 1 99.8 0 Z';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function htmlParagraph(
  text: string,
  options: {
    readonly fontSize: number;
    readonly color: string;
    readonly weight?: number;
    readonly align?: 'left' | 'center' | 'right';
    readonly lineHeight?: number;
  },
): string {
  const weight = options.weight ? ` font-weight: ${options.weight};` : '';
  const align = options.align ? ` text-align: ${options.align};` : '';
  return `<p style="font-size: ${options.fontSize}px; color: ${options.color};${weight}${align} line-height: ${
    options.lineHeight ?? 1.2
  };">${escapeHtml(text)}</p>`;
}

function textElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  content: string,
  defaultColor: string,
  textType?: PPTTextElement['textType'],
): PPTTextElement {
  return {
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    rotate: 0,
    content,
    defaultFontName: DEFAULT_SCREEN_FONT_NAME,
    defaultColor,
    textType,
  };
}

function lineElement(
  id: string,
  left: number,
  top: number,
  start: [number, number],
  end: [number, number],
  width: number,
  color: string,
  points: PPTLineElement['points'] = ['', ''],
  style: PPTLineElement['style'] = 'solid',
): PPTLineElement {
  return {
    id,
    type: 'line',
    left,
    top,
    width,
    start,
    end,
    style,
    color,
    points,
  };
}

function shapeElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  path: string,
  fill: string,
  outline?: PPTShapeElement['outline'],
  opacity?: number,
): PPTShapeElement {
  return {
    id,
    type: 'shape',
    left,
    top,
    width,
    height,
    rotate: 0,
    viewBox: [200, 200],
    path,
    fixedRatio: false,
    fill,
    ...(outline ? { outline } : {}),
    ...(opacity === undefined ? {} : { opacity }),
  };
}

export function isAngleRelationSlideOutline(outline: SceneOutline): boolean {
  const haystack = [
    outline.title,
    outline.description,
    ...(outline.keyPoints || []),
  ]
    .map(normalizeText)
    .join('\n')
    .toLowerCase();

  return [
    '邻补角',
    '补角',
    '平角',
    '公共边',
    '反向延长线',
    '反向延长',
    '和为180',
    '180°',
    '180度',
    '∠1+∠2',
    '∠1 + ∠2',
    'linear pair',
    'supplementary angle',
    'supplementary angles',
  ].some((keyword) => haystack.includes(keyword));
}

export function buildAngleRelationSlideContent(outline: SceneOutline): GeneratedSlideContent {
  const language = outline.language || 'zh-CN';
  const isChinese = language !== 'en-US';
  const title =
    normalizeText(outline.title) || (isChinese ? '邻补角：公共边与反向延长线' : 'Linear Pair');
  const subtitle = isChinese
    ? '两个角共用一条边，另外两边互为反向延长线。'
    : 'Two adjacent angles share a side, and their other sides form a straight line.';
  const formula = isChinese ? '邻补角：∠1 + ∠2 = 180°' : 'Linear pair: ∠1 + ∠2 = 180°';
  const conclusion = isChinese
    ? '判断时先找公共边，再看另外两条边是否在同一条直线上。'
    : 'First find the shared side, then check whether the other two sides form one line.';

  const elements: PPTElement[] = [
    textElement(
      'template_angle_title',
      58,
      34,
      884,
      48,
      htmlParagraph(title, {
        fontSize: 30,
        color: '#0f172a',
        weight: 760,
        align: 'center',
      }),
      '#0f172a',
      'title',
    ),
    textElement(
      'template_angle_subtitle',
      130,
      84,
      740,
      34,
      htmlParagraph(subtitle, {
        fontSize: 17,
        color: '#475569',
        weight: 500,
        align: 'center',
        lineHeight: 1.3,
      }),
      '#475569',
      'subtitle',
    ),

    lineElement('template_line_a', 126, 252, [0, 0], [748, 0], 5, '#2563eb'),
    lineElement('template_line_b', 290, 106, [0, 292], [430, 0], 5, '#111827'),
    lineElement('template_common_side', 500, 122, [0, 130], [192, 0], 7, '#f97316'),
    lineElement('template_reverse_extension', 324, 252, [0, 120], [176, 0], 5, '#2563eb', ['', ''], 'dashed'),

    shapeElement(
      'template_angle_arc_1',
      346,
      140,
      204,
      204,
      'M 24 110 A 84 84 0 0 1 176 49',
      'none',
      { style: 'solid', width: 5, color: '#f59e0b' },
    ),
    shapeElement(
      'template_angle_arc_2',
      500,
      140,
      184,
      184,
      'M 54 51 A 86 86 0 0 1 176 110',
      'none',
      { style: 'solid', width: 5, color: '#2563eb' },
    ),
    shapeElement('template_center_dot', 491, 243, 18, 18, ELLIPSE_PATH, '#111827'),

    textElement(
      'template_angle_label_1',
      384,
      196,
      44,
      34,
      htmlParagraph('1', { fontSize: 24, color: '#b45309', weight: 760, align: 'center' }),
      '#b45309',
      'itemNumber',
    ),
    textElement(
      'template_angle_label_2',
      634,
      194,
      44,
      34,
      htmlParagraph('2', { fontSize: 24, color: '#1d4ed8', weight: 760, align: 'center' }),
      '#1d4ed8',
      'itemNumber',
    ),
    textElement(
      'template_label_common_side',
      612,
      112,
      126,
      34,
      htmlParagraph(isChinese ? '公共边' : 'shared side', {
        fontSize: 19,
        color: '#c2410c',
        weight: 700,
        align: 'center',
      }),
      '#c2410c',
      'itemTitle',
    ),
    textElement(
      'template_label_reverse_extension',
      282,
      342,
      196,
      34,
      htmlParagraph(isChinese ? '反向延长线' : 'opposite ray', {
        fontSize: 19,
        color: '#1d4ed8',
        weight: 700,
        align: 'center',
      }),
      '#1d4ed8',
      'itemTitle',
    ),
    textElement(
      'template_label_o',
      518,
      236,
      44,
      32,
      htmlParagraph('O', { fontSize: 22, color: '#0f172a', weight: 700, align: 'center' }),
      '#0f172a',
      'itemTitle',
    ),
    textElement(
      'template_label_a',
      886,
      238,
      36,
      30,
      htmlParagraph('a', { fontSize: 22, color: '#0f172a', weight: 700, align: 'center' }),
      '#0f172a',
      'itemTitle',
    ),
    textElement(
      'template_label_b',
      720,
      84,
      36,
      30,
      htmlParagraph('b', { fontSize: 22, color: '#0f172a', weight: 700, align: 'center' }),
      '#0f172a',
      'itemTitle',
    ),

    textElement(
      'template_angle_formula',
      238,
      424,
      524,
      60,
      htmlParagraph(formula, {
        fontSize: 38,
        color: '#111827',
        weight: 700,
        align: 'center',
        lineHeight: 1.1,
      }),
      '#111827',
      'content',
    ),
    textElement(
      'template_angle_conclusion',
      160,
      492,
      680,
      34,
      htmlParagraph(conclusion, {
        fontSize: 16,
        color: '#475569',
        weight: 600,
        align: 'center',
        lineHeight: 1.3,
      }),
      '#475569',
      'notes',
    ),
  ];

  return {
    elements,
    background: { type: 'solid', color: '#ffffff' },
    remark: normalizeText(outline.description) || subtitle,
  };
}

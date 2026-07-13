import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';
import type { GeneratedSlideContent, SceneOutline } from '@/lib/types/generation';
import type {
  PPTElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTextElement,
} from '@/lib/types/slides';

const RECT_PATH = 'M 0 0 L 1 0 L 1 1 L 0 1 Z';
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

function htmlStack(lines: readonly string[], fontSize: number, color: string): string {
  return lines
    .map((line, index) =>
      htmlParagraph(line, {
        fontSize,
        color,
        weight: index === 0 ? 760 : 560,
        align: 'center',
        lineHeight: index === 0 ? 1.15 : 1.25,
      }),
    )
    .join('');
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
    viewBox: path === RECT_PATH ? [1, 1] : [200, 200],
    path,
    fixedRatio: false,
    fill,
    ...(outline ? { outline } : {}),
    ...(opacity === undefined ? {} : { opacity }),
  };
}

function outlineText(outline: SceneOutline): string {
  return [outline.title, outline.description, ...(outline.keyPoints || [])]
    .map(normalizeText)
    .join('\n')
    .toLowerCase();
}

export function isIntersectingLinesSlideOutline(outline: SceneOutline): boolean {
  const haystack = outlineText(outline);

  if (
    ['相交线', '对顶角', 'intersecting lines', 'vertical angles', 'opposite angles'].some(
      (keyword) => haystack.includes(keyword),
    )
  ) {
    return true;
  }

  if (
    haystack.includes('四个角') &&
    (haystack.includes('直线') || haystack.includes('相交') || haystack.includes('line'))
  ) {
    return true;
  }

  const numberedAngles = ['∠1', '∠2', '∠3', '∠4', '角1', '角2', '角3', '角4'].filter((keyword) =>
    haystack.includes(keyword),
  );

  return (
    numberedAngles.length >= 3 &&
    (haystack.includes('交点') || haystack.includes('直线') || haystack.includes('line'))
  );
}

export function buildIntersectingLinesSlideContent(outline: SceneOutline): GeneratedSlideContent {
  const language = outline.language || 'zh-CN';
  const isChinese = language !== 'en-US';
  const title = normalizeText(outline.title) || (isChinese ? '相交线模型' : 'Intersecting Lines');
  const subtitle = isChinese
    ? '两条直线相交形成四个角，关系可以从交点 O 开始读。'
    : 'Two intersecting lines form four angles around point O.';
  const verticalRule = isChinese ? '对顶角相等' : 'Vertical angles';
  const verticalFormula = isChinese ? '∠1 = ∠3，∠2 = ∠4' : '∠1 = ∠3, ∠2 = ∠4';
  const adjacentRule = isChinese ? '邻补角互补' : 'Adjacent angles';
  const adjacentFormula = isChinese ? '相邻两角和为 180°' : 'Adjacent angles sum to 180°';
  const readingRule = isChinese ? '读图顺序' : 'Read the diagram';
  const readingFormula = isChinese ? '先找交点 O，再顺时针编号' : 'Find O, then read clockwise';
  const prompt = isChinese
    ? '课堂互动：找一找 ∠1 的对顶角和邻补角。'
    : 'Class check: find the vertical and adjacent angles of ∠1.';

  const elements: PPTElement[] = [
    textElement(
      'template_intersect_title',
      64,
      50,
      872,
      42,
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
      'template_intersect_subtitle',
      120,
      96,
      760,
      30,
      htmlParagraph(subtitle, {
        fontSize: 17,
        color: '#475569',
        weight: 520,
        align: 'center',
        lineHeight: 1.25,
      }),
      '#475569',
      'subtitle',
    ),
    lineElement('template_intersect_divider', 64, 130, [0, 0], [872, 0], 3, '#2563eb'),

    shapeElement('template_intersect_diagram_panel', 64, 146, 610, 320, RECT_PATH, '#f8fafc', {
      style: 'solid',
      width: 2,
      color: '#dbeafe',
    }),
    shapeElement(
      'template_intersect_angle_1_hint',
      342,
      250,
      82,
      82,
      'M 174 58 A 74 74 0 0 0 64 34',
      'none',
      { style: 'solid', width: 5, color: '#f59e0b' },
    ),
    shapeElement(
      'template_intersect_angle_3_hint',
      312,
      288,
      92,
      92,
      'M 32 142 A 76 76 0 0 0 142 170',
      'none',
      { style: 'solid', width: 5, color: '#f59e0b' },
    ),
    shapeElement(
      'template_intersect_angle_2_hint',
      296,
      258,
      84,
      84,
      'M 46 38 A 76 76 0 0 0 30 148',
      'none',
      { style: 'solid', width: 5, color: '#2563eb' },
    ),
    shapeElement(
      'template_intersect_angle_4_hint',
      368,
      288,
      84,
      84,
      'M 152 42 A 76 76 0 0 0 164 148',
      'none',
      { style: 'solid', width: 5, color: '#2563eb' },
    ),
    lineElement('template_intersect_main_line_l', 128, 208, [0, 196], [482, 0], 5, '#111827'),
    lineElement('template_intersect_main_line_m', 138, 194, [0, 0], [462, 224], 5, '#111827'),
    shapeElement('template_intersect_center_dot', 363, 300, 12, 12, ELLIPSE_PATH, '#111827'),

    textElement(
      'template_intersect_angle_label_1',
      382,
      246,
      36,
      30,
      htmlParagraph('1', { fontSize: 24, color: '#b45309', weight: 760, align: 'center' }),
      '#b45309',
      'itemNumber',
    ),
    textElement(
      'template_intersect_angle_label_2',
      304,
      294,
      36,
      30,
      htmlParagraph('2', { fontSize: 24, color: '#1d4ed8', weight: 760, align: 'center' }),
      '#1d4ed8',
      'itemNumber',
    ),
    textElement(
      'template_intersect_angle_label_3',
      338,
      350,
      36,
      30,
      htmlParagraph('3', { fontSize: 24, color: '#b45309', weight: 760, align: 'center' }),
      '#b45309',
      'itemNumber',
    ),
    textElement(
      'template_intersect_angle_label_4',
      430,
      300,
      36,
      30,
      htmlParagraph('4', { fontSize: 24, color: '#1d4ed8', weight: 760, align: 'center' }),
      '#1d4ed8',
      'itemNumber',
    ),
    textElement(
      'template_intersect_label_o',
      382,
      284,
      34,
      28,
      htmlParagraph('O', { fontSize: 21, color: '#0f172a', weight: 760, align: 'center' }),
      '#0f172a',
      'itemTitle',
    ),
    textElement(
      'template_intersect_label_l',
      620,
      194,
      34,
      28,
      htmlParagraph('l', { fontSize: 23, color: '#0f172a', weight: 760, align: 'center' }),
      '#0f172a',
      'itemTitle',
    ),
    textElement(
      'template_intersect_label_m',
      608,
      406,
      34,
      28,
      htmlParagraph('m', { fontSize: 23, color: '#0f172a', weight: 760, align: 'center' }),
      '#0f172a',
      'itemTitle',
    ),

    shapeElement('template_intersect_vertical_card', 714, 146, 250, 96, RECT_PATH, '#eff6ff', {
      style: 'solid',
      width: 2,
      color: '#bfdbfe',
    }),
    textElement(
      'template_intersect_vertical_text',
      730,
      162,
      218,
      64,
      htmlStack([verticalRule, verticalFormula], 19, '#1d4ed8'),
      '#1d4ed8',
      'content',
    ),
    shapeElement('template_intersect_adjacent_card', 714, 262, 250, 96, RECT_PATH, '#fff7ed', {
      style: 'solid',
      width: 2,
      color: '#fed7aa',
    }),
    textElement(
      'template_intersect_adjacent_text',
      730,
      278,
      218,
      64,
      htmlStack([adjacentRule, adjacentFormula], 19, '#c2410c'),
      '#c2410c',
      'content',
    ),
    shapeElement('template_intersect_reading_card', 714, 378, 250, 88, RECT_PATH, '#f8fafc', {
      style: 'solid',
      width: 2,
      color: '#e2e8f0',
    }),
    textElement(
      'template_intersect_reading_text',
      730,
      392,
      218,
      60,
      htmlStack([readingRule, readingFormula], 18, '#334155'),
      '#334155',
      'content',
    ),
    shapeElement('template_intersect_prompt_strip', 64, 486, 900, 46, RECT_PATH, '#eef2ff', {
      style: 'solid',
      width: 2,
      color: '#c7d2fe',
    }),
    textElement(
      'template_intersect_prompt_text',
      84,
      494,
      860,
      30,
      htmlParagraph(prompt, {
        fontSize: 18,
        color: '#3730a3',
        weight: 680,
        align: 'center',
        lineHeight: 1.2,
      }),
      '#3730a3',
      'notes',
    ),
  ];

  return {
    elements,
    background: { type: 'solid', color: '#ffffff' },
    remark: normalizeText(outline.description) || subtitle,
  };
}

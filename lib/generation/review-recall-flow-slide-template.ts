import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';
import type { GeneratedSlideContent, SceneOutline } from '@/lib/types/generation';
import type {
  PPTElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTextElement,
} from '@/lib/types/slides';
import { buildCenteredFlowRow, buildFlowConnectors } from './card-flow-layout';

const RECT_PATH = 'M 0 0 L 1 0 L 1 1 L 0 1 Z';

interface RecallColumn {
  readonly key: 'recall' | 'anchor' | 'gap';
  readonly title: string;
  readonly points: string[];
  readonly color: string;
  readonly softColor: string;
}

const COLUMN_LABELS: Record<RecallColumn['key'], readonly string[]> = {
  recall: ['旧知扫描', '旧知回顾', '旧知唤醒', '旧知', 'Prior Knowledge', 'Review Recall'],
  anchor: ['课文支点', '文本支点', '学习支点', '支点', 'Text Anchor', 'Lesson Anchor'],
  gap: ['先补问题', '补足问题', '补问题', '薄弱点', '问题', 'Gap to Fix', 'Learning Gap'],
};

const COLUMN_TITLES: Record<RecallColumn['key'], { zh: string; en: string }> = {
  recall: { zh: '旧知扫描', en: 'Prior Knowledge' },
  anchor: { zh: '课文支点', en: 'Text Anchor' },
  gap: { zh: '先补问题', en: 'Gap to Fix' },
};

const FALLBACK_COLUMN_POINTS: Record<
  RecallColumn['key'],
  { zh: readonly string[]; en: readonly string[] }
> = {
  recall: {
    zh: ['回顾已学方法', '唤醒关键词'],
    en: ['Recall known methods', 'Reactivate key terms'],
  },
  anchor: {
    zh: ['定位课文线索', '连接本课目标'],
    en: ['Find text anchors', 'Connect to today'],
  },
  gap: {
    zh: ['标出疑问点', '明确待补内容'],
    en: ['Mark unclear points', 'Name the gap to fix'],
  },
};

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
    options.lineHeight ?? 1.25
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

function shapeElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
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
    viewBox: [1, 1],
    path: RECT_PATH,
    fixedRatio: false,
    fill,
    ...(outline ? { outline } : {}),
    ...(opacity === undefined ? {} : { opacity }),
  };
}

function lineElement(
  id: string,
  left: number,
  top: number,
  length: number,
  color: string,
  points: PPTLineElement['points'] = ['', ''],
): PPTLineElement {
  return {
    id,
    type: 'line',
    left,
    top,
    width: 3,
    start: [0, 0],
    end: [length, 0],
    style: 'solid',
    color,
    points,
  };
}

function outlineText(outline: SceneOutline): string {
  return [outline.title, outline.description, ...(outline.keyPoints || [])]
    .map(normalizeText)
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function isReviewRecallFlowSlideOutline(outline: SceneOutline): boolean {
  if (outline.type !== 'slide') return false;

  const text = outlineText(outline);
  if (outline.learningContext?.section === 'review') return true;

  return /(?:复习导入|旧知唤醒|旧知扫描|旧知回顾|课文支点|文本支点|学习支点|先补问题|补足问题|薄弱点|review\s*intro|prior\s*knowledge|warm[-\s]*up)/i.test(
    text,
  );
}

function splitPointText(value: string): string[] {
  return value
    .replace(/[•·]/g, '、')
    .split(/[、,，;；/]/u)
    .map((item) => item.replace(/^[-—–\s]+/, '').trim())
    .filter(Boolean);
}

function stripLabeledPoint(value: string): string {
  let text = normalizeText(value);
  for (const labels of Object.values(COLUMN_LABELS)) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`^${escaped}\\s*[:：\\-—–]?\\s*`, 'iu'), '').trim();
    }
  }
  return text;
}

function extractLabeledPoints(sources: readonly string[], labels: readonly string[]): string[] {
  const points: string[] = [];
  const labelPattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const pattern = new RegExp(`(?:${labelPattern})\\s*[:：]\\s*([^\\n。]+)`, 'iu');

  for (const source of sources) {
    const match = source.match(pattern);
    if (match?.[1]) points.push(...splitPointText(match[1]));
  }

  return [...new Set(points)].slice(0, 4);
}

function distributePoints(points: readonly string[]): string[][] {
  const cleaned = points.map(normalizeText).filter(Boolean);
  if (cleaned.length === 0) return [[], [], []];

  return [
    cleaned.filter((_, index) => index % 3 === 0).slice(0, 4),
    cleaned.filter((_, index) => index % 3 === 1).slice(0, 4),
    cleaned.filter((_, index) => index % 3 === 2).slice(0, 4),
  ];
}

function buildColumns(outline: SceneOutline): RecallColumn[] {
  const isEnglish = outline.language === 'en-US';
  const languageKey = isEnglish ? 'en' : 'zh';
  const sources = [outline.title, outline.description, ...(outline.keyPoints || [])]
    .map(normalizeText)
    .filter(Boolean);
  const distributed = distributePoints((outline.keyPoints || []).map(stripLabeledPoint));

  const withFallback = (key: RecallColumn['key'], points: string[], fallback: string[]) =>
    points.length > 0
      ? points
      : fallback.length > 0
        ? fallback
        : [...FALLBACK_COLUMN_POINTS[key][isEnglish ? 'en' : 'zh']];

  const recallPoints = withFallback(
    'recall',
    extractLabeledPoints(sources, COLUMN_LABELS.recall),
    distributed[0],
  );
  const anchorPoints = withFallback(
    'anchor',
    extractLabeledPoints(sources, COLUMN_LABELS.anchor),
    distributed[1],
  );
  const gapPoints = withFallback(
    'gap',
    extractLabeledPoints(sources, COLUMN_LABELS.gap),
    distributed[2],
  );

  return [
    {
      key: 'recall',
      title: COLUMN_TITLES.recall[languageKey],
      points: recallPoints,
      color: '#2563eb',
      softColor: '#eff6ff',
    },
    {
      key: 'anchor',
      title: COLUMN_TITLES.anchor[languageKey],
      points: anchorPoints,
      color: '#16a34a',
      softColor: '#ecfdf5',
    },
    {
      key: 'gap',
      title: COLUMN_TITLES.gap[languageKey],
      points: gapPoints,
      color: '#f59e0b',
      softColor: '#fff7ed',
    },
  ];
}

function bulletHtml(points: readonly string[], color: string): string {
  return points
    .slice(0, 4)
    .map(
      (point) =>
        `<p style="font-size: 16px; color: ${color}; line-height: 1.42;">&bull; ${escapeHtml(
          point,
        )}</p>`,
    )
    .join('');
}

export function buildReviewRecallFlowSlideContent(outline: SceneOutline): GeneratedSlideContent {
  const language = outline.language || 'zh-CN';
  const isChinese = language !== 'en-US';
  const title = normalizeText(outline.title) || (isChinese ? '复习导入' : 'Review Warm-Up');
  const tag = isChinese ? '旧知唤醒' : 'Prior Knowledge';
  const prompt = isChinese
    ? '课堂互动：圈出最需要补足的一个点'
    : 'Class check: circle one point that needs review';
  const columns = buildColumns(outline);
  const cardRects = buildCenteredFlowRow({
    count: columns.length,
    contentLeft: 76,
    contentRight: 934,
    itemTop: 166,
    itemWidth: 240,
    itemHeight: 268,
    minGap: 64,
  });
  const connectors = buildFlowConnectors(cardRects, {
    y: cardRects[0]?.centerY ?? 300,
    padding: 12,
    minLength: 44,
  });

  const elements: PPTElement[] = [
    textElement(
      'template_review_recall_title',
      76,
      50,
      500,
      58,
      htmlParagraph(title, {
        fontSize: 32,
        color: '#0f172a',
        weight: 760,
        lineHeight: 1.15,
      }),
      '#0f172a',
      'title',
    ),
    shapeElement('template_review_recall_tag_bg', 738, 50, 196, 44, '#ffffff', {
      style: 'solid',
      width: 1,
      color: '#e5e7eb',
    }),
    textElement(
      'template_review_recall_tag',
      760,
      61,
      152,
      24,
      htmlParagraph(tag, {
        fontSize: 17,
        color: '#475569',
        weight: 620,
        align: 'center',
      }),
      '#475569',
      'subtitle',
    ),
    lineElement('template_review_recall_divider', 76, 128, 858, '#f59e0b'),
  ];

  columns.forEach((column, index) => {
    const card = cardRects[index];
    if (!card) return;
    elements.push(
      shapeElement(
        `template_review_recall_card_${column.key}`,
        card.left,
        card.top,
        card.width,
        card.height,
        column.softColor,
        { style: 'solid', width: 1.5, color: '#e5e7eb' },
      ),
      shapeElement(
        `template_review_recall_card_bar_${column.key}`,
        card.left + 24,
        card.top + 26,
        56,
        8,
        column.color,
      ),
      textElement(
        `template_review_recall_card_title_${column.key}`,
        card.left + 28,
        card.top + 58,
        card.width - 56,
        34,
        htmlParagraph(column.title, {
          fontSize: 22,
          color: column.color,
          weight: 720,
          align: 'center',
          lineHeight: 1.1,
        }),
        column.color,
        'itemTitle',
      ),
      textElement(
        `template_review_recall_card_points_${column.key}`,
        card.left + 34,
        card.top + 114,
        card.width - 68,
        116,
        bulletHtml(column.points, '#334155'),
        '#334155',
        'content',
      ),
    );

    if (index < columns.length - 1) {
      const connector = connectors[index];
      if (!connector) return;
      elements.push(
        lineElement(
          `template_review_recall_step_arrow_${index + 1}`,
          connector.left,
          connector.top,
          connector.length,
          '#f59e0b',
          ['', 'arrow'],
        ),
      );
    }
  });

  elements.push(
    shapeElement('template_review_recall_prompt_bg', 76, 464, 858, 44, '#fff7ed', {
      style: 'solid',
      width: 1,
      color: '#fed7aa',
    }),
    textElement(
      'template_review_recall_prompt',
      150,
      474,
      710,
      24,
      htmlParagraph(prompt, {
        fontSize: 18,
        color: '#334155',
        weight: 650,
        align: 'center',
        lineHeight: 1.1,
      }),
      '#334155',
      'notes',
    ),
  );

  return {
    elements,
    background: { type: 'solid', color: '#ffffff' },
    remark: prompt,
  };
}

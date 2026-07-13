import type {
  GeneratedSlideContent,
  ImageMapping,
  PdfImage,
  SceneOutline,
} from '@/lib/types/generation';
import type {
  PPTElement,
  PPTImageElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTextElement,
} from '@/lib/types/slides';
import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';
import { sanitizeSceneContentOutline } from './scene-content-policy';
import { getPresentationPalette, type ColorThemeId } from '@/lib/theme/color-themes';
import { applyPresentationThemeToSlideContent } from '@/lib/theme/presentation-theme';
import { buildCenteredFlowRow } from './card-flow-layout';
import { buildReviewRecallFlowSlideContent } from './review-recall-flow-slide-template';
import { resolveSlideLayoutVariant, type SlideLayoutVariantId } from './slide-layout-variants';
import { normalizeVisibleSlideLayout } from '@/lib/utils/slide-element-layout';

const RECT_PATH = 'M 0 0 L 1 0 L 1 1 L 0 1 Z';

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

function paragraph(
  text: string,
  options: {
    fontSize: number;
    color: string;
    weight?: number;
    lineHeight?: number;
    align?: 'left' | 'center' | 'right';
  },
): string {
  const fontWeight = options.weight ? ` font-weight: ${options.weight};` : '';
  const lineHeight = options.lineHeight ?? 1.35;
  const textAlign = options.align ? ` text-align: ${options.align};` : '';
  return `<p style="font-size: ${options.fontSize}px; color: ${options.color};${fontWeight} line-height: ${lineHeight};${textAlign}">${escapeHtml(text)}</p>`;
}

function textElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  content: string,
  color: string,
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
    defaultColor: color,
    textType,
  };
}

function finalizeFallbackSlideContent(content: GeneratedSlideContent): GeneratedSlideContent {
  return {
    ...content,
    elements: normalizeVisibleSlideLayout(content.elements) as PPTElement[],
  };
}

function shapeElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
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

function verticalLineElement(
  id: string,
  left: number,
  top: number,
  length: number,
  color: string,
): PPTLineElement {
  return {
    id,
    type: 'line',
    left,
    top,
    width: 3,
    start: [0, 0],
    end: [0, length],
    style: 'solid',
    color,
    points: ['', ''],
  };
}

function isUsableImageSrc(src?: string): src is string {
  if (!src) return false;
  return src.startsWith('data:image/') || src.startsWith('http://') || src.startsWith('https://');
}

function findFallbackImageSrc(
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
): string | undefined {
  if (!assignedImages) return undefined;

  for (const image of assignedImages) {
    const src = imageMapping?.[image.id] || image.src;
    if (isUsableImageSrc(src)) return src;
  }

  return undefined;
}

function splitDescription(description: string, language: SceneOutline['language']): string[] {
  const separator = language === 'en-US' ? /[.!?;]\s+/ : /[。！？；]\s*/;
  return description.split(separator).map(normalizeText).filter(Boolean);
}

function fallbackPoints(outline: SceneOutline): string[] {
  const language = outline.language || 'zh-CN';
  const keyPoints = (outline.keyPoints || []).map(normalizeText).filter(Boolean);
  if (keyPoints.length > 0) return keyPoints.slice(0, 5);

  const description = normalizeText(outline.description);
  const descriptionPoints = splitDescription(description, language);
  if (descriptionPoints.length > 0) return descriptionPoints.slice(0, 5);

  return language === 'en-US'
    ? [
        'Name the topic in your own words',
        'Find one key detail from the material',
        'Share one example or question',
      ]
    : ['用自己的话说出主题', '找出材料中的一个重点', '分享一个例子或问题'];
}

function bulletList(points: string[], fontSize: number, color: string): string {
  return points
    .map(
      (point) =>
        `<p style="font-size: ${fontSize}px; color: ${color}; line-height: 1.45;">&bull; ${escapeHtml(
          point,
        )}</p>`,
    )
    .join('');
}

function visualLength(value: string): number {
  let units = 0;
  for (const char of value) {
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

function trimVisual(value: string, maxUnits: number): string {
  const normalized = normalizeText(value);
  if (visualLength(normalized) <= maxUnits) return normalized;

  let result = '';
  for (const char of normalized) {
    if (visualLength(`${result}${char}`) > maxUnits - 3) break;
    result += char;
  }
  return `${result.trim()}...`;
}

function pointOrFallback(
  points: string[],
  index: number,
  language: SceneOutline['language'],
): string {
  if (points[index]) return points[index];
  const fallback =
    language === 'en-US' ? ['Observe', 'Connect', 'Explain'] : ['观察', '联系', '表达'];
  return fallback[index % fallback.length];
}

function splitPoint(point: string): { heading: string; detail: string } {
  const normalized = normalizeText(point);
  const [heading, ...rest] = normalized.split(/[:：]/);
  const detail = rest.join('：').trim();

  if (detail) {
    return {
      heading: trimVisual(heading, 12),
      detail: trimVisual(detail, 28),
    };
  }

  return {
    heading: trimVisual(normalized, 16),
    detail: '',
  };
}

function numberedPointList(points: string[], fontSize: number, color: string): string {
  return points
    .map(
      (point, index) =>
        `<p style="font-size: ${fontSize}px; color: ${color}; line-height: 1.45;"><strong>${index + 1}.</strong> ${escapeHtml(
          trimVisual(point, 28),
        )}</p>`,
    )
    .join('');
}

function createFallbackBase(outline: SceneOutline) {
  const language = outline.language || 'zh-CN';
  const title =
    normalizeText(outline.title) || (language === 'en-US' ? 'Classroom Topic' : '课堂主题');
  const description =
    normalizeText(outline.description) ||
    (language === 'en-US'
      ? 'Start with a concise classroom introduction and guide students into the topic.'
      : '先用简短课堂导入引出主题，再带学生进入学习。');

  return {
    language,
    title: trimVisual(title, 36),
    description: trimVisual(description, 62),
    points: fallbackPoints(outline),
  };
}

function buildBottomPrompt(language: SceneOutline['language'], color: string): string {
  return paragraph(
    language === 'en-US'
      ? 'Think: what is one thing you can explain after this page?'
      : '想一想：学完这一页后，你能说明一个什么重点？',
    { fontSize: 16, color, weight: 600 },
  );
}

function imageElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  src: string,
): PPTImageElement {
  return {
    id,
    type: 'image',
    left,
    top,
    width,
    height,
    rotate: 0,
    fixedRatio: true,
    src,
    imageType: 'pageFigure',
  };
}

function buildClassicTitlePointsFallback(
  safeOutline: SceneOutline,
  palette: ReturnType<typeof getPresentationPalette>,
  imageSrc?: string,
): GeneratedSlideContent {
  const base = createFallbackBase(safeOutline);
  const contentWidth = imageSrc ? 500 : 810;

  const elements: PPTElement[] = [
    shapeElement('fallback_top_bar', 0, 0, 1000, 12, palette.primary),
    shapeElement('fallback_title_mark', 64, 58, 8, 70, palette.accent),
    textElement(
      'fallback_title',
      88,
      46,
      820,
      68,
      paragraph(base.title, { fontSize: 30, color: palette.title, weight: 700, lineHeight: 1.2 }),
      palette.title,
      'title',
    ),
    textElement(
      'fallback_description',
      88,
      116,
      790,
      52,
      paragraph(base.description, { fontSize: 17, color: palette.muted, lineHeight: 1.35 }),
      palette.muted,
      'subtitle',
    ),
    shapeElement('fallback_panel_classic', 64, 194, contentWidth + 56, 252, palette.surfaceAlt),
    textElement(
      'fallback_points_heading',
      96,
      218,
      contentWidth,
      34,
      paragraph(base.language === 'en-US' ? 'Key Points' : '课堂要点', {
        fontSize: 18,
        color: palette.title,
        weight: 700,
      }),
      palette.title,
      'itemTitle',
    ),
    textElement(
      'fallback_points',
      96,
      266,
      contentWidth,
      136,
      bulletList(base.points, 18, palette.text),
      palette.text,
      'content',
    ),
    textElement(
      'fallback_prompt',
      92,
      472,
      820,
      36,
      buildBottomPrompt(base.language, palette.success),
      palette.success,
      'notes',
    ),
  ];

  if (imageSrc) {
    elements.splice(
      5,
      0,
      shapeElement('fallback_image_frame', 632, 180, 326, 280, palette.surface),
      imageElement('fallback_image', 650, 198, 286, 242, imageSrc),
    );
  }

  return {
    elements,
    background: { type: 'solid', color: palette.background },
    remark: base.description,
  };
}

function buildSplitVisualNotesFallback(
  safeOutline: SceneOutline,
  palette: ReturnType<typeof getPresentationPalette>,
): GeneratedSlideContent {
  const base = createFallbackBase(safeOutline);
  const noteFills = [palette.primarySoft, palette.secondarySoft, palette.accentSoft];

  const elements: PPTElement[] = [
    shapeElement('fallback_split_side_band', 0, 0, 34, 562.5, palette.primary),
    textElement(
      'fallback_title',
      64,
      44,
      860,
      66,
      paragraph(base.title, { fontSize: 30, color: palette.title, weight: 700, lineHeight: 1.2 }),
      palette.title,
      'title',
    ),
    textElement(
      'fallback_description',
      66,
      112,
      820,
      48,
      paragraph(base.description, { fontSize: 17, color: palette.muted }),
      palette.muted,
      'subtitle',
    ),
    shapeElement('fallback_split_visual_panel', 64, 188, 398, 236, palette.surfaceAlt),
    shapeElement('fallback_split_visual_accent', 92, 216, 88, 88, palette.accentSoft),
    textElement(
      'fallback_split_visual_heading',
      96,
      330,
      322,
      38,
      paragraph(base.language === 'en-US' ? 'Learning Focus' : '学习焦点', {
        fontSize: 20,
        color: palette.title,
        weight: 700,
      }),
      palette.title,
      'itemTitle',
    ),
    textElement(
      'fallback_split_visual_text',
      96,
      372,
      322,
      40,
      paragraph(pointOrFallback(base.points, 0, base.language), {
        fontSize: 18,
        color: palette.text,
        lineHeight: 1.35,
      }),
      palette.text,
      'content',
    ),
  ];

  const notePoints = Array.from({ length: 3 }, (_, index) =>
    pointOrFallback(base.points, index, base.language),
  );
  notePoints.forEach((point, index) => {
    const top = 186 + index * 84;
    const parsed = splitPoint(point);
    elements.push(
      shapeElement(`fallback_split_note_${index + 1}`, 520, top, 390, 66, noteFills[index]),
      textElement(
        `fallback_split_note_title_${index + 1}`,
        544,
        top + 12,
        342,
        26,
        paragraph(parsed.heading, {
          fontSize: 17,
          color: palette.title,
          weight: 700,
          lineHeight: 1.15,
        }),
        palette.title,
        'itemTitle',
      ),
      textElement(
        `fallback_split_note_detail_${index + 1}`,
        544,
        top + 38,
        342,
        22,
        paragraph(parsed.detail || trimVisual(point, 28), {
          fontSize: 14,
          color: palette.text,
          lineHeight: 1.2,
        }),
        palette.text,
        'content',
      ),
    );
  });

  elements.push(
    textElement(
      'fallback_prompt',
      64,
      474,
      860,
      36,
      buildBottomPrompt(base.language, palette.success),
      palette.success,
      'notes',
    ),
  );

  return {
    elements,
    background: { type: 'solid', color: palette.background },
    remark: base.description,
  };
}

function buildThreeCardScanFallback(
  safeOutline: SceneOutline,
  palette: ReturnType<typeof getPresentationPalette>,
): GeneratedSlideContent {
  const base = createFallbackBase(safeOutline);
  const cardFills = [palette.primarySoft, palette.secondarySoft, palette.accentSoft];
  const cards = buildCenteredFlowRow({
    count: 3,
    contentLeft: 64,
    contentRight: 936,
    itemTop: 196,
    itemWidth: 244,
    itemHeight: 210,
    minGap: 64,
  });

  const elements: PPTElement[] = [
    shapeElement('fallback_three_top_rule', 64, 120, 872, 4, palette.divider),
    textElement(
      'fallback_title',
      64,
      48,
      860,
      58,
      paragraph(base.title, { fontSize: 30, color: palette.title, weight: 700, lineHeight: 1.15 }),
      palette.title,
      'title',
    ),
    textElement(
      'fallback_description',
      64,
      132,
      850,
      42,
      paragraph(base.description, { fontSize: 16, color: palette.muted, lineHeight: 1.3 }),
      palette.muted,
      'subtitle',
    ),
  ];

  cards.forEach((card, index) => {
    const point = pointOrFallback(base.points, index, base.language);
    const parsed = splitPoint(point);
    const isShortLabelOnly = !parsed.detail && visualLength(parsed.heading) <= 8;
    const titleTop = isShortLabelOnly ? card.top : card.top + 74;
    const titleHeight = isShortLabelOnly ? card.height : 44;
    elements.push(
      shapeElement(
        `fallback_three_card_${index + 1}`,
        card.left,
        card.top,
        card.width,
        card.height,
        cardFills[index],
      ),
      textElement(
        `fallback_three_card_number_${index + 1}`,
        card.left + 24,
        card.top + 24,
        44,
        34,
        paragraph(String(index + 1), {
          fontSize: 20,
          color: palette.primary,
          weight: 700,
          align: 'center',
        }),
        palette.primary,
        'itemNumber',
      ),
      textElement(
        `fallback_three_card_title_${index + 1}`,
        isShortLabelOnly ? card.left : card.left + 28,
        titleTop,
        isShortLabelOnly ? card.width : card.width - 56,
        titleHeight,
        paragraph(parsed.heading, {
          fontSize: isShortLabelOnly ? 24 : 20,
          color: palette.title,
          weight: 700,
          lineHeight: 1.2,
          align: 'center',
        }),
        palette.title,
        'itemTitle',
      ),
    );

    if (!isShortLabelOnly) {
      elements.push(
        textElement(
          `fallback_three_card_detail_${index + 1}`,
          card.left + 28,
          card.top + 132,
          card.width - 56,
          48,
          paragraph(parsed.detail || trimVisual(point, 34), {
            fontSize: 15,
            color: palette.text,
            lineHeight: 1.35,
          }),
          palette.text,
          'content',
        ),
      );
    }
  });

  elements.push(
    textElement(
      'fallback_prompt',
      82,
      472,
      836,
      36,
      buildBottomPrompt(base.language, palette.success),
      palette.success,
      'notes',
    ),
  );

  return {
    elements,
    background: { type: 'solid', color: palette.background },
    remark: base.description,
  };
}

function buildTimelineFlowFallback(
  safeOutline: SceneOutline,
  palette: ReturnType<typeof getPresentationPalette>,
): GeneratedSlideContent {
  const base = createFallbackBase(safeOutline);
  const stepCount = Math.min(Math.max(base.points.length, 3), 4);
  const cards = buildCenteredFlowRow({
    count: stepCount,
    contentLeft: 96,
    contentRight: 904,
    itemTop: 0,
    itemWidth: stepCount === 3 ? 192 : 172,
    itemHeight: 82,
    minGap: 36,
  });
  const axisLeft = cards[0]?.centerX ?? 128;
  const axisRight = cards[cards.length - 1]?.centerX ?? 872;

  const elements: PPTElement[] = [
    textElement(
      'fallback_title',
      64,
      46,
      860,
      60,
      paragraph(base.title, { fontSize: 30, color: palette.title, weight: 700, lineHeight: 1.15 }),
      palette.title,
      'title',
    ),
    textElement(
      'fallback_description',
      64,
      112,
      835,
      46,
      paragraph(base.description, { fontSize: 16, color: palette.muted, lineHeight: 1.3 }),
      palette.muted,
      'subtitle',
    ),
    lineElement(
      'fallback_timeline_axis',
      axisLeft,
      294,
      Math.max(44, axisRight - axisLeft),
      palette.divider,
      ['', 'arrow'],
    ),
  ];

  cards.forEach((card, index) => {
    const point = pointOrFallback(base.points, index, base.language);
    const parsed = splitPoint(point);
    const isTop = index % 2 === 0;
    const cardTop = isTop ? 178 : 332;
    const fill =
      index % 3 === 0
        ? palette.primarySoft
        : index % 3 === 1
          ? palette.secondarySoft
          : palette.accentSoft;

    elements.push(
      shapeElement(
        `fallback_timeline_node_${index + 1}`,
        card.centerX - 18,
        276,
        36,
        36,
        palette.primary,
      ),
      textElement(
        `fallback_timeline_node_label_${index + 1}`,
        card.centerX - 18,
        282,
        36,
        24,
        paragraph(String(index + 1), {
          fontSize: 16,
          color: palette.background,
          weight: 700,
          align: 'center',
        }),
        palette.background,
        'itemNumber',
      ),
      shapeElement(`fallback_timeline_card_${index + 1}`, card.left, cardTop, card.width, 82, fill),
      textElement(
        `fallback_timeline_title_${index + 1}`,
        card.left + 18,
        cardTop + 14,
        card.width - 36,
        30,
        paragraph(parsed.heading, {
          fontSize: 16,
          color: palette.title,
          weight: 700,
          lineHeight: 1.15,
          align: 'center',
        }),
        palette.title,
        'itemTitle',
      ),
      textElement(
        `fallback_timeline_detail_${index + 1}`,
        card.left + 18,
        cardTop + 46,
        card.width - 36,
        24,
        paragraph(parsed.detail || trimVisual(point, 18), {
          fontSize: 13,
          color: palette.text,
          lineHeight: 1.2,
          align: 'center',
        }),
        palette.text,
        'content',
      ),
    );
  });

  elements.push(
    textElement(
      'fallback_prompt',
      76,
      486,
      850,
      34,
      buildBottomPrompt(base.language, palette.success),
      palette.success,
      'notes',
    ),
  );

  return {
    elements,
    background: { type: 'solid', color: palette.background },
    remark: base.description,
  };
}

function buildCompareColumnsFallback(
  safeOutline: SceneOutline,
  palette: ReturnType<typeof getPresentationPalette>,
): GeneratedSlideContent {
  const base = createFallbackBase(safeOutline);
  const midpoint = Math.ceil(base.points.length / 2);
  const leftPoints = base.points.slice(0, midpoint);
  const rightPoints = base.points.slice(midpoint);

  const elements: PPTElement[] = [
    textElement(
      'fallback_title',
      64,
      46,
      860,
      60,
      paragraph(base.title, { fontSize: 30, color: palette.title, weight: 700, lineHeight: 1.15 }),
      palette.title,
      'title',
    ),
    textElement(
      'fallback_description',
      64,
      108,
      850,
      48,
      paragraph(base.description, { fontSize: 16, color: palette.muted, lineHeight: 1.3 }),
      palette.muted,
      'subtitle',
    ),
    shapeElement('fallback_compare_left_panel', 64, 178, 398, 260, palette.primarySoft),
    shapeElement('fallback_compare_right_panel', 538, 178, 398, 260, palette.secondarySoft),
    verticalLineElement('fallback_compare_divider', 500, 192, 218, palette.divider),
    textElement(
      'fallback_compare_left_heading',
      94,
      206,
      338,
      36,
      paragraph(base.language === 'en-US' ? 'Look One' : '观察一', {
        fontSize: 20,
        color: palette.title,
        weight: 700,
      }),
      palette.title,
      'itemTitle',
    ),
    textElement(
      'fallback_compare_right_heading',
      568,
      206,
      338,
      36,
      paragraph(base.language === 'en-US' ? 'Look Two' : '观察二', {
        fontSize: 20,
        color: palette.title,
        weight: 700,
      }),
      palette.title,
      'itemTitle',
    ),
    textElement(
      'fallback_compare_left_points',
      94,
      260,
      330,
      132,
      numberedPointList(
        leftPoints.length > 0 ? leftPoints : [pointOrFallback(base.points, 0, base.language)],
        16,
        palette.text,
      ),
      palette.text,
      'content',
    ),
    textElement(
      'fallback_compare_right_points',
      568,
      260,
      330,
      132,
      numberedPointList(
        rightPoints.length > 0 ? rightPoints : [pointOrFallback(base.points, 1, base.language)],
        16,
        palette.text,
      ),
      palette.text,
      'content',
    ),
    textElement(
      'fallback_prompt',
      78,
      478,
      844,
      36,
      buildBottomPrompt(base.language, palette.success),
      palette.success,
      'notes',
    ),
  ];

  return {
    elements,
    background: { type: 'solid', color: palette.background },
    remark: base.description,
  };
}

function buildImageFeatureFallback(
  safeOutline: SceneOutline,
  palette: ReturnType<typeof getPresentationPalette>,
  imageSrc?: string,
): GeneratedSlideContent {
  if (!imageSrc) return buildSplitVisualNotesFallback(safeOutline, palette);

  const base = createFallbackBase(safeOutline);

  const elements: PPTElement[] = [
    shapeElement('fallback_image_header_rule', 64, 124, 872, 4, palette.divider),
    textElement(
      'fallback_title',
      64,
      46,
      860,
      60,
      paragraph(base.title, { fontSize: 30, color: palette.title, weight: 700, lineHeight: 1.15 }),
      palette.title,
      'title',
    ),
    shapeElement('fallback_image_panel', 64, 158, 430, 302, palette.surfaceAlt),
    imageElement('fallback_image', 84, 178, 390, 262, imageSrc),
    textElement(
      'fallback_description',
      544,
      156,
      380,
      58,
      paragraph(base.description, { fontSize: 17, color: palette.muted, lineHeight: 1.3 }),
      palette.muted,
      'subtitle',
    ),
    shapeElement('fallback_image_notes_panel', 536, 236, 400, 196, palette.surface),
    textElement(
      'fallback_points_heading',
      566,
      258,
      340,
      34,
      paragraph(base.language === 'en-US' ? 'Observe and Explain' : '观察与说明', {
        fontSize: 19,
        color: palette.title,
        weight: 700,
      }),
      palette.title,
      'itemTitle',
    ),
    textElement(
      'fallback_points',
      566,
      308,
      340,
      88,
      bulletList(base.points.slice(0, 4), 16, palette.text),
      palette.text,
      'content',
    ),
    textElement(
      'fallback_prompt',
      74,
      490,
      852,
      34,
      buildBottomPrompt(base.language, palette.success),
      palette.success,
      'notes',
    ),
  ];

  return {
    elements,
    background: { type: 'solid', color: palette.background },
    remark: base.description,
  };
}

export function buildFallbackSlideContent(
  outline: SceneOutline,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  visualTheme?: ColorThemeId,
  layoutVariant?: SlideLayoutVariantId,
): GeneratedSlideContent {
  const palette = getPresentationPalette(visualTheme);
  const safeOutline = sanitizeSceneContentOutline(outline);
  const imageSrc = findFallbackImageSrc(assignedImages, imageMapping);
  const selectedVariant = resolveSlideLayoutVariant(
    layoutVariant,
    safeOutline,
    assignedImages,
    imageMapping,
  );

  switch (selectedVariant) {
    case 'split-visual-notes':
      return finalizeFallbackSlideContent(buildSplitVisualNotesFallback(safeOutline, palette));
    case 'three-card-scan':
      return finalizeFallbackSlideContent(buildThreeCardScanFallback(safeOutline, palette));
    case 'review-recall-flow':
      return finalizeFallbackSlideContent(
        applyPresentationThemeToSlideContent(
          buildReviewRecallFlowSlideContent(safeOutline),
          visualTheme,
        ),
      );
    case 'timeline-flow':
      return finalizeFallbackSlideContent(buildTimelineFlowFallback(safeOutline, palette));
    case 'compare-columns':
      return finalizeFallbackSlideContent(buildCompareColumnsFallback(safeOutline, palette));
    case 'image-feature':
      return finalizeFallbackSlideContent(buildImageFeatureFallback(safeOutline, palette, imageSrc));
    case 'classic-title-points':
    default:
      return finalizeFallbackSlideContent(
        buildClassicTitlePointsFallback(safeOutline, palette, imageSrc),
      );
  }
}

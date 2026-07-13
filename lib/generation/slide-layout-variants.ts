import type { ImageMapping, PdfImage, SceneOutline } from '@/lib/types/generation';

export const SLIDE_LAYOUT_VARIANT_IDS = [
  'classic-title-points',
  'split-visual-notes',
  'three-card-scan',
  'review-recall-flow',
  'timeline-flow',
  'compare-columns',
  'image-feature',
] as const;

export type SlideLayoutVariantId = (typeof SLIDE_LAYOUT_VARIANT_IDS)[number];

const GENERIC_LAYOUT_ROTATION: readonly SlideLayoutVariantId[] = [
  'classic-title-points',
  'three-card-scan',
  'split-visual-notes',
  'timeline-flow',
];

const IMAGE_LAYOUT_ROTATION: readonly SlideLayoutVariantId[] = [
  'image-feature',
  'split-visual-notes',
];

function outlineVisibleText(outline: SceneOutline): string {
  return [outline.title, outline.description, ...(outline.keyPoints || [])]
    .filter(Boolean)
    .join('\n');
}

function stableIndex(outline: SceneOutline, modulo: number): number {
  if (modulo <= 1) return 0;

  const order = Number(outline.order);
  if (Number.isFinite(order) && order > 0) {
    return (Math.trunc(order) - 1) % modulo;
  }

  let hash = 0;
  for (const char of `${outline.id}:${outline.title}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % modulo;
}

function isUsableImageSrc(src?: string): boolean {
  if (!src) return false;
  return src.startsWith('data:image/') || src.startsWith('http://') || src.startsWith('https://');
}

export function hasUsableAssignedImage(
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
): boolean {
  if (!assignedImages || assignedImages.length === 0) return false;

  return assignedImages.some((image) => isUsableImageSrc(imageMapping?.[image.id] || image.src));
}

export function isSlideLayoutVariantId(value: unknown): value is SlideLayoutVariantId {
  return (
    typeof value === 'string' && (SLIDE_LAYOUT_VARIANT_IDS as readonly string[]).includes(value)
  );
}

export function resolveSlideLayoutVariant(
  value: unknown,
  outline: SceneOutline,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
): SlideLayoutVariantId {
  return isSlideLayoutVariantId(value)
    ? value
    : selectSlideLayoutVariant(outline, assignedImages, imageMapping);
}

export function selectSlideLayoutVariant(
  outline: SceneOutline,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
): SlideLayoutVariantId {
  const text = outlineVisibleText(outline);

  if (hasUsableAssignedImage(assignedImages, imageMapping)) {
    return IMAGE_LAYOUT_ROTATION[stableIndex(outline, IMAGE_LAYOUT_ROTATION.length)];
  }

  if (outline.learningContext?.section === 'review') {
    return 'review-recall-flow';
  }

  if (
    /(?:复习导入|旧知唤醒|旧知扫描|旧知回顾|课文支点|文本支点|学习支点|先补问题|补足问题|薄弱点|review\s*intro|prior\s*knowledge|warm[-\s]*up)/i.test(
      text,
    )
  ) {
    return 'review-recall-flow';
  }

  if (
    /(?:对比|比较|异同|不同点|相同点|优缺点|利弊|\bvs\.?\b|\bcompare\b|\bcomparison\b)/i.test(text)
  ) {
    return 'compare-columns';
  }

  if (
    /(?:流程|步骤|过程|顺序|时间线|时间轴|先.*再|第一步|第二步|\btimeline\b|\bprocess\b|\bstep\b)/i.test(
      text,
    )
  ) {
    return 'timeline-flow';
  }

  return GENERIC_LAYOUT_ROTATION[stableIndex(outline, GENERIC_LAYOUT_ROTATION.length)];
}

export function buildSlideLayoutVariantPrompt(
  variant: SlideLayoutVariantId,
  language: SceneOutline['language'] = 'zh-CN',
): string {
  const guidance =
    language === 'en-US'
      ? {
          'classic-title-points':
            'Classic title and key-points page: clear title band, one main content panel, 3-5 concise lesson points, and a quiet bottom thinking prompt.',
          'split-visual-notes':
            'Split page: use an expressive left concept area and a right notes column. Keep text in compact blocks; do not duplicate the same sentence across both sides.',
          'three-card-scan':
            'Three-card scan: arrange the core lesson content as three equal light cards for quick comparison or review. Keep the title in its own unobstructed top area. Never use a full-size dark body panel, and do not add extra dialogue cards unless the scene explicitly needs role interaction.',
          'review-recall-flow':
            'Review recall flow: use a compact fixed teaching layout for review warm-ups. Show three small light panels for prior knowledge, text anchors, and gaps to fix. Keep headings near bullets, avoid oversized empty cards, avoid decorative page numbers, and use only subtle connector arrows.',
          'timeline-flow':
            'Timeline or learning path: arrange points as 3-4 ordered steps with a clean connector line. Keep connector lines away from text.',
          'compare-columns':
            'Comparison columns: use two balanced columns for similarities/differences, before/after, causes/results, or two methods. Keep the center gap clean.',
          'image-feature':
            'Image-feature page: make the assigned image the main visual focus and place 2-4 compact notes beside it. Use only provided image IDs.',
        }
      : {
          'classic-title-points':
            '经典标题+要点页：顶部标题区，一个主体内容面板，3-5 条简短课程要点，底部保留安静的思考提示。',
          'split-visual-notes':
            '左右分栏页：左侧做概念/情境视觉区，右侧做笔记要点列。文字保持短块，不要两边重复同一句。',
          'three-card-scan':
            '三卡扫描页：把核心课程内容整理成三个浅色等宽卡片，适合复习、归纳或并列观察。标题必须独立完整可读；不要生成主体大暗底；除非 scene 明确需要角色互动，不要额外堆叠多组对话卡。',
          'review-recall-flow':
            '复习唤醒流程页：用于复习导入/旧知唤醒。使用紧凑固定教学布局，三块浅色小面板分别呈现旧知、课文支点、待补问题；标题和要点必须相邻，不要巨大空白卡片，不要装饰性页码，箭头只做轻量连接。',
          'timeline-flow':
            '时间线/学习路径页：把要点排成 3-4 个有顺序的步骤，用清晰连接线表达流程，连接线不能穿过文字。',
          'compare-columns':
            '双栏对照页：用两个平衡列呈现相同/不同、前后变化、原因/结果或两种方法，中间留出干净分隔。',
          'image-feature':
            '图片主导页：把已分配图片作为主要视觉焦点，旁边放 2-4 条紧凑注释；只能使用 Available Images 中给出的图片 ID。',
        };

  const prefix = language === 'en-US' ? `Variant: ${variant}` : `版式：${variant}`;
  const common =
    language === 'en-US'
      ? 'Use this as the layout direction only. Do not write the variant name, layout instructions, or internal generation policy on the slide.'
      : '这只是版式方向。不要把版式名称、版式说明或内部生成策略写到页面可见文字里。';

  return `${prefix}\n${guidance[variant]}\n${common}`;
}

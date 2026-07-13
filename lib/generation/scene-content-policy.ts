import type { SceneOutline } from '@/lib/types/generation';
import type { ColorThemeId } from '@/lib/theme/color-themes';
import type { SlideLayoutVariantId } from './slide-layout-variants';

export interface SceneContentGenerationOptions {
  generationConstraints?: string[];
  visualIntent?: SceneContentVisualIntent;
  visualTheme?: ColorThemeId;
  layoutVariant?: SlideLayoutVariantId;
  slideLayoutReviewEnabled?: boolean;
}

export type SceneContentVisualIntent = { kind: 'pyramid' };

const VISUAL_PLANNING_MARKER = String.raw`(?:金字塔图|金字塔|流程图|结构图|关系图|思维导图|概念图|图示|图解|图表|表格|示意图|pyramid|flowchart|flow|diagram|chart|table|image|formula|mind\s*map|concept\s*map)`;
const VISUAL_PLANNING_MARKER_PREFIX_PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`^\s*[\[【「『]\s*${VISUAL_PLANNING_MARKER}\s*[\]】」』]\s*(?:[:：\-—–、]\s*)?`,
    'i',
  ),
  new RegExp(
    String.raw`^\s*[\(（]\s*${VISUAL_PLANNING_MARKER}\s*[\)）]\s*(?:[:：\-—–、]\s*)?`,
    'i',
  ),
  new RegExp(String.raw`^\s*${VISUAL_PLANNING_MARKER}\s*[:：]\s*`, 'i'),
  new RegExp(String.raw`^\s*${VISUAL_PLANNING_MARKER}\s+`, 'i'),
];

const INTERNAL_SCENE_CONTENT_STRATEGY_PATTERNS: RegExp[] = [
  /^[\[【]?\s*课堂模式\s*[\]】]?\s*[:：]?/i,
  /^[\[【]?\s*classroom mode\s*[\]】]?\s*[:：]?/i,
  /^硬性生成模式\s*[:：]/i,
  /^hard generation mode\s*:/i,
  /\bthis scene\b.*\bnormal\s+bingo\s+classroom\s+scene\b/i,
  /\bnormal\s+bingo\s+(?:interactive\s+)?classroom\s+(?:scene|page|outline)s?\b/i,
  /\bscene\b.*必须.*生成.*bingo/i,
  /bingo.*普通.*(?:课堂|互动课堂|课堂页面)/i,
  /(?:slide\s+scene|slide\s+scenes).*?(?:visual|document|paragraph|layout|page)/i,
  /(?:slide\s+scene).*?(?:视觉|幻灯片|页面|版式)/i,
  /(?:文档版式|视觉课堂页面版式|视觉幻灯片页面|屏幕文字必须简短|老师和课堂角色互动|课堂角色互动)/i,
  /(?:长篇解释.*老师.*讲解动作|不要塞进幻灯片正文)/i,
  /(?:put long explanations.*teacher speech actions|visible slide body text)/i,
  /preserve teacher.*classroom-role interaction/i,
  /(?:不要|不是|不得|禁止).*(?:文档|讲义|学习报告|教案|练习册|长文总结|段落文章|lesson document)/i,
  /(?:not|do not|don't|must not).*(?:document|handout|worksheet|lesson[- ]?plan|lesson document|long[- ]?form summary|paragraph article)/i,
  /大纲必须包含多个\s*scene/i,
  /outline must contain multiple scenes/i,
];

const INTERNAL_SCENE_CONTENT_STRATEGY_MARKERS: RegExp[] = [
  /[\[【]?\s*课堂模式\s*[\]】]?\s*[:：]?/i,
  /[\[【]?\s*classroom mode\s*[\]】]?\s*[:：]?/i,
  /硬性生成模式\s*[:：]/i,
  /hard generation mode\s*:/i,
  /\bthis scene\b.*\bnormal\s+bingo\s+classroom\s+scene\b/i,
  /\bnormal\s+bingo\s+(?:interactive\s+)?classroom\s+(?:scene|page|outline)s?\b/i,
  /\bscene\b.*必须.*生成.*bingo/i,
  /bingo.*普通.*(?:课堂|互动课堂|课堂页面)/i,
  /(?:文档版式|视觉课堂页面版式|视觉幻灯片页面|屏幕文字必须简短|老师和课堂角色互动|课堂角色互动)/i,
  /(?:长篇解释.*老师.*讲解动作|不要塞进幻灯片正文)/i,
  /(?:put long explanations.*teacher speech actions|visible slide body text)/i,
  /preserve teacher.*classroom-role interaction/i,
  /(?:不要|不是|不得|禁止).*(?:文档|讲义|学习报告|教案|练习册|长文总结|段落文章|lesson document)/i,
  /(?:not|do not|don't|must not).*(?:document|handout|worksheet|lesson[- ]?plan|lesson document|long[- ]?form summary|paragraph article)/i,
  /大纲必须包含多个\s*scene/i,
  /outline must contain multiple scenes/i,
];

function normalizeForStrategyMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function isInternalSceneContentStrategyText(value: string): boolean {
  const normalized = normalizeForStrategyMatch(value);
  if (!normalized) return false;
  return INTERNAL_SCENE_CONTENT_STRATEGY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function containsInternalSceneContentStrategyMarker(value: string): boolean {
  const normalized = normalizeForStrategyMatch(value);
  if (!normalized) return false;
  return INTERNAL_SCENE_CONTENT_STRATEGY_MARKERS.some((pattern) => pattern.test(normalized));
}

function splitSentenceLikeSegments(value: string): string[] {
  const matches = value.match(/[^。！？；;.!?\n]+[。！？；;.!?]?/g);
  return matches && matches.length > 0 ? matches : [value];
}

export function stripVisualPlanningMarkers(value?: string): string {
  if (!value) return '';

  let next = value.trim();
  let changed = true;

  while (changed && next) {
    changed = false;
    for (const pattern of VISUAL_PLANNING_MARKER_PREFIX_PATTERNS) {
      const cleaned = next.replace(pattern, '').trim();
      if (cleaned !== next) {
        next = cleaned;
        changed = true;
        break;
      }
    }
  }

  return next;
}

export function stripInternalSceneContentStrategyText(value?: string): string {
  if (!value) return '';

  const kept: string[] = [];
  for (const rawLine of value.replace(/\r\n/g, '\n').split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!containsInternalSceneContentStrategyMarker(line)) {
      kept.push(stripVisualPlanningMarkers(line));
      continue;
    }

    const visibleSegments = splitSentenceLikeSegments(line)
      .map((segment) => stripVisualPlanningMarkers(segment.trim()))
      .filter((segment) => segment && !isInternalSceneContentStrategyText(segment));

    if (visibleSegments.length > 0) {
      kept.push(visibleSegments.join(' '));
    }
  }

  return stripVisualPlanningMarkers(kept.join(' ').replace(/\s+/g, ' ').trim());
}

export function sanitizeSceneContentOutline(outline: SceneOutline): SceneOutline {
  return {
    ...outline,
    description: stripVisualPlanningMarkers(
      stripInternalSceneContentStrategyText(outline.description),
    ),
    keyPoints: (outline.keyPoints || [])
      .map((point) => stripVisualPlanningMarkers(stripInternalSceneContentStrategyText(point)))
      .filter(Boolean),
  };
}

function outlineVisibleText(outline: SceneOutline): string {
  return [outline.title, outline.description, ...(outline.keyPoints || [])]
    .filter(Boolean)
    .join('\n');
}

export function detectSceneContentVisualIntent(
  outline: SceneOutline,
): SceneContentVisualIntent | undefined {
  const text = outlineVisibleText(outline).toLowerCase();

  if (/(?:金字塔图|金字塔|pyramid)/i.test(text)) {
    return { kind: 'pyramid' };
  }

  const pyramidLayerLabels = ['行动层', '品质层', '精神层'];
  const matchedPyramidLayers = pyramidLayerLabels.filter((label) => text.includes(label));
  if (matchedPyramidLayers.length >= 3) {
    return { kind: 'pyramid' };
  }

  return undefined;
}

export function mergeSceneContentGenerationOptions(
  options: SceneContentGenerationOptions | undefined,
  inferredVisualIntent: SceneContentVisualIntent | undefined,
): SceneContentGenerationOptions | undefined {
  if (!options && !inferredVisualIntent) return undefined;

  return {
    ...(options || {}),
    visualIntent: options?.visualIntent || inferredVisualIntent,
  };
}

export function buildClassroomContentGenerationConstraints(
  language: 'zh-CN' | 'en-US' = 'zh-CN',
): string[] {
  return language === 'en-US'
    ? [
        'This scene must become a normal interactive classroom page, not a document, handout, worksheet, lesson-plan page, long-form summary, or paragraph article.',
        'Slide scenes must be visual pages with concise text blocks and layout elements.',
        'Put long explanations in teacher speech actions, not in visible slide body text.',
        'Preserve teacher and classroom-role interaction.',
      ]
    : [
        '这个 scene 必须生成普通互动课堂页面，不是文档、讲义、练习册、教案页、长文总结或段落文章。',
        'Slide scene 必须是视觉幻灯片页面，用简短文字块和版式元素表达。',
        '长篇解释应放到老师讲解动作里，不要塞进幻灯片正文。',
        '保留老师和课堂角色互动。',
      ];
}

export function formatSceneContentGenerationConstraints(
  constraints: readonly string[] | undefined,
  language: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const cleaned = (constraints || []).map((constraint) => constraint.trim()).filter(Boolean);

  if (cleaned.length === 0) {
    return language === 'en-US' ? 'No additional generation constraints.' : '无额外生成约束。';
  }

  return cleaned.map((constraint, index) => `${index + 1}. ${constraint}`).join('\n');
}

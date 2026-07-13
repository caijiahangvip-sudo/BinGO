import type { SceneOutline } from '@/lib/types/generation';

type ReviewRecallGroup = 'recall' | 'anchor' | 'gap';

const GROUP_LABELS: Record<ReviewRecallGroup, readonly string[]> = {
  recall: ['旧知扫描', '旧知回顾', '旧知唤醒', '旧知', 'prior knowledge', 'review recall'],
  anchor: ['课文支点', '文本支点', '学习支点', '支点', 'text anchor', 'lesson anchor'],
  gap: ['先补问题', '补足问题', '补问题', '薄弱点', '问题', 'learning gap', 'gap to fix'],
};

const GROUP_TITLES: Record<ReviewRecallGroup, { zh: string; en: string }> = {
  recall: { zh: '旧知扫描', en: 'Prior Knowledge' },
  anchor: { zh: '课文支点', en: 'Text Anchor' },
  gap: { zh: '先补问题', en: 'Gap to Fix' },
};

const GROUP_FALLBACK_POINTS: Record<
  ReviewRecallGroup,
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

const GENERIC_LABELS = new Set(['旧知', '支点', '问题']);

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function stripTitlePrefix(value: string): string {
  return normalizeText(value)
    .replace(/^[\d一二三四五六七八九十]+[.、:：\-\s]+/u, '')
    .replace(/[.。:：\-\s]+$/u, '')
    .trim();
}

function groupForLabel(value: string): ReviewRecallGroup | null {
  const normalized = stripTitlePrefix(value).toLowerCase();
  for (const [group, labels] of Object.entries(GROUP_LABELS) as Array<
    [ReviewRecallGroup, readonly string[]]
  >) {
    if (
      labels.some((label) => {
        const normalizedLabel = label.toLowerCase();
        const canMatchPrefix = !GENERIC_LABELS.has(label);
        return (
          normalized === normalizedLabel ||
          (canMatchPrefix &&
            (normalized.startsWith(`${normalizedLabel}:`) ||
              normalized.startsWith(`${normalizedLabel}：`) ||
              normalized.startsWith(`${normalizedLabel} - `) ||
              normalized.startsWith(`${normalizedLabel}-`)))
        );
      })
    ) {
      return group;
    }
  }
  return null;
}

function groupForTitle(outline: SceneOutline): ReviewRecallGroup | null {
  if (outline.type !== 'slide') return null;
  return groupForLabel(outline.title);
}

function isLabelOnlyText(value: string): boolean {
  const normalized = stripTitlePrefix(value).toLowerCase();
  if (!normalized) return true;
  return Object.values(GROUP_LABELS).some((labels) =>
    labels.some((label) => normalized === label.toLowerCase()),
  );
}

function stripLeadingGroupLabel(value: string): string {
  let text = normalizeText(value);
  for (const labels of Object.values(GROUP_LABELS)) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`^${escaped}\\s*[:：\\-—–]?\\s*`, 'iu'), '').trim();
    }
  }
  return text;
}

function splitPointText(value: string): string[] {
  return stripLeadingGroupLabel(value)
    .replace(/[•·]/g, '、')
    .split(/[、,，;；/]/u)
    .map((item) => item.replace(/^[-—–\s]+/u, '').trim())
    .filter((item) => item && !isLabelOnlyText(item));
}

function collectOutlinePoints(outline: SceneOutline): string[] {
  const sources = [
    outline.title,
    outline.description,
    outline.teachingObjective,
    ...(outline.keyPoints || []),
  ]
    .map(normalizeText)
    .filter(Boolean);

  return [...new Set(sources.flatMap(splitPointText))].slice(0, 6);
}

function columnPoints(
  group: ReviewRecallGroup,
  outlines: readonly SceneOutline[],
  language: SceneOutline['language'],
): string[] {
  const points = outlines.flatMap(collectOutlinePoints);
  if (points.length > 0) return [...new Set(points)].slice(0, 4);
  return [...GROUP_FALLBACK_POINTS[group][language === 'en-US' ? 'en' : 'zh']];
}

function mergeReviewRecallRun(
  run: readonly SceneOutline[],
  order: number,
  language?: SceneOutline['language'],
): SceneOutline {
  const lang = language || run.find((outline) => outline.language)?.language || 'zh-CN';
  const isEnglish = lang === 'en-US';
  const byGroup: Record<ReviewRecallGroup, SceneOutline[]> = {
    recall: [],
    anchor: [],
    gap: [],
  };

  for (const outline of run) {
    const group = groupForTitle(outline);
    if (group) byGroup[group].push(outline);
  }

  const keyPoints = (Object.keys(byGroup) as ReviewRecallGroup[]).map((group) => {
    const title = GROUP_TITLES[group][isEnglish ? 'en' : 'zh'];
    return `${title}${isEnglish ? ': ' : '：'}${columnPoints(group, byGroup[group], lang).join(
      isEnglish ? ', ' : '、',
    )}`;
  });
  const knowledgePointIds = [
    ...new Set(run.flatMap((outline) => outline.learningContext?.knowledgePointIds || [])),
  ];
  const estimatedDuration = run
    .map((outline) => outline.estimatedDuration)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);

  return {
    ...run[0],
    id: run[0].id,
    type: 'slide',
    title: isEnglish ? 'Review Warm-Up' : '复习导入',
    description: isEnglish
      ? 'Review warm-up: scan prior knowledge, locate text anchors, and name the gap to fix.'
      : '旧知唤醒：先扫描旧知，再找到课文支点，最后补足问题。',
    keyPoints,
    teachingObjective:
      run.find((outline) => normalizeText(outline.teachingObjective))?.teachingObjective ||
      (isEnglish ? 'Prepare for the lesson with a focused review.' : '通过旧知唤醒进入本课学习。'),
    estimatedDuration: estimatedDuration > 0 ? estimatedDuration : run[0].estimatedDuration,
    order,
    language: lang,
    learningContext: {
      section: 'review',
      knowledgePointIds,
    },
  };
}

function shouldMergeRun(run: readonly SceneOutline[]): boolean {
  const groups = new Set(
    run.map(groupForTitle).filter((group): group is ReviewRecallGroup => !!group),
  );
  return groups.has('recall') && groups.has('anchor') && groups.has('gap');
}

export function normalizeReviewRecallOutlines(
  outlines: readonly SceneOutline[],
  language?: SceneOutline['language'],
): SceneOutline[] {
  const normalized: SceneOutline[] = [];
  let index = 0;

  while (index < outlines.length) {
    const run: SceneOutline[] = [];
    let cursor = index;

    while (cursor < outlines.length && groupForTitle(outlines[cursor])) {
      run.push(outlines[cursor]);
      cursor += 1;
    }

    if (run.length > 0 && shouldMergeRun(run)) {
      normalized.push(mergeReviewRecallRun(run, normalized.length + 1, language));
      index = cursor;
      continue;
    }

    normalized.push({
      ...outlines[index],
      order: normalized.length + 1,
      language: outlines[index].language || language,
    });
    index += 1;
  }

  return normalized;
}

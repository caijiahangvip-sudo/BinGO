import type { GeneratedSlideData } from './pipeline-types';
import type { SceneOutline } from '@/lib/types/generation';
import type { PPTElement } from '@/lib/types/slides';

export type SlideLayoutQualityIssueCode =
  | 'missing-slide-title'
  | 'oversized-dominant-shape'
  | 'sparse-visible-content'
  | 'orphan-decoration'
  | 'model-rejected-layout';

export interface SlideLayoutQualityIssue {
  code: SlideLayoutQualityIssueCode | string;
  severity: 'warning' | 'critical';
  elementIndexes: number[];
  message: string;
}

export interface SlideLayoutModelReview {
  approved: boolean;
  issues: SlideLayoutQualityIssue[];
  summary: string;
}

type LayoutElement = GeneratedSlideData['elements'][number] | PPTElement;

function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function elementText(element: LayoutElement): string {
  const record = element as unknown as Record<string, unknown>;
  if (element.type === 'text') return stripHtml(record.content);
  if (element.type === 'shape' && record.text && typeof record.text === 'object') {
    return stripHtml((record.text as Record<string, unknown>).content);
  }
  if (element.type === 'latex') return stripHtml(record.latex);
  return '';
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function titleIsRepresented(outline: SceneOutline, elements: readonly LayoutElement[]): boolean {
  const title = normalizeText(outline.title.replace(/^(?:回顾|复习|导入)[:：]?/, ''));
  if (!title) return true;

  return elements.some((element) => {
    const text = normalizeText(elementText(element));
    if (!text) return false;
    if (text.includes(title) || title.includes(text))
      return text.length >= Math.min(6, title.length);

    const titleChars = new Set(title);
    const overlap = [...new Set(text)].filter((char) => titleChars.has(char)).length;
    return overlap / Math.max(1, titleChars.size) >= 0.65;
  });
}

function elementArea(element: LayoutElement): number {
  const record = element as unknown as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width * height
    : 0;
}

function detectOrphanDecoration(elements: readonly LayoutElement[]): number[] {
  return elements.flatMap((element, index) => {
    if (element.type !== 'shape') return [];
    const record = element as unknown as Record<string, unknown>;
    const width = Number(record.width);
    const height = Number(record.height);
    const left = Number(record.left);
    const top = Number(record.top);
    if (!(width >= 35 && width <= 150 && height >= 4 && height <= 28 && top < 80)) return [];

    const hasNearbyText = elements.some((candidate) => {
      if (!elementText(candidate)) return false;
      const candidateRecord = candidate as unknown as Record<string, unknown>;
      const candidateLeft = Number(candidateRecord.left);
      const candidateTop = Number(candidateRecord.top);
      return (
        candidateTop < 85 &&
        Math.abs(candidateLeft - left) < 220 &&
        Math.abs(candidateTop - top) < 70
      );
    });
    return hasNearbyText ? [] : [index];
  });
}

export function detectSlideLayoutQualityIssues(
  outline: SceneOutline,
  elements: readonly LayoutElement[],
): SlideLayoutQualityIssue[] {
  const issues: SlideLayoutQualityIssue[] = [];

  if (!titleIsRepresented(outline, elements)) {
    issues.push({
      code: 'missing-slide-title',
      severity: 'critical',
      elementIndexes: [],
      message: `The visible slide does not contain the intended title: ${outline.title}`,
    });
  }

  const oversizedIndexes = elements.flatMap((element, index) => {
    if (element.type !== 'shape') return [];
    return elementArea(element) >= 1000 * 562.5 * 0.3 ? [index] : [];
  });
  if (oversizedIndexes.length > 0) {
    issues.push({
      code: 'oversized-dominant-shape',
      severity: 'warning',
      elementIndexes: oversizedIndexes,
      message: 'A foreground shape occupies more than 30% of the slide and may dominate the layout',
    });
  }

  const visibleText = elements.map(elementText).filter(Boolean).join('');
  const expectedText = [outline.title, outline.description, ...(outline.keyPoints || [])].join('');
  if (visibleText.length < Math.min(36, Math.max(18, expectedText.length * 0.25))) {
    issues.push({
      code: 'sparse-visible-content',
      severity: 'warning',
      elementIndexes: [],
      message: 'The slide contains too little visible instructional content for the outline',
    });
  }

  const orphanIndexes = detectOrphanDecoration(elements);
  if (orphanIndexes.length > 0) {
    issues.push({
      code: 'orphan-decoration',
      severity: 'warning',
      elementIndexes: orphanIndexes,
      message: 'Decorative shapes are detached from any visible title or content group',
    });
  }

  return issues;
}

function normalizeReviewIssue(value: unknown): SlideLayoutQualityIssue | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'string' || typeof record.message !== 'string') return null;
  return {
    code: record.code,
    severity: record.severity === 'warning' ? 'warning' : 'critical',
    elementIndexes: Array.isArray(record.elementIndexes)
      ? record.elementIndexes.filter((item): item is number => Number.isInteger(item))
      : [],
    message: record.message,
  };
}

export function parseSlideLayoutModelReview(value: unknown): SlideLayoutModelReview | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.approved !== 'boolean') return null;
  const issues = Array.isArray(record.issues)
    ? record.issues
        .map(normalizeReviewIssue)
        .filter((item): item is SlideLayoutQualityIssue => !!item)
    : [];
  if (!record.approved && issues.length === 0) return null;
  return {
    approved: record.approved,
    issues,
    summary: typeof record.summary === 'string' ? record.summary : '',
  };
}

export function serializeSlideForLayoutReview(elements: readonly PPTElement[]): string {
  return JSON.stringify(
    elements.map((element, index) => {
      const record = element as unknown as Record<string, unknown>;
      return {
        index,
        type: element.type,
        left: record.left,
        top: record.top,
        width: record.width,
        height: record.height,
        text: elementText(element),
        start: record.start,
        end: record.end,
      };
    }),
  );
}

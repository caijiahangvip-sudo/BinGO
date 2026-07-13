import { describe, expect, it, vi } from 'vitest';

import {
  buildIntersectingLinesSlideContent,
  isIntersectingLinesSlideOutline,
} from '@/lib/generation/intersecting-lines-slide-template';
import { generateSceneContent } from '@/lib/generation/scene-generator';
import type { SceneOutline } from '@/lib/types/generation';
import type { PPTElement, PPTLineElement } from '@/lib/types/slides';

type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function outline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: 'scene_intersecting_lines',
    type: 'slide',
    title: '相交线模型',
    description: '认识两条直线相交后形成的四个角。',
    keyPoints: ['找到交点 O', '标出∠1、∠2、∠3、∠4', '理解对顶角相等', '理解邻补角互补'],
    order: 1,
    language: 'zh-CN',
    ...overrides,
  };
}

function textOf(element: PPTElement): string {
  if (element.type !== 'text') return '';
  return element.content.replace(/<[^>]+>/g, '');
}

function byId(elements: PPTElement[], id: string): PPTElement {
  const element = elements.find((item) => item.id === id);
  if (!element) throw new Error(`Missing element ${id}`);
  return element;
}

function asRect(element: PPTElement): RectLike {
  if (element.type === 'line') {
    throw new Error(`Expected rectangular element, got line ${element.id}`);
  }
  return element;
}

function bottomOf(rect: RectLike): number {
  return rect.top + rect.height;
}

function rightOf(rect: RectLike): number {
  return rect.left + rect.width;
}

function overlaps(a: RectLike, b: RectLike): boolean {
  return a.left < rightOf(b) && rightOf(a) > b.left && a.top < bottomOf(b) && bottomOf(a) > b.top;
}

function isInside(inner: RectLike, outer: RectLike): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    rightOf(inner) <= rightOf(outer) &&
    bottomOf(inner) <= bottomOf(outer)
  );
}

describe('intersecting lines slide template', () => {
  it('detects intersecting-lines slide outlines without matching unrelated slides', () => {
    expect(isIntersectingLinesSlideOutline(outline())).toBe(true);
    expect(
      isIntersectingLinesSlideOutline(
        outline({
          title: 'Vertical angles',
          description: 'Use intersecting lines to compare opposite angles.',
          keyPoints: ['Find ∠1 and ∠3', 'Compare ∠2 and ∠4'],
          language: 'en-US',
        }),
      ),
    ).toBe(true);
    expect(
      isIntersectingLinesSlideOutline(
        outline({
          title: '分数大小对比',
          description: '比较两个分数并判断谁更大。',
          keyPoints: ['观察分子和分母', '说明判断理由'],
        }),
      ),
    ).toBe(false);
  });

  it('routes matching slide generation to the deterministic template without calling AI', async () => {
    const aiCall = vi.fn(async () => {
      throw new Error('AI should not be called for the intersecting-lines template');
    });

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    expect(aiCall).not.toHaveBeenCalled();
    expect(
      content &&
        'elements' in content &&
        content.elements.some((element) => element.id === 'template_intersect_main_line_l'),
    ).toBe(true);
  });

  it('builds a bounded diagram with anchored labels and relationship cards', () => {
    const content = buildIntersectingLinesSlideContent(outline());
    const elements = content.elements;
    const labels = elements.map(textOf).join('\n');
    const mainLines = elements.filter(
      (element): element is PPTLineElement =>
        element.type === 'line' && element.id.startsWith('template_intersect_main_line_'),
    );

    expect(mainLines).toHaveLength(2);
    expect(labels).toContain('O');
    expect(labels).toContain('l');
    expect(labels).toContain('m');
    expect(labels).toContain('1');
    expect(labels).toContain('2');
    expect(labels).toContain('3');
    expect(labels).toContain('4');
    expect(labels).toContain('对顶角相等');
    expect(labels).toContain('∠1 = ∠3，∠2 = ∠4');
    expect(labels).toContain('邻补角互补');
    expect(labels).toContain('相邻两角和为 180°');

    for (const element of elements) {
      expect(element.left).toBeGreaterThanOrEqual(0);
      expect(element.top).toBeGreaterThanOrEqual(0);
      expect(element.left + element.width).toBeLessThanOrEqual(1000);
      if (element.type !== 'line') {
        expect(element.top + element.height).toBeLessThanOrEqual(562.5);
      }
      if (element.type === 'line') {
        expect(element.width).toBeLessThanOrEqual(6);
      }
    }
  });

  it('keeps relationship cards and prompt strip separated', () => {
    const content = buildIntersectingLinesSlideContent(outline());
    const elements = content.elements;
    const verticalCard = byId(elements, 'template_intersect_vertical_card');
    const verticalText = byId(elements, 'template_intersect_vertical_text');
    const adjacentCard = byId(elements, 'template_intersect_adjacent_card');
    const adjacentText = byId(elements, 'template_intersect_adjacent_text');
    const readingCard = byId(elements, 'template_intersect_reading_card');
    const readingText = byId(elements, 'template_intersect_reading_text');
    const promptStrip = byId(elements, 'template_intersect_prompt_strip');

    expect(overlaps(asRect(verticalCard), asRect(adjacentCard))).toBe(false);
    expect(overlaps(asRect(adjacentCard), asRect(readingCard))).toBe(false);
    expect(overlaps(asRect(readingCard), asRect(promptStrip))).toBe(false);
    expect(promptStrip.top - bottomOf(asRect(readingCard))).toBeGreaterThanOrEqual(14);

    expect(isInside(asRect(verticalText), asRect(verticalCard))).toBe(true);
    expect(isInside(asRect(adjacentText), asRect(adjacentCard))).toBe(true);
    expect(isInside(asRect(readingText), asRect(readingCard))).toBe(true);
  });
});

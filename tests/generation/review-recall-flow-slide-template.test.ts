import { describe, expect, it } from 'vitest';

import {
  buildReviewRecallFlowSlideContent,
  isReviewRecallFlowSlideOutline,
} from '@/lib/generation/review-recall-flow-slide-template';
import type { SceneOutline } from '@/lib/types/generation';
import type { PPTLineElement, PPTShapeElement, PPTTextElement } from '@/lib/types/slides';

type BoxElement = PPTShapeElement | PPTTextElement;

function outline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: 'scene_review',
    type: 'slide',
    title: '复习导入',
    description: '旧知唤醒，先扫描旧知，再找到课文支点，最后补足问题。',
    keyPoints: [
      '旧知扫描：精读方法、杰出人物、家国情怀、抒情阅读',
      '课文支点：《邓稼先》品质、《说和做》言行、《孙权劝学》文言、《木兰诗》形象',
      '先补问题：品质关键词、文言字词、人物特点、抒情依据',
    ],
    order: 1,
    language: 'zh-CN',
    ...overrides,
  };
}

function rect(element: { left: number; top: number; width: number; height: number }) {
  return {
    left: element.left,
    top: element.top,
    right: element.left + element.width,
    bottom: element.top + element.height,
  };
}

function overlaps(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) {
  const ar = rect(a);
  const br = rect(b);
  return !(
    ar.right <= br.left ||
    br.right <= ar.left ||
    ar.bottom <= br.top ||
    br.bottom <= ar.top
  );
}

function absoluteLineEndpoints(element: PPTLineElement) {
  return {
    start: {
      x: element.left + element.start[0],
      y: element.top + element.start[1],
    },
    end: {
      x: element.left + element.end[0],
      y: element.top + element.end[1],
    },
  };
}

describe('review recall flow slide template', () => {
  it('detects review recall outlines', () => {
    expect(isReviewRecallFlowSlideOutline(outline())).toBe(true);
    expect(
      isReviewRecallFlowSlideOutline(
        outline({
          title: '普通讲解',
          description: '学习新的课文内容。',
          keyPoints: ['概括内容', '分析语言'],
          learningContext: undefined,
        }),
      ),
    ).toBe(false);
  });

  it('builds compact review cards without screenshot-like empty card gaps', () => {
    const content = buildReviewRecallFlowSlideContent(outline());
    const elements = content.elements;
    const visibleText = JSON.stringify(elements);
    const card = elements.find(
      (element): element is BoxElement => element.id === 'template_review_recall_card_recall',
    );
    const cardTitle = elements.find(
      (element): element is BoxElement => element.id === 'template_review_recall_card_title_recall',
    );
    const cardPoints = elements.find(
      (element): element is BoxElement =>
        element.id === 'template_review_recall_card_points_recall',
    );
    const prompt = elements.find(
      (element): element is BoxElement => element.id === 'template_review_recall_prompt_bg',
    );

    expect(card).toBeDefined();
    expect(cardTitle).toBeDefined();
    expect(cardPoints).toBeDefined();
    expect(prompt).toBeDefined();
    expect(Number(card?.height)).toBeLessThan(290);
    expect(Number(cardTitle?.top) - Number(card?.top)).toBeLessThan(70);
    expect(Number(cardPoints?.top) - Number(cardTitle?.top)).toBeLessThan(70);
    expect(overlaps(card!, prompt!)).toBe(false);
    expect(visibleText).toContain('精读方法');
    expect(visibleText).toContain('《邓稼先》品质');
    expect(visibleText).toContain('品质关键词');
    expect(visibleText).not.toContain('Bingo');
  });

  it('fills label-only review cards with visible fallback points', () => {
    const content = buildReviewRecallFlowSlideContent(
      outline({
        title: '旧知扫描',
        description: '',
        keyPoints: ['旧知扫描', '课文支点', '先补问题'],
      }),
    );
    const visibleText = JSON.stringify(content.elements);
    const pointElements = content.elements.filter(
      (element): element is PPTTextElement =>
        element.id === 'template_review_recall_card_points_recall' ||
        element.id === 'template_review_recall_card_points_anchor' ||
        element.id === 'template_review_recall_card_points_gap',
    );

    expect(pointElements).toHaveLength(3);
    for (const element of pointElements) {
      expect(String(element.content || '').trim()).not.toBe('');
      expect(String(element.content)).toContain('&bull;');
    }
    expect(visibleText).toContain('回顾已学方法');
    expect(visibleText).toContain('定位课文线索');
    expect(visibleText).toContain('标出疑问点');
  });

  it('centers visible connector arrows in the gaps between review cards', () => {
    const content = buildReviewRecallFlowSlideContent(outline());
    const cards = ['recall', 'anchor', 'gap'].map((key) => {
      const card = content.elements.find(
        (element): element is PPTShapeElement =>
          element.id === `template_review_recall_card_${key}`,
      );
      expect(card).toBeDefined();
      return card!;
    });
    const arrows = content.elements.filter(
      (element): element is PPTLineElement =>
        element.type === 'line' && element.id.startsWith('template_review_recall_step_arrow_'),
    );

    expect(arrows).toHaveLength(2);
    arrows.forEach((arrow, index) => {
      const endpoints = absoluteLineEndpoints(arrow);
      const previousCard = rect(cards[index]);
      const nextCard = rect(cards[index + 1]);
      const gapCenter = (previousCard.right + nextCard.left) / 2;
      const arrowCenter = (endpoints.start.x + endpoints.end.x) / 2;

      expect(endpoints.start.x).toBeGreaterThan(previousCard.right);
      expect(endpoints.end.x).toBeLessThan(nextCard.left);
      expect(endpoints.end.x - endpoints.start.x).toBeGreaterThanOrEqual(44);
      expect(arrowCenter).toBeCloseTo(gapCenter, 1);
      expect(endpoints.start.y).toBeCloseTo(cards[index].top + cards[index].height / 2, 1);
      expect(arrow.points).toEqual(['', 'arrow']);
    });
  });
});

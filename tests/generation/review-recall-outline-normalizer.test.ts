import { describe, expect, it } from 'vitest';

import { normalizeReviewRecallOutlines } from '@/lib/generation/review-recall-outline-normalizer';
import type { SceneOutline } from '@/lib/types/generation';

function outline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: overrides.id || `scene_${overrides.order || 1}`,
    type: 'slide',
    title: '阅读方法梳理',
    description: '通览全文，抓关键词句，品味细节。',
    keyPoints: ['通览全文', '抓关键词句', '品味细节'],
    order: 1,
    language: 'zh-CN',
    ...overrides,
  };
}

describe('review recall outline normalizer', () => {
  it('merges adjacent label-only review outlines into one populated review slide', () => {
    const normalized = normalizeReviewRecallOutlines([
      outline({
        id: 'recall',
        title: '旧知扫描',
        description: '',
        keyPoints: [],
        order: 1,
      }),
      outline({
        id: 'anchor',
        title: '课文支点',
        description: '',
        keyPoints: [],
        order: 2,
      }),
      outline({
        id: 'gap',
        title: '先补问题',
        description: '',
        keyPoints: [],
        order: 3,
      }),
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      id: 'recall',
      type: 'slide',
      title: '复习导入',
      order: 1,
      learningContext: { section: 'review' },
    });
    expect(normalized[0].keyPoints).toEqual([
      '旧知扫描：回顾已学方法、唤醒关键词',
      '课文支点：定位课文线索、连接本课目标',
      '先补问题：标出疑问点、明确待补内容',
    ]);
  });

  it('preserves real lesson points when merging review label pages', () => {
    const normalized = normalizeReviewRecallOutlines([
      outline({
        id: 'recall',
        title: '旧知扫描',
        description: '旧知扫描：精读方法、杰出人物',
        keyPoints: [],
        order: 1,
      }),
      outline({
        id: 'anchor',
        title: '课文支点',
        description: '',
        keyPoints: ['课文支点：《邓稼先》品质'],
        order: 2,
      }),
      outline({
        id: 'gap',
        title: '先补问题',
        description: '',
        keyPoints: ['先补问题：品质关键词'],
        order: 3,
      }),
      outline({
        id: 'lesson',
        title: '通览全文',
        order: 4,
      }),
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].keyPoints).toEqual([
      '旧知扫描：精读方法、杰出人物',
      '课文支点：《邓稼先》品质',
      '先补问题：品质关键词',
    ]);
    expect(normalized[1]).toMatchObject({ id: 'lesson', order: 2 });
  });

  it('preserves real points carried in explicit label titles', () => {
    const normalized = normalizeReviewRecallOutlines([
      outline({
        id: 'recall',
        title: '旧知扫描：精读方法、杰出人物',
        description: '',
        keyPoints: [],
        order: 1,
      }),
      outline({
        id: 'anchor',
        title: '课文支点：《邓稼先》品质',
        description: '',
        keyPoints: [],
        order: 2,
      }),
      outline({
        id: 'gap',
        title: '先补问题：品质关键词',
        description: '',
        keyPoints: [],
        order: 3,
      }),
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].keyPoints).toEqual([
      '旧知扫描：精读方法、杰出人物',
      '课文支点：《邓稼先》品质',
      '先补问题：品质关键词',
    ]);
  });

  it('does not merge normal non-adjacent lesson slides', () => {
    const normalized = normalizeReviewRecallOutlines([
      outline({ id: 'recall', title: '旧知扫描', order: 1 }),
      outline({ id: 'lesson', title: '通览全文', order: 2 }),
      outline({ id: 'anchor', title: '课文支点', order: 3 }),
      outline({ id: 'gap', title: '先补问题', order: 4 }),
    ]);

    expect(normalized).toHaveLength(4);
    expect(normalized.map((item) => item.id)).toEqual(['recall', 'lesson', 'anchor', 'gap']);
    expect(normalized.map((item) => item.order)).toEqual([1, 2, 3, 4]);
  });

  it('does not treat a generic question title as the review gap label', () => {
    const normalized = normalizeReviewRecallOutlines([
      outline({ id: 'recall', title: '旧知扫描', order: 1 }),
      outline({ id: 'anchor', title: '课文支点', order: 2 }),
      outline({ id: 'question', title: '问题：人物精神如何体现', order: 3 }),
    ]);

    expect(normalized).toHaveLength(3);
    expect(normalized.map((item) => item.id)).toEqual(['recall', 'anchor', 'question']);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { generateSceneOutlinesFromRequirements } from '@/lib/generation/outline-generator';
import type { SceneOutline, UserRequirements } from '@/lib/types/generation';

const requirements: UserRequirements = {
  requirement: '生成一节阅读课。',
  language: 'zh-CN',
};

function modelOutline(overrides: Partial<SceneOutline>): SceneOutline {
  return {
    id: overrides.id || 'scene_1',
    type: 'slide',
    title: overrides.title || '阅读方法梳理',
    description: overrides.description || '',
    keyPoints: overrides.keyPoints || [],
    order: overrides.order || 1,
    language: 'zh-CN',
    ...overrides,
  };
}

describe('outline generator', () => {
  it('normalizes adjacent review recall label pages before returning outlines', async () => {
    const aiCall = vi.fn(async () =>
      JSON.stringify([
        modelOutline({ id: 'recall', title: '旧知扫描', order: 1 }),
        modelOutline({ id: 'anchor', title: '课文支点', order: 2 }),
        modelOutline({ id: 'gap', title: '先补问题', order: 3 }),
        modelOutline({
          id: 'lesson',
          title: '通览全文',
          description: '通览全文，抓关键词句，品味细节。',
          keyPoints: ['通览全文', '抓关键词句', '品味细节'],
          order: 4,
        }),
      ]),
    );

    const result = await generateSceneOutlinesFromRequirements(
      requirements,
      undefined,
      undefined,
      aiCall,
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({
      id: 'recall',
      title: '复习导入',
      order: 1,
      learningContext: { section: 'review' },
    });
    expect(result.data?.[0].keyPoints).toEqual([
      '旧知扫描：回顾已学方法、唤醒关键词',
      '课文支点：定位课文线索、连接本课目标',
      '先补问题：标出疑问点、明确待补内容',
    ]);
    expect(result.data?.[1]).toMatchObject({
      id: 'lesson',
      title: '通览全文',
      order: 2,
    });
  });
});

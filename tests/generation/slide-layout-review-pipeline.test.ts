import { describe, expect, it, vi } from 'vitest';

import { generateSceneContent } from '@/lib/generation/scene-generator';
import type { SceneOutline } from '@/lib/types/generation';

const outline: SceneOutline = {
  id: 'scene_layout_review',
  type: 'slide',
  title: '阅读与写作相互照亮',
  description: '梳理阅读发现如何转化为表达。',
  keyPoints: ['读人物', '读对话', '写人物'],
  order: 1,
  language: 'zh-CN',
};

const validSlide = JSON.stringify({
  background: { type: 'solid', color: '#fffdf8' },
  elements: [
    {
      type: 'text',
      left: 60,
      top: 35,
      width: 880,
      height: 55,
      content: '<p style="font-size:32px">阅读与写作相互照亮</p>',
      defaultFontName: 'Microsoft YaHei',
      defaultColor: '#222222',
    },
    {
      type: 'text',
      left: 90,
      top: 150,
      width: 820,
      height: 240,
      content:
        '<p style="font-size:22px">读人物：发现特点</p><p style="font-size:22px">读对话：体会表达</p><p style="font-size:22px">写人物：迁移方法</p>',
      defaultFontName: 'Microsoft YaHei',
      defaultColor: '#333333',
    },
  ],
});

const poorSlide = JSON.stringify({
  elements: [
    {
      type: 'shape',
      left: 25,
      top: 25,
      width: 70,
      height: 12,
      fill: '#c98b2b',
      path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
      viewBox: [1, 1],
      fixedRatio: false,
    },
    {
      type: 'shape',
      left: 350,
      top: 140,
      width: 310,
      height: 310,
      fill: '#f4dfbd',
      path: 'M 1 0.5 A 0.5 0.5 0 1 1 0 0.5 A 0.5 0.5 0 1 1 1 0.5 Z',
      viewBox: [1, 1],
      fixedRatio: true,
      text: {
        content: '<p>阅读发现变成表达</p>',
        align: 'middle',
        defaultFontName: 'Microsoft YaHei',
        defaultColor: '#333333',
      },
    },
  ],
});

describe('slide layout review pipeline', () => {
  it('uses one structural model review for a valid candidate', async () => {
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(validSlide)
      .mockResolvedValueOnce(JSON.stringify({ approved: true, summary: 'balanced', issues: [] }));

    const content = await generateSceneContent(
      outline,
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { slideLayoutReviewEnabled: true },
    );

    expect(content && 'elements' in content).toBe(true);
    expect(aiCall).toHaveBeenCalledTimes(2);
    expect(aiCall.mock.calls[1][0]).toContain('strict presentation layout reviewer');
  });

  it('repairs once and reviews the corrected candidate', async () => {
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(validSlide)
      .mockResolvedValueOnce(
        JSON.stringify({
          approved: false,
          summary: 'needs stronger hierarchy',
          issues: [
            {
              code: 'weak-hierarchy',
              severity: 'critical',
              elementIndexes: [0, 1],
              message: 'Separate title and body more clearly',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(validSlide)
      .mockResolvedValueOnce(JSON.stringify({ approved: true, summary: 'fixed', issues: [] }));

    const content = await generateSceneContent(
      outline,
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { slideLayoutReviewEnabled: true },
    );

    expect(content && 'elements' in content).toBe(true);
    expect(aiCall).toHaveBeenCalledTimes(4);
    expect(aiCall.mock.calls[2][0]).toContain('repair classroom slide layouts');
  });

  it('falls back when a rule-rejected candidate cannot be corrected', async () => {
    const aiCall = vi.fn().mockResolvedValueOnce(poorSlide).mockResolvedValueOnce('not valid JSON');

    const content = await generateSceneContent(
      outline,
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { slideLayoutReviewEnabled: true },
    );

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;
    expect(content.elements.some((element) => String(element.id).startsWith('fallback_'))).toBe(
      true,
    );
    expect(aiCall).toHaveBeenCalledTimes(2);
  });
});

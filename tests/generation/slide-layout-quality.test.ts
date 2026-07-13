import { describe, expect, it } from 'vitest';

import {
  detectSlideLayoutQualityIssues,
  parseSlideLayoutModelReview,
} from '@/lib/generation/slide-layout-quality';
import type { SceneOutline } from '@/lib/types/generation';

const outline: SceneOutline = {
  id: 'scene_review',
  type: 'slide',
  title: '回顾：阅读与写作相互照亮',
  description: '梳理阅读发现如何转化为人物表达。',
  keyPoints: ['读人物', '读对话', '写人物'],
  order: 1,
  language: 'zh-CN',
};

describe('slide layout quality', () => {
  it('detects the missing-title, oversized-shape screenshot pattern', () => {
    const issues = detectSlideLayoutQualityIssues(outline, [
      {
        type: 'shape',
        left: 25,
        top: 25,
        width: 70,
        height: 12,
        fill: '#c98b2b',
      },
      {
        type: 'shape',
        left: 350,
        top: 145,
        width: 310,
        height: 310,
        fill: '#f4dfbd',
        text: { content: '<p>阅读发现<br>变成表达</p>' },
      },
      {
        type: 'text',
        left: 80,
        top: 100,
        width: 180,
        height: 50,
        content: '<p>读人物</p>',
      },
    ]);

    expect(issues.map((issue) => issue.code)).toContain('missing-slide-title');
    expect(issues.map((issue) => issue.code)).toContain('orphan-decoration');
  });

  it('accepts a visible title and balanced instructional text', () => {
    const issues = detectSlideLayoutQualityIssues(outline, [
      {
        type: 'text',
        left: 60,
        top: 35,
        width: 880,
        height: 55,
        content: '<p>回顾：阅读与写作相互照亮</p>',
      },
      {
        type: 'text',
        left: 80,
        top: 150,
        width: 840,
        height: 220,
        content: '<p>读人物：发现特点</p><p>读对话：体会表达</p><p>写人物：迁移方法</p>',
      },
    ]);

    expect(issues).toEqual([]);
  });

  it('validates model review JSON', () => {
    expect(
      parseSlideLayoutModelReview({
        approved: false,
        summary: 'Title is missing',
        issues: [
          {
            code: 'missing-title',
            severity: 'critical',
            elementIndexes: [],
            message: 'Add the intended title',
          },
        ],
      }),
    ).toMatchObject({ approved: false, summary: 'Title is missing' });
    expect(parseSlideLayoutModelReview({ approved: false, issues: [] })).toBeNull();
  });
});

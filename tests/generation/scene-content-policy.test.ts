import { describe, expect, it } from 'vitest';

import {
  detectSceneContentVisualIntent,
  sanitizeSceneContentOutline,
  stripVisualPlanningMarkers,
} from '@/lib/generation/scene-content-policy';
import type { SceneOutline } from '@/lib/types/generation';

describe('scene content policy', () => {
  it('removes visual planning markers while preserving lesson content', () => {
    expect(stripVisualPlanningMarkers('「流程图」通览全文 -> 抓关键词句 -> 品味细节')).toBe(
      '通览全文 -> 抓关键词句 -> 品味细节',
    );
    expect(stripVisualPlanningMarkers('[Chart] 近三年成绩变化')).toBe('近三年成绩变化');
    expect(stripVisualPlanningMarkers('[Table] 人物言行对照')).toBe('人物言行对照');
    expect(stripVisualPlanningMarkers('[金字塔图] 行动层、品质层、精神层')).toBe(
      '行动层、品质层、精神层',
    );
    expect(stripVisualPlanningMarkers('学习流程图的基本结构')).toBe('学习流程图的基本结构');
  });

  it('sanitizes visual markers from description and keyPoints', () => {
    const outline: SceneOutline = {
      id: 'scene_visual_marker',
      type: 'slide',
      title: '阅读方法梳理',
      description: '本页梳理阅读方法。\n【流程图】通览全文 -> 抓关键词句 -> 品味细节',
      keyPoints: ['通览全文', '（流程图）抓关键词句 -> 品味细节', '[Table] 人物言行对照'],
      order: 1,
      language: 'zh-CN',
    };

    const sanitized = sanitizeSceneContentOutline(outline);

    expect(sanitized.description).toBe('本页梳理阅读方法。 通览全文 -> 抓关键词句 -> 品味细节');
    expect(sanitized.keyPoints).toEqual(['通览全文', '抓关键词句 -> 品味细节', '人物言行对照']);
  });

  it('detects pyramid visual intent before marker cleanup', () => {
    const outline: SceneOutline = {
      id: 'scene_pyramid',
      type: 'slide',
      title: '精神品质层级',
      description: '[金字塔图] 行动层、品质层、精神层',
      keyPoints: ['行动层：冲锋、坚守、牺牲、互助', '品质层：勇敢、坚韧、无私、忠诚'],
      order: 1,
      language: 'zh-CN',
    };

    expect(detectSceneContentVisualIntent(outline)).toEqual({ kind: 'pyramid' });
    expect(sanitizeSceneContentOutline(outline).description).toBe('行动层、品质层、精神层');
  });
});

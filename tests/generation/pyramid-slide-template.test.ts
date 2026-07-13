import { describe, expect, it } from 'vitest';

import {
  buildPyramidSlideContent,
  isPyramidSlideOutline,
} from '@/lib/generation/pyramid-slide-template';
import type { SceneOutline } from '@/lib/types/generation';

function outline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: 'scene_pyramid',
    type: 'slide',
    title: '革命精神的三层理解',
    description: '[金字塔图] 行动层、品质层、精神层',
    keyPoints: [
      '行动层：冲锋、坚守、牺牲、互助',
      '品质层：勇敢、坚韧、无私、忠诚',
      '精神层：保家卫国、热爱人民、承担责任',
    ],
    order: 1,
    language: 'zh-CN',
    ...overrides,
  };
}

describe('pyramid slide template', () => {
  it('detects pyramid outlines and builds a three-layer diagram', () => {
    expect(isPyramidSlideOutline(outline(), { kind: 'pyramid' })).toBe(true);

    const content = buildPyramidSlideContent(outline());
    const visibleText = JSON.stringify(content);
    const layerShapes = content.elements.filter((element) =>
      element.id.startsWith('template_pyramid_layer_'),
    );

    expect(layerShapes).toHaveLength(3);
    expect(visibleText).toContain('行动层');
    expect(visibleText).toContain('品质层');
    expect(visibleText).toContain('精神层');
    expect(visibleText).toContain('冲锋、坚守、牺牲、互助');
    expect(visibleText).not.toContain('[金字塔图]');
    expect(visibleText).not.toContain('金字塔图');
  });

  it('infers pyramid outlines from the three canonical layer labels', () => {
    expect(
      isPyramidSlideOutline(
        outline({
          description: '行动层、品质层、精神层',
          keyPoints: ['行动层：冲锋', '品质层：勇敢', '精神层：保家卫国'],
        }),
      ),
    ).toBe(true);
  });
});

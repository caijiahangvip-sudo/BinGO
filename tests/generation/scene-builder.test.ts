import { describe, expect, it } from 'vitest';

import { buildCompleteScene } from '@/lib/generation/scene-builder';
import { getPresentationPalette } from '@/lib/theme/color-themes';
import type { GeneratedSlideContent, SceneOutline } from '@/lib/types/generation';
import type { PPTShapeElement } from '@/lib/types/slides';

describe('scene builder', () => {
  it('builds slide scenes without post-generation layout repair', () => {
    const outline: SceneOutline = {
      id: 'scene_1',
      type: 'slide',
      title: 'Slide without repair',
      description: 'A slide that keeps generated layout unchanged.',
      keyPoints: ['generated layout'],
      order: 1,
    };

    const accentBar: PPTShapeElement = {
      id: 'shape_footer_accent',
      type: 'shape',
      left: 70,
      top: 448,
      width: 860,
      height: 24,
      rotate: 0,
      viewBox: [1, 1],
      path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
      fixedRatio: false,
      fill: '#2563eb',
    };

    const footerBand: PPTShapeElement = {
      id: 'shape_footer_prompt',
      type: 'shape',
      left: 80,
      top: 460,
      width: 840,
      height: 52,
      rotate: 0,
      viewBox: [1, 1],
      path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
      fixedRatio: false,
      fill: '#dbeeff',
    };

    const content: GeneratedSlideContent = {
      elements: [accentBar, footerBand],
    };

    const scene = buildCompleteScene(outline, content, [], 'stage_1');
    expect(scene?.type).toBe('slide');
    if (!scene || scene.content.type !== 'slide') return;

    expect(scene.content.canvas.elements).toEqual(content.elements);
  });

  it('builds slide scenes with the requested visual theme', () => {
    const outline: SceneOutline = {
      id: 'scene_themed',
      type: 'slide',
      title: 'Themed slide',
      description: 'A slide using a selected classroom palette.',
      keyPoints: ['theme'],
      order: 1,
    };
    const content: GeneratedSlideContent = {
      elements: [],
      background: { type: 'solid', color: '#ffffff' },
    };
    const palette = getPresentationPalette('nature-reader');

    const scene = buildCompleteScene(outline, content, [], 'stage_1', 'nature-reader');

    expect(scene?.type).toBe('slide');
    if (!scene || scene.content.type !== 'slide') return;
    expect(scene.content.canvas.theme.backgroundColor).toBe(palette.background);
    expect(scene.content.canvas.theme.themeColors).toEqual(palette.chartColors);
    expect(scene.content.canvas.theme.fontColor).toBe(palette.text);
  });
});

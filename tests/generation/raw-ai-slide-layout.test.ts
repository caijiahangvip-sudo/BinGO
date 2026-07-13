import { describe, expect, it } from 'vitest';

import { finalizeGeneratedSlideContent } from '@/lib/generation/scene-generator';
import type { GeneratedSlideData } from '@/lib/generation/pipeline-types';
import type { SceneOutline } from '@/lib/types/generation';

const outline: SceneOutline = {
  id: 'scene_raw_layout',
  type: 'slide',
  title: '原始布局测试',
  description: '验证 AI 几何信息不经过布局修补。',
  keyPoints: ['保留坐标', '保留尺寸'],
  order: 1,
  language: 'zh-CN',
};

describe('raw AI slide layout mode', () => {
  it('preserves AI geometry, ordering, rotation, and missing layout defaults', () => {
    const generatedData: GeneratedSlideData = {
      elements: [
        {
          type: 'shape',
          left: -35,
          top: 510,
          width: 460,
          height: 120,
          rotate: 17,
          fill: '#123456',
        },
        {
          type: 'text',
          left: 120,
          top: 130,
          width: 360,
          height: 18,
          rotate: -9,
          content: '<p style="font-size: 42px;">这段文字故意超出文本框高度</p>',
        },
      ],
      background: { type: 'solid', color: '#abcdef' },
      remark: 'AI 原始备注',
    };

    const result = finalizeGeneratedSlideContent(
      generatedData,
      outline,
      undefined,
      undefined,
      'warm-storybook',
      'classic-title-points',
      false,
    );

    expect(result).not.toBeNull();
    expect(result?.elements.map((element) => element.type)).toEqual(['shape', 'text']);
    expect(result?.elements[0]).toMatchObject({
      left: -35,
      top: 510,
      width: 460,
      height: 120,
      rotate: 17,
    });
    expect(result?.elements[1]).toMatchObject({
      left: 120,
      top: 130,
      width: 360,
      height: 18,
      rotate: -9,
    });
    expect(result?.elements[0]).not.toHaveProperty('path');
    expect(result?.elements[0].id).toMatch(/^shape_/);
    expect(result?.elements[1].id).toMatch(/^text_/);
    expect(result?.remark).toBe('AI 原始备注');
  });

  it('still resolves image IDs and renders LaTeX', () => {
    const generatedData: GeneratedSlideData = {
      elements: [
        {
          type: 'image',
          left: 40,
          top: 60,
          width: 300,
          height: 200,
          src: 'img_1',
        },
        {
          type: 'latex',
          left: 380,
          top: 70,
          width: 240,
          height: 80,
          latex: 'x^2 + y^2',
        },
      ],
    };

    const result = finalizeGeneratedSlideContent(
      generatedData,
      outline,
      undefined,
      { img_1: 'data:image/png;base64,example' },
      'warm-storybook',
      'classic-title-points',
      false,
    );

    expect(result).not.toBeNull();
    expect(result?.elements[0]).toMatchObject({
      type: 'image',
      src: 'data:image/png;base64,example',
      left: 40,
      top: 60,
      width: 300,
      height: 200,
    });
    expect(result?.elements[1]).toMatchObject({
      type: 'latex',
      latex: 'x^2 + y^2',
      left: 380,
      top: 70,
      width: 240,
      height: 80,
      fixedRatio: true,
    });
    expect(result?.elements[1]).toHaveProperty('html');
  });

  it('runs the existing repair pipeline when layout review is enabled', () => {
    const generatedData: GeneratedSlideData = {
      elements: [
        {
          type: 'shape',
          left: 80,
          top: 150,
          width: 280,
          height: 120,
          fill: '#123456',
        },
        {
          type: 'text',
          left: 120,
          top: 180,
          width: 180,
          height: 50,
          rotate: 23,
          content: '<p style="font-size: 24px;">审核模式</p>',
        },
      ],
    };

    const result = finalizeGeneratedSlideContent(
      generatedData,
      outline,
      undefined,
      undefined,
      'warm-storybook',
      'classic-title-points',
      true,
    );

    expect(result).not.toBeNull();
    expect(result?.elements[0]).toHaveProperty('path');
    expect(
      result?.elements.every((element) => !('rotate' in element) || element.rotate === 0),
    ).toBe(true);
  });
});

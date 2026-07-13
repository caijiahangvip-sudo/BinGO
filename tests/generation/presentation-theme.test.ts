import { describe, expect, it } from 'vitest';

import {
  applyPresentationThemeToSlideContent,
  buildPresentationThemePrompt,
  createSlideTheme,
} from '@/lib/theme/presentation-theme';
import { getColorThemePreset, getPresentationPalette } from '@/lib/theme/color-themes';
import type { GeneratedSlideContent } from '@/lib/types/generation';
import type { PPTChartElement, PPTShapeElement, PPTTextElement } from '@/lib/types/slides';

describe('presentation theme', () => {
  it('maps common generated colors to the selected presentation palette', () => {
    const palette = getPresentationPalette('nature-reader');
    const text: PPTTextElement = {
      id: 'text_1',
      type: 'text',
      left: 0,
      top: 0,
      width: 200,
      height: 40,
      rotate: 0,
      content: '<p style="color: #2563eb;">重点</p>',
      defaultFontName: 'Arial',
      defaultColor: '#111827',
    };
    const shape: PPTShapeElement = {
      id: 'shape_1',
      type: 'shape',
      left: 0,
      top: 50,
      width: 200,
      height: 80,
      rotate: 0,
      viewBox: [1, 1],
      path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
      fixedRatio: false,
      fill: '#dbeafe',
      outline: { color: '#2563eb', width: 1, style: 'solid' },
    };
    const chart: PPTChartElement = {
      id: 'chart_1',
      type: 'chart',
      left: 0,
      top: 140,
      width: 200,
      height: 120,
      rotate: 0,
      chartType: 'bar',
      data: { labels: ['A'], legends: ['B'], series: [[1]] },
      themeColors: ['#2563eb'],
    };
    const content: GeneratedSlideContent = {
      elements: [text, shape, chart],
      background: { type: 'solid', color: '#ffffff' },
    };

    const themed = applyPresentationThemeToSlideContent(content, 'nature-reader');

    expect(themed.background).toEqual({ type: 'solid', color: palette.background });
    expect((themed.elements[0] as PPTTextElement).defaultColor).toBe(palette.title);
    expect((themed.elements[0] as PPTTextElement).content).toContain(palette.primary);
    expect((themed.elements[1] as PPTShapeElement).fill).toBe(palette.primarySoft);
    expect((themed.elements[1] as PPTShapeElement).outline?.color).toBe(palette.primary);
    expect((themed.elements[2] as PPTChartElement).themeColors).toEqual(palette.chartColors);
  });

  it('creates slide theme and prompt from the selected preset', () => {
    const palette = getPresentationPalette('night-lecture');
    const preset = getColorThemePreset('night-lecture');
    const theme = createSlideTheme('night-lecture');
    const prompt = buildPresentationThemePrompt('night-lecture', 'zh-CN');

    expect(theme.backgroundColor).toBe(palette.background);
    expect(theme.themeColors).toEqual(palette.chartColors);
    expect(theme.fontColor).toBe(palette.text);
    expect(prompt).toContain(preset.label.zh);
    expect(prompt).toContain(palette.primary);
  });
});

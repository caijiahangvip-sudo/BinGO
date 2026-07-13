import { describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/generate/scene-actions/route';
import { getPresentationPalette } from '@/lib/theme/color-themes';
import type { GeneratedSlideContent, SceneOutline } from '@/lib/types/generation';

vi.mock('@/lib/ai/llm', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromHeaders: vi.fn(() => {
    throw new Error('API key required for provider: openai');
  }),
}));

function request(body: Record<string, unknown>): Parameters<typeof POST>[0] {
  return new Request('http://localhost/api/generate/scene-actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

describe('scene actions route fallback', () => {
  it('returns fallback actions when model resolution fails', async () => {
    const outline: SceneOutline = {
      id: 'interactive_1',
      type: 'interactive',
      title: '升旗礼仪小判断',
      description: '通过互动判断练习升旗礼仪。',
      keyPoints: ['升旗时立正站好', '认真看国旗'],
      order: 1,
      language: 'zh-CN',
      interactiveConfig: {
        conceptName: '升旗礼仪小判断',
        conceptOverview: '判断升旗时哪些做法是正确的。',
        designIdea: '点击正确或错误做法并获得反馈。',
        subject: '德育',
      },
    };

    const response = await POST(
      request({
        outline,
        allOutlines: [outline],
        content: {
          html: '<!DOCTYPE html><html><body><button data-ok="true">立正站好</button></body></html>',
        },
        stageId: 'stage_1',
        previousSpeeches: [],
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.warning).toBe('SCENE_ACTIONS_FALLBACK');
    expect(data.scene.actions.length).toBeGreaterThan(0);
    expect(data.scene.actions[0].type).toBe('speech');
    expect(JSON.stringify(data.scene.actions)).not.toContain('我是AI老师');
  });

  it('uses visual theme when assembling fallback slide scenes', async () => {
    const outline: SceneOutline = {
      id: 'slide_1',
      type: 'slide',
      title: '主题页',
      description: '用指定主题组装页面。',
      keyPoints: ['统一配色'],
      order: 1,
      language: 'zh-CN',
    };
    const content: GeneratedSlideContent = {
      elements: [],
      background: { type: 'solid', color: '#ffffff' },
    };
    const palette = getPresentationPalette('pastel-classroom');

    const response = await POST(
      request({
        outline,
        allOutlines: [outline],
        content,
        stageId: 'stage_1',
        previousSpeeches: [],
        visualTheme: 'pastel-classroom',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.warning).toBe('SCENE_ACTIONS_FALLBACK');
    expect(data.scene.content.canvas.theme.backgroundColor).toBe(palette.background);
    expect(data.scene.content.canvas.theme.themeColors).toEqual(palette.chartColors);
  });
});

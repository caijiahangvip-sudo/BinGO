import { describe, expect, it, vi } from 'vitest';

import {
  buildFallbackInteractiveContent,
  generateSceneActions,
  generateSceneContent,
} from '@/lib/generation/scene-generator';
import { INTERACTIVE_COMPACT_REPAIR_MARKER } from '@/lib/generation/interactive-post-processor';
import type { SceneOutline } from '@/lib/types/generation';

function interactiveOutline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
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
    ...overrides,
  };
}

describe('interactive scene generation', () => {
  it('uses a deterministic interactive page for basic judgment scenes', async () => {
    const aiCall = vi.fn(async () => 'unused');

    const content = await generateSceneContent(interactiveOutline(), aiCall);

    expect(content && 'html' in content).toBe(true);
    if (!content || !('html' in content)) return;
    expect(content.html).toContain('升旗礼仪小判断');
    expect(content.html).toContain('data-ok="true"');
    expect(content.html).toContain('升旗时立正站好');
    expect(content.html).toContain('data-bingo-interactive-root');
    expect(content.html).toContain('height: 100vh');
    expect(content.html).not.toContain('place-items: center');
    expect(content.html).not.toContain('width: min(920px, 92vw)');
    expect(aiCall).not.toHaveBeenCalled();
  });

  it('builds fallback interactive pages as full-stage layouts', () => {
    const content = buildFallbackInteractiveContent(interactiveOutline(), 'zh-CN');

    expect(content.html).toContain('data-bingo-interactive-root');
    expect(content.html).toContain('width: 100vw');
    expect(content.html).toContain('height: 100vh');
    expect(content.html).toContain('grid-template-rows: auto minmax(0, 1fr) auto');
    expect(content.html).not.toContain('place-items: center');
    expect(content.html).not.toContain('width: min(920px, 92vw)');
  });

  it('repairs compact AI-generated interactive HTML before returning content', async () => {
    const compactHtml = `<!DOCTYPE html>
<html>
<head>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; }
    body { display: grid; place-items: center; background: #f8fafc; }
    main {
      width: min(920px, 92vw);
      min-height: min(500px, 86vh);
      background: #ffffff;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <main>
    <h1>细胞膜运输模拟</h1>
    <div class="choices"><button>观察扩散</button><button>改变浓度</button></div>
    <div id="feedback">拖动滑块观察变化。</div>
  </main>
</body>
</html>`;
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          core_formulas: ['Flux follows concentration gradient'],
          mechanism: ['Particles move from high concentration to low concentration'],
          constraints: ['Do not reverse diffusion direction'],
          forbidden_errors: [],
        }),
      )
      .mockResolvedValueOnce(compactHtml);

    const content = await generateSceneContent(
      interactiveOutline({
        title: '细胞膜运输模拟',
        description: '观察粒子如何跨膜扩散。',
        keyPoints: ['粒子从高浓度区域向低浓度区域扩散', '浓度差会影响扩散速度'],
        interactiveConfig: {
          conceptName: '细胞膜运输模拟',
          conceptOverview: '观察粒子如何跨膜扩散。',
          designIdea: '拖动滑块改变浓度差，观察粒子移动。',
          subject: '生物',
        },
      }),
      aiCall,
    );

    expect(content && 'html' in content).toBe(true);
    if (!content || !('html' in content)) return;
    expect(content.html).toContain(INTERACTIVE_COMPACT_REPAIR_MARKER);
    expect(content.html).toContain('width: 100vw !important');
    expect(content.html).toContain('max-width: none !important');
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('falls back to a usable interactive page when model HTML generation fails', async () => {
    const aiCall = vi.fn(async () => {
      throw new Error('Invalid JSON response');
    });

    const content = await generateSceneContent(
      interactiveOutline({
        title: '水循环模拟',
        description: '通过互动观察水循环过程。',
        keyPoints: ['蒸发形成水汽', '遇冷凝结成云'],
        interactiveConfig: {
          conceptName: '水循环模拟',
          conceptOverview: '观察水从蒸发到凝结的循环。',
          designIdea: '拖动滑块观察变化。',
          subject: '科学',
        },
      }),
      aiCall,
    );

    expect(content && 'html' in content).toBe(true);
    if (!content || !('html' in content)) return;
    expect(content.html).toContain('水循环模拟');
    expect(content.html).toContain('data-ok="true"');
    expect(content.html).toContain('蒸发形成水汽');
    expect(aiCall).toHaveBeenCalledTimes(2);
  });

  it('falls back to usable interactive actions when model action generation fails', async () => {
    const aiCall = vi.fn(async () => {
      throw new Error('Invalid JSON response');
    });

    const actions = await generateSceneActions(
      interactiveOutline(),
      { html: '<!DOCTYPE html><html><body><button data-ok="true">立正站好</button></body></html>' },
      aiCall,
    );

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].type).toBe('speech');
    expect(actions[0]).toMatchObject({
      title: '交互引导',
      text: expect.stringContaining('交互式可视化'),
    });
    expect(JSON.stringify(actions)).not.toContain('我是AI老师');
    expect(aiCall).toHaveBeenCalledTimes(1);
  });
});

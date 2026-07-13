import { describe, expect, it, vi } from 'vitest';

import { generateSceneContent } from '@/lib/generation/scene-generator';
import { getPresentationPalette } from '@/lib/theme/color-themes';
import type { SceneOutline } from '@/lib/types/generation';
import type { PPTLineElement, PPTShapeElement, PPTTextElement } from '@/lib/types/slides';

function outline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: 'scene_1',
    type: 'slide',
    title: '分数大小对比',
    description: '比较两个分数并判断谁更大。',
    keyPoints: ['观察分子和分母', '结合图示判断大小', '说明判断理由', '联系生活中的分蛋糕情境'],
    order: 1,
    language: 'zh-CN',
    ...overrides,
  };
}

function overlaps(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) {
  return !(
    a.left + a.width <= b.left ||
    b.left + b.width <= a.left ||
    a.top + a.height <= b.top ||
    b.top + b.height <= a.top
  );
}

const goodSlideJson = JSON.stringify({
  background: { type: 'solid', color: '#ffffff' },
  elements: [
    {
      type: 'text',
      left: 60,
      top: 60,
      width: 880,
      height: 52,
      content: '<p style="font-size: 28px; font-weight: 700;">分数大小对比</p>',
      defaultFontName: '',
      defaultColor: '#111827',
    },
    {
      type: 'text',
      left: 60,
      top: 114,
      width: 880,
      height: 40,
      content: '<p style="font-size: 16px;">比较两个分数并判断谁更大。</p>',
      defaultFontName: '',
      defaultColor: '#5b6472',
    },
    {
      type: 'shape',
      left: 60,
      top: 170,
      width: 420,
      height: 230,
      path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
      viewBox: [1, 1],
      fill: '#f5f8ff',
      fixedRatio: false,
    },
    {
      type: 'text',
      left: 84,
      top: 198,
      width: 370,
      height: 128,
      content:
        '<p style="font-size: 18px;">• 观察分子和分母</p><p style="font-size: 18px;">• 结合图示判断大小</p>',
      defaultFontName: '',
      defaultColor: '#333333',
    },
    {
      type: 'shape',
      left: 520,
      top: 170,
      width: 420,
      height: 230,
      path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
      viewBox: [1, 1],
      fill: '#fff7ed',
      fixedRatio: false,
    },
    {
      type: 'text',
      left: 544,
      top: 198,
      width: 370,
      height: 128,
      content:
        '<p style="font-size: 18px;">• 说明判断理由</p><p style="font-size: 18px;">• 联系生活中的分蛋糕情境</p>',
      defaultFontName: '',
      defaultColor: '#333333',
    },
    {
      type: 'text',
      left: 60,
      top: 430,
      width: 880,
      height: 40,
      content: '<p style="font-size: 15px;">对比时先看单位“1”是否相同。</p>',
      defaultFontName: '',
      defaultColor: '#475569',
    },
  ],
});

describe('slide scene generation', () => {
  it('generates slide content with a single slide-content prompt', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const aiCall = vi.fn(async (system: string, user: string) => {
      calls.push({ system, user });
      return goodSlideJson;
    });

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    expect(aiCall).toHaveBeenCalledTimes(1);
    expect(calls[0].user).not.toContain('Audit Problems To Fix');
    expect(calls[0].user).not.toContain('Recommended Structure');
    expect(calls[0].user).toContain('版式方案 / Layout Variant');
    expect(calls[0].user).toContain('版式：compare-columns');
    expect(
      content &&
        'elements' in content &&
        content.elements.some((element) => element.id.startsWith('template_')),
    ).toBe(false);
  });

  it('passes classroom constraints through a dedicated prompt field', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const aiCall = vi.fn(async (system: string, user: string) => {
      calls.push({ system, user });
      return goodSlideJson;
    });

    await generateSceneContent(
      outline(),
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        generationConstraints: ['这个 scene 必须生成普通互动课堂页面，不要文档版式。'],
      },
    );

    expect(calls[0].user).toContain('生成约束 / Generation Constraints');
    expect(calls[0].user).toContain('这个 scene 必须生成普通互动课堂页面');
    expect(calls[0].user).not.toContain('普通 Bingo');
  });

  it('passes explicit layout variants through the slide prompt without changing outline text', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const aiCall = vi.fn(async (system: string, user: string) => {
      calls.push({ system, user });
      return goodSlideJson;
    });

    await generateSceneContent(
      outline({
        description: '通览全文，明确学习路径。',
        keyPoints: ['通览全文', '抓关键词句', '品味细节'],
      }),
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        layoutVariant: 'three-card-scan',
      },
    );

    expect(calls[0].user).toContain('版式方案 / Layout Variant');
    expect(calls[0].user).toContain('版式：three-card-scan');
    expect(calls[0].user).toContain('三卡扫描页');
    expect(calls[0].user).toContain('通览全文，明确学习路径。');
  });

  it('strips visual planning markers before building the slide prompt', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const aiCall = vi.fn(async (system: string, user: string) => {
      calls.push({ system, user });
      return goodSlideJson;
    });

    await generateSceneContent(
      outline({
        description: '【流程图】通览全文 -> 抓关键词句 -> 品味细节',
        keyPoints: ['「流程图」通览全文 -> 抓关键词句 -> 品味细节', '[Table] 人物言行对照'],
      }),
      aiCall,
    );

    expect(calls[0].user).toContain('通览全文 -> 抓关键词句 -> 品味细节');
    expect(calls[0].user).toContain('人物言行对照');
    expect(calls[0].user).not.toContain('流程图');
    expect(calls[0].user).not.toContain('[Table]');
  });

  it('routes pyramid outlines to a deterministic diagram without calling AI', async () => {
    const aiCall = vi.fn(async () => {
      throw new Error('AI should not be called for pyramid template');
    });

    const content = await generateSceneContent(
      outline({
        title: '革命精神的三层理解',
        description: '[金字塔图] 行动层、品质层、精神层',
        keyPoints: [
          '行动层：冲锋、坚守、牺牲、互助',
          '品质层：勇敢、坚韧、无私、忠诚',
          '精神层：保家卫国、热爱人民、承担责任',
        ],
      }),
      aiCall,
    );

    expect(content && 'elements' in content).toBe(true);
    expect(aiCall).not.toHaveBeenCalled();
    const visibleText = JSON.stringify(content);
    expect(visibleText).toContain('template_pyramid_layer_action');
    expect(visibleText).toContain('template_pyramid_layer_quality');
    expect(visibleText).toContain('template_pyramid_layer_spirit');
    expect(visibleText).toContain('行动层');
    expect(visibleText).toContain('品质层');
    expect(visibleText).toContain('精神层');
    expect(visibleText).toContain('冲锋、坚守、牺牲、互助');
    expect(visibleText).not.toContain('[金字塔图]');
    expect(visibleText).not.toContain('金字塔图');
  });

  it('routes review warm-up outlines to a deterministic review flow template', async () => {
    const aiCall = vi.fn(async () => goodSlideJson);

    const content = await generateSceneContent(
      outline({
        title: '复习导入',
        description: '回顾第2课薄弱知识点，帮助学生重新进入学习状态。',
        keyPoints: ['旧知连接', '薄弱点', '证据表达', '阅读方法'],
        learningContext: {
          section: 'review',
          knowledgePointIds: ['kp_1'],
        },
      }),
      aiCall,
    );
    const visibleText = JSON.stringify(content);

    expect(content && 'elements' in content).toBe(true);
    expect(aiCall).not.toHaveBeenCalled();
    expect(visibleText).toContain('template_review_recall_card_recall');
    expect(visibleText).toContain('template_review_recall_card_anchor');
    expect(visibleText).toContain('template_review_recall_card_gap');
    expect(visibleText).not.toContain('Bingo 热身');
    expect(visibleText).not.toContain('连成一线喊 Bingo');
    expect(visibleText).not.toContain('哪一格最需要补足');
    expect(visibleText).not.toContain('九宫格');
  });

  it('retries invalid slide JSON with a stricter JSON prompt', async () => {
    const aiCall = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce(goodSlideJson);

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    expect(aiCall).toHaveBeenCalledTimes(2);
    expect(aiCall.mock.calls[1][0]).toContain('Return only one valid JSON object');
    expect(aiCall.mock.calls[1][1]).toContain('invalid JSON response');
    expect(aiCall.mock.calls[1][1]).toContain('版式方案 / Layout Variant');
    expect(aiCall.mock.calls[1][1]).toContain('版式：compare-columns');
  });

  it('expands cramped generated text boxes before rendering', async () => {
    const crampedSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'shape',
          left: 110,
          top: 250,
          width: 300,
          height: 54,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#fff7cc',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 130,
          top: 262,
          width: 260,
          height: 28,
          content:
            '<p style="font-size: 24px; font-weight: 700;">做准备好的小学生</p><p style="font-size: 20px;">集齐用品</p><p style="font-size: 20px;">上学不慌张</p>',
          defaultFontName: '',
          defaultColor: '#111827',
        },
      ],
    });
    const aiCall = vi.fn(async () => crampedSlideJson);

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    const text = content.elements.find(
      (element) =>
        element.type === 'text' &&
        'content' in element &&
        String(element.content).includes('做准备好的小学生'),
    ) as PPTTextElement | undefined;
    const shape = content.elements.find(
      (element) => element.type === 'shape' && 'fill' in element && element.fill === '#fff7cc',
    ) as PPTShapeElement | undefined;

    expect(text?.height).toBeGreaterThan(28);
    expect(shape?.height).toBeGreaterThan(54);
    expect(text && text.top + text.height).toBeLessThanOrEqual(562.5 - 12);
  });

  it('recenters short banner text inside containing shapes', async () => {
    const palette = getPresentationPalette();
    const bannerSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'shape',
          left: 120,
          top: 220,
          width: 280,
          height: 56,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#111827',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 145,
          top: 226,
          width: 180,
          height: 24,
          content: '<p style="font-size: 24px; font-weight: 700;">课堂目标</p>',
          defaultFontName: '',
          defaultColor: '#ffffff',
        },
      ],
    });
    const aiCall = vi.fn(async () => bannerSlideJson);

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    const shape = content.elements.find(
      (element) => element.type === 'shape' && 'fill' in element && element.fill === palette.title,
    ) as PPTShapeElement | undefined;
    const text = content.elements.find(
      (element) => element.type === 'text' && String(element.content).includes('课堂目标'),
    ) as PPTTextElement | undefined;

    expect(shape).toBeDefined();
    expect(text).toBeDefined();
    expect(text?.left).toBeCloseTo(
      Number(shape?.left) + (Number(shape?.width) - Number(text?.width)) / 2,
      0,
    );
    expect(text?.top).toBeCloseTo(
      Number(shape?.top) + (Number(shape?.height) - Number(text?.height)) / 2,
      0,
    );
    expect(text?.content).toContain('text-align: center');
  });

  it('centers short card labels both horizontally and vertically inside large color blocks', async () => {
    const cardSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'shape',
          left: 60,
          top: 120,
          width: 260,
          height: 120,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#dbeafe',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 60,
          top: 120,
          width: 260,
          height: 120,
          content: '<p style="font-size: 36px; font-weight: 700;">共用顶点</p>',
          defaultFontName: '',
          defaultColor: '#2563eb',
        },
        {
          type: 'shape',
          left: 370,
          top: 120,
          width: 260,
          height: 120,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#dcfce7',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 370,
          top: 120,
          width: 260,
          height: 120,
          content: '<p style="font-size: 36px; font-weight: 700;">位置决定关系</p>',
          defaultFontName: '',
          defaultColor: '#166534',
        },
        {
          type: 'shape',
          left: 680,
          top: 120,
          width: 260,
          height: 120,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#fef3c7',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 680,
          top: 120,
          width: 260,
          height: 120,
          content: '<p style="font-size: 36px; font-weight: 700;">角度可推理</p>',
          defaultFontName: '',
          defaultColor: '#92400e',
        },
      ],
    });
    const aiCall = vi.fn(async () => cardSlideJson);

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    for (const label of ['共用顶点', '位置决定关系', '角度可推理']) {
      const text = content.elements.find(
        (element) => element.type === 'text' && String(element.content).includes(label),
      ) as PPTTextElement | undefined;
      const shape = content.elements.find(
        (element) =>
          element.type === 'shape' &&
          Math.abs(Number(element.left) - Number(text?.left)) < 1 &&
          Number(element.width) === 260 &&
          Number(element.height) === 120,
      ) as PPTShapeElement | undefined;

      expect(shape).toBeDefined();
      expect(text).toBeDefined();
      expect(text?.height).toBeLessThan(Number(shape?.height));
      expect(text?.left).toBeCloseTo(
        Number(shape?.left) + (Number(shape?.width) - Number(text?.width)) / 2,
        0,
      );
      expect(text?.top).toBeCloseTo(
        Number(shape?.top) + (Number(shape?.height) - Number(text?.height)) / 2,
        0,
      );
      expect(text?.content).toContain('text-align: center');
    }
  });

  it('preserves explicit horizontal alignment for short box text', async () => {
    const bannerSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'shape',
          left: 120,
          top: 220,
          width: 280,
          height: 56,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#111827',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 145,
          top: 226,
          width: 180,
          height: 24,
          content: '<p style="font-size: 24px; font-weight: 700; text-align: left;">课堂目标</p>',
          defaultFontName: '',
          defaultColor: '#ffffff',
        },
      ],
    });
    const aiCall = vi.fn(async () => bannerSlideJson);

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    const text = content.elements.find(
      (element) => element.type === 'text' && String(element.content).includes('课堂目标'),
    ) as PPTTextElement | undefined;

    expect(text).toBeDefined();
    expect(text?.left).toBe(145);
    expect(text?.top).toBe(226);
    expect(text?.content).toContain('text-align: left');
  });

  it('centers short standalone filled text boxes', async () => {
    const filledTextBoxSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'text',
          left: 48,
          top: 305,
          width: 295,
          height: 76,
          fill: '#dbeafe',
          content: '<p style="font-size: 16px; font-weight: 600;">篱笆竹竿</p>',
          defaultFontName: '',
          defaultColor: '#1d4ed8',
        },
      ],
    });
    const aiCall = vi.fn(async () => filledTextBoxSlideJson);

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    const text = content.elements.find(
      (element) => element.type === 'text' && String(element.content).includes('篱笆竹竿'),
    ) as PPTTextElement | undefined;

    expect(text).toBeDefined();
    expect(text?.content).toContain('text-align: center');
  });

  it('moves generated diagram fills behind intersecting geometry lines', async () => {
    const palette = getPresentationPalette();
    const blockedDiagramSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'line',
          left: 110,
          top: 280,
          width: 3,
          start: [0, 0],
          end: [610, 0],
          style: 'solid',
          color: '#111827',
          points: ['', ''],
        },
        {
          type: 'line',
          left: 200,
          top: 120,
          width: 3,
          start: [0, 0],
          end: [480, 310],
          style: 'solid',
          color: '#111827',
          points: ['', ''],
        },
        {
          type: 'shape',
          left: 250,
          top: 220,
          width: 180,
          height: 120,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#ffedd5',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 690,
          top: 210,
          width: 220,
          height: 46,
          content: '<p style="font-size: 16px;">∠1 = 65°</p>',
          defaultFontName: '',
          defaultColor: '#111827',
        },
      ],
    });
    const aiCall = vi.fn(async () => blockedDiagramSlideJson);

    const content = await generateSceneContent(outline(), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    const fillIndex = content.elements.findIndex(
      (element) =>
        element.type === 'shape' && 'fill' in element && element.fill === palette.warningSoft,
    );
    const lineIndexes = content.elements
      .map((element, index) => ({ element, index }))
      .filter(
        (entry): entry is { element: PPTLineElement; index: number } =>
          entry.element.type === 'line',
      )
      .map((entry) => entry.index);
    const labelIndex = content.elements.findIndex(
      (element) => element.type === 'text' && String(element.content).includes('65°'),
    );

    expect(fillIndex).toBeGreaterThanOrEqual(0);
    expect(lineIndexes).toHaveLength(2);
    expect(fillIndex).toBeLessThan(Math.min(...lineIndexes));
    expect(labelIndex).toBeGreaterThan(fillIndex);
  });

  it('repairs generated top-level slide overlaps before saving elements', async () => {
    const palette = getPresentationPalette();
    const overlappedSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'text',
          left: 430,
          top: 248,
          width: 300,
          height: 58,
          content: '<p style="font-size: 40px; font-weight: 700;">第一单元：杰出人物</p>',
          defaultFontName: '',
          defaultColor: '#111827',
        },
        {
          type: 'shape',
          left: 70,
          top: 160,
          width: 430,
          height: 260,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#dbeafe',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 112,
          top: 214,
          width: 320,
          height: 150,
          content: '<p style="font-size: 28px;">第一单元主题</p>',
          defaultFontName: '',
          defaultColor: '#1e3a8a',
        },
      ],
    });
    const aiCall = vi.fn(async () => overlappedSlideJson);

    const content = await generateSceneContent(outline({ title: '第一单元：杰出人物' }), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    const title = content.elements.find(
      (element) => element.type === 'text' && String(element.content).includes('杰出人物'),
    ) as PPTTextElement | undefined;
    const panel = content.elements.find(
      (element) =>
        element.type === 'shape' && 'fill' in element && element.fill === palette.primarySoft,
    ) as PPTShapeElement | undefined;
    const panelText = content.elements.find(
      (element) => element.type === 'text' && String(element.content).includes('第一单元主题'),
    ) as PPTTextElement | undefined;

    expect(title).toBeDefined();
    expect(panel).toBeDefined();
    expect(panelText).toBeDefined();
    expect(overlaps(title!, panel!)).toBe(false);
    expect(panelText?.left).not.toBe(112);
  });

  it('repairs themed dark body panels instead of keeping screenshot-like title obstruction', async () => {
    const palette = getPresentationPalette();
    const screenshotLikeSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'text',
          left: 64,
          top: 52,
          width: 380,
          height: 58,
          content: '<p style="font-size: 30px; font-weight: 700;">观察生活中的语言</p>',
          defaultFontName: '',
          defaultColor: '#111827',
          textType: 'title',
        },
        {
          type: 'shape',
          left: 140,
          top: 0,
          width: 820,
          height: 562.5,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#333333',
          fixedRatio: false,
        },
        {
          type: 'shape',
          left: 180,
          top: 190,
          width: 230,
          height: 140,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#fff7ed',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 210,
          top: 230,
          width: 170,
          height: 48,
          content: '<p style="font-size: 20px;">看见语言</p>',
          defaultFontName: '',
          defaultColor: '#333333',
        },
        {
          type: 'shape',
          left: 445,
          top: 190,
          width: 230,
          height: 140,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#eff6ff',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 475,
          top: 230,
          width: 170,
          height: 48,
          content: '<p style="font-size: 20px;">听出味道</p>',
          defaultFontName: '',
          defaultColor: '#333333',
        },
      ],
    });
    const aiCall = vi.fn(async () => screenshotLikeSlideJson);

    const content = await generateSceneContent(
      outline({
        title: '观察生活中的语言',
        description: '观察生活里的语言表达。',
        keyPoints: ['看见语言', '听出味道', '写出真情'],
      }),
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { layoutVariant: 'three-card-scan' },
    );

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    expect(content.elements.some((element) => element.id.startsWith('fallback_'))).toBe(false);

    const titleIndex = content.elements.findIndex(
      (element) => element.type === 'text' && String(element.content).includes('观察生活中的语言'),
    );
    const panelIndex = content.elements.findIndex(
      (element) =>
        element.type === 'shape' && Number(element.width) > 760 && Number(element.height) > 300,
    );
    const title = content.elements[titleIndex] as PPTTextElement | undefined;
    const panel = content.elements[panelIndex] as PPTShapeElement | undefined;

    expect(title).toBeDefined();
    expect(panel).toBeDefined();
    expect(panel?.fill).toBe(palette.surfaceAlt);
    expect(panel?.top).toBeGreaterThanOrEqual(Number(title?.top) + Number(title?.height) + 16);
    expect(panelIndex).toBeLessThan(titleIndex);
  });

  it('falls back to a safe template when repaired AI output still has critical layout issues', async () => {
    const unsafeSlideJson = JSON.stringify({
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        {
          type: 'text',
          left: 24,
          top: 24,
          width: 940,
          height: 500,
          content: '<p style="font-size: 34px;">坏布局第一层</p>',
          defaultFontName: '',
          defaultColor: '#111827',
        },
        {
          type: 'text',
          left: 36,
          top: 40,
          width: 920,
          height: 480,
          content: '<p style="font-size: 32px;">坏布局第二层</p>',
          defaultFontName: '',
          defaultColor: '#dc2626',
        },
      ],
    });
    const aiCall = vi.fn(async () => unsafeSlideJson);

    const content = await generateSceneContent(outline({ title: '安全兜底页' }), aiCall);

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    expect(content.elements.some((element) => element.id === 'fallback_title')).toBe(true);
    expect(content.elements.some((element) => String(element.id).startsWith('fallback_'))).toBe(
      true,
    );
    expect(
      content.elements.some(
        (element) => 'content' in element && String(element.content).includes('坏布局第二层'),
      ),
    ).toBe(false);
  });

  it('falls back when AI returns the legacy four-card task-grid template', async () => {
    const legacyTaskGridJson = JSON.stringify({
      background: { type: 'solid', color: '#fffaf0' },
      elements: [
        {
          type: 'text',
          left: 78,
          top: 74,
          width: 760,
          height: 58,
          content: '<p style="font-size: 30px;">进入新课：细节写作与整本书笔记</p>',
          defaultFontName: '',
          defaultColor: '#2f2a24',
        },
        {
          type: 'line',
          left: 64,
          top: 130,
          width: 4,
          start: [0, 0],
          end: [872, 0],
          style: 'solid',
          color: '#c7773d',
          points: ['', ''],
        },
        {
          type: 'shape',
          left: 104,
          top: 160,
          width: 170,
          height: 34,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#dce8c9',
          fixedRatio: false,
        },
        {
          type: 'text',
          left: 118,
          top: 166,
          width: 140,
          height: 24,
          content: '<p style="font-size: 18px;">本课学习任务</p>',
          defaultFontName: '',
          defaultColor: '#4f7d53',
        },
        ...[
          [80, 226, '#c7773d'],
          [500, 226, '#4f7d53'],
          [80, 348, '#5b7f95'],
          [500, 348, '#c88b2f'],
        ].map(([left, top, fill], index) => ({
          type: 'shape',
          left,
          top,
          width: 14,
          height: 14,
          path: 'M 1 0.5 A 0.5 0.5 0 1 1 0 0.5 A 0.5 0.5 0 1 1 1 0.5 Z',
          viewBox: [1, 1],
          fill,
          fixedRatio: true,
          id: `dot_${index + 1}`,
        })),
        ...[
          [104, 196, '#f3ead8', '核心任务', '人物写具体 | 阅读记清楚'],
          [524, 196, '#dce8c9', '细节写作', '看见人物 | 听见声音'],
          [104, 326, '#d9e7ec', '整本书笔记', '追踪人物变化 | 主题线索'],
          [524, 326, '#f3dfab', '阅读重点', '命运 | 社会环境 | 语言风格'],
        ].flatMap(([left, top, fill, heading, detail], index) => [
          {
            type: 'shape',
            left,
            top,
            width: 390,
            height: 116,
            path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
            viewBox: [1, 1],
            fill,
            fixedRatio: false,
            id: `legacy_card_${index + 1}`,
          },
          {
            type: 'text',
            left: Number(left) + 64,
            top: Number(top) + 28,
            width: 262,
            height: 64,
            content: `<p style="font-size: 19px; text-align: center;">${heading}</p><p style="font-size: 17px; text-align: center;">${detail}</p>`,
            defaultFontName: '',
            defaultColor: '#3f372c',
            id: `legacy_card_text_${index + 1}`,
          },
        ]),
        {
          type: 'shape',
          left: 64,
          top: 470,
          width: 872,
          height: 46,
          path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
          viewBox: [1, 1],
          fill: '#efe4c8',
          fixedRatio: false,
          id: 'footer-strip',
        },
        {
          type: 'text',
          left: 312,
          top: 482,
          width: 380,
          height: 24,
          content: '<p style="font-size: 16px;">课堂互动：从祥子的一个动作，猜一猜人物状态</p>',
          defaultFontName: '',
          defaultColor: '#746854',
          id: 'footer-text',
        },
      ],
    });
    const aiCall = vi.fn(async () => legacyTaskGridJson);

    const content = await generateSceneContent(
      outline({
        title: '进入新课：细节写作与整本书笔记',
        description: '围绕人物细节和整本书笔记进入新课。',
        keyPoints: ['细节写作', '整本书笔记', '阅读重点'],
        order: 9,
      }),
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { layoutVariant: 'three-card-scan' },
    );

    expect(content && 'elements' in content).toBe(true);
    if (!content || !('elements' in content)) return;

    const visibleText = JSON.stringify(content);
    expect(content.elements.some((element) => String(element.id).startsWith('fallback_'))).toBe(
      true,
    );
    expect(visibleText).toContain('细节写作');
    expect(visibleText).toContain('整本书笔记');
    expect(visibleText).not.toContain('本课学习任务');
    expect(visibleText).not.toContain('课堂互动：从祥子的一个动作');
    expect(content.elements.some((element) => element.id === 'footer-strip')).toBe(false);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { POST } from '@/app/api/generate/scene-content/route';
import { generateSceneContent } from '@/lib/generation/generation-pipeline';
import type { SceneOutline } from '@/lib/types/generation';

vi.mock('@/lib/ai/llm', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromHeaders: vi.fn(() => ({
    model: undefined,
    modelInfo: undefined,
    modelString: 'test:model',
  })),
}));

vi.mock('@/lib/server/chinese-xinhua', () => ({
  buildChineseXinhuaPromptContext: vi.fn(async () => ''),
}));

vi.mock('@/lib/generation/generation-pipeline', () => ({
  applyOutlineFallbacks: vi.fn((outline: SceneOutline) => outline),
  buildFallbackInteractiveContent: vi.fn((outline: SceneOutline) => ({
    html: `<!DOCTYPE html><html><body><button data-ok="true">${outline.title}</button></body></html>`,
  })),
  buildFallbackQuizContent: vi.fn((outline: SceneOutline) => ({
    questions: [
      {
        id: 'q_fallback',
        type: 'single',
        question: `关于“${outline.title}”，下面哪一项更合适？`,
        options: [{ label: '正确做法', value: 'A' }],
        answer: ['A'],
        points: 10,
      },
    ],
  })),
  buildVisionUserContent: vi.fn(),
  generateSceneContent: vi.fn(),
}));

function request(body: Record<string, unknown>): Parameters<typeof POST>[0] {
  return new Request('http://localhost/api/generate/scene-content', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

function baseBody(outline: SceneOutline): Record<string, unknown> {
  return {
    outline,
    allOutlines: [outline],
    stageId: 'stage_1',
    stageInfo: {
      name: '课堂',
      language: 'zh-CN',
    },
  };
}

describe('scene content route fallback', () => {
  beforeEach(() => {
    vi.mocked(generateSceneContent).mockReset();
  });

  it('returns fallback slide content when AI slide JSON is unusable', async () => {
    const outline: SceneOutline = {
      id: 'scene_1',
      type: 'slide',
      title: '我是小学生啦',
      description: '面向小学生的课堂导入。',
      keyPoints: ['认识自己的学习身份', '说出一个学习目标'],
      order: 1,
      language: 'zh-CN',
    };
    vi.mocked(generateSceneContent).mockResolvedValue(null);

    const response = await POST(request(baseBody(outline)));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.warning).toBe('SLIDE_CONTENT_FALLBACK');
    expect(data.content.elements.length).toBeGreaterThan(0);
    expect(JSON.stringify(data.content.elements)).toContain('我是小学生啦');
  });

  it('keeps classroom constraints out of visible outline fields', async () => {
    const outline: SceneOutline = {
      id: 'scene_policy',
      type: 'slide',
      title: '阅读方法梳理',
      description:
        '通览全文，明确学习路径。\n\n课堂模式：这个 scene 必须生成普通 Bingo 课堂页面，不是文档、讲义、练习册、教案页、长文总结或段落文章。',
      keyPoints: [
        '通览全文',
        '[课堂模式] 使用视觉课堂页面版式，不要文档版式。',
        '抓关键词句',
        '「流程图」通览全文 -> 抓关键词句 -> 品味细节',
        '长篇解释应放到老师讲解动作里，不要塞进幻灯片正文。',
        'This scene must become a normal Bingo classroom scene, not a document page.',
        'scene 必须生成普通 Bingo 普通课堂，不要文档版式。',
        '品味细节',
      ],
      order: 1,
      language: 'zh-CN',
    };
    vi.mocked(generateSceneContent).mockResolvedValue({
      elements: [],
      background: { type: 'solid', color: '#ffffff' },
      remark: '通览全文，明确学习路径。',
    });

    const response = await POST(request({ ...baseBody(outline), forceClassroomScenes: true }));
    const data = await response.json();
    const generateCall = vi.mocked(generateSceneContent).mock.calls[0];
    const passedOutline = generateCall[0] as SceneOutline;
    const options = generateCall[7] as
      | { generationConstraints?: string[]; visualTheme?: string }
      | undefined;
    const visibleOutlineText = JSON.stringify(data.effectiveOutline);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(options?.generationConstraints?.join('\n')).toContain('普通互动课堂页面');
    expect(options?.generationConstraints?.join('\n')).not.toContain('Bingo');
    expect(options?.visualTheme).toBe('warm-storybook');
    expect(passedOutline.keyPoints).toEqual([
      '通览全文',
      '抓关键词句',
      '通览全文 -> 抓关键词句 -> 品味细节',
      '品味细节',
    ]);
    expect(passedOutline.description).toContain('通览全文');
    expect(JSON.stringify(passedOutline)).not.toContain('课堂模式');
    expect(JSON.stringify(passedOutline)).not.toContain('文档版式');
    expect(JSON.stringify(passedOutline)).not.toContain('流程图');
    expect(visibleOutlineText).not.toContain('课堂模式');
    expect(visibleOutlineText).not.toContain('流程图');
    expect(visibleOutlineText).not.toContain('scene 必须生成');
    expect(visibleOutlineText).not.toContain('Bingo 普通课堂');
    expect(visibleOutlineText).not.toContain('老师讲解动作');
    expect(visibleOutlineText).not.toContain('normal Bingo classroom scene');
    expect(data.effectiveOutline.keyPoints).toEqual([
      '通览全文',
      '抓关键词句',
      '通览全文 -> 抓关键词句 -> 品味细节',
      '品味细节',
    ]);
  });

  it('passes visual theme from request body into scene content generation', async () => {
    const outline: SceneOutline = {
      id: 'scene_theme',
      type: 'slide',
      title: '主题配色',
      description: '用指定配色生成课堂页。',
      keyPoints: ['配色统一'],
      order: 1,
      language: 'zh-CN',
    };
    vi.mocked(generateSceneContent).mockResolvedValue({
      elements: [],
      background: { type: 'solid', color: '#ffffff' },
      remark: '用指定配色生成课堂页。',
    });

    const response = await POST(request({ ...baseBody(outline), visualTheme: 'nature-reader' }));
    const data = await response.json();
    const generateCall = vi.mocked(generateSceneContent).mock.calls[0];
    const options = generateCall[7] as { visualTheme?: string } | undefined;

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(options?.visualTheme).toBe('nature-reader');
  });

  it('passes the layout review setting into scene content generation', async () => {
    const outline: SceneOutline = {
      id: 'scene_layout_review',
      type: 'slide',
      title: '布局审核',
      description: '验证前端审核设置透传。',
      keyPoints: ['审核开关'],
      order: 1,
      language: 'zh-CN',
    };
    vi.mocked(generateSceneContent).mockResolvedValue({
      elements: [],
      background: { type: 'solid', color: '#ffffff' },
      remark: '验证前端审核设置透传。',
    });

    const response = await POST(request({ ...baseBody(outline), slideLayoutReviewEnabled: true }));
    const generateCall = vi.mocked(generateSceneContent).mock.calls[0];
    const options = generateCall[7] as { slideLayoutReviewEnabled?: boolean } | undefined;

    expect(response.status).toBe(200);
    expect(options?.slideLayoutReviewEnabled).toBe(true);
  });

  it('returns fallback quiz content when AI quiz content is unusable', async () => {
    const outline: SceneOutline = {
      id: 'scene_2',
      type: 'quiz',
      title: '课堂小测',
      description: '检查学生是否理解主题。',
      keyPoints: ['完成选择题'],
      order: 2,
      language: 'zh-CN',
      quizConfig: {
        questionCount: 1,
        difficulty: 'easy',
        questionTypes: ['single'],
      },
    };
    vi.mocked(generateSceneContent).mockResolvedValue(null);

    const response = await POST(request(baseBody(outline)));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.warning).toBe('QUIZ_CONTENT_FALLBACK');
    expect(data.content.questions.length).toBeGreaterThan(0);
  });

  it('returns fallback interactive content when AI interactive content throws', async () => {
    const outline: SceneOutline = {
      id: 'scene_3',
      type: 'interactive',
      title: '升旗礼仪小判断',
      description: '判断升旗时哪些做法是正确的。',
      keyPoints: ['升旗时立正站好'],
      order: 3,
      language: 'zh-CN',
      interactiveConfig: {
        conceptName: '升旗礼仪小判断',
        conceptOverview: '判断升旗时哪些做法是正确的。',
        designIdea: '点击正确或错误做法并获得反馈。',
        subject: '德育',
      },
    };
    vi.mocked(generateSceneContent).mockRejectedValue(new Error('Invalid JSON response'));

    const response = await POST(request(baseBody(outline)));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.warning).toBe('INTERACTIVE_CONTENT_FALLBACK');
    expect(data.content.html).toContain('升旗礼仪小判断');
  });
});

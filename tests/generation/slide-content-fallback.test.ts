import { describe, expect, it } from 'vitest';

import { buildFallbackSlideContent } from '@/lib/generation/slide-content-fallback';
import { getPresentationPalette } from '@/lib/theme/color-themes';
import type { SceneOutline } from '@/lib/types/generation';
import type { PPTLineElement, PPTShapeElement } from '@/lib/types/slides';

function rect(element: { left: number; top: number; width: number; height: number }) {
  return {
    left: element.left,
    top: element.top,
    right: element.left + element.width,
    bottom: element.top + element.height,
  };
}

function absoluteLineEndpoints(element: PPTLineElement) {
  return {
    start: {
      x: element.left + element.start[0],
      y: element.top + element.start[1],
    },
    end: {
      x: element.left + element.end[0],
      y: element.top + element.end[1],
    },
  };
}

describe('slide content fallback', () => {
  it('filters internal classroom policy text from visible fallback content', () => {
    const outline: SceneOutline = {
      id: 'scene_1',
      type: 'slide',
      title: '阅读方法梳理',
      description:
        '通览全文，明确学习路径。\n\n课堂模式：这个 scene 必须生成普通 Bingo 课堂页面，不是文档、讲义、练习册、教案页、长文总结或段落文章。',
      keyPoints: [
        '通览全文',
        '[课堂模式] 使用视觉课堂页面版式，不要文档版式。',
        '抓关键词句',
        '「流程图」通览全文 -> 抓关键词句 -> 品味细节',
        '[金字塔图] 行动层、品质层、精神层',
        '长篇解释应放到老师讲解动作里，不要塞进幻灯片正文。',
        'This scene must become a normal Bingo classroom scene, not a document page.',
        'scene 必须生成普通 Bingo 普通课堂，不要文档版式。',
        '品味细节',
      ],
      order: 1,
      language: 'zh-CN',
    };

    const content = buildFallbackSlideContent(outline);
    const visibleText = JSON.stringify(content);

    expect(visibleText).toContain('通览全文');
    expect(visibleText).toContain('抓关键词句');
    expect(visibleText).toContain('品味细节');
    expect(visibleText).toContain('通览全文 -&gt; 抓关键词句 -&gt; 品味细节');
    expect(visibleText).toContain('行动层、品质层、精神层');
    expect(visibleText).not.toContain('课堂模式');
    expect(visibleText).not.toContain('Classroom mode');
    expect(visibleText).not.toContain('流程图');
    expect(visibleText).not.toContain('金字塔图');
    expect(visibleText).not.toContain('scene 必须生成');
    expect(visibleText).not.toContain('Bingo 普通课堂');
    expect(visibleText).not.toContain('普通 Bingo');
    expect(visibleText).not.toContain('文档版式');
    expect(visibleText).not.toContain('老师讲解动作');
    expect(visibleText).not.toContain('normal Bingo classroom scene');
    expect(content.remark).not.toContain('课堂模式');
  });

  it('uses the selected presentation palette in fallback slides', () => {
    const outline: SceneOutline = {
      id: 'scene_theme',
      type: 'slide',
      title: '阅读方法梳理',
      description: '通览全文，明确学习路径。',
      keyPoints: ['通览全文', '抓关键词句', '品味细节'],
      order: 1,
      language: 'zh-CN',
    };
    const palette = getPresentationPalette('night-lecture');

    const content = buildFallbackSlideContent(outline, undefined, undefined, 'night-lecture');

    expect(content.background).toEqual({ type: 'solid', color: palette.background });
    expect(JSON.stringify(content.elements)).toContain(palette.primary);
    expect(JSON.stringify(content.elements)).toContain(palette.text);
  });

  it('rotates fallback page layouts by stable scene order', () => {
    const baseOutline: SceneOutline = {
      id: 'scene_layout',
      type: 'slide',
      title: '阅读方法梳理',
      description: '通览全文，明确学习路径。',
      keyPoints: ['通览全文', '抓关键词句', '品味细节'],
      order: 1,
      language: 'zh-CN',
    };

    const first = buildFallbackSlideContent(baseOutline);
    const second = buildFallbackSlideContent({ ...baseOutline, id: 'scene_layout_2', order: 2 });
    const firstIds = first.elements.map((element) => element.id);
    const secondIds = second.elements.map((element) => element.id);

    expect(firstIds).toContain('fallback_panel_classic');
    expect(secondIds).toContain('fallback_three_card_1');
    expect(secondIds).not.toContain('fallback_panel_classic');
  });

  it('uses stable centered geometry for fallback three-card pages', () => {
    const outline: SceneOutline = {
      id: 'scene_three',
      type: 'slide',
      title: '阅读方法梳理',
      description: '通览全文，明确学习路径。',
      keyPoints: ['通览全文', '抓关键词句', '品味细节'],
      order: 2,
      language: 'zh-CN',
    };

    const content = buildFallbackSlideContent(
      outline,
      undefined,
      undefined,
      undefined,
      'three-card-scan',
    );
    const cards = [1, 2, 3].map((index) => {
      const card = content.elements.find(
        (element): element is PPTShapeElement => element.id === `fallback_three_card_${index}`,
      );
      expect(card).toBeDefined();
      return card!;
    });

    const firstGap = cards[1].left - rect(cards[0]).right;
    const secondGap = cards[2].left - rect(cards[1]).right;
    expect(cards[0].left).toBeGreaterThanOrEqual(64);
    expect(rect(cards[2]).right).toBeLessThanOrEqual(936);
    expect(cards.map((card) => card.width)).toEqual([244, 244, 244]);
    expect(firstGap).toBeGreaterThanOrEqual(64);
    expect(secondGap).toBeCloseTo(firstGap, 1);
  });

  it('centers short labels in fallback three-card pages', () => {
    const outline: SceneOutline = {
      id: 'scene_three_labels',
      type: 'slide',
      title: '细节描写',
      description: '从细节观察人物。',
      keyPoints: ['动作', '神态', '环境'],
      order: 2,
      language: 'zh-CN',
    };

    const content = buildFallbackSlideContent(
      outline,
      undefined,
      undefined,
      undefined,
      'three-card-scan',
    );

    for (let index = 1; index <= 3; index += 1) {
      const card = content.elements.find(
        (element): element is PPTShapeElement => element.id === `fallback_three_card_${index}`,
      );
      const label = content.elements.find(
        (element) => element.id === `fallback_three_card_title_${index}`,
      ) as { left: number; top: number; width: number; height: number; content: string } | undefined;

      expect(card).toBeDefined();
      expect(label).toBeDefined();
      expect(label!.left + label!.width / 2).toBeCloseTo(card!.left + card!.width / 2, 1);
      expect(label!.top + label!.height / 2).toBeCloseTo(card!.top + card!.height / 2, 1);
      expect(label!.content).toContain('text-align: center');
    }

    expect(content.elements.some((element) => element.id === 'fallback_three_card_detail_1')).toBe(
      false,
    );
  });

  it('uses the review recall card flow for review fallback pages', () => {
    const outline: SceneOutline = {
      id: 'scene_review',
      type: 'slide',
      title: '复习导入',
      description: '旧知唤醒：旧知扫描、课文支点、先补问题。',
      keyPoints: ['旧知扫描：通览全文', '课文支点：抓关键词句', '先补问题：品味细节'],
      order: 1,
      language: 'zh-CN',
      learningContext: {
        section: 'review',
        knowledgePointIds: ['kp_1'],
      },
    };

    const content = buildFallbackSlideContent(
      outline,
      undefined,
      undefined,
      undefined,
      'review-recall-flow',
    );
    const ids = content.elements.map((element) => element.id);
    const arrows = content.elements.filter(
      (element): element is PPTLineElement =>
        element.type === 'line' && element.id.startsWith('template_review_recall_step_arrow_'),
    );

    expect(ids).toContain('template_review_recall_card_recall');
    expect(ids).toContain('template_review_recall_card_anchor');
    expect(ids).toContain('template_review_recall_card_gap');
    expect(ids).not.toContain('fallback_timeline_axis');
    expect(arrows).toHaveLength(2);
    arrows.forEach((arrow) => {
      const endpoints = absoluteLineEndpoints(arrow);
      expect(endpoints.end.x - endpoints.start.x).toBeGreaterThanOrEqual(44);
      expect(arrow.points).toEqual(['', 'arrow']);
    });
  });

  it('keeps fallback timeline cards centered on their nodes and axis', () => {
    const outline: SceneOutline = {
      id: 'scene_timeline',
      type: 'slide',
      title: '学习流程',
      description: '按照流程梳理阅读方法。',
      keyPoints: ['通览全文', '抓关键词句', '品味细节', '说明理由'],
      order: 3,
      language: 'zh-CN',
    };

    const content = buildFallbackSlideContent(
      outline,
      undefined,
      undefined,
      undefined,
      'timeline-flow',
    );
    const axis = content.elements.find(
      (element): element is PPTLineElement => element.id === 'fallback_timeline_axis',
    );
    const cards = [1, 2, 3, 4].map((index) => {
      const card = content.elements.find(
        (element): element is PPTShapeElement => element.id === `fallback_timeline_card_${index}`,
      );
      expect(card).toBeDefined();
      return card!;
    });
    const nodes = [1, 2, 3, 4].map((index) => {
      const node = content.elements.find(
        (element): element is PPTShapeElement => element.id === `fallback_timeline_node_${index}`,
      );
      expect(node).toBeDefined();
      return node!;
    });

    expect(axis).toBeDefined();
    const axisEndpoints = absoluteLineEndpoints(axis!);
    expect(axisEndpoints.end.x - axisEndpoints.start.x).toBeGreaterThanOrEqual(44);
    cards.forEach((card, index) => {
      const cardCenter = card.left + card.width / 2;
      const nodeCenter = nodes[index].left + nodes[index].width / 2;
      expect(card.left).toBeGreaterThanOrEqual(64);
      expect(rect(card).right).toBeLessThanOrEqual(936);
      expect(cardCenter).toBeCloseTo(nodeCenter, 1);
    });
    expect(axisEndpoints.start.x).toBeCloseTo(nodes[0].left + nodes[0].width / 2, 1);
    expect(axisEndpoints.end.x).toBeCloseTo(nodes[3].left + nodes[3].width / 2, 1);
  });

  it('builds compare fallback pages without leaking internal strategy text', () => {
    const outline: SceneOutline = {
      id: 'scene_compare',
      type: 'slide',
      title: '阅读方法对比',
      description:
        '比较通览全文和精读细节的不同作用。课堂模式：这个 scene 必须生成普通 Bingo 课堂页面，不是文档版式。',
      keyPoints: [
        '通览全文：先把握主要内容',
        '精读细节：抓关键词句',
        '[课堂模式] 使用视觉课堂页面版式，不要文档版式。',
        '对比表达：说明两种方法的异同',
      ],
      order: 4,
      language: 'zh-CN',
    };

    const content = buildFallbackSlideContent(
      outline,
      undefined,
      undefined,
      undefined,
      'compare-columns',
    );
    const ids = content.elements.map((element) => element.id);
    const visibleText = JSON.stringify(content);

    expect(ids).toContain('fallback_compare_left_panel');
    expect(ids).toContain('fallback_compare_right_panel');
    expect(visibleText).toContain('通览全文');
    expect(visibleText).toContain('精读细节');
    expect(visibleText).not.toContain('课堂模式');
    expect(visibleText).not.toContain('普通 Bingo');
    expect(visibleText).not.toContain('文档版式');
  });

  it('uses assigned images in image-feature fallback pages', () => {
    const outline: SceneOutline = {
      id: 'scene_image',
      type: 'slide',
      title: '观察课文插图',
      description: '结合图片说出你看到的关键信息。',
      keyPoints: ['观察人物', '说明环境', '联系课文'],
      order: 1,
      language: 'zh-CN',
    };

    const content = buildFallbackSlideContent(
      outline,
      [{ id: 'img_1', src: '', pageNumber: 1 }],
      { img_1: 'data:image/png;base64,abc' },
      undefined,
      'image-feature',
    );

    expect(content.elements.some((element) => element.id === 'fallback_image')).toBe(true);
    expect(JSON.stringify(content.elements)).toContain('data:image/png;base64,abc');
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildSlideLayoutVariantPrompt,
  selectSlideLayoutVariant,
} from '@/lib/generation/slide-layout-variants';
import type { PdfImage, SceneOutline } from '@/lib/types/generation';

function outline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: 'scene_layout',
    type: 'slide',
    title: '阅读方法梳理',
    description: '通览全文，抓关键词句，品味细节。',
    keyPoints: ['通览全文', '抓关键词句', '品味细节'],
    order: 1,
    language: 'zh-CN',
    ...overrides,
  };
}

describe('slide layout variants', () => {
  it('uses an image-focused variant when a usable assigned image exists', () => {
    const images: PdfImage[] = [{ id: 'img_1', src: '', pageNumber: 1 }];

    expect(
      selectSlideLayoutVariant(outline({ order: 1 }), images, {
        img_1: 'data:image/png;base64,abc',
      }),
    ).toBe('image-feature');
    expect(
      selectSlideLayoutVariant(outline({ order: 2 }), images, {
        img_1: 'data:image/png;base64,abc',
      }),
    ).toBe('split-visual-notes');
  });

  it('routes flow and comparison content to matching variants', () => {
    expect(
      selectSlideLayoutVariant(
        outline({
          description: '按照流程梳理：通览全文 -> 抓关键词句 -> 品味细节。',
        }),
      ),
    ).toBe('timeline-flow');

    expect(
      selectSlideLayoutVariant(
        outline({
          description: '比较两种阅读方法的异同。',
          keyPoints: ['通读', '精读', '对比表达'],
        }),
      ),
    ).toBe('compare-columns');
  });

  it('uses review cards for review sections and rotates generic pages by order', () => {
    expect(
      selectSlideLayoutVariant(
        outline({
          learningContext: {
            section: 'review',
            knowledgePointIds: ['kp_1'],
          },
        }),
      ),
    ).toBe('review-recall-flow');

    expect(selectSlideLayoutVariant(outline({ order: 1, description: '认识课文主题。' }))).toBe(
      'classic-title-points',
    );
    expect(selectSlideLayoutVariant(outline({ order: 2, description: '认识课文主题。' }))).toBe(
      'three-card-scan',
    );
    expect(selectSlideLayoutVariant(outline({ order: 3, description: '认识课文主题。' }))).toBe(
      'split-visual-notes',
    );
  });

  it('formats layout guidance as prompt-only instructions', () => {
    const prompt = buildSlideLayoutVariantPrompt('three-card-scan', 'zh-CN');

    expect(prompt).toContain('版式：three-card-scan');
    expect(prompt).toContain('不要把版式名称');
    expect(prompt).toContain('三卡扫描页');
    expect(prompt).toContain('不要生成主体大暗底');
    expect(prompt).toContain('标题必须独立完整可读');
  });

  it('routes review recall signals to the fixed review flow variant', () => {
    expect(
      selectSlideLayoutVariant(
        outline({
          title: '复习导入',
          description: '旧知唤醒：旧知扫描、课文支点、先补问题。',
          keyPoints: [
            '旧知扫描：精读方法、杰出人物',
            '课文支点：《邓稼先》品质',
            '先补问题：品质关键词',
          ],
          order: 1,
        }),
      ),
    ).toBe('review-recall-flow');

    const prompt = buildSlideLayoutVariantPrompt('review-recall-flow', 'zh-CN');
    expect(prompt).toContain('复习唤醒流程页');
    expect(prompt).toContain('不要巨大空白卡片');
  });
});

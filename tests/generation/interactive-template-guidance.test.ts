import { describe, expect, it } from 'vitest';
import { getInteractiveTemplateGuidance } from '@/lib/generation/interactive-template-guidance';

describe('interactive template guidance', () => {
  it('selects the angle relationship template for intersecting-line concepts', () => {
    const guidance = getInteractiveTemplateGuidance({
      subject: '数学',
      conceptName: '相交线中的邻补角与对顶角',
      conceptOverview: '通过旋转一条直线观察四个角的变化关系',
      designIdea: '拖动直线并高亮对顶角和邻补角',
      keyPoints: ['对顶角相等', '邻补角和为180度'],
    });

    expect(guidance).toContain('Template: intersecting lines / angle relationships.');
    expect(guidance).toContain('Do not add a known-angle calculator');
  });

  it('selects the function graph template for graphing concepts', () => {
    const guidance = getInteractiveTemplateGuidance({
      subject: 'Mathematics',
      conceptName: 'Quadratic function graph',
      conceptOverview: 'Explore how coefficients change the parabola',
      designIdea: 'Use sliders for a, b, c and update the graph instantly',
      keyPoints: ['vertex', 'opening direction'],
    });

    expect(guidance).toContain('Template: function graph exploration.');
    expect(guidance).toContain('use 1-3 sliders');
  });

  it('falls back to the generic simplicity guidance for unmatched topics', () => {
    const guidance = getInteractiveTemplateGuidance({
      subject: 'Biology',
      conceptName: 'Cell membrane transport',
      conceptOverview: 'Show diffusion across a membrane',
      designIdea: 'Simple animation of particles moving across the membrane',
      keyPoints: ['concentration gradient'],
    });

    expect(guidance).toContain('Default template policy: keep the page simple and highly reliable.');
    expect(guidance).not.toContain('Template: intersecting lines / angle relationships.');
  });
});

import { describe, expect, it } from 'vitest';
import { renderInteractiveTemplate } from '@/lib/generation/interactive-template-renderer';

describe('interactive template renderer', () => {
  it('renders a deterministic angle-relations page for intersecting-line concepts', () => {
    const html = renderInteractiveTemplate({
      language: 'zh-CN',
      subject: '\u6570\u5b66',
      conceptName: '\u76f8\u4ea4\u7ebf\u4e2d\u7684\u90bb\u8865\u89d2\u4e0e\u5bf9\u9876\u89d2',
      conceptOverview: '\u89c2\u5bdf\u56db\u4e2a\u89d2\u7684\u5173\u7cfb',
      designIdea: '\u62d6\u52a8\u4e00\u6761\u76f4\u7ebf',
      keyPoints: ['\u5bf9\u9876\u89d2\u76f8\u7b49', '\u90bb\u8865\u89d2\u548c\u4e3a180\u00b0'],
    });

    expect(html).toBeTruthy();
    expect(html).toContain('data-template="angle-relations"');
    expect(html).toContain('id="diagram"');
    expect(html).toContain("mode = 'opposite'");
    expect(html).toContain("svg.addEventListener('pointermove'");
    expect(html).not.toMatch(/<aside\b/i);
    expect(html).not.toContain('known-angle');
  });

  it('escapes concept titles before embedding them into HTML', () => {
    const html = renderInteractiveTemplate({
      language: 'en-US',
      subject: 'Math',
      conceptName: '<Angles & Lines>',
      conceptOverview: 'Vertical angles',
      designIdea: 'Drag a line',
      keyPoints: ['vertical angles'],
    });

    expect(html).toContain('&lt;Angles &amp; Lines&gt;');
    expect(html).not.toContain('<Angles & Lines>');
  });

  it('returns null when no deterministic template is safe to apply', () => {
    const html = renderInteractiveTemplate({
      language: 'en-US',
      subject: 'Biology',
      conceptName: 'Cell membrane transport',
      conceptOverview: 'Show diffusion across a membrane',
      designIdea: 'Move particles across the membrane',
      keyPoints: ['concentration gradient'],
    });

    expect(html).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeSlideContent } from '@/lib/utils/slide-content-normalization';

describe('normalizeSlideContent', () => {
  it('wraps generated slide content in the canvas shape expected by the classroom', () => {
    const element = {
      id: 'title',
      type: 'text',
      left: 10,
      top: 10,
      width: 100,
      height: 40,
      rotate: 0,
      content: 'Title',
      defaultFontName: 'Arial',
      defaultColor: '#000000',
    };

    const result = normalizeSlideContent({ elements: [element] });

    expect(result.changed).toBe(true);
    expect(result.content.type).toBe('slide');
    expect(result.content.canvas.elements).toEqual([element]);
    expect(result.content.canvas.viewportSize).toBe(1000);
    expect(result.content.canvas.viewportRatio).toBe(0.5625);
  });

  it('preserves already valid slide content', () => {
    const content = normalizeSlideContent({ elements: [] }).content;

    expect(normalizeSlideContent(content)).toEqual({ content, changed: false });
  });
});

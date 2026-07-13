import { describe, expect, it } from 'vitest';

import { getIntersectingLinesGeometry } from '@/lib/quiz/intersecting-lines-geometry';

describe('quiz diagram geometry', () => {
  it('keeps the center label offset from the intersection point', () => {
    const geometry = getIntersectingLinesGeometry();

    expect(geometry.center).toEqual({ x: 210, y: 110 });
    expect(geometry.board.center).toEqual({ x: 0, y: 0 });
    expect(geometry.centerLabel.text).toBe('O');
    expect(geometry.centerLabel.x).toBeGreaterThan(geometry.center.x + 12);
    expect(geometry.centerLabel.y).toBeLessThan(geometry.center.y);
  });

  it('uses the expected endpoint labels for intersecting lines', () => {
    const geometry = getIntersectingLinesGeometry();

    expect(geometry.labels.map((label) => label.text)).toEqual(['A', 'C', 'B', 'D']);
    expect(geometry.lines).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';

import { normalizeShapeViewBox } from '@/lib/utils/shape-view-box';

describe('normalizeShapeViewBox', () => {
  it('keeps valid tuple dimensions', () => {
    expect(normalizeShapeViewBox([100, 50], 400, 200)).toEqual([100, 50]);
  });

  it('converts persisted SVG viewBox strings', () => {
    expect(normalizeShapeViewBox('0 0 420 230', 400, 200)).toEqual([420, 230]);
  });

  it('falls back for missing or invalid dimensions', () => {
    expect(normalizeShapeViewBox(undefined, 400, 200)).toEqual([400, 200]);
    expect(normalizeShapeViewBox([0, Number.NaN], 400, 200)).toEqual([400, 200]);
  });
});

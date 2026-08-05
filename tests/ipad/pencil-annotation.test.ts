import { describe, expect, it } from 'vitest';
import { normalizePencilPoint } from '@/components/ipad/pencil-annotation-canvas';

describe('Apple Pencil point normalization', () => {
  it('normalizes coordinates and preserves pressure', () => {
    expect(
      normalizePencilPoint(
        { clientX: 60, clientY: 45, pressure: 0.8, timeStamp: 100 },
        { left: 10, top: 20, width: 100, height: 50 },
      ),
    ).toEqual({ x: 0.5, y: 0.5, pressure: 0.8, timestamp: 100 });
  });

  it('uses a stable fallback pressure for touch input', () => {
    expect(
      normalizePencilPoint(
        { clientX: -10, clientY: 200, pressure: 0, timeStamp: 1 },
        { left: 0, top: 0, width: 100, height: 100 },
      ),
    ).toEqual({ x: 0, y: 1, pressure: 0.5, timestamp: 1 });
  });
});

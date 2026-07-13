import { describe, expect, it } from 'vitest';

import type { PPTLineElement } from '@/lib/types/slides';
import {
  getLineElementLocalBounds,
  getLineElementPath,
  getLineRenderGeometry,
} from '@/lib/utils/line-geometry';

function line(overrides: Partial<PPTLineElement> = {}): PPTLineElement {
  return {
    id: 'line-1',
    type: 'line',
    left: 0,
    top: 0,
    width: 6,
    start: [0, 0],
    end: [120, 0],
    style: 'solid',
    color: '#2563eb',
    points: ['', 'arrow'],
    ...overrides,
  };
}

describe('line geometry', () => {
  it('includes negative coordinates and arrow marker padding in the render viewBox', () => {
    const geometry = getLineRenderGeometry(
      line({
        start: [-30, 40],
        end: [80, 0],
      }),
    );

    expect(geometry.left).toBeLessThan(-30);
    expect(geometry.top).toBeLessThan(0);
    expect(geometry.width).toBeGreaterThan(110);
    expect(geometry.height).toBeGreaterThan(40);
    expect(geometry.path).toContain('M');
    expect(geometry.path).toContain('L');
  });

  it('includes broken connector control points in bounds and path data', () => {
    const element = line({
      start: [20, 120],
      broken: [140, -40],
      end: [260, 120],
    });

    const bounds = getLineElementLocalBounds(element);
    const path = getLineElementPath(element);
    const geometry = getLineRenderGeometry(element);

    expect(bounds.minY).toBe(-40);
    expect(path).toBe('M20,120 L140,-40 L260,120');
    expect(geometry.top).toBeLessThan(-40);
  });

  it('expands broken2 connectors to concrete line segments', () => {
    const path = getLineElementPath(
      line({
        start: [0, 0],
        broken2: [80, 60],
        end: [160, 40],
      }),
    );

    expect(path).toBe('M0,0 L80,0 L80,40 L160,40');
  });
});

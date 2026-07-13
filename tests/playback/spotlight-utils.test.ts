import { describe, expect, it } from 'vitest';

import {
  buildSpotlightOverlayPath,
  DEFAULT_SPOTLIGHT_DIMNESS,
  MAX_SPOTLIGHT_CUTOUT_HEIGHT,
  MAX_SPOTLIGHT_CUTOUT_WIDTH,
  MAX_SPOTLIGHT_DIMNESS,
  MIN_SPOTLIGHT_CUTOUT_HEIGHT,
  MIN_SPOTLIGHT_CUTOUT_WIDTH,
  normalizeSpotlightDimness,
  normalizeSpotlightRect,
} from '@/lib/playback/spotlight-utils';

describe('spotlight utilities', () => {
  it('defaults and clamps dimness so the page stays readable', () => {
    expect(normalizeSpotlightDimness()).toBe(DEFAULT_SPOTLIGHT_DIMNESS);
    expect(normalizeSpotlightDimness(Number.NaN)).toBe(DEFAULT_SPOTLIGHT_DIMNESS);
    expect(normalizeSpotlightDimness('')).toBe(DEFAULT_SPOTLIGHT_DIMNESS);
    expect(normalizeSpotlightDimness('0.42')).toBe(0.42);
    expect(normalizeSpotlightDimness(-1)).toBe(0);
    expect(normalizeSpotlightDimness(1)).toBe(MAX_SPOTLIGHT_DIMNESS);
  });

  it('adds a minimum cutout for tiny targets such as lines or labels', () => {
    const rect = normalizeSpotlightRect({ x: 40, y: 50, w: 0.4, h: 0.2 });

    expect(rect).not.toBeNull();
    expect(rect!.w).toBeGreaterThanOrEqual(MIN_SPOTLIGHT_CUTOUT_WIDTH);
    expect(rect!.h).toBeGreaterThanOrEqual(MIN_SPOTLIGHT_CUTOUT_HEIGHT);
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
  });

  it('rejects invalid or fully off-canvas rectangles', () => {
    expect(normalizeSpotlightRect({ x: 10, y: 10, w: 0, h: 0 })).toBeNull();
    expect(normalizeSpotlightRect({ x: -20, y: 10, w: 5, h: 5 })).toBeNull();
    expect(normalizeSpotlightRect({ x: 10, y: 101, w: 5, h: 5 })).toBeNull();
  });

  it('rejects oversized targets that would dim the whole slide', () => {
    expect(
      normalizeSpotlightRect({ x: 15, y: 20, w: MAX_SPOTLIGHT_CUTOUT_WIDTH + 1, h: 20 }),
    ).toBeNull();
    expect(
      normalizeSpotlightRect({ x: 15, y: 20, w: 20, h: MAX_SPOTLIGHT_CUTOUT_HEIGHT + 1 }),
    ).toBeNull();
  });

  it('builds an even-odd path with a cutout inside the full page', () => {
    expect(buildSpotlightOverlayPath({ x: 10, y: 20, w: 30, h: 40 })).toBe(
      'M0 0H100V100H0Z M10 20H40V60H10Z',
    );
  });
});

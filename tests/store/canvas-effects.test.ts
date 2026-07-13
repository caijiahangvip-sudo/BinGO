import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SPOTLIGHT_DIMNESS,
  MAX_SPOTLIGHT_DIMNESS,
} from '@/lib/playback/spotlight-utils';
import { useCanvasStore } from '@/lib/store/canvas';

describe('canvas effect cleanup', () => {
  afterEach(() => {
    useCanvasStore.getState().resetCanvasState();
  });

  it('clears transient teaching effects without touching video playback state', () => {
    const store = useCanvasStore.getState();

    store.setSpotlight('spotlight-target', { dimness: 0.8 });
    store.setHighlight(['highlight-a', 'highlight-b'], { opacity: 0.4 });
    store.setLaser('laser-target', { color: '#00ff00' });
    store.setZoom('zoom-target', 1.6);
    store.playVideo('video-target');

    store.clearAllEffects();

    const next = useCanvasStore.getState();
    expect(next.spotlightElementId).toBe('');
    expect(next.spotlightOptions).toBeNull();
    expect(next.highlightedElementIds).toEqual([]);
    expect(next.highlightOptions).toBeNull();
    expect(next.laserElementId).toBe('');
    expect(next.laserOptions).toBeNull();
    expect(next.zoomTarget).toBeNull();
    expect(next.playingVideoElementId).toBe('video-target');
  });

  it('stores spotlight effects with readable default and clamped dimness', () => {
    const store = useCanvasStore.getState();

    store.setSpotlight('default-target');
    expect(useCanvasStore.getState().spotlightOptions?.dimness).toBe(DEFAULT_SPOTLIGHT_DIMNESS);

    store.setSpotlight('clamped-target', { dimness: 1 });
    expect(useCanvasStore.getState().spotlightOptions?.dimness).toBe(MAX_SPOTLIGHT_DIMNESS);
  });
});

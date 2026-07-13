import { afterEach, describe, expect, it } from 'vitest';

import { ActionEngine } from '@/lib/action/engine';
import { MAX_SPOTLIGHT_DIMNESS } from '@/lib/playback/spotlight-utils';
import { useCanvasStore } from '@/lib/store/canvas';

describe('ActionEngine spotlight', () => {
  afterEach(() => {
    useCanvasStore.getState().resetCanvasState();
  });

  it('clamps spotlight dimOpacity before writing canvas state', async () => {
    const engine = new ActionEngine({
      getState: () => ({
        stage: null,
        scenes: [],
        currentSceneId: null,
        mode: 'idle',
      }),
    } as never);

    await engine.execute({
      id: 'spotlight_1',
      type: 'spotlight',
      elementId: 'text_1',
      dimOpacity: 1,
    });
    engine.dispose();

    expect(useCanvasStore.getState().spotlightOptions?.dimness).toBe(MAX_SPOTLIGHT_DIMNESS);
  });
});

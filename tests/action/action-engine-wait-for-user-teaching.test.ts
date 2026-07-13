import { afterEach, describe, expect, it } from 'vitest';

import { ActionEngine } from '@/lib/action/engine';
import { useCanvasStore } from '@/lib/store/canvas';

describe('ActionEngine wait_for_user_teaching', () => {
  afterEach(() => {
    useCanvasStore.getState().resetCanvasState();
  });

  it('enables student whiteboard editing and waits for the registered handler', async () => {
    const storeState = {
      stage: {
        id: 'stage_1',
        name: 'Test Stage',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      scenes: [],
      currentSceneId: null,
      mode: 'playback',
    };
    const store = {
      getState: () => storeState,
      setState: (update: Partial<typeof storeState>) => {
        Object.assign(storeState, update);
      },
    };

    let releaseWait!: () => void;
    const waitPromise = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    useCanvasStore.getState().setWhiteboardOpen(true);

    const engine = new ActionEngine(store as never, undefined, {
      onWaitForUserTeaching: () => waitPromise,
    });

    const execution = engine.execute({
      id: 'wait_1',
      type: 'wait_for_user_teaching',
      prompt: 'Explain your reasoning.',
    });

    await Promise.resolve();

    expect(useCanvasStore.getState().whiteboardOpen).toBe(true);
    expect(useCanvasStore.getState().studentTeachingEnabled).toBe(true);
    expect(useCanvasStore.getState().studentTeachingPrompt).toBe('Explain your reasoning.');

    releaseWait();
    await execution;
    engine.dispose();

    expect(useCanvasStore.getState().studentTeachingEnabled).toBe(false);
    expect(useCanvasStore.getState().studentTeachingPrompt).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { PlaybackEngine } from '@/lib/playback/engine';
import type { DiscussionAction } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';

function createDiscussionScene(): Scene {
  const discussion: DiscussionAction = {
    id: 'discussion-1',
    type: 'discussion',
    topic: 'why',
    prompt: 'explain why',
  };

  return {
    id: 'scene-1',
    stageId: 'stage-1',
    type: 'slide',
    title: 'Scene 1',
    order: 0,
    content: {
      type: 'slide',
      canvas: {
        id: 'slide-1',
        type: 'slide',
        width: 1000,
        height: 562.5,
        elements: [],
        background: undefined,
      } as never,
    },
    actions: [discussion],
  };
}

describe('PlaybackEngine visual effects lifecycle', () => {
  it('clears active teaching effects when playback is paused', () => {
    const actionEngine = {
      clearEffects: vi.fn(),
      execute: vi.fn(),
    };
    const audioPlayer = {
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isPlaying: vi.fn(() => false),
      hasActiveAudio: vi.fn(() => false),
      onEnded: vi.fn(),
      play: vi.fn(),
    };

    const engine = new PlaybackEngine(
      [createDiscussionScene()],
      actionEngine as never,
      audioPlayer as never,
    );

    engine.start();
    actionEngine.clearEffects.mockClear();
    engine.pause();

    expect(actionEngine.clearEffects).toHaveBeenCalledTimes(1);
    expect(engine.getMode()).toBe('paused');
  });
});

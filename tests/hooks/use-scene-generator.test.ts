import { beforeEach, describe, expect, it } from 'vitest';

import {
  prepareSceneSpeechForTTS,
  shouldAbortSceneGeneration,
} from '@/lib/hooks/use-scene-generator';
import { useSettingsStore } from '@/lib/store/settings';
import type { Scene } from '@/lib/types/stage';

function makeScene(): Scene {
  return {
    id: 'scene-1',
    stageId: 'stage-1',
    type: 'slide',
    title: 'Intro',
    order: 1,
    content: {
      type: 'slide',
      canvas: {
        id: 'slide-1',
        viewportSize: 1280,
        viewportRatio: 9 / 16,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#6366f1'],
          fontColor: '#111827',
          fontName: 'Microsoft YaHei',
        },
        elements: [],
      },
    },
    actions: [
      {
        id: 'speech-1',
        type: 'speech',
        text: 'Hello from the generated lesson.',
      },
    ],
  } as Scene;
}

describe('prepareSceneSpeechForTTS', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      ttsEnabled: true,
      ttsProviderId: 'cosyvoice-tts',
    });
  });

  it('assigns stable audio IDs before background TTS runs', () => {
    const scene = makeScene();

    const prepared = prepareSceneSpeechForTTS(scene);

    expect(prepared.actions?.[0]).toMatchObject({
      id: 'speech-1',
      type: 'speech',
      audioId: 'tts_speech-1',
    });
    expect(scene.actions?.[0]).not.toHaveProperty('audioId');
  });

  it('leaves browser-native TTS scenes unchanged', () => {
    useSettingsStore.setState({
      ttsEnabled: true,
      ttsProviderId: 'browser-native-tts',
    });
    const scene = makeScene();

    const prepared = prepareSceneSpeechForTTS(scene);

    expect(prepared).toBe(scene);
    expect(prepared.actions?.[0]).not.toHaveProperty('audioId');
  });
});

describe('shouldAbortSceneGeneration', () => {
  it('keeps idle cleanup from bumping the generation epoch', () => {
    expect(shouldAbortSceneGeneration(false, null)).toBe(false);
  });

  it('allows cleanup to abort active generation work', () => {
    expect(shouldAbortSceneGeneration(true, null)).toBe(true);
    expect(shouldAbortSceneGeneration(false, new AbortController())).toBe(true);
  });
});

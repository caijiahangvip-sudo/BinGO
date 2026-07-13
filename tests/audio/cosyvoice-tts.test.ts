import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TTS_MODELS,
  DEFAULT_TTS_VOICES,
  TTS_PROVIDERS,
  getTTSVoices,
} from '@/lib/audio/constants';

describe('CosyVoice TTS provider', () => {
  it('includes the open-source local CosyVoice provider', () => {
    const provider = TTS_PROVIDERS['cosyvoice-tts'];

    expect(provider.name).toBe('CosyVoice');
    expect(provider.requiresApiKey).toBe(false);
    expect(provider.defaultBaseUrl).toBe('http://localhost:50000');
    expect(provider.icon).toBe('/logos/bailian.svg');
    expect(provider.models.map((model) => model.id)).toEqual(['Fun-CosyVoice3-0.5B-2512_RL']);
    expect(DEFAULT_TTS_MODELS['cosyvoice-tts']).toBe('Fun-CosyVoice3-0.5B-2512_RL');
    expect(DEFAULT_TTS_VOICES['cosyvoice-tts']).toBe('zero_shot_prompt');
    expect(
      getTTSVoices('cosyvoice-tts', 'Fun-CosyVoice3-0.5B-2512_RL').map((voice) => voice.id),
    ).toContain('zero_shot_prompt');
  });
});

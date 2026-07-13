import { describe, expect, it } from 'vitest';

import { ASR_PROVIDERS } from '@/lib/audio/constants';

describe('SenseVoice ASR provider', () => {
  it('registers the local SenseVoice provider with the public model id', () => {
    const provider = ASR_PROVIDERS['sensevoice-asr'];

    expect(provider.name).toBe('SenseVoice');
    expect(provider.requiresApiKey).toBe(false);
    expect(provider.defaultBaseUrl).toBe('http://localhost:50001');
    expect(provider.icon).toBe('/logos/bailian.svg');
    expect(provider.models.map((model) => model.id)).toEqual(['iic/SenseVoiceSmall']);
    expect(provider.defaultModelId).toBe('iic/SenseVoiceSmall');
    expect(provider.supportedLanguages).toContain('zh');
    expect(provider.supportedLanguages).toContain('en');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: {
    getState: () => ({
      providerId: 'openai',
      modelId: '',
      providersConfig: {
        openai: {
          apiKey: '',
          baseUrl: '',
          models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
          requiresApiKey: true,
          isServerConfigured: false,
        },
      },
      lightweightProviderId: 'openai',
      lightweightModelId: 'gpt-4o-mini',
      lightweightProvidersConfig: {
        openai: {
          apiKey: '',
          baseUrl: '',
          models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
          requiresApiKey: true,
          isServerConfigured: true,
        },
      },
    }),
  },
}));

import { resolveChatModelConfig } from '@/lib/utils/model-config';

describe('resolveChatModelConfig', () => {
  it('falls back to lightweight chat model when the main model is unusable', () => {
    const resolved = resolveChatModelConfig();

    expect(resolved?.profile).toBe('lightweight');
    expect(resolved?.config.modelId).toBe('gpt-4o-mini');
  });
});

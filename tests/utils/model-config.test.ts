import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockState } = vi.hoisted(() => ({
  mockState: {
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
  },
}));

vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: {
    getState: () => mockState,
  },
}));

import { resolveChatModelConfig } from '@/lib/utils/model-config';

describe('resolveChatModelConfig', () => {
  afterEach(() => {
    mockState.providerId = 'openai';
    mockState.modelId = '';
    mockState.providersConfig.openai.isServerConfigured = false;
    mockState.providersConfig.openai.serverModels = undefined;
    mockState.providersConfig.openai.models = [{ id: 'gpt-4o', name: 'GPT-4o' }];
    mockState.lightweightProviderId = 'openai';
    mockState.lightweightModelId = 'gpt-4o-mini';
    mockState.lightweightProvidersConfig.openai.isServerConfigured = true;
    mockState.lightweightProvidersConfig.openai.serverModels = undefined;
    mockState.lightweightProvidersConfig.openai.models = [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }];
  });

  it('falls back to lightweight chat model when the main model is unusable', () => {
    const resolved = resolveChatModelConfig();

    expect(resolved?.profile).toBe('lightweight');
    expect(resolved?.config.modelId).toBe('gpt-4o-mini');
  });

  it('uses main model when server is configured and modelId is set', () => {
    mockState.providersConfig.openai.isServerConfigured = true;
    mockState.modelId = 'gpt-4o';

    const resolved = resolveChatModelConfig();

    expect(resolved?.profile).toBe('main');
    expect(resolved?.config.modelId).toBe('gpt-4o');
  });

  it('uses first valid model from list when modelId is empty and server is configured', () => {
    mockState.providersConfig.openai.isServerConfigured = true;
    mockState.modelId = '';

    const resolved = resolveChatModelConfig();

    expect(resolved?.profile).toBe('main');
    expect(resolved?.config.modelId).toBe('gpt-4o');
  });

  it('returns null when neither main nor lightweight is server configured', () => {
    mockState.lightweightProvidersConfig.openai.isServerConfigured = false;

    const resolved = resolveChatModelConfig();

    expect(resolved).toBeNull();
  });

  it('does not return a server-only model id absent from the saved list', () => {
    // Server-only provider: saved list has gpt-4o, server allowlist has gpt-5.
    // The fallback must not return gpt-5 (no saved model info available).
    mockState.providersConfig.openai.isServerConfigured = true;
    mockState.providersConfig.openai.serverModels = ['gpt-5'];
    mockState.providersConfig.openai.models = [{ id: 'gpt-4o', name: 'GPT-4o' }];
    mockState.modelId = '';
    // Lightweight is unusable so resolveChatModelConfig can't fall through.
    mockState.lightweightProvidersConfig.openai.isServerConfigured = false;

    const resolved = resolveChatModelConfig();

    expect(resolved).toBeNull();
  });

  it('prefers the first server-allowed saved model for a server-only provider', () => {
    mockState.providersConfig.openai.isServerConfigured = true;
    mockState.providersConfig.openai.serverModels = ['gpt-4o', 'gpt-4o-mini'];
    mockState.providersConfig.openai.models = [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'user-only', name: 'User Only' },
    ];
    mockState.modelId = '';
    mockState.lightweightProvidersConfig.openai.isServerConfigured = false;

    const resolved = resolveChatModelConfig();

    expect(resolved?.profile).toBe('main');
    expect(resolved?.config.modelId).toBe('gpt-4o');
  });
});

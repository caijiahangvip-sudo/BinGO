/**
 * Tests for fetchServerProviders() — verifying that the settings store
 * correctly reflects server-side provider availability changes.
 *
 * Core invariant: after server sync, the set of models/providers a user
 * can select in the UI must match what the server currently supports.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ProvidersConfig } from '@/lib/types/settings';

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the store
// ---------------------------------------------------------------------------

// Minimal built-in provider registry used by the store
vi.mock('@/lib/ai/providers', () => ({
  PROVIDERS: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      requiresApiKey: true,
      icon: '/logos/openai.svg',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      ],
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      defaultBaseUrl: 'https://api.anthropic.com',
      requiresApiKey: true,
      icon: '/logos/anthropic.svg',
      models: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      ],
    },
  },
}));

vi.mock('@/lib/audio/constants', () => ({
  TTS_PROVIDERS: {
    'openai-tts': {
      id: 'openai-tts',
      name: 'OpenAI TTS',
      requiresApiKey: true,
      defaultModelId: 'gpt-4o-mini-tts',
      models: [{ id: 'gpt-4o-mini-tts', name: 'GPT-4o Mini TTS' }],
      voices: [{ id: 'alloy', name: 'Alloy', language: 'en', gender: 'neutral' }],
      supportedFormats: ['mp3'],
    },
    'azure-tts': {
      id: 'azure-tts',
      name: 'Azure TTS',
      requiresApiKey: true,
      defaultModelId: '',
      models: [],
      voices: [{ id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', language: 'zh-CN' }],
      supportedFormats: ['mp3'],
    },
    'browser-native-tts': {
      id: 'browser-native-tts',
      name: 'Browser Native TTS',
      requiresApiKey: false,
      defaultModelId: '',
      models: [],
      voices: [{ id: 'default', name: 'Default', language: 'en', gender: 'neutral' }],
      supportedFormats: ['browser'],
      speedRange: { min: 0.1, max: 10, default: 1 },
    },
  },
  ASR_PROVIDERS: {
    'openai-whisper': {
      id: 'openai-whisper',
      name: 'OpenAI Whisper',
      requiresApiKey: true,
      defaultModelId: 'gpt-4o-mini-transcribe',
      models: [{ id: 'gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe' }],
      supportedLanguages: ['auto', 'zh'],
      supportedFormats: ['webm'],
    },
    'browser-native': {
      id: 'browser-native',
      name: 'Browser Native ASR',
      requiresApiKey: false,
      defaultModelId: '',
      models: [],
      supportedLanguages: ['zh'],
      supportedFormats: ['browser'],
    },
  },
  DEFAULT_TTS_VOICES: {
    'openai-tts': 'alloy',
    'browser-native-tts': 'default',
  },
  getDefaultTTSVoice: (providerId: 'openai-tts' | 'azure-tts' | 'browser-native-tts') =>
    ({
      'openai-tts': 'alloy',
      'azure-tts': 'zh-CN-XiaoxiaoNeural',
      'browser-native-tts': 'default',
    })[providerId] || 'default',
}));

vi.mock('@/lib/audio/types', () => ({}));

vi.mock('@/lib/pdf/constants', () => ({
  PDF_PROVIDERS: {
    'mineru-local': {
      id: 'mineru-local',
      requiresApiKey: false,
      baseUrl: 'http://localhost:50002',
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Stub global fetch
const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

// Stub localStorage
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};
vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('window', { localStorage: localStorageMock });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full server response shape */
interface MockServerResponse {
  providers?: Record<string, { models?: string[]; baseUrl?: string }>;
  tts?: Record<string, { baseUrl?: string }>;
  asr?: Record<string, { baseUrl?: string }>;
  pdf?: Record<string, { baseUrl?: string }>;
  vector?: Record<string, { models?: string[]; baseUrl?: string }>;
  webSearch?: Record<string, { baseUrl?: string }>;
}

function mockServerResponse(overrides: MockServerResponse = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      providers: {},
      tts: {},
      asr: {},
      pdf: {},
      vector: {},
      webSearch: {},
      ...overrides,
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('slide layout review setting', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  it('defaults to disabled and can be changed', async () => {
    const store = await getStore();

    expect(store.getState().slideLayoutReviewEnabled).toBe(false);
    store.getState().setSlideLayoutReviewEnabled(true);
    expect(store.getState().slideLayoutReviewEnabled).toBe(true);
  });

  it('migrates older settings without the field to disabled', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: { providerId: 'openai', modelId: '' },
        version: 3,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().slideLayoutReviewEnabled).toBe(false);
  });
});

describe('provider deletion persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  it('records deleted built-in providers when provider config removes one', async () => {
    const store = await getStore();
    const { openai: _openai, ...withoutOpenAI } = store.getState().providersConfig;

    store.getState().setProvidersConfig(withoutOpenAI as ProvidersConfig);

    expect(store.getState().providersConfig.openai).toBeUndefined();
    expect(store.getState().deletedBuiltInProviderIds).toContain('openai');
  });

  it('does not restore deleted built-in providers on rehydrate', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          deletedBuiltInProviderIds: ['openai'],
          providersConfig: {
            anthropic: {
              apiKey: '',
              baseUrl: '',
              models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
              name: 'Anthropic',
              type: 'anthropic',
              defaultBaseUrl: 'https://api.anthropic.com',
              icon: '/logos/anthropic.svg',
              requiresApiKey: true,
              isBuiltIn: true,
            },
          },
        },
        version: 2,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().providersConfig.openai).toBeUndefined();
    expect(store.getState().providersConfig.anthropic).toBeDefined();
    expect(store.getState().deletedBuiltInProviderIds).toEqual(['openai']);
  });

  it('does not restore built-in models on rehydrate after the user deletes them all', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          providerId: 'openai',
          modelId: '',
          providersConfig: {
            openai: {
              apiKey: '',
              baseUrl: '',
              models: [],
              modelsCustomized: true,
              name: 'OpenAI',
              type: 'openai',
              defaultBaseUrl: 'https://api.openai.com/v1',
              icon: '/logos/openai.svg',
              requiresApiKey: true,
              isBuiltIn: true,
            },
          },
        },
        version: 2,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().providersConfig.openai.models).toEqual([]);
    expect(store.getState().providersConfig.openai.modelsCustomized).toBe(true);
  });

  it('keeps a persisted empty built-in model list from older builds', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          providerId: 'openai',
          modelId: '',
          providersConfig: {
            openai: {
              apiKey: '',
              baseUrl: '',
              models: [],
              name: 'OpenAI',
              type: 'openai',
              defaultBaseUrl: 'https://api.openai.com/v1',
              icon: '/logos/openai.svg',
              requiresApiKey: true,
              isBuiltIn: true,
            },
          },
        },
        version: 2,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().providersConfig.openai.models).toEqual([]);
  });

  it('keeps a persisted built-in model list instead of re-adding defaults on rehydrate', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          providerId: 'openai',
          modelId: 'gpt-4o-mini',
          providersConfig: {
            openai: {
              apiKey: '',
              baseUrl: '',
              models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
              name: 'OpenAI',
              type: 'openai',
              defaultBaseUrl: 'https://api.openai.com/v1',
              icon: '/logos/openai.svg',
              requiresApiKey: true,
              isBuiltIn: true,
            },
          },
        },
        version: 2,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().providersConfig.openai.models.map((model) => model.id)).toEqual([
      'gpt-4o-mini',
    ]);
  });

  it('migrates old default auto agent mode back to preset and defaults role generation to lightweight model', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          agentMode: 'auto',
        },
        version: 2,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().agentMode).toBe('preset');
    expect(store.getState().agentGenerationModelProfile).toBe('lightweight');
  });

  it('keeps explicitly persisted auto agent mode after the migration version', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          agentMode: 'auto',
          agentGenerationModelProfile: 'main',
        },
        version: 3,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().agentMode).toBe('auto');
    expect(store.getState().agentGenerationModelProfile).toBe('main');
  });

  it('does not restore lightweight built-in models after the user deletes them all', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          lightweightProviderId: 'openai',
          lightweightModelId: '',
          lightweightProvidersConfig: {
            openai: {
              apiKey: '',
              baseUrl: '',
              models: [],
              modelsCustomized: true,
              name: 'OpenAI',
              type: 'openai',
              defaultBaseUrl: 'https://api.openai.com/v1',
              icon: '/logos/openai.svg',
              requiresApiKey: true,
              isBuiltIn: true,
            },
          },
        },
        version: 2,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().lightweightProvidersConfig.openai.models).toEqual([]);
    expect(store.getState().lightweightProvidersConfig.openai.modelsCustomized).toBe(true);
  });

  it('does not expose Claude as a built-in lightweight provider', async () => {
    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().providersConfig.anthropic).toBeDefined();
    expect(store.getState().lightweightProvidersConfig.anthropic).toBeUndefined();
  });

  it('removes persisted Claude lightweight provider bindings on rehydrate', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          lightweightProviderId: 'anthropic',
          lightweightModelId: 'claude-haiku-4-5',
          lightweightProvidersConfig: {
            anthropic: {
              apiKey: '',
              baseUrl: '',
              models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }],
              name: 'Anthropic',
              type: 'anthropic',
              defaultBaseUrl: 'https://api.anthropic.com',
              icon: '/logos/anthropic.svg',
              requiresApiKey: true,
              isBuiltIn: true,
            },
          },
        },
        version: 3,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    expect(store.getState().lightweightProvidersConfig.anthropic).toBeUndefined();
    expect(store.getState().lightweightProviderId).not.toBe('anthropic');
    expect(store.getState().lightweightModelId).not.toBe('claude-haiku-4-5');
  });

  const serviceProviderCases = [
    [
      'TTS',
      'openai-tts',
      'ttsProvidersConfig',
      'deletedBuiltInTTSProviderIds',
      'deleteTTSProvider',
      'restoreTTSProvider',
    ],
    [
      'ASR',
      'openai-whisper',
      'asrProvidersConfig',
      'deletedBuiltInASRProviderIds',
      'deleteASRProvider',
      'restoreASRProvider',
    ],
    [
      'PDF',
      'mineru-local',
      'pdfProvidersConfig',
      'deletedBuiltInPDFProviderIds',
      'deletePDFProvider',
      'restorePDFProvider',
    ],
    [
      'web search',
      'tavily',
      'webSearchProvidersConfig',
      'deletedBuiltInWebSearchProviderIds',
      'deleteWebSearchProvider',
      'restoreWebSearchProvider',
    ],
  ] as const;

  it.each(serviceProviderCases)(
    'records and restores deleted built-in %s providers',
    async (_label, providerId, configKey, deletedKey, deleteAction, restoreAction) => {
      const store = await getStore();
      const initialState = store.getState() as unknown as Record<string, unknown>;

      (initialState[deleteAction] as (id: string) => void)(providerId);

      const deletedState = store.getState() as unknown as Record<string, unknown>;
      expect((deletedState[configKey] as Record<string, unknown>)[providerId]).toBeUndefined();
      expect(deletedState[deletedKey] as string[]).toContain(providerId);

      (deletedState[restoreAction] as (id: string) => void)(providerId);

      const restoredState = store.getState() as unknown as Record<string, unknown>;
      expect((restoredState[configKey] as Record<string, unknown>)[providerId]).toBeDefined();
      expect(restoredState[deletedKey] as string[]).not.toContain(providerId);
    },
  );

  it.each([
    [
      'TTS',
      'openai-tts',
      'ttsProvidersConfig',
      'deletedBuiltInTTSProviderIds',
      {
        ttsProviderId: 'browser-native-tts',
        ttsProvidersConfig: {
          'browser-native-tts': { apiKey: '', baseUrl: '', enabled: true },
        },
        deletedBuiltInTTSProviderIds: ['openai-tts'],
      },
    ],
    [
      'ASR',
      'openai-whisper',
      'asrProvidersConfig',
      'deletedBuiltInASRProviderIds',
      {
        asrProviderId: 'browser-native',
        asrProvidersConfig: {
          'browser-native': { apiKey: '', baseUrl: '', enabled: true },
        },
        deletedBuiltInASRProviderIds: ['openai-whisper'],
      },
    ],
    [
      'web search',
      'tavily',
      'webSearchProvidersConfig',
      'deletedBuiltInWebSearchProviderIds',
      {
        webSearchProviderId: 'tavily',
        webSearchProvidersConfig: {},
        deletedBuiltInWebSearchProviderIds: ['tavily'],
      },
    ],
  ] as const)(
    'does not restore deleted built-in %s providers on rehydrate',
    async (_label, providerId, configKey, deletedKey, persistedState) => {
      storage.set(
        'settings-storage',
        JSON.stringify({
          state: persistedState,
          version: 2,
        }),
      );

      const store = await getStore();
      await store.persist.rehydrate();

      const state = store.getState() as unknown as Record<string, unknown>;
      expect((state[configKey] as Record<string, unknown>)[providerId]).toBeUndefined();
      expect(state[deletedKey] as string[]).toEqual([providerId]);
    },
  );
});

describe('fetchServerProviders — provider availability sync', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  // ---- Server model list filtering ----

  it('filters models to only those the server allows', async () => {
    const store = await getStore();
    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o'] },
      },
    });

    await store.getState().fetchServerProviders();

    const config = store.getState().providersConfig.openai;
    const modelIds = config.models.map((m) => m.id);
    expect(modelIds).toEqual(['gpt-4o']);
    expect(modelIds.includes('gpt-4o-mini')).toBe(false);
    expect(modelIds.includes('gpt-4-turbo')).toBe(false);
  });

  it('keeps all models when server provides no model restriction', async () => {
    const store = await getStore();
    mockServerResponse({
      providers: {
        openai: {}, // no models field = no restriction
      },
    });

    await store.getState().fetchServerProviders();

    const modelIds = store.getState().providersConfig.openai.models.map((m) => m.id);
    expect(modelIds).toContain('gpt-4o');
    expect(modelIds).toContain('gpt-4o-mini');
    expect(modelIds).toContain('gpt-4-turbo');
  });

  it('removes a model when server drops it from the allowed list', async () => {
    const store = await getStore();

    // Round 1: server allows two models
    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o', 'gpt-4o-mini'] },
      },
    });
    await store.getState().fetchServerProviders();
    expect(store.getState().providersConfig.openai.models.map((m) => m.id)).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);

    // Round 2: server removes gpt-4o-mini
    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o'] },
      },
    });
    await store.getState().fetchServerProviders();
    const modelIds = store.getState().providersConfig.openai.models.map((m) => m.id);
    expect(modelIds).toEqual(['gpt-4o']);
    expect(modelIds.includes('gpt-4o-mini')).toBe(false);
  });

  // ---- Provider availability flags ----

  it('marks provider as server-configured when present in response', async () => {
    const store = await getStore();
    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o'] },
      },
    });

    await store.getState().fetchServerProviders();

    expect(store.getState().providersConfig.openai.isServerConfigured).toBe(true);
  });

  it('resets isServerConfigured when provider disappears from response', async () => {
    const store = await getStore();

    // Round 1: openai is server-configured
    mockServerResponse({ providers: { openai: { models: ['gpt-4o'] } } });
    await store.getState().fetchServerProviders();
    expect(store.getState().providersConfig.openai.isServerConfigured).toBe(true);

    // Round 2: openai is no longer in server response
    mockServerResponse({});
    await store.getState().fetchServerProviders();
    expect(store.getState().providersConfig.openai.isServerConfigured).toBe(false);
  });

  it('provider without client key and not server-configured has no usable path', async () => {
    const store = await getStore();
    mockServerResponse({}); // no server providers

    await store.getState().fetchServerProviders();

    const config = store.getState().providersConfig.openai;
    // No client key, not server-configured → provider should not be "ready"
    expect(config.apiKey).toBe('');
    expect(config.isServerConfigured).toBe(false);
    // This is the condition model-selector uses to decide if a provider is usable:
    const isUsable = !config.requiresApiKey || !!config.apiKey || !!config.isServerConfigured;
    expect(isUsable).toBe(false);
  });

  // ---- Multiple providers ----

  it('handles mixed provider state: one configured, one not', async () => {
    const store = await getStore();
    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o'] },
        // anthropic not in response
      },
    });

    await store.getState().fetchServerProviders();

    expect(store.getState().providersConfig.openai.isServerConfigured).toBe(true);
    expect(store.getState().providersConfig.anthropic.isServerConfigured).toBe(false);
  });

  // ---- serverModels metadata ----

  it('stores serverModels metadata for downstream filtering', async () => {
    const store = await getStore();
    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o', 'gpt-4o-mini'] },
      },
    });

    await store.getState().fetchServerProviders();

    expect(store.getState().providersConfig.openai.serverModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('clears serverModels when provider removed from server', async () => {
    const store = await getStore();

    mockServerResponse({ providers: { openai: { models: ['gpt-4o'] } } });
    await store.getState().fetchServerProviders();
    expect(store.getState().providersConfig.openai.serverModels).toEqual(['gpt-4o']);

    mockServerResponse({});
    await store.getState().fetchServerProviders();
    expect(store.getState().providersConfig.openai.serverModels).toBeUndefined();
  });

  // ---- Stale selection consistency ----

  // BUG: fetchServerProviders() updates providersConfig.models but never
  // validates the current modelId/providerId selection against the new list.
  // These tests document the desired fix — remove .fails() once implemented.

  it('clears modelId when server removes the selected model', async () => {
    const store = await getStore();

    // User selects gpt-4o-mini while it's available
    store.getState().setModel('openai', 'gpt-4o-mini');
    expect(store.getState().modelId).toBe('gpt-4o-mini');

    // Server drops gpt-4o-mini
    mockServerResponse({ providers: { openai: { models: ['gpt-4o'] } } });
    await store.getState().fetchServerProviders();

    // modelId should be cleared, not silently kept as a stale value
    expect(store.getState().modelId).toBe('gpt-4o');
  });

  it('clears providerId when entire provider loses server config and has no client key', async () => {
    const store = await getStore();

    // User on a server-only provider (no client key)
    store.getState().setModel('openai', 'gpt-4o');
    mockServerResponse({ providers: { openai: { models: ['gpt-4o'] } } });
    await store.getState().fetchServerProviders();
    expect(store.getState().providersConfig.openai.isServerConfigured).toBe(true);

    // Server removes openai entirely — no client key either
    mockServerResponse({});
    await store.getState().fetchServerProviders();

    // Provider is unusable → selection should be cleared
    expect(store.getState().providerId).toBe('');
    expect(store.getState().modelId).toBe('');
  });

  it('clears modelId when server narrows model list and selected model is excluded', async () => {
    const store = await getStore();

    // Round 1: user picks gpt-4-turbo
    mockServerResponse({
      providers: { openai: { models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] } },
    });
    await store.getState().fetchServerProviders();
    store.getState().setModel('openai', 'gpt-4-turbo');

    // Round 2: server narrows to gpt-4o only
    mockServerResponse({ providers: { openai: { models: ['gpt-4o'] } } });
    await store.getState().fetchServerProviders();

    // Selection should be cleared, not left pointing to unavailable model
    expect(store.getState().modelId).toBe('gpt-4o');
  });

  it('keeps modelId when selected model is still available after server sync', async () => {
    const store = await getStore();

    store.getState().setModel('openai', 'gpt-4o');
    mockServerResponse({ providers: { openai: { models: ['gpt-4o', 'gpt-4o-mini'] } } });
    await store.getState().fetchServerProviders();

    // gpt-4o is still available — selection should be preserved
    expect(store.getState().providerId).toBe('openai');
    expect(store.getState().modelId).toBe('gpt-4o');
  });

  // ---- Error handling ----

  it('does not modify state when fetch returns non-ok response', async () => {
    const store = await getStore();

    // First, set up a known state
    mockServerResponse({ providers: { openai: { models: ['gpt-4o'] } } });
    await store.getState().fetchServerProviders();
    expect(store.getState().providersConfig.openai.isServerConfigured).toBe(true);

    // Now fetch returns an error
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await store.getState().fetchServerProviders();

    // State should be unchanged — the failed fetch should not wipe existing config
    expect(store.getState().providersConfig.openai.isServerConfigured).toBe(true);
  });

  it('does not throw when fetch rejects (network error)', async () => {
    const store = await getStore();

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw — server providers are optional
    await store.getState().fetchServerProviders();
  });
});

describe('fetchServerProviders — TTS stale selection', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  it('falls back to browser-native-tts when selected TTS provider loses server config', async () => {
    const store = await getStore();

    mockServerResponse({ tts: { 'openai-tts': {} } });
    await store.getState().fetchServerProviders();
    store.getState().setTTSProvider('openai-tts');
    expect(store.getState().ttsProviderId).toBe('openai-tts');

    mockServerResponse({});
    await store.getState().fetchServerProviders();

    expect(store.getState().ttsProviderId).toBe('browser-native-tts');
  });

  it('falls back to remaining server TTS provider when selected one is removed', async () => {
    const store = await getStore();

    mockServerResponse({ tts: { 'openai-tts': {}, 'azure-tts': {} } });
    await store.getState().fetchServerProviders();
    store.getState().setTTSProvider('openai-tts');

    mockServerResponse({ tts: { 'azure-tts': {} } });
    await store.getState().fetchServerProviders();

    expect(store.getState().ttsProviderId).toBe('azure-tts');
  });

  it('keeps TTS provider when it is still server-configured', async () => {
    const store = await getStore();

    mockServerResponse({ tts: { 'openai-tts': {} } });
    await store.getState().fetchServerProviders();
    store.getState().setTTSProvider('openai-tts');

    mockServerResponse({ tts: { 'openai-tts': {} } });
    await store.getState().fetchServerProviders();

    expect(store.getState().ttsProviderId).toBe('openai-tts');
  });
});

describe('fetchServerProviders — ASR stale selection', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  it('falls back to browser-native when selected ASR provider loses server config', async () => {
    const store = await getStore();

    mockServerResponse({ asr: { 'openai-whisper': {} } });
    await store.getState().fetchServerProviders();
    store.getState().setASRProvider('openai-whisper');
    expect(store.getState().asrProviderId).toBe('openai-whisper');

    mockServerResponse({});
    await store.getState().fetchServerProviders();

    expect(store.getState().asrProviderId).toBe('browser-native');
  });

  it('keeps ASR provider when it is still server-configured', async () => {
    const store = await getStore();

    mockServerResponse({ asr: { 'openai-whisper': {} } });
    await store.getState().fetchServerProviders();
    store.getState().setASRProvider('openai-whisper');

    mockServerResponse({ asr: { 'openai-whisper': {} } });
    await store.getState().fetchServerProviders();

    expect(store.getState().asrProviderId).toBe('openai-whisper');
  });
});

describe('fetchServerProviders — PDF stale selection', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  it('falls back to mineru-local when persisted PDF provider is stale', async () => {
    const store = await getStore();

    mockServerResponse({});
    await store.getState().fetchServerProviders();

    store.setState({ pdfProviderId: 'mineru' as unknown as 'mineru-local' });

    mockServerResponse({});
    await store.getState().fetchServerProviders();

    expect(store.getState().pdfProviderId).toBe('mineru-local');
  });

  it('marks MinerU local PDF provider as server-configured', async () => {
    const store = await getStore();

    mockServerResponse({ pdf: { 'mineru-local': { baseUrl: 'http://localhost:50002' } } });
    await store.getState().fetchServerProviders();

    expect(store.getState().pdfProviderId).toBe('mineru-local');
    expect(store.getState().pdfProvidersConfig['mineru-local'].isServerConfigured).toBe(true);
    expect(store.getState().pdfProvidersConfig['mineru-local'].serverBaseUrl).toBe(
      'http://localhost:50002',
    );
  });
});

describe('fetchServerProviders — Vector sync', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  it('marks vector providers as server-configured and stores server models', async () => {
    const store = await getStore();

    mockServerResponse({
      vector: {
        'openai-embedding': {
          baseUrl: 'https://proxy.example.com/v1',
          models: ['text-embedding-3-small', 'text-embedding-3-large'],
        },
      },
    });
    await store.getState().fetchServerProviders();

    const config = store.getState().vectorProvidersConfig['openai-embedding'];
    expect(config.isServerConfigured).toBe(true);
    expect(config.serverBaseUrl).toBe('https://proxy.example.com/v1');
    expect(config.models).toEqual([
      { id: 'text-embedding-3-small', name: 'text-embedding-3-small' },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large' },
    ]);
  });

  it('does not leave the stale vector provider selected when server config changes', async () => {
    const store = await getStore();

    mockServerResponse({
      vector: {
        'openai-embedding': { baseUrl: 'https://proxy.example.com/v1' },
        'qwen-embedding': { baseUrl: 'https://proxy.qwen.com/v1' },
      },
    });
    await store.getState().fetchServerProviders();
    store.getState().setVectorProvider('openai-embedding');
    store.getState().setVectorProviderConfig('openai-embedding', {
      apiKey: '',
      baseUrl: '',
    });

    mockServerResponse({
      vector: {
        'qwen-embedding': { baseUrl: 'https://proxy.qwen.com/v1' },
      },
    });
    await store.getState().fetchServerProviders();

    expect(store.getState().vectorProviderId).not.toBe('openai-embedding');
    expect(store.getState().vectorProvidersConfig['qwen-embedding'].isServerConfigured).toBe(true);
  });

  it('migrates retired local BGE vector config into SiliconFlow without stale branding', async () => {
    storage.set(
      'settings-storage',
      JSON.stringify({
        state: {
          vectorProviderId: 'chinese-xinhua-local',
          vectorProvidersConfig: {
            'chinese-xinhua-local': {
              apiKey: '',
              baseUrl: 'http://localhost:50003',
              enabled: true,
              modelId: 'BAAI/bge-base-zh-v1.5',
              name: '本地新华字典向量',
              icon: '/logos/bailian.svg',
              requiresApiKey: false,
            },
          },
        },
        version: 2,
      }),
    );

    const store = await getStore();
    await store.persist.rehydrate();

    const state = store.getState();
    const config = state.vectorProvidersConfig.siliconflow;
    expect(state.vectorProviderId).toBe('siliconflow');
    expect(state.vectorProvidersConfig['chinese-xinhua-local']).toBeUndefined();
    expect(config.modelId).toBe('BAAI/bge-base-zh-v1.5');
    expect(config.baseUrl).toBe('http://localhost:50003');
    expect(config.requiresApiKey).toBe(false);
    expect(config.name).toBeUndefined();
    expect(config.icon).toBeUndefined();
  });
});

describe('fetchServerProviders — LLM cross-provider fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    mockFetch.mockReset();
  });

  async function getStore() {
    const { useSettingsStore } = await import('@/lib/store/settings');
    return useSettingsStore;
  }

  it('falls back to another server-configured LLM provider when current becomes unusable', async () => {
    const store = await getStore();

    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o'] },
        anthropic: { models: ['claude-sonnet-4-6'] },
      },
    });
    await store.getState().fetchServerProviders();
    store.getState().setModel('openai', 'gpt-4o');

    mockServerResponse({
      providers: {
        anthropic: { models: ['claude-sonnet-4-6'] },
      },
    });
    await store.getState().fetchServerProviders();

    expect(store.getState().providerId).toBe('anthropic');
    expect(store.getState().modelId).toBe('claude-sonnet-4-6');
  });

  it('does not mirror server-configured Claude into lightweight providers', async () => {
    const store = await getStore();

    mockServerResponse({
      providers: {
        openai: { models: ['gpt-4o-mini'] },
        anthropic: { models: ['claude-sonnet-4-6'] },
      },
    });
    await store.getState().fetchServerProviders();

    expect(store.getState().providersConfig.anthropic?.isServerConfigured).toBe(true);
    expect(store.getState().lightweightProvidersConfig.anthropic).toBeUndefined();
  });
});

/**
 * Settings Store
 * Global settings state synchronized with localStorage
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderId } from '@/lib/ai/providers';
import type { ProvidersConfig } from '@/lib/types/settings';
import { PROVIDERS } from '@/lib/ai/providers';
import type { TTSProviderId, ASRProviderId } from '@/lib/audio/types';
import { ASR_PROVIDERS, TTS_PROVIDERS, getDefaultTTSVoice } from '@/lib/audio/constants';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFProviderId } from '@/lib/pdf/types';
import {
  LOCAL_BGE_BASE_ZH_MODEL_ID,
  VECTOR_PROVIDERS,
  normalizeVectorProviderId,
} from '@/lib/vector/constants';
import type { VectorProviderId } from '@/lib/vector/types';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { createLogger } from '@/lib/logger';
import { validateProvider, validateModel } from '@/lib/store/settings-validation';

const log = createLogger('Settings');

/** Available playback speed tiers */
export const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export type AgentGenerationModelProfile = 'lightweight' | 'main';

const LIGHTWEIGHT_EXCLUDED_PROVIDER_IDS = new Set<string>(['anthropic']);

export function isLightweightProviderAllowed(providerId: string): boolean {
  return !LIGHTWEIGHT_EXCLUDED_PROVIDER_IDS.has(providerId);
}

export interface ManagedServiceProviderConfig<TCompatibleProviderId extends string = string> {
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  modelId?: string;
  models?: Array<{ id: string; name: string }>;
  customModels?: Array<{ id: string; name: string }>;
  providerOptions?: Record<string, unknown>;
  isServerConfigured?: boolean;
  serverBaseUrl?: string;
  name?: string;
  icon?: string;
  requiresApiKey?: boolean;
  defaultBaseUrl?: string;
  isBuiltIn?: boolean;
  compatibleProviderId?: TCompatibleProviderId;
}

export interface SettingsState {
  secretsHydrated: boolean;
  secretMigrationError: string | null;
  // Model selection
  providerId: ProviderId;
  modelId: string;
  lightweightProviderId: ProviderId;
  lightweightModelId: string;

  // Provider configurations (unified JSON storage)
  providersConfig: ProvidersConfig;
  deletedBuiltInProviderIds: ProviderId[];
  lightweightProvidersConfig: ProvidersConfig;
  deletedBuiltInLightweightProviderIds: ProviderId[];

  // TTS settings (legacy, kept for backward compatibility)
  ttsModel: string;

  // Audio settings (new unified audio configuration)
  ttsProviderId: TTSProviderId;
  ttsVoice: string;
  ttsSpeed: number;
  asrProviderId: ASRProviderId;
  asrLanguage: string;

  // Audio provider configurations
  deletedBuiltInTTSProviderIds: TTSProviderId[];
  deletedBuiltInASRProviderIds: ASRProviderId[];
  ttsProvidersConfig: Record<TTSProviderId, ManagedServiceProviderConfig<TTSProviderId>>;

  asrProvidersConfig: Record<ASRProviderId, ManagedServiceProviderConfig<ASRProviderId>>;

  // PDF settings
  deletedBuiltInPDFProviderIds: PDFProviderId[];
  pdfProviderId: PDFProviderId;
  pdfProvidersConfig: Record<PDFProviderId, ManagedServiceProviderConfig<PDFProviderId>>;

  // Vector / embedding settings
  deletedBuiltInVectorProviderIds: VectorProviderId[];
  vectorProviderId: VectorProviderId;
  vectorProvidersConfig: Record<VectorProviderId, ManagedServiceProviderConfig<VectorProviderId>>;

  // Web Search settings
  deletedBuiltInWebSearchProviderIds: WebSearchProviderId[];
  webSearchProviderId: WebSearchProviderId;
  webSearchProvidersConfig: Record<
    WebSearchProviderId,
    ManagedServiceProviderConfig<WebSearchProviderId>
  >;

  // Global TTS/ASR toggles
  ttsEnabled: boolean;
  asrEnabled: boolean;

  // Auto-config lifecycle flag (persisted)
  autoConfigApplied: boolean;

  // Playback controls
  ttsMuted: boolean;
  ttsVolume: number; // 0-1, actual volume level
  autoPlayLecture: boolean;
  playbackSpeed: PlaybackSpeed;

  // Agent settings
  selectedAgentIds: string[];
  maxTurns: string;
  agentMode: 'preset' | 'auto';
  autoAgentCount: number;
  agentGenerationModelProfile: AgentGenerationModelProfile;

  // Slide generation settings
  slideLayoutReviewEnabled: boolean;

  // Layout preferences (persisted via localStorage)
  sidebarCollapsed: boolean;
  chatAreaCollapsed: boolean;
  chatAreaWidth: number;

  // Actions
  setModel: (providerId: ProviderId, modelId: string) => void;
  setLightweightModel: (providerId: ProviderId, modelId: string) => void;
  setProviderConfig: (providerId: ProviderId, config: Partial<ProvidersConfig[ProviderId]>) => void;
  setProvidersConfig: (config: ProvidersConfig) => void;
  setLightweightProviderConfig: (
    providerId: ProviderId,
    config: Partial<ProvidersConfig[ProviderId]>,
  ) => void;
  setLightweightProvidersConfig: (config: ProvidersConfig) => void;
  setTtsModel: (model: string) => void;
  setTTSMuted: (muted: boolean) => void;
  setTTSVolume: (volume: number) => void;
  setAutoPlayLecture: (autoPlay: boolean) => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  setSelectedAgentIds: (ids: string[]) => void;
  setMaxTurns: (turns: string) => void;
  setAgentMode: (mode: 'preset' | 'auto') => void;
  setAutoAgentCount: (count: number) => void;
  setAgentGenerationModelProfile: (profile: AgentGenerationModelProfile) => void;
  setSlideLayoutReviewEnabled: (enabled: boolean) => void;

  // Layout actions
  setSidebarCollapsed: (collapsed: boolean) => void;
  setChatAreaCollapsed: (collapsed: boolean) => void;
  setChatAreaWidth: (width: number) => void;

  // Audio actions
  setTTSProvider: (providerId: TTSProviderId) => void;
  setTTSVoice: (voice: string) => void;
  setTTSSpeed: (speed: number) => void;
  setASRProvider: (providerId: ASRProviderId) => void;
  setASRLanguage: (language: string) => void;
  setTTSProviderConfig: (
    providerId: TTSProviderId,
    config: Partial<ManagedServiceProviderConfig<TTSProviderId>>,
  ) => void;
  deleteTTSProvider: (providerId: TTSProviderId) => void;
  restoreTTSProvider: (providerId: TTSProviderId) => void;
  setASRProviderConfig: (
    providerId: ASRProviderId,
    config: Partial<ManagedServiceProviderConfig<ASRProviderId>>,
  ) => void;
  deleteASRProvider: (providerId: ASRProviderId) => void;
  restoreASRProvider: (providerId: ASRProviderId) => void;
  setTTSEnabled: (enabled: boolean) => void;
  setASREnabled: (enabled: boolean) => void;

  // PDF actions
  setPDFProvider: (providerId: PDFProviderId) => void;
  setPDFProviderConfig: (
    providerId: PDFProviderId,
    config: Partial<ManagedServiceProviderConfig<PDFProviderId>>,
  ) => void;
  deletePDFProvider: (providerId: PDFProviderId) => void;
  restorePDFProvider: (providerId: PDFProviderId) => void;

  // Vector actions
  setVectorProvider: (providerId: VectorProviderId) => void;
  setVectorProviderConfig: (
    providerId: VectorProviderId,
    config: Partial<ManagedServiceProviderConfig<VectorProviderId>>,
  ) => void;
  deleteVectorProvider: (providerId: VectorProviderId) => void;
  restoreVectorProvider: (providerId: VectorProviderId) => void;

  // Web Search actions
  setWebSearchProvider: (providerId: WebSearchProviderId) => void;
  setWebSearchProviderConfig: (
    providerId: WebSearchProviderId,
    config: Partial<ManagedServiceProviderConfig<WebSearchProviderId>>,
  ) => void;
  deleteWebSearchProvider: (providerId: WebSearchProviderId) => void;
  restoreWebSearchProvider: (providerId: WebSearchProviderId) => void;

  // Server provider actions
  fetchServerProviders: () => Promise<void>;
  setSecretHydrationState: (hydrated: boolean, error?: string | null) => void;
}

export function redactApiKeys<T extends Record<string, { apiKey?: string }>>(config: T): T {
  return Object.fromEntries(
    Object.entries(config).map(([providerId, providerConfig]) => [
      providerId,
      { ...providerConfig, apiKey: '' },
    ]),
  ) as T;
}

export function sanitizePersistedSettings(state: SettingsState): SettingsState {
  return {
    ...state,
    secretsHydrated: false,
    secretMigrationError: null,
    providersConfig: redactApiKeys(state.providersConfig),
    lightweightProvidersConfig: redactApiKeys(state.lightweightProvidersConfig),
    ttsProvidersConfig: redactApiKeys(state.ttsProvidersConfig),
    asrProvidersConfig: redactApiKeys(state.asrProvidersConfig),
    pdfProvidersConfig: redactApiKeys(state.pdfProvidersConfig),
    vectorProvidersConfig: redactApiKeys(state.vectorProvidersConfig),
    webSearchProvidersConfig: redactApiKeys(state.webSearchProvidersConfig),
  };
}

// Initialize default providers config
const getDefaultProvidersConfig = (): ProvidersConfig => {
  const config: ProvidersConfig = {} as ProvidersConfig;
  Object.keys(PROVIDERS).forEach((pid) => {
    const provider = PROVIDERS[pid as ProviderId];
    config[pid as ProviderId] = {
      apiKey: '',
      baseUrl: '',
      models: provider.models,
      name: provider.name,
      type: provider.type,
      defaultBaseUrl: provider.defaultBaseUrl,
      icon: provider.icon,
      requiresApiKey: provider.requiresApiKey,
      isBuiltIn: true,
    };
  });
  return config;
};

const getLightweightProvidersConfig = (source?: Partial<ProvidersConfig>): ProvidersConfig => {
  const config: ProvidersConfig = {} as ProvidersConfig;
  const sourceConfig = source || getDefaultProvidersConfig();

  Object.entries(sourceConfig).forEach(([pid, providerConfig]) => {
    if (!isLightweightProviderAllowed(pid) || !providerConfig) return;
    config[pid as ProviderId] = providerConfig as ProvidersConfig[ProviderId];
  });

  return config;
};

const getDefaultLightweightProvidersConfig = (): ProvidersConfig =>
  getLightweightProvidersConfig(getDefaultProvidersConfig());

function getInitialLightweightProviderId(providerId?: ProviderId): ProviderId {
  return providerId && isLightweightProviderAllowed(providerId) ? providerId : 'openai';
}

function getNormalizedDeletedBuiltInProviderIds(value: unknown): ProviderId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is ProviderId => typeof id === 'string' && id in PROVIDERS);
}

function normalizeDeletedBuiltInProviderIds(state: Partial<SettingsState>): void {
  state.deletedBuiltInProviderIds = getNormalizedDeletedBuiltInProviderIds(
    (state as { deletedBuiltInProviderIds?: unknown }).deletedBuiltInProviderIds,
  );
  state.deletedBuiltInLightweightProviderIds = getNormalizedDeletedBuiltInProviderIds(
    (state as { deletedBuiltInLightweightProviderIds?: unknown })
      .deletedBuiltInLightweightProviderIds,
  );
}

function getDeletedBuiltInProviderIds(
  providersConfig: Partial<ProvidersConfig>,
  existingDeletedIds: ProviderId[] = [],
): ProviderId[] {
  const deletedIds = new Set(getNormalizedDeletedBuiltInProviderIds(existingDeletedIds));

  Object.keys(PROVIDERS).forEach((pid) => {
    const providerId = pid as ProviderId;
    if (providersConfig[providerId]) {
      deletedIds.delete(providerId);
    } else {
      deletedIds.add(providerId);
    }
  });

  return Array.from(deletedIds);
}

function getNormalizedProviderIds<T extends string>(
  value: unknown,
  providerMap: Record<string, unknown>,
): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is T => typeof id === 'string' && id in providerMap);
}

function getDeletedBuiltInIds<T extends string>(
  providersConfig: Partial<Record<T, unknown>>,
  providerMap: Record<string, unknown>,
  existingDeletedIds: T[] = [],
): T[] {
  const deletedIds = new Set(getNormalizedProviderIds<T>(existingDeletedIds, providerMap));

  Object.keys(providerMap).forEach((pid) => {
    const providerId = pid as T;
    if (providersConfig[providerId]) {
      deletedIds.delete(providerId);
    } else {
      deletedIds.add(providerId);
    }
  });

  return Array.from(deletedIds);
}

function normalizeDeletedBuiltInServiceProviderIds(state: Partial<SettingsState>): void {
  const record = state as Record<string, unknown>;
  state.deletedBuiltInTTSProviderIds = getNormalizedProviderIds<TTSProviderId>(
    record.deletedBuiltInTTSProviderIds,
    TTS_PROVIDERS,
  );
  state.deletedBuiltInASRProviderIds = getNormalizedProviderIds<ASRProviderId>(
    record.deletedBuiltInASRProviderIds,
    ASR_PROVIDERS,
  );
  state.deletedBuiltInPDFProviderIds = getNormalizedProviderIds<PDFProviderId>(
    record.deletedBuiltInPDFProviderIds,
    PDF_PROVIDERS,
  );
  state.deletedBuiltInVectorProviderIds = getNormalizedProviderIds<VectorProviderId>(
    record.deletedBuiltInVectorProviderIds,
    {
      ...VECTOR_PROVIDERS,
      'siliconflow-embedding': VECTOR_PROVIDERS.siliconflow,
    },
  ).map((id) => normalizeVectorProviderId(id));
  state.deletedBuiltInWebSearchProviderIds = getNormalizedProviderIds<WebSearchProviderId>(
    record.deletedBuiltInWebSearchProviderIds,
    WEB_SEARCH_PROVIDERS,
  );
}

// Initialize default audio config
const getDefaultAudioConfig = () => ({
  ttsProviderId: 'browser-native-tts' as TTSProviderId,
  ttsVoice: 'default',
  ttsSpeed: 1.0,
  asrProviderId: 'browser-native' as ASRProviderId,
  asrLanguage: 'zh',
  ttsProvidersConfig: {
    'openai-tts': { apiKey: '', baseUrl: '', enabled: true },
    'azure-tts': { apiKey: '', baseUrl: '', enabled: false },
    'glm-tts': { apiKey: '', baseUrl: '', enabled: false },
    'qwen-tts': { apiKey: '', baseUrl: '', enabled: false },
    'cosyvoice-tts': {
      apiKey: '',
      baseUrl: '',
      modelId: 'Fun-CosyVoice3-0.5B-2512_RL',
      enabled: false,
    },
    'doubao-tts': { apiKey: '', baseUrl: '', enabled: false },
    'elevenlabs-tts': { apiKey: '', baseUrl: '', enabled: false },
    'minimax-tts': { apiKey: '', baseUrl: '', modelId: 'speech-2.8-hd', enabled: false },
    'browser-native-tts': { apiKey: '', baseUrl: '', enabled: true },
  } as Record<
    TTSProviderId,
    { apiKey: string; baseUrl: string; modelId?: string; enabled: boolean }
  >,
  asrProvidersConfig: {
    'openai-whisper': { apiKey: '', baseUrl: '', enabled: true },
    'browser-native': { apiKey: '', baseUrl: '', enabled: true },
    'qwen-asr': { apiKey: '', baseUrl: '', enabled: false },
    'sensevoice-asr': {
      apiKey: '',
      baseUrl: '',
      modelId: 'iic/SenseVoiceSmall',
      enabled: false,
    },
  } as Record<ASRProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});

// Initialize default PDF config
const getDefaultPDFConfig = () => ({
  pdfProviderId: 'mineru-local' as PDFProviderId,
  pdfProvidersConfig: {
    'mineru-local': {
      apiKey: '',
      baseUrl: 'http://localhost:50002',
      enabled: true,
    },
  } as Record<PDFProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});

// Initialize default Vector config
const getDefaultVectorConfig = () => ({
  vectorProviderId: 'siliconflow' as VectorProviderId,
  vectorProvidersConfig: {
    'openai-embedding': {
      apiKey: '',
      baseUrl: '',
      modelId: 'text-embedding-3-small',
      enabled: false,
    },
    'qwen-embedding': {
      apiKey: '',
      baseUrl: '',
      modelId: 'text-embedding-v4',
      enabled: false,
    },
    siliconflow: {
      apiKey: '',
      baseUrl: 'http://localhost:50003',
      modelId: LOCAL_BGE_BASE_ZH_MODEL_ID,
      enabled: true,
      requiresApiKey: false,
    },
  } as Record<
    VectorProviderId,
    { apiKey: string; baseUrl: string; modelId?: string; enabled: boolean }
  >,
});

const RETIRED_CHINESE_XINHUA_VECTOR_NAMES = new Set([
  '本地新华字典向量',
  'Chinese Xinhua Local Vector',
  'Chinese Xinhua Local',
  'Local Chinese Xinhua Vector',
]);

function scrubRetiredChineseXinhuaVectorBranding(
  config?: Partial<ManagedServiceProviderConfig<VectorProviderId>>,
): void {
  if (!config) return;

  if (config.name && RETIRED_CHINESE_XINHUA_VECTOR_NAMES.has(config.name)) {
    delete config.name;
  }
  if (config.icon === '/logos/bailian.svg') {
    delete config.icon;
  }
}

const RETIRED_MEDIA_GENERATION_KEYS = [
  'deletedBuiltInImageProviderIds',
  'imageProviderId',
  'imageModelId',
  'imageProvidersConfig',
  'deletedBuiltInVideoProviderIds',
  'videoProviderId',
  'videoModelId',
  'videoProvidersConfig',
  'imageGenerationEnabled',
  'videoGenerationEnabled',
] as const;

const RETIRED_AUDIO_CAPTURE_KEYS = [
  '\u0063\u006c\u0061\u0073\u0073\u0072\u006f\u006f\u006d\u0041\u006c\u0077\u0061\u0079\u0073\u004f\u006e\u0041\u0053\u0052\u0045\u006e\u0061\u0062\u006c\u0065\u0064',
] as const;

function scrubRetiredMediaGenerationSettings(state: object): void {
  const record = state as Record<string, unknown>;
  for (const key of RETIRED_MEDIA_GENERATION_KEYS) {
    delete record[key];
  }
}

function scrubRetiredAudioCaptureSettings(state: object): void {
  const record = state as Record<string, unknown>;
  for (const key of RETIRED_AUDIO_CAPTURE_KEYS) {
    delete record[key];
  }
}

// Initialize default Web Search config
const getDefaultWebSearchConfig = () => ({
  webSearchProviderId: 'tavily' as WebSearchProviderId,
  webSearchProvidersConfig: {
    tavily: { apiKey: '', baseUrl: '', enabled: true },
  } as Record<WebSearchProviderId, { apiKey: string; baseUrl: string; enabled: boolean }>,
});

function getFirstConfiguredProviderId<T extends string>(
  config: Partial<Record<T, unknown>> | undefined,
): T | '' {
  return (Object.keys(config ?? {})[0] as T | undefined) ?? '';
}

function getCompatibleProviderId<T extends string>(
  config: Partial<Record<T, ManagedServiceProviderConfig<T>>> | undefined,
  providerId: T | undefined,
): T | undefined {
  if (!providerId) return undefined;
  return (config?.[providerId]?.compatibleProviderId || providerId) as T;
}

/**
 * Validate all persisted provider IDs against their registries.
 * Reset any stale / removed ID back to its default value.
 * Called during both migrate and merge to cover all rehydration paths.
 */
function ensureValidProviderSelections(state: Partial<SettingsState>): void {
  if (state.providerId && !state.providersConfig?.[state.providerId as ProviderId]) {
    state.providerId = getFirstConfiguredProviderId<ProviderId>(
      state.providersConfig,
    ) as ProviderId;
    state.modelId =
      state.providerId && state.providersConfig?.[state.providerId as ProviderId]?.models?.[0]
        ? state.providersConfig[state.providerId as ProviderId].models[0].id
        : '';
  }

  if (
    state.lightweightProviderId &&
    !state.lightweightProvidersConfig?.[state.lightweightProviderId as ProviderId]
  ) {
    state.lightweightProviderId = getFirstConfiguredProviderId<ProviderId>(
      state.lightweightProvidersConfig,
    ) as ProviderId;
    state.lightweightModelId =
      state.lightweightProviderId &&
      state.lightweightProvidersConfig?.[state.lightweightProviderId as ProviderId]?.models?.[0]
        ? state.lightweightProvidersConfig[state.lightweightProviderId as ProviderId].models[0].id
        : '';
  }

  if (!state.pdfProviderId || !state.pdfProvidersConfig?.[state.pdfProviderId as PDFProviderId]) {
    state.pdfProviderId = (
      state.pdfProvidersConfig?.['mineru-local']
        ? 'mineru-local'
        : getFirstConfiguredProviderId<PDFProviderId>(state.pdfProvidersConfig)
    ) as PDFProviderId;
  }

  if (
    !state.vectorProviderId ||
    !state.vectorProvidersConfig?.[state.vectorProviderId as VectorProviderId]
  ) {
    state.vectorProviderId = (
      state.vectorProvidersConfig?.siliconflow
        ? 'siliconflow'
        : getFirstConfiguredProviderId<VectorProviderId>(state.vectorProvidersConfig)
    ) as VectorProviderId;
  }

  if (
    !state.webSearchProviderId ||
    !state.webSearchProvidersConfig?.[state.webSearchProviderId as WebSearchProviderId]
  ) {
    state.webSearchProviderId = getFirstConfiguredProviderId<WebSearchProviderId>(
      state.webSearchProvidersConfig,
    ) as WebSearchProviderId;
  }

  if (!state.ttsProviderId || !state.ttsProvidersConfig?.[state.ttsProviderId as TTSProviderId]) {
    state.ttsProviderId = getFirstConfiguredProviderId<TTSProviderId>(
      state.ttsProvidersConfig,
    ) as TTSProviderId;
    const compatibleProviderId = getCompatibleProviderId(
      state.ttsProvidersConfig,
      state.ttsProviderId,
    );
    state.ttsVoice = compatibleProviderId
      ? getDefaultTTSVoice(
          compatibleProviderId,
          state.ttsProvidersConfig?.[state.ttsProviderId as TTSProviderId]?.modelId ||
            TTS_PROVIDERS[compatibleProviderId]?.defaultModelId,
        )
      : 'default';
  }

  if (!state.asrProviderId || !state.asrProvidersConfig?.[state.asrProviderId as ASRProviderId]) {
    state.asrProviderId = getFirstConfiguredProviderId<ASRProviderId>(
      state.asrProvidersConfig,
    ) as ASRProviderId;
    const compatibleProviderId = getCompatibleProviderId(
      state.asrProvidersConfig,
      state.asrProviderId,
    );
    const supportedLanguages = compatibleProviderId
      ? ASR_PROVIDERS[compatibleProviderId]?.supportedLanguages || []
      : [];
    state.asrLanguage = supportedLanguages.includes(state.asrLanguage || '')
      ? state.asrLanguage!
      : supportedLanguages[0] || 'auto';
  }
}

function removeUnsupportedLightweightProviders(state: Partial<SettingsState>): void {
  if (!state.lightweightProvidersConfig) return;

  Object.keys(state.lightweightProvidersConfig).forEach((pid) => {
    if (!isLightweightProviderAllowed(pid)) {
      delete state.lightweightProvidersConfig![pid as ProviderId];
    }
  });

  state.deletedBuiltInLightweightProviderIds = getNormalizedDeletedBuiltInProviderIds(
    state.deletedBuiltInLightweightProviderIds,
  ).filter(isLightweightProviderAllowed);

  if (
    state.lightweightProviderId &&
    !state.lightweightProvidersConfig[state.lightweightProviderId as ProviderId]
  ) {
    state.lightweightProviderId = getFirstConfiguredProviderId<ProviderId>(
      state.lightweightProvidersConfig,
    ) as ProviderId;
    state.lightweightModelId =
      state.lightweightProviderId &&
      state.lightweightProvidersConfig?.[state.lightweightProviderId as ProviderId]?.models?.[0]
        ? state.lightweightProvidersConfig[state.lightweightProviderId as ProviderId].models[0].id
        : '';
  }
}

/**
 * Ensure providersConfig includes all built-in providers and their latest models.
 * Called on every rehydrate (not just version migrations) so new providers
 * added in code are always picked up without clearing cache.
 */
function ensureBuiltInProviders(state: Partial<SettingsState>): void {
  if (!state.providersConfig) return;
  const defaultConfig = getDefaultProvidersConfig();
  const deletedBuiltInProviderIds = new Set(
    getNormalizedDeletedBuiltInProviderIds(state.deletedBuiltInProviderIds),
  );
  Object.keys(PROVIDERS).forEach((pid) => {
    const providerId = pid as ProviderId;
    if (deletedBuiltInProviderIds.has(providerId)) return;
    if (!state.providersConfig![providerId]) {
      // New provider: add with defaults
      state.providersConfig![providerId] = defaultConfig[providerId];
    } else {
      // Existing provider: merge new models & metadata
      const provider = PROVIDERS[providerId];
      const existing = state.providersConfig![providerId];
      const hasPersistedModelList = Array.isArray(existing.models);

      state.providersConfig![providerId] = {
        ...existing,
        models: hasPersistedModelList ? existing.models : provider.models,
        name: existing.name || provider.name,
        type: existing.type || provider.type,
        defaultBaseUrl: existing.defaultBaseUrl || provider.defaultBaseUrl,
        icon: provider.icon || existing.icon,
        requiresApiKey: existing.requiresApiKey ?? provider.requiresApiKey,
        isBuiltIn: existing.isBuiltIn ?? true,
      };
    }
  });
}

function ensureBuiltInLightweightProviders(state: Partial<SettingsState>): void {
  if (!state.lightweightProvidersConfig) return;
  removeUnsupportedLightweightProviders(state);
  const defaultConfig = getDefaultLightweightProvidersConfig();
  const deletedBuiltInProviderIds = new Set(
    getNormalizedDeletedBuiltInProviderIds(state.deletedBuiltInLightweightProviderIds),
  );
  Object.keys(PROVIDERS).forEach((pid) => {
    const providerId = pid as ProviderId;
    if (!isLightweightProviderAllowed(providerId)) return;
    if (deletedBuiltInProviderIds.has(providerId)) return;
    if (!state.lightweightProvidersConfig![providerId]) {
      state.lightweightProvidersConfig![providerId] = defaultConfig[providerId];
    } else {
      const provider = PROVIDERS[providerId];
      const existing = state.lightweightProvidersConfig![providerId];
      const hasPersistedModelList = Array.isArray(existing.models);

      state.lightweightProvidersConfig![providerId] = {
        ...existing,
        models: hasPersistedModelList ? existing.models : provider.models,
        name: existing.name || provider.name,
        type: existing.type || provider.type,
        defaultBaseUrl: existing.defaultBaseUrl || provider.defaultBaseUrl,
        icon: provider.icon || existing.icon,
        requiresApiKey: existing.requiresApiKey ?? provider.requiresApiKey,
        isBuiltIn: existing.isBuiltIn ?? true,
      };
    }
  });
}

function ensureBuiltInAudioProviders(state: Partial<SettingsState>): void {
  const defaultAudioConfig = getDefaultAudioConfig();

  if (state.ttsProvidersConfig) {
    const deletedIds = new Set(
      getNormalizedProviderIds<TTSProviderId>(state.deletedBuiltInTTSProviderIds, TTS_PROVIDERS),
    );
    Object.keys(TTS_PROVIDERS).forEach((pid) => {
      const providerId = pid as TTSProviderId;
      if (deletedIds.has(providerId)) return;
      if (!state.ttsProvidersConfig![providerId]) {
        state.ttsProvidersConfig![providerId] = defaultAudioConfig.ttsProvidersConfig[
          providerId
        ] || {
          apiKey: '',
          baseUrl: '',
          enabled: providerId === 'browser-native-tts',
          modelId: TTS_PROVIDERS[providerId]?.defaultModelId || undefined,
        };
      }
    });
  }

  if (state.asrProvidersConfig) {
    delete (state.asrProvidersConfig as Record<string, unknown>)['doubao-asr'];
    const deletedIds = new Set(
      getNormalizedProviderIds<ASRProviderId>(state.deletedBuiltInASRProviderIds, ASR_PROVIDERS),
    );
    Object.keys(ASR_PROVIDERS).forEach((pid) => {
      const providerId = pid as ASRProviderId;
      if (deletedIds.has(providerId)) return;
      if (!state.asrProvidersConfig![providerId]) {
        state.asrProvidersConfig![providerId] = defaultAudioConfig.asrProvidersConfig[
          providerId
        ] || {
          apiKey: '',
          baseUrl: '',
          enabled: providerId === 'browser-native',
          modelId: ASR_PROVIDERS[providerId]?.defaultModelId || undefined,
        };
      }
    });
  }
}

function ensureBuiltInPDFProviders(state: Partial<SettingsState>): void {
  const defaultConfig = getDefaultPDFConfig().pdfProvidersConfig;
  const persistedMinerU = state.pdfProvidersConfig?.['mineru-local'];

  state.pdfProviderId = 'mineru-local' as PDFProviderId;
  state.deletedBuiltInPDFProviderIds = [];
  state.pdfProvidersConfig = {
    'mineru-local': {
      ...defaultConfig['mineru-local'],
      ...persistedMinerU,
      baseUrl: persistedMinerU?.baseUrl || defaultConfig['mineru-local'].baseUrl || '',
      enabled: true,
    },
  } as SettingsState['pdfProvidersConfig'];
}

function ensureBuiltInVectorProviders(state: Partial<SettingsState>): void {
  if (!state.vectorProvidersConfig) return;
  const defaultConfig = getDefaultVectorConfig().vectorProvidersConfig;
  const record = state.vectorProvidersConfig as Record<
    string,
    ManagedServiceProviderConfig<VectorProviderId>
  >;
  const oldLocalConfig = record['chinese-xinhua-local'];
  if (oldLocalConfig) {
    const {
      name: _retiredLocalName,
      icon: _retiredLocalIcon,
      ...oldLocalConfigWithoutBranding
    } = oldLocalConfig;
    record.siliconflow = {
      ...record.siliconflow,
      ...oldLocalConfigWithoutBranding,
      modelId: LOCAL_BGE_BASE_ZH_MODEL_ID,
      baseUrl: oldLocalConfig.baseUrl || record.siliconflow?.baseUrl || 'http://localhost:50003',
      requiresApiKey: false,
      compatibleProviderId: 'siliconflow' as VectorProviderId,
    };
    delete record['chinese-xinhua-local'];
  }
  const oldSiliconFlowConfig = record['siliconflow-embedding'];
  if (oldSiliconFlowConfig) {
    record.siliconflow = {
      ...oldSiliconFlowConfig,
      ...record.siliconflow,
      modelId:
        record.siliconflow?.modelId || oldSiliconFlowConfig.modelId || LOCAL_BGE_BASE_ZH_MODEL_ID,
    };
    delete record['siliconflow-embedding'];
  }
  if (
    state.vectorProviderId === 'siliconflow-embedding' ||
    state.vectorProviderId === 'chinese-xinhua-local'
  ) {
    state.vectorProviderId = 'siliconflow' as VectorProviderId;
  }
  const deletedIds = new Set(
    getNormalizedProviderIds<VectorProviderId>(state.deletedBuiltInVectorProviderIds, {
      ...VECTOR_PROVIDERS,
      'siliconflow-embedding': VECTOR_PROVIDERS.siliconflow,
      'chinese-xinhua-local': VECTOR_PROVIDERS.siliconflow,
    }).map((id) => normalizeVectorProviderId(id)),
  );
  Object.keys(VECTOR_PROVIDERS).forEach((pid) => {
    const providerId = pid as VectorProviderId;
    if (deletedIds.has(providerId)) return;
    if (!state.vectorProvidersConfig![providerId]) {
      state.vectorProvidersConfig![providerId] = defaultConfig[providerId] || {
        apiKey: '',
        baseUrl: '',
        enabled: providerId === 'siliconflow',
        modelId: VECTOR_PROVIDERS[providerId]?.defaultModelId || undefined,
      };
    }
  });
  const siliconflow = state.vectorProvidersConfig.siliconflow;
  if (siliconflow) {
    scrubRetiredChineseXinhuaVectorBranding(siliconflow);
    siliconflow.compatibleProviderId = 'siliconflow' as VectorProviderId;
    siliconflow.modelId = siliconflow.modelId || LOCAL_BGE_BASE_ZH_MODEL_ID;
    if (siliconflow.modelId === LOCAL_BGE_BASE_ZH_MODEL_ID) {
      siliconflow.baseUrl = siliconflow.baseUrl || 'http://localhost:50003';
      siliconflow.requiresApiKey = false;
      siliconflow.enabled = true;
    }
  }
}

function normalizeVectorProviderState(
  state: Pick<
    SettingsState,
    'vectorProviderId' | 'vectorProvidersConfig' | 'deletedBuiltInVectorProviderIds'
  >,
): Pick<
  SettingsState,
  'vectorProviderId' | 'vectorProvidersConfig' | 'deletedBuiltInVectorProviderIds'
> {
  const nextState = {
    vectorProviderId: state.vectorProviderId,
    vectorProvidersConfig: { ...state.vectorProvidersConfig },
    deletedBuiltInVectorProviderIds: [...state.deletedBuiltInVectorProviderIds],
  };
  ensureBuiltInVectorProviders(nextState);
  return nextState;
}

function ensureBuiltInWebSearchProviders(state: Partial<SettingsState>): void {
  if (!state.webSearchProvidersConfig) return;
  const defaultConfig = getDefaultWebSearchConfig().webSearchProvidersConfig;
  const deletedIds = new Set(
    getNormalizedProviderIds<WebSearchProviderId>(
      state.deletedBuiltInWebSearchProviderIds,
      WEB_SEARCH_PROVIDERS,
    ),
  );
  Object.keys(WEB_SEARCH_PROVIDERS).forEach((pid) => {
    const providerId = pid as WebSearchProviderId;
    if (deletedIds.has(providerId)) return;
    if (!state.webSearchProvidersConfig![providerId]) {
      state.webSearchProvidersConfig![providerId] = defaultConfig[providerId];
    }
  });
}

// Migrate from old localStorage format
const migrateFromOldStorage = () => {
  if (typeof window === 'undefined') return null;

  // Check if new storage already exists
  const newStorage = localStorage.getItem('settings-storage');
  if (newStorage) return null; // Already migrated or new install

  // Read old localStorage keys
  const oldLlmModel = localStorage.getItem('llmModel');
  const oldProvidersConfig = localStorage.getItem('providersConfig');
  const oldTtsModel = localStorage.getItem('ttsModel');
  const oldSelectedAgents = localStorage.getItem('selectedAgentIds');
  const oldMaxTurns = localStorage.getItem('maxTurns');

  if (!oldLlmModel && !oldProvidersConfig) return null; // No old data

  // Parse model selection
  let providerId: ProviderId = 'openai';
  let modelId = 'gpt-4o-mini';
  if (oldLlmModel) {
    const [pid, mid] = oldLlmModel.split(':');
    if (pid && mid) {
      providerId = pid as ProviderId;
      modelId = mid;
    }
  }

  // Parse providers config
  let providersConfig = getDefaultProvidersConfig();
  if (oldProvidersConfig) {
    try {
      const parsed = JSON.parse(oldProvidersConfig);
      providersConfig = { ...providersConfig, ...parsed };
    } catch (e) {
      log.error('Failed to parse old providersConfig:', e);
    }
  }

  // Parse other settings
  let ttsModel = 'openai-tts';
  if (oldTtsModel) ttsModel = oldTtsModel;

  let selectedAgentIds = ['default-1', 'default-2', 'default-3'];
  if (oldSelectedAgents) {
    try {
      const parsed = JSON.parse(oldSelectedAgents);
      if (Array.isArray(parsed) && parsed.length > 0) {
        selectedAgentIds = parsed;
      }
    } catch (e) {
      log.error('Failed to parse old selectedAgentIds:', e);
    }
  }

  let maxTurns = '10';
  if (oldMaxTurns) maxTurns = oldMaxTurns;

  return {
    providerId,
    modelId,
    providersConfig,
    ttsModel,
    selectedAgentIds,
    maxTurns,
  };
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => {
      // Try to migrate from old storage
      const migratedData = migrateFromOldStorage();
      const defaultAudioConfig = getDefaultAudioConfig();
      const defaultPDFConfig = getDefaultPDFConfig();
      const defaultVectorConfig = getDefaultVectorConfig();
      const defaultWebSearchConfig = getDefaultWebSearchConfig();
      const initialLightweightProviderId = getInitialLightweightProviderId(
        migratedData?.providerId,
      );

      return {
        secretsHydrated: false,
        secretMigrationError: null,
        // Initial state (use migrated data if available)
        providerId: migratedData?.providerId || 'openai',
        modelId: migratedData?.modelId || '',
        lightweightProviderId: initialLightweightProviderId,
        lightweightModelId:
          initialLightweightProviderId === migratedData?.providerId
            ? migratedData?.modelId || ''
            : '',
        providersConfig: migratedData?.providersConfig || getDefaultProvidersConfig(),
        lightweightProvidersConfig: getLightweightProvidersConfig(migratedData?.providersConfig),
        deletedBuiltInProviderIds: [],
        deletedBuiltInLightweightProviderIds: [],
        deletedBuiltInTTSProviderIds: [],
        deletedBuiltInASRProviderIds: [],
        deletedBuiltInPDFProviderIds: [],
        deletedBuiltInVectorProviderIds: [],
        deletedBuiltInWebSearchProviderIds: [],
        ttsModel: migratedData?.ttsModel || 'openai-tts',
        selectedAgentIds: migratedData?.selectedAgentIds || ['default-1', 'default-2', 'default-3'],
        maxTurns: migratedData?.maxTurns?.toString() || '10',
        agentMode: 'preset' as const,
        autoAgentCount: 3,
        agentGenerationModelProfile: 'lightweight' as const,

        // Slide generation settings
        slideLayoutReviewEnabled: false,

        // Playback controls
        ttsMuted: false,
        ttsVolume: 1,
        autoPlayLecture: false,
        playbackSpeed: 1,

        // Layout preferences
        sidebarCollapsed: true,
        chatAreaCollapsed: true,
        chatAreaWidth: 320,

        // Audio settings (use defaults)
        ...defaultAudioConfig,

        // PDF settings (use defaults)
        ...defaultPDFConfig,

        // Vector settings (use defaults)
        ...defaultVectorConfig,

        // Audio feature toggles (on by default)
        ttsEnabled: true,
        asrEnabled: true,

        autoConfigApplied: false,

        // Web Search settings (use defaults)
        ...defaultWebSearchConfig,

        // Actions
        setModel: (providerId, modelId) => set({ providerId, modelId }),
        setLightweightModel: (lightweightProviderId, lightweightModelId) =>
          set({ lightweightProviderId, lightweightModelId }),

        setProviderConfig: (providerId, config) =>
          set((state) => ({
            providersConfig: {
              ...state.providersConfig,
              [providerId]: {
                ...state.providersConfig[providerId],
                ...config,
              },
            },
          })),

        setProvidersConfig: (config) =>
          set((state) => ({
            providersConfig: config,
            deletedBuiltInProviderIds: getDeletedBuiltInProviderIds(
              config,
              state.deletedBuiltInProviderIds,
            ),
          })),

        setLightweightProviderConfig: (providerId, config) =>
          set((state) => ({
            lightweightProvidersConfig: {
              ...state.lightweightProvidersConfig,
              [providerId]: {
                ...state.lightweightProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        setLightweightProvidersConfig: (config) =>
          set((state) => ({
            lightweightProvidersConfig: config,
            deletedBuiltInLightweightProviderIds: getDeletedBuiltInProviderIds(
              config,
              state.deletedBuiltInLightweightProviderIds,
            ),
          })),

        setTtsModel: (model) => set({ ttsModel: model }),

        setTTSMuted: (muted) => set({ ttsMuted: muted }),

        setTTSVolume: (volume) => set({ ttsVolume: Math.max(0, Math.min(1, volume)) }),

        setAutoPlayLecture: (autoPlay) => set({ autoPlayLecture: autoPlay }),

        setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

        setSelectedAgentIds: (ids) => set({ selectedAgentIds: ids }),

        setMaxTurns: (turns) => set({ maxTurns: turns }),
        setAgentMode: (mode) => set({ agentMode: mode }),
        setAutoAgentCount: (count) => set({ autoAgentCount: count }),
        setAgentGenerationModelProfile: (agentGenerationModelProfile) =>
          set({ agentGenerationModelProfile }),
        setSlideLayoutReviewEnabled: (slideLayoutReviewEnabled) =>
          set({ slideLayoutReviewEnabled }),

        // Layout actions
        setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
        setChatAreaCollapsed: (collapsed) => set({ chatAreaCollapsed: collapsed }),
        setChatAreaWidth: (width) => set({ chatAreaWidth: width }),

        // Audio actions
        setTTSProvider: (providerId) =>
          set((state) => {
            // If switching provider, set default voice for that provider
            const shouldUpdateVoice = state.ttsProviderId !== providerId;
            const compatibleProviderId = getCompatibleProviderId(
              state.ttsProvidersConfig,
              providerId,
            );
            return {
              ttsProviderId: providerId,
              ...(shouldUpdateVoice && {
                ttsVoice: compatibleProviderId
                  ? getDefaultTTSVoice(
                      compatibleProviderId,
                      state.ttsProvidersConfig[providerId]?.modelId ||
                        TTS_PROVIDERS[compatibleProviderId]?.defaultModelId,
                    )
                  : 'default',
              }),
            };
          }),

        setTTSVoice: (voice) => set({ ttsVoice: voice }),

        setTTSSpeed: (speed) => set({ ttsSpeed: speed }),

        // Reset language when switching providers, since language code formats differ
        // (e.g. browser-native uses BCP-47 "en-US", OpenAI Whisper uses ISO 639-1 "en")
        setASRProvider: (providerId) =>
          set((state) => {
            const compatibleProviderId = getCompatibleProviderId(
              state.asrProvidersConfig,
              providerId,
            );
            const supportedLanguages = compatibleProviderId
              ? ASR_PROVIDERS[compatibleProviderId]?.supportedLanguages || []
              : [];
            const isLanguageValid = supportedLanguages.includes(state.asrLanguage);
            return {
              asrProviderId: providerId,
              ...(isLanguageValid ? {} : { asrLanguage: supportedLanguages[0] || 'auto' }),
            };
          }),

        setASRLanguage: (language) => set({ asrLanguage: language }),

        setTTSProviderConfig: (providerId, config) =>
          set((state) => ({
            ttsProvidersConfig: {
              ...state.ttsProvidersConfig,
              [providerId]: {
                ...state.ttsProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        deleteTTSProvider: (providerId) =>
          set((state) => {
            const nextConfig = { ...state.ttsProvidersConfig };
            delete nextConfig[providerId];
            return {
              ttsProvidersConfig: nextConfig as SettingsState['ttsProvidersConfig'],
              deletedBuiltInTTSProviderIds: getDeletedBuiltInIds(
                nextConfig,
                TTS_PROVIDERS,
                state.deletedBuiltInTTSProviderIds,
              ),
            };
          }),

        restoreTTSProvider: (providerId) =>
          set((state) => {
            const defaultConfig = getDefaultAudioConfig().ttsProvidersConfig[providerId] || {
              apiKey: '',
              baseUrl: '',
              enabled: providerId === 'browser-native-tts',
              modelId: TTS_PROVIDERS[providerId]?.defaultModelId || undefined,
            };
            return {
              ttsProvidersConfig: {
                ...state.ttsProvidersConfig,
                [providerId]: defaultConfig,
              },
              deletedBuiltInTTSProviderIds: state.deletedBuiltInTTSProviderIds.filter(
                (id) => id !== providerId,
              ),
            };
          }),

        setASRProviderConfig: (providerId, config) =>
          set((state) => ({
            asrProvidersConfig: {
              ...state.asrProvidersConfig,
              [providerId]: {
                ...state.asrProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        deleteASRProvider: (providerId) =>
          set((state) => {
            const nextConfig = { ...state.asrProvidersConfig };
            delete nextConfig[providerId];
            return {
              asrProvidersConfig: nextConfig as SettingsState['asrProvidersConfig'],
              deletedBuiltInASRProviderIds: getDeletedBuiltInIds(
                nextConfig,
                ASR_PROVIDERS,
                state.deletedBuiltInASRProviderIds,
              ),
            };
          }),

        restoreASRProvider: (providerId) =>
          set((state) => {
            const defaultConfig = getDefaultAudioConfig().asrProvidersConfig[providerId] || {
              apiKey: '',
              baseUrl: '',
              enabled: providerId === 'browser-native',
              modelId: ASR_PROVIDERS[providerId]?.defaultModelId || undefined,
            };
            return {
              asrProvidersConfig: {
                ...state.asrProvidersConfig,
                [providerId]: defaultConfig,
              },
              deletedBuiltInASRProviderIds: state.deletedBuiltInASRProviderIds.filter(
                (id) => id !== providerId,
              ),
            };
          }),

        // PDF actions
        setPDFProvider: (providerId) => set({ pdfProviderId: providerId }),

        setPDFProviderConfig: (providerId, config) =>
          set((state) => ({
            pdfProvidersConfig: {
              ...state.pdfProvidersConfig,
              [providerId]: {
                ...state.pdfProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        deletePDFProvider: (providerId) =>
          set((state) => {
            const nextConfig: Partial<SettingsState['pdfProvidersConfig']> = {
              ...state.pdfProvidersConfig,
            };
            delete nextConfig[providerId];
            return {
              pdfProvidersConfig: nextConfig as SettingsState['pdfProvidersConfig'],
              deletedBuiltInPDFProviderIds: getDeletedBuiltInIds(
                nextConfig,
                PDF_PROVIDERS,
                state.deletedBuiltInPDFProviderIds,
              ),
            };
          }),

        restorePDFProvider: (providerId) =>
          set((state) => ({
            pdfProvidersConfig: {
              ...state.pdfProvidersConfig,
              [providerId]: getDefaultPDFConfig().pdfProvidersConfig[providerId],
            },
            deletedBuiltInPDFProviderIds: state.deletedBuiltInPDFProviderIds.filter(
              (id) => id !== providerId,
            ),
          })),

        // Vector actions
        setVectorProvider: (providerId) =>
          set((state) =>
            normalizeVectorProviderState({
              vectorProviderId: normalizeVectorProviderId(providerId) as VectorProviderId,
              vectorProvidersConfig: state.vectorProvidersConfig,
              deletedBuiltInVectorProviderIds: state.deletedBuiltInVectorProviderIds,
            }),
          ),

        setVectorProviderConfig: (providerId, config) =>
          set((state) => {
            const normalizedProviderId = normalizeVectorProviderId(providerId) as VectorProviderId;
            return normalizeVectorProviderState({
              vectorProviderId:
                state.vectorProviderId === providerId
                  ? normalizedProviderId
                  : state.vectorProviderId,
              vectorProvidersConfig: {
                ...state.vectorProvidersConfig,
                [normalizedProviderId]: {
                  ...state.vectorProvidersConfig[providerId],
                  ...state.vectorProvidersConfig[normalizedProviderId],
                  ...config,
                  compatibleProviderId: normalizedProviderId,
                },
              },
              deletedBuiltInVectorProviderIds: state.deletedBuiltInVectorProviderIds,
            });
          }),

        deleteVectorProvider: (providerId) =>
          set((state) => {
            const normalizedProviderId = normalizeVectorProviderId(providerId) as VectorProviderId;
            const nextConfig: Partial<SettingsState['vectorProvidersConfig']> = {
              ...state.vectorProvidersConfig,
            };
            delete nextConfig[providerId];
            delete nextConfig[normalizedProviderId];
            const normalizedState = normalizeVectorProviderState({
              vectorProviderId:
                state.vectorProviderId === providerId ||
                state.vectorProviderId === normalizedProviderId
                  ? ('' as VectorProviderId)
                  : state.vectorProviderId,
              vectorProvidersConfig: nextConfig as SettingsState['vectorProvidersConfig'],
              deletedBuiltInVectorProviderIds: getDeletedBuiltInIds(
                nextConfig,
                VECTOR_PROVIDERS,
                state.deletedBuiltInVectorProviderIds,
              ),
            });
            return normalizedState;
          }),

        restoreVectorProvider: (providerId) =>
          set((state) => {
            const normalizedProviderId = normalizeVectorProviderId(providerId) as VectorProviderId;
            const defaultConfig = getDefaultVectorConfig().vectorProvidersConfig[
              normalizedProviderId
            ] || {
              apiKey: '',
              baseUrl: '',
              enabled: normalizedProviderId === 'siliconflow',
              modelId: VECTOR_PROVIDERS[normalizedProviderId]?.defaultModelId || undefined,
            };
            return normalizeVectorProviderState({
              vectorProviderId: state.vectorProviderId || normalizedProviderId,
              vectorProvidersConfig: {
                ...state.vectorProvidersConfig,
                [normalizedProviderId]: defaultConfig,
              },
              deletedBuiltInVectorProviderIds: state.deletedBuiltInVectorProviderIds.filter(
                (id) => normalizeVectorProviderId(id) !== normalizedProviderId,
              ),
            });
          }),

        setTTSEnabled: (enabled) => set({ ttsEnabled: enabled }),
        setASREnabled: (enabled) => set({ asrEnabled: enabled }),

        // Web Search actions
        setWebSearchProvider: (providerId) => set({ webSearchProviderId: providerId }),
        setWebSearchProviderConfig: (providerId, config) =>
          set((state) => ({
            webSearchProvidersConfig: {
              ...state.webSearchProvidersConfig,
              [providerId]: {
                ...state.webSearchProvidersConfig[providerId],
                ...config,
              },
            },
          })),

        deleteWebSearchProvider: (providerId) =>
          set((state) => {
            const nextConfig: Partial<SettingsState['webSearchProvidersConfig']> = {
              ...state.webSearchProvidersConfig,
            };
            delete nextConfig[providerId];
            return {
              webSearchProvidersConfig: nextConfig as SettingsState['webSearchProvidersConfig'],
              deletedBuiltInWebSearchProviderIds: getDeletedBuiltInIds(
                nextConfig,
                WEB_SEARCH_PROVIDERS,
                state.deletedBuiltInWebSearchProviderIds,
              ),
            };
          }),

        restoreWebSearchProvider: (providerId) =>
          set((state) => ({
            webSearchProvidersConfig: {
              ...state.webSearchProvidersConfig,
              [providerId]: getDefaultWebSearchConfig().webSearchProvidersConfig[providerId],
            },
            deletedBuiltInWebSearchProviderIds: state.deletedBuiltInWebSearchProviderIds.filter(
              (id) => id !== providerId,
            ),
          })),

        // Fetch server-configured providers and merge into local state
        fetchServerProviders: async () => {
          try {
            const res = await fetch('/api/server-providers');
            if (!res.ok) return;
            const data = (await res.json()) as {
              providers: Record<string, { models?: string[]; baseUrl?: string }>;
              tts: Record<string, { baseUrl?: string }>;
              asr: Record<string, { baseUrl?: string }>;
              pdf: Record<string, { baseUrl?: string }>;
              vector?: Record<string, { models?: string[]; baseUrl?: string }>;
              webSearch: Record<string, { baseUrl?: string }>;
            };

            set((state) => {
              // Merge LLM providers
              const newProvidersConfig = { ...state.providersConfig };
              // First reset all server flags
              for (const pid of Object.keys(newProvidersConfig)) {
                const key = pid as ProviderId;
                if (newProvidersConfig[key]) {
                  newProvidersConfig[key] = {
                    ...newProvidersConfig[key],
                    isServerConfigured: false,
                    serverModels: undefined,
                    serverBaseUrl: undefined,
                  };
                }
              }
              // Set flags for server-configured providers
              for (const [pid, info] of Object.entries(data.providers)) {
                const key = pid as ProviderId;
                if (newProvidersConfig[key]) {
                  const currentModels = newProvidersConfig[key].models;
                  // When server specifies allowed models, filter the models list
                  const filteredModels = info.models?.length
                    ? currentModels.filter((m) => info.models!.includes(m.id))
                    : currentModels;
                  newProvidersConfig[key] = {
                    ...newProvidersConfig[key],
                    isServerConfigured: true,
                    serverModels: info.models,
                    serverBaseUrl: info.baseUrl,
                    models: filteredModels,
                  };
                }
              }

              // Merge lightweight LLM providers separately from advanced LLM providers.
              const newLightweightProvidersConfig = getLightweightProvidersConfig(
                state.lightweightProvidersConfig,
              );
              for (const pid of Object.keys(newLightweightProvidersConfig)) {
                const key = pid as ProviderId;
                if (newLightweightProvidersConfig[key]) {
                  newLightweightProvidersConfig[key] = {
                    ...newLightweightProvidersConfig[key],
                    isServerConfigured: false,
                    serverModels: undefined,
                    serverBaseUrl: undefined,
                  };
                }
              }
              for (const [pid, info] of Object.entries(data.providers)) {
                if (!isLightweightProviderAllowed(pid)) continue;
                const key = pid as ProviderId;
                if (newLightweightProvidersConfig[key]) {
                  const currentModels = newLightweightProvidersConfig[key].models;
                  const filteredModels = info.models?.length
                    ? currentModels.filter((m) => info.models!.includes(m.id))
                    : currentModels;
                  newLightweightProvidersConfig[key] = {
                    ...newLightweightProvidersConfig[key],
                    isServerConfigured: true,
                    serverModels: info.models,
                    serverBaseUrl: info.baseUrl,
                    models: filteredModels,
                  };
                }
              }

              // Merge TTS providers
              const newTTSConfig = { ...state.ttsProvidersConfig };
              for (const pid of Object.keys(newTTSConfig)) {
                const key = pid as TTSProviderId;
                if (newTTSConfig[key]) {
                  newTTSConfig[key] = {
                    ...newTTSConfig[key],
                    isServerConfigured: false,
                    serverBaseUrl: undefined,
                  };
                }
              }
              for (const [pid, info] of Object.entries(data.tts)) {
                const key = pid as TTSProviderId;
                if (newTTSConfig[key]) {
                  newTTSConfig[key] = {
                    ...newTTSConfig[key],
                    isServerConfigured: true,
                    serverBaseUrl: info.baseUrl,
                  };
                }
              }

              // Merge ASR providers
              const newASRConfig = { ...state.asrProvidersConfig };
              for (const pid of Object.keys(newASRConfig)) {
                const key = pid as ASRProviderId;
                if (newASRConfig[key]) {
                  newASRConfig[key] = {
                    ...newASRConfig[key],
                    isServerConfigured: false,
                    serverBaseUrl: undefined,
                  };
                }
              }
              for (const [pid, info] of Object.entries(data.asr)) {
                const key = pid as ASRProviderId;
                if (newASRConfig[key]) {
                  newASRConfig[key] = {
                    ...newASRConfig[key],
                    isServerConfigured: true,
                    serverBaseUrl: info.baseUrl,
                  };
                }
              }

              // Merge PDF providers
              const newPDFConfig = { ...state.pdfProvidersConfig };
              for (const pid of Object.keys(newPDFConfig)) {
                const key = pid as PDFProviderId;
                if (newPDFConfig[key]) {
                  newPDFConfig[key] = {
                    ...newPDFConfig[key],
                    isServerConfigured: false,
                    serverBaseUrl: undefined,
                  };
                }
              }
              for (const [pid, info] of Object.entries(data.pdf)) {
                const key = pid as PDFProviderId;
                if (newPDFConfig[key]) {
                  newPDFConfig[key] = {
                    ...newPDFConfig[key],
                    isServerConfigured: true,
                    serverBaseUrl: info.baseUrl,
                  };
                }
              }

              // Merge Web Search config — reset all first, then mark server-configured
              // Merge Vector providers
              const newVectorConfig = { ...state.vectorProvidersConfig };
              const oldLocalVectorConfig = (
                newVectorConfig as Record<string, ManagedServiceProviderConfig<VectorProviderId>>
              )['chinese-xinhua-local'];
              if (oldLocalVectorConfig) {
                const {
                  name: _retiredLocalName,
                  icon: _retiredLocalIcon,
                  ...oldLocalVectorConfigWithoutBranding
                } = oldLocalVectorConfig;
                newVectorConfig.siliconflow = {
                  ...newVectorConfig.siliconflow,
                  ...oldLocalVectorConfigWithoutBranding,
                  modelId: LOCAL_BGE_BASE_ZH_MODEL_ID,
                  baseUrl:
                    oldLocalVectorConfig.baseUrl ||
                    newVectorConfig.siliconflow?.baseUrl ||
                    'http://localhost:50003',
                  requiresApiKey: false,
                  compatibleProviderId: 'siliconflow' as VectorProviderId,
                };
                delete (
                  newVectorConfig as Record<string, ManagedServiceProviderConfig<VectorProviderId>>
                )['chinese-xinhua-local'];
              }
              const oldSiliconFlowConfig = (
                newVectorConfig as Record<string, ManagedServiceProviderConfig<VectorProviderId>>
              )['siliconflow-embedding'];
              if (oldSiliconFlowConfig) {
                newVectorConfig.siliconflow = {
                  ...oldSiliconFlowConfig,
                  ...newVectorConfig.siliconflow,
                  modelId:
                    newVectorConfig.siliconflow?.modelId ||
                    oldSiliconFlowConfig.modelId ||
                    LOCAL_BGE_BASE_ZH_MODEL_ID,
                };
                delete (
                  newVectorConfig as Record<string, ManagedServiceProviderConfig<VectorProviderId>>
                )['siliconflow-embedding'];
              }
              for (const pid of Object.keys(newVectorConfig)) {
                const key = pid as VectorProviderId;
                if (newVectorConfig[key]) {
                  newVectorConfig[key] = {
                    ...newVectorConfig[key],
                    isServerConfigured: false,
                    serverBaseUrl: undefined,
                  };
                }
              }
              scrubRetiredChineseXinhuaVectorBranding(newVectorConfig.siliconflow);
              if (data.vector) {
                for (const [pid, info] of Object.entries(data.vector)) {
                  const key = normalizeVectorProviderId(
                    pid as VectorProviderId,
                  ) as VectorProviderId;
                  if (newVectorConfig[key]) {
                    newVectorConfig[key] = {
                      ...newVectorConfig[key],
                      isServerConfigured: true,
                      serverBaseUrl: info.baseUrl,
                      ...(info.models?.length
                        ? { models: info.models.map((id) => ({ id, name: id })) }
                        : {}),
                    };
                  }
                }
              }

              const newWebSearchConfig = { ...state.webSearchProvidersConfig };
              for (const key of Object.keys(newWebSearchConfig) as WebSearchProviderId[]) {
                newWebSearchConfig[key] = {
                  ...newWebSearchConfig[key],
                  isServerConfigured: false,
                  serverBaseUrl: undefined,
                };
              }
              if (data.webSearch) {
                for (const [pid, info] of Object.entries(data.webSearch)) {
                  const key = pid as WebSearchProviderId;
                  if (newWebSearchConfig[key]) {
                    newWebSearchConfig[key] = {
                      ...newWebSearchConfig[key],
                      isServerConfigured: true,
                      serverBaseUrl: info.baseUrl,
                    };
                  }
                }
              }

              // === Validate current selections against updated configs ===
              // Build fallback: server-configured first, then client-key-only
              const buildFallback = <T extends string>(
                config: Record<
                  string,
                  {
                    isServerConfigured?: boolean;
                    apiKey?: string;
                    baseUrl?: string;
                    serverBaseUrl?: string;
                  }
                >,
                options: { allowBaseUrl?: boolean } = {},
              ): T[] => [
                ...Object.entries(config)
                  .filter(
                    ([, c]) =>
                      c.isServerConfigured ||
                      (options.allowBaseUrl && (!!c.baseUrl || !!c.serverBaseUrl)),
                  )
                  .map(([id]) => id as T),
                ...Object.entries(config)
                  .filter(
                    ([, c]) =>
                      !c.isServerConfigured &&
                      !(options.allowBaseUrl && (!!c.baseUrl || !!c.serverBaseUrl)) &&
                      !!c.apiKey,
                  )
                  .map(([id]) => id as T),
              ];

              const llmFallback = buildFallback<ProviderId>(newProvidersConfig);
              const lightweightFallback = buildFallback<ProviderId>(newLightweightProvidersConfig);
              const ttsFallback = buildFallback<TTSProviderId>(newTTSConfig);
              const asrFallback = buildFallback<ASRProviderId>(newASRConfig);
              const pdfFallback = buildFallback<PDFProviderId>(newPDFConfig, {
                allowBaseUrl: true,
              });
              const vectorFallback = buildFallback<VectorProviderId>(newVectorConfig, {
                allowBaseUrl: true,
              });

              const validLLMProvider = validateProvider(
                state.providerId,
                newProvidersConfig,
                llmFallback,
              );
              const currentLightweightProvider = state.lightweightProviderId || state.providerId;
              const validLightweightProvider = validateProvider(
                currentLightweightProvider,
                newLightweightProvidersConfig,
                lightweightFallback,
              );
              const validTTSProvider = validateProvider(
                state.ttsProviderId,
                newTTSConfig,
                ttsFallback,
                newTTSConfig['browser-native-tts']
                  ? ('browser-native-tts' as TTSProviderId)
                  : undefined,
              );
              const validASRProvider = validateProvider(
                state.asrProviderId,
                newASRConfig,
                asrFallback,
                newASRConfig['browser-native'] ? ('browser-native' as ASRProviderId) : undefined,
              );
              const currentPdfConfig = newPDFConfig[state.pdfProviderId as PDFProviderId];
              const currentPdfUsable =
                !!currentPdfConfig &&
                (!!currentPdfConfig.isServerConfigured ||
                  !!currentPdfConfig.apiKey ||
                  !!currentPdfConfig.baseUrl ||
                  !!currentPdfConfig.serverBaseUrl);
              const validPDFProvider = currentPdfUsable
                ? state.pdfProviderId
                : (pdfFallback[0] ??
                  (newPDFConfig['mineru-local'] ? ('mineru-local' as PDFProviderId) : ''));
              const currentVectorConfig =
                newVectorConfig[state.vectorProviderId as VectorProviderId];
              const currentVectorUsable =
                !!currentVectorConfig &&
                (!!currentVectorConfig.isServerConfigured ||
                  !!currentVectorConfig.apiKey ||
                  !!currentVectorConfig.baseUrl ||
                  !!currentVectorConfig.serverBaseUrl ||
                  currentVectorConfig.requiresApiKey === false);
              const validVectorProvider = currentVectorUsable
                ? state.vectorProviderId
                : (vectorFallback[0] ??
                  (newVectorConfig.siliconflow ? ('siliconflow' as VectorProviderId) : ''));
              const validLLMModel = validLLMProvider
                ? validateModel(
                    state.modelId,
                    newProvidersConfig[validLLMProvider as ProviderId]?.models ?? [],
                  )
                : '';
              const validLightweightModel = validLightweightProvider
                ? validateModel(
                    state.lightweightModelId ||
                      (validLightweightProvider === validLLMProvider ? validLLMModel : ''),
                    newLightweightProvidersConfig[validLightweightProvider as ProviderId]?.models ??
                      [],
                  )
                : '';

              const validTTSCompatibleProvider = getCompatibleProviderId(
                newTTSConfig,
                validTTSProvider as TTSProviderId,
              );
              const validTTSVoice =
                validTTSProvider !== state.ttsProviderId
                  ? validTTSCompatibleProvider
                    ? getDefaultTTSVoice(
                        validTTSCompatibleProvider,
                        newTTSConfig[validTTSProvider as TTSProviderId]?.modelId ||
                          TTS_PROVIDERS[validTTSCompatibleProvider]?.defaultModelId,
                      )
                    : 'default'
                  : state.ttsVoice;

              // === Auto-select / auto-enable (only on first run) ===
              let autoTtsProvider: TTSProviderId | undefined;
              let autoTtsVoice: string | undefined;
              let autoAsrProvider: ASRProviderId | undefined;
              let autoPdfProvider: PDFProviderId | undefined;
              let autoVectorProvider: VectorProviderId | undefined;

              if (!state.autoConfigApplied) {
                // PDF: select MinerU when the local service is server-configured.
                const serverPdfIds = (Object.keys(data.pdf) as PDFProviderId[]).filter(
                  (id) => newPDFConfig[id],
                );
                autoPdfProvider = serverPdfIds.includes('mineru-local' as PDFProviderId)
                  ? ('mineru-local' as PDFProviderId)
                  : undefined;

                // TTS: select first server provider if current is not server-configured
                const serverTtsIds = (Object.keys(data.tts) as TTSProviderId[]).filter(
                  (id) => newTTSConfig[id],
                );
                if (
                  serverTtsIds.length > 0 &&
                  !newTTSConfig[state.ttsProviderId]?.isServerConfigured
                ) {
                  autoTtsProvider = serverTtsIds[0];
                  autoTtsVoice = getDefaultTTSVoice(
                    autoTtsProvider,
                    newTTSConfig[autoTtsProvider]?.modelId ||
                      TTS_PROVIDERS[autoTtsProvider]?.defaultModelId,
                  );
                }

                // ASR: select first server provider if current is not server-configured
                const serverAsrIds = (Object.keys(data.asr) as ASRProviderId[]).filter(
                  (id) => newASRConfig[id],
                );
                if (
                  serverAsrIds.length > 0 &&
                  !newASRConfig[state.asrProviderId]?.isServerConfigured
                ) {
                  autoAsrProvider = serverAsrIds[0];
                }

                if (autoPdfProvider) {
                  newPDFConfig[autoPdfProvider] = {
                    ...newPDFConfig[autoPdfProvider],
                    enabled: true,
                  };
                }

                const serverVectorIds = (Object.keys(data.vector ?? {}) as VectorProviderId[])
                  .map((id) => normalizeVectorProviderId(id) as VectorProviderId)
                  .filter((id) => newVectorConfig[id]);
                autoVectorProvider = serverVectorIds.includes('siliconflow' as VectorProviderId)
                  ? ('siliconflow' as VectorProviderId)
                  : serverVectorIds[0];
              }

              // LLM auto-select: only on true first load (no provider selected yet)
              let autoProviderId: ProviderId | undefined;
              let autoModelId: string | undefined;
              let autoLightweightProviderId: ProviderId | undefined;
              let autoLightweightModelId: string | undefined;
              if (!state.providerId && !state.modelId) {
                for (const [pid, cfg] of Object.entries(newProvidersConfig)) {
                  if (cfg.isServerConfigured) {
                    // Prefer server-restricted models, fall back to built-in list
                    const serverModels = cfg.serverModels;
                    const modelId = serverModels?.length
                      ? serverModels[0]
                      : PROVIDERS[pid as ProviderId]?.models[0]?.id;
                    if (modelId) {
                      autoProviderId = pid as ProviderId;
                      autoModelId = modelId;
                      if (isLightweightProviderAllowed(pid)) {
                        autoLightweightProviderId = pid as ProviderId;
                        autoLightweightModelId = modelId;
                      }
                      break;
                    }
                  }
                }
              }

              return {
                providersConfig: newProvidersConfig,
                lightweightProvidersConfig: newLightweightProvidersConfig,
                ttsProvidersConfig: newTTSConfig,
                asrProvidersConfig: newASRConfig,
                pdfProvidersConfig: newPDFConfig,
                vectorProvidersConfig: newVectorConfig,
                webSearchProvidersConfig: newWebSearchConfig,
                autoConfigApplied: true,
                // Validated selections
                ...(validLLMProvider !== state.providerId && {
                  providerId: validLLMProvider as ProviderId,
                }),
                ...(validLLMModel !== state.modelId && { modelId: validLLMModel }),
                ...(validLightweightProvider !== state.lightweightProviderId && {
                  lightweightProviderId: validLightweightProvider as ProviderId,
                }),
                ...(validLightweightModel !== state.lightweightModelId && {
                  lightweightModelId: validLightweightModel,
                }),
                ...(validTTSProvider !== state.ttsProviderId && {
                  ttsProviderId: validTTSProvider as TTSProviderId,
                  ttsVoice: validTTSVoice,
                }),
                ...(validASRProvider !== state.asrProviderId && {
                  asrProviderId: validASRProvider as ASRProviderId,
                }),
                ...(validPDFProvider !== state.pdfProviderId && {
                  pdfProviderId: validPDFProvider as PDFProviderId,
                }),
                ...(validVectorProvider !== state.vectorProviderId && {
                  vectorProviderId: validVectorProvider as VectorProviderId,
                }),
                // First-run auto-select overrides validation (autoConfigApplied guard).
                // On first sync, auto-select picks the best provider. On subsequent syncs,
                // auto* variables stay undefined so only validation spreads take effect.
                ...(autoTtsProvider && {
                  ttsProviderId: autoTtsProvider,
                  ttsVoice: autoTtsVoice,
                }),
                ...(autoAsrProvider && { asrProviderId: autoAsrProvider }),
                ...(autoPdfProvider && { pdfProviderId: autoPdfProvider }),
                ...(autoVectorProvider && { vectorProviderId: autoVectorProvider }),
                ...(autoProviderId && { providerId: autoProviderId }),
                ...(autoModelId && { modelId: autoModelId }),
                ...(autoLightweightProviderId && {
                  lightweightProviderId: autoLightweightProviderId,
                }),
                ...(autoLightweightModelId && { lightweightModelId: autoLightweightModelId }),
              };
            });
          } catch (e) {
            // Silently fail — server providers are optional
            log.warn('Failed to fetch server providers:', e);
          }
        },
        setSecretHydrationState: (secretsHydrated, secretMigrationError = null) =>
          set({ secretsHydrated, secretMigrationError }),
      };
    },
    {
      name: 'settings-storage',
      version: 3,
      partialize: sanitizePersistedSettings,
      // Migrate persisted state
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Partial<SettingsState>;
        if (state.slideLayoutReviewEnabled === undefined) {
          state.slideLayoutReviewEnabled = false;
        }
        normalizeDeletedBuiltInProviderIds(state);
        normalizeDeletedBuiltInServiceProviderIds(state);

        // v0 → v1: clear hardcoded default model so user must actively select
        if (version === 0) {
          if (state.providerId === 'openai' && state.modelId === 'gpt-4o-mini') {
            state.modelId = '';
          }
        }

        // Ensure providersConfig has all built-in providers (also in merge below)
        ensureBuiltInProviders(state);
        if (!state.lightweightProvidersConfig) {
          state.lightweightProvidersConfig = state.providersConfig
            ? getLightweightProvidersConfig(JSON.parse(JSON.stringify(state.providersConfig)))
            : getDefaultLightweightProvidersConfig();
        }
        removeUnsupportedLightweightProviders(state);
        ensureBuiltInLightweightProviders(state);

        // Ensure provider configs have all built-in providers unless the user deleted them
        ensureBuiltInAudioProviders(state);
        ensureBuiltInPDFProviders(state);
        if (!state.vectorProvidersConfig) {
          const defaultVectorConfig = getDefaultVectorConfig();
          Object.assign(state, defaultVectorConfig);
        }
        ensureBuiltInVectorProviders(state);
        ensureBuiltInWebSearchProviders(state);
        scrubRetiredMediaGenerationSettings(state);
        scrubRetiredAudioCaptureSettings(state);

        // Migrate from old ttsModel to new ttsProviderId
        if (state.ttsModel && !state.ttsProviderId) {
          // Map old ttsModel values to new ttsProviderId
          if (state.ttsModel === 'openai-tts') {
            state.ttsProviderId = 'openai-tts';
          } else if (state.ttsModel === 'azure-tts') {
            state.ttsProviderId = 'azure-tts';
          } else {
            // Default to OpenAI
            state.ttsProviderId = 'openai-tts';
          }
        }

        // Add default audio config if missing
        if (!state.ttsProvidersConfig || !state.asrProvidersConfig) {
          const defaultAudioConfig = getDefaultAudioConfig();
          if (!state.ttsProviderId) state.ttsProviderId = defaultAudioConfig.ttsProviderId;
          if (!state.ttsVoice) state.ttsVoice = defaultAudioConfig.ttsVoice;
          if (state.ttsSpeed === undefined) state.ttsSpeed = defaultAudioConfig.ttsSpeed;
          if (!state.ttsProvidersConfig) {
            state.ttsProvidersConfig = defaultAudioConfig.ttsProvidersConfig;
          }
          if (!state.asrProviderId) state.asrProviderId = defaultAudioConfig.asrProviderId;
          if (!state.asrLanguage) state.asrLanguage = defaultAudioConfig.asrLanguage;
          if (!state.asrProvidersConfig) {
            state.asrProvidersConfig = defaultAudioConfig.asrProvidersConfig;
          }
        }

        // Migrate global ttsModelId to per-provider
        if ((state as Record<string, unknown>).ttsModelId) {
          const pid = state.ttsProviderId;
          if (pid && state.ttsProvidersConfig?.[pid]) {
            state.ttsProvidersConfig[pid].modelId = (state as Record<string, unknown>)
              .ttsModelId as string;
          }
          delete (state as Record<string, unknown>).ttsModelId;
        }
        // Same for asrModelId
        if ((state as Record<string, unknown>).asrModelId) {
          const pid = state.asrProviderId;
          if (pid && state.asrProvidersConfig?.[pid]) {
            state.asrProvidersConfig[pid].modelId = (state as Record<string, unknown>)
              .asrModelId as string;
          }
          delete (state as Record<string, unknown>).asrModelId;
        }
        // Migrate MiniMax's model field to modelId
        for (const [, cfg] of Object.entries(
          (state.ttsProvidersConfig as unknown as Record<string, Record<string, unknown>>) || {},
        )) {
          if (cfg.model && !cfg.modelId) {
            cfg.modelId = cfg.model;
            delete cfg.model;
          }
        }

        // Add default PDF config if missing
        if (!state.pdfProvidersConfig) {
          const defaultPDFConfig = getDefaultPDFConfig();
          Object.assign(state, defaultPDFConfig);
        }

        // Add default Vector config if missing
        if (!state.vectorProvidersConfig) {
          const defaultVectorConfig = getDefaultVectorConfig();
          Object.assign(state, defaultVectorConfig);
        }
        ensureBuiltInVectorProviders(state);

        scrubRetiredMediaGenerationSettings(state);
        scrubRetiredAudioCaptureSettings(state);

        // v1 → v2: Replace deep research with web search
        if (version < 2) {
          delete (state as Record<string, unknown>).deepResearchProviderId;
          delete (state as Record<string, unknown>).deepResearchProvidersConfig;
        }

        // v2 → v3: old builds defaulted every user to auto agent generation,
        // which made ordinary generation wait on role generation.
        if (version < 3 && (state as Record<string, unknown>).agentMode === 'auto') {
          (state as Record<string, unknown>).agentMode = 'preset';
        }

        // Add default audio toggles if missing
        if ((state as Record<string, unknown>).ttsEnabled === undefined) {
          (state as Record<string, unknown>).ttsEnabled = true;
        }
        if ((state as Record<string, unknown>).asrEnabled === undefined) {
          (state as Record<string, unknown>).asrEnabled = true;
        }
        delete (state as Record<string, unknown>).generationAuditsEnabled;

        // Existing users already have their config set up — mark auto-config as done
        if ((state as Record<string, unknown>).autoConfigApplied === undefined) {
          (state as Record<string, unknown>).autoConfigApplied = true;
        }

        if (!(state as Record<string, unknown>).lightweightProviderId) {
          state.lightweightProviderId = state.providerId || ('' as ProviderId);
        }
        if (!(state as Record<string, unknown>).lightweightModelId) {
          state.lightweightModelId = state.modelId || '';
        }

        if ((state as Record<string, unknown>).agentMode === undefined) {
          (state as Record<string, unknown>).agentMode = 'preset';
        }
        if ((state as Record<string, unknown>).autoAgentCount === undefined) {
          (state as Record<string, unknown>).autoAgentCount = 3;
        }
        if ((state as Record<string, unknown>).agentGenerationModelProfile === undefined) {
          (state as Record<string, unknown>).agentGenerationModelProfile = 'lightweight';
        }

        // Migrate Web Search: old flat fields → new provider-based config
        if (!state.webSearchProvidersConfig) {
          const stateRecord = state as Record<string, unknown>;
          const oldApiKey = (stateRecord.webSearchApiKey as string) || '';
          const oldIsServerConfigured =
            (stateRecord.webSearchIsServerConfigured as boolean) || false;
          state.webSearchProviderId = 'tavily' as WebSearchProviderId;
          state.webSearchProvidersConfig = {
            tavily: {
              apiKey: oldApiKey,
              baseUrl: '',
              enabled: true,
              isServerConfigured: oldIsServerConfigured,
            },
          } as SettingsState['webSearchProvidersConfig'];
          delete stateRecord.webSearchApiKey;
          delete stateRecord.webSearchIsServerConfigured;
        }

        ensureValidProviderSelections(state);

        return state;
      },
      // Custom merge: always sync built-in providers on every rehydrate,
      // so newly added providers/models appear without clearing cache.
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as object) };
        normalizeDeletedBuiltInProviderIds(merged as Partial<SettingsState>);
        normalizeDeletedBuiltInServiceProviderIds(merged as Partial<SettingsState>);
        ensureBuiltInProviders(merged as Partial<SettingsState>);
        if (!(merged as Partial<SettingsState>).lightweightProvidersConfig) {
          (merged as Partial<SettingsState>).lightweightProvidersConfig = JSON.parse(
            JSON.stringify(
              getLightweightProvidersConfig((merged as Partial<SettingsState>).providersConfig),
            ),
          );
        }
        removeUnsupportedLightweightProviders(merged as Partial<SettingsState>);
        ensureBuiltInLightweightProviders(merged as Partial<SettingsState>);
        ensureBuiltInAudioProviders(merged as Partial<SettingsState>);
        ensureBuiltInPDFProviders(merged as Partial<SettingsState>);
        if (!(merged as Partial<SettingsState>).vectorProvidersConfig) {
          Object.assign(merged, getDefaultVectorConfig());
        }
        ensureBuiltInVectorProviders(merged as Partial<SettingsState>);
        ensureBuiltInWebSearchProviders(merged as Partial<SettingsState>);
        scrubRetiredMediaGenerationSettings(merged);
        scrubRetiredAudioCaptureSettings(merged);
        delete (merged as Record<string, unknown>).generationAuditsEnabled;
        if ((merged as Record<string, unknown>).agentGenerationModelProfile === undefined) {
          (merged as Record<string, unknown>).agentGenerationModelProfile = 'lightweight';
        }
        ensureValidProviderSelections(merged as Partial<SettingsState>);
        return merged as SettingsState;
      },
    },
  ),
);

import { useSettingsStore } from '@/lib/store/settings';
import type { ProviderId } from '@/lib/types/provider';
import type { ProvidersConfig } from '@/lib/types/settings';

export type ModelConfigProfile = 'main' | 'lightweight';
export type ResolvedModelConfig = ReturnType<typeof buildModelConfig>;

function getFirstConfiguredModelId(
  providerId: string,
  providersConfig: ProvidersConfig | undefined,
): string {
  const providerConfig = providersConfig?.[providerId as ProviderId];

  return providerConfig?.serverModels?.[0] || providerConfig?.models?.[0]?.id || '';
}

function resolveModelConfig(profile: ModelConfigProfile) {
  const state = useSettingsStore.getState();

  if (profile === 'lightweight') {
    const providerId = state.lightweightProviderId || state.providerId;
    const modelId =
      state.lightweightModelId ||
      getFirstConfiguredModelId(providerId, state.lightweightProvidersConfig);
    const providerConfig = state.lightweightProvidersConfig?.[providerId as ProviderId];

    if (providerId && modelId && providerConfig) {
      return { providerId, modelId, providerConfig };
    }
  }

  const providerId = state.providerId;
  const modelId = state.modelId || getFirstConfiguredModelId(providerId, state.providersConfig);
  const providerConfig = state.providersConfig?.[providerId as ProviderId];
  return { providerId, modelId, providerConfig };
}

function buildModelConfig(profile: ModelConfigProfile = 'main') {
  const { providerId, modelId, providerConfig } = resolveModelConfig(profile);
  const modelString = providerId && modelId ? `${providerId}:${modelId}` : '';
  const modelInfo = providerConfig?.models?.find((model) => model.id === modelId);

  return {
    providerId,
    modelId,
    modelString,
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
    contextWindow: modelInfo?.contextWindow,
    outputWindow: modelInfo?.outputWindow,
    capabilities: modelInfo?.capabilities,
  };
}

export function isResolvedModelConfigUsable(config: ResolvedModelConfig): boolean {
  return (
    !!config.modelId && (!config.requiresApiKey || !!config.apiKey || !!config.isServerConfigured)
  );
}

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  return buildModelConfig();
}

export function getCurrentLightweightModelConfig() {
  return buildModelConfig('lightweight');
}

export function resolveChatModelConfig(): {
  config: ResolvedModelConfig;
  profile: ModelConfigProfile;
} | null {
  const main = buildModelConfig('main');
  if (isResolvedModelConfigUsable(main)) {
    return { config: main, profile: 'main' };
  }

  const lightweight = buildModelConfig('lightweight');
  if (isResolvedModelConfigUsable(lightweight)) {
    return { config: lightweight, profile: 'lightweight' };
  }

  return null;
}

/**
 * Standard headers for API routes that use the selected language model.
 */
export function getModelApiHeaders(options: { profile?: ModelConfigProfile } = {}): HeadersInit {
  const main = buildModelConfig(options.profile || 'main');

  return {
    'Content-Type': 'application/json',
    'x-model': main.modelString,
    'x-api-key': main.apiKey,
    'x-base-url': main.baseUrl,
    'x-provider-type': main.providerType || '',
    'x-requires-api-key': main.requiresApiKey ? 'true' : 'false',
    'x-model-context-window': main.contextWindow ? String(main.contextWindow) : '',
    'x-model-output-window': main.outputWindow ? String(main.outputWindow) : '',
    'x-model-capability-vision':
      main.capabilities?.vision === undefined ? '' : String(main.capabilities.vision),
    'x-model-capability-tools':
      main.capabilities?.tools === undefined ? '' : String(main.capabilities.tools),
    'x-model-capability-streaming':
      main.capabilities?.streaming === undefined ? '' : String(main.capabilities.streaming),
  };
}

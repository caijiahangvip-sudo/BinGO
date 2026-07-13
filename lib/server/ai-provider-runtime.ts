import 'server-only';

import { createRequire } from 'node:module';
import type { LanguageModel } from 'ai';
import { stripEndpointPath, trimUrl } from '@/lib/utils/api-url';
import {
  normalizeOpenAIBaseUrlForSdk,
  shouldUseOpenAIResponsesApi,
} from '@/lib/ai/openai-routing';
import {
  getProvider,
  parseModelString,
  type ModelConfig,
  type ModelInfo,
  type ProviderConfig,
  type ProviderId,
} from '@/lib/ai/providers';
import type { ThinkingConfig } from '@/lib/types/provider';

type OpenAIFactory = typeof import('@ai-sdk/openai').createOpenAI;
type AnthropicFactory = typeof import('@ai-sdk/anthropic').createAnthropic;
type GoogleFactory = typeof import('@ai-sdk/google').createGoogleGenerativeAI;

const nodeRequire = createRequire(import.meta.url);

function loadOpenAIFactory(): OpenAIFactory {
  return (nodeRequire('@ai-sdk/openai') as typeof import('@ai-sdk/openai')).createOpenAI;
}

function loadAnthropicFactory(): AnthropicFactory {
  return (nodeRequire('@ai-sdk/anthropic') as typeof import('@ai-sdk/anthropic'))
    .createAnthropic;
}

function loadGoogleFactory(): GoogleFactory {
  return (nodeRequire('@ai-sdk/google') as typeof import('@ai-sdk/google'))
    .createGoogleGenerativeAI;
}

function getCompatThinkingBodyParams(
  providerId: ProviderId,
  config: ThinkingConfig,
): Record<string, unknown> | undefined {
  if (config.enabled === false) {
    switch (providerId) {
      case 'kimi':
      case 'deepseek':
      case 'glm':
        return { thinking: { type: 'disabled' } };
      case 'qwen':
      case 'siliconflow':
        return { enable_thinking: false };
      default:
        return undefined;
    }
  }

  if (config.enabled === true) {
    switch (providerId) {
      case 'kimi':
      case 'deepseek':
      case 'glm':
        return { thinking: { type: 'enabled' } };
      case 'qwen':
      case 'siliconflow':
        return { enable_thinking: true };
      default:
        return undefined;
    }
  }

  return undefined;
}

function normalizeMiniMaxAnthropicBaseUrl(
  providerId: ProviderId,
  baseUrl?: string,
): string | undefined {
  const sanitizedBaseUrl = stripEndpointPath(
    baseUrl?.replace(/\/models\/[^/]+:(streamGenerateContent|generateContent)$/i, ''),
    [
      '/chat/completions',
      '/responses',
      '/messages',
      '/audio/speech',
      '/audio/transcriptions',
    ],
  );

  if (providerId !== 'minimax' || !sanitizedBaseUrl) {
    return sanitizedBaseUrl;
  }

  const trimmed = trimUrl(sanitizedBaseUrl) || '';
  if (trimmed.endsWith('/anthropic/v1')) {
    return trimmed;
  }
  if (trimmed.endsWith('/anthropic')) {
    return `${trimmed}/v1`;
  }
  return `${trimmed}/anthropic/v1`;
}

function resolveProviderConfig(providerId: ProviderId): ProviderConfig | null {
  return getProvider(providerId) ?? null;
}

export interface ModelWithInfo {
  model: LanguageModel;
  modelInfo: ModelInfo | null;
}

export function getModel(config: ModelConfig): ModelWithInfo {
  let providerType = config.providerType;
  let requiresApiKey = config.requiresApiKey ?? true;

  if (!providerType) {
    const provider = resolveProviderConfig(config.providerId);
    if (provider) {
      providerType = provider.type;
      requiresApiKey = provider.requiresApiKey;
    } else {
      throw new Error(`Unknown provider: ${config.providerId}. Please provide providerType.`);
    }
  }

  if (requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for provider: ${config.providerId}`);
  }

  const effectiveApiKey = config.apiKey || '';
  const provider = resolveProviderConfig(config.providerId);
  const requestedBaseUrl = config.baseUrl || provider?.defaultBaseUrl || undefined;
  const effectiveBaseUrl = normalizeMiniMaxAnthropicBaseUrl(
    config.providerId,
    requestedBaseUrl,
  );

  let model: LanguageModel;

  switch (providerType) {
    case 'openai': {
      const createOpenAI = loadOpenAIFactory();
      const openaiOptions: {
        apiKey: string;
        baseURL?: string;
        fetch?: typeof fetch;
      } = {
        apiKey: effectiveApiKey,
        baseURL: effectiveBaseUrl,
      };

      if (config.providerId !== 'openai') {
        const providerId = config.providerId;
        openaiOptions.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
          const thinkingCtx = (globalThis as Record<string, unknown>).__thinkingContext as
            | { getStore?: () => unknown }
            | undefined;
          const thinking = thinkingCtx?.getStore?.() as ThinkingConfig | undefined;
          if (thinking && init?.body && typeof init.body === 'string') {
            const extra = getCompatThinkingBodyParams(providerId, thinking);
            if (extra) {
              try {
                const body = JSON.parse(init.body);
                Object.assign(body, extra);
                init = { ...init, body: JSON.stringify(body) };
              } catch {
                // Leave the request body unchanged when it is not JSON.
              }
            }
          }
          return globalThis.fetch(url, init);
        };
      }

      const openai = createOpenAI({
        ...openaiOptions,
        baseURL: normalizeOpenAIBaseUrlForSdk(effectiveBaseUrl),
      });
      model = shouldUseOpenAIResponsesApi(config.providerId, requestedBaseUrl)
        ? openai.responses(config.modelId)
        : openai.chat(config.modelId);
      break;
    }

    case 'anthropic': {
      const createAnthropic = loadAnthropicFactory();
      const anthropic = createAnthropic({
        apiKey: effectiveApiKey,
        baseURL: effectiveBaseUrl,
      });
      model = anthropic.chat(config.modelId);
      break;
    }

    case 'google': {
      const createGoogleGenerativeAI = loadGoogleFactory();
      const googleOptions: {
        apiKey: string;
        baseURL?: string;
        fetch?: typeof fetch;
      } = {
        apiKey: effectiveApiKey,
        baseURL: effectiveBaseUrl,
      };

      if (config.proxy) {
        const { ProxyAgent, fetch: undiciFetch } = nodeRequire('undici') as typeof import('undici');
        const agent = new ProxyAgent(config.proxy);
        googleOptions.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
          undiciFetch(input as string, {
            ...(init as Record<string, unknown>),
            dispatcher: agent,
          }).then((response: unknown) => response as Response)) as typeof fetch;
      }

      const google = createGoogleGenerativeAI(googleOptions);
      model = google.chat(config.modelId);
      break;
    }

    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }

  const modelInfo = provider?.models.find((candidate) => candidate.id === config.modelId) || null;
  return { model, modelInfo };
}

export { parseModelString };

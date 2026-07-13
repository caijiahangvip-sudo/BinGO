/**
 * Vector / embedding provider registry.
 *
 * This file is client-safe and mirrors the TTS/ASR/PDF provider metadata
 * pattern used by the settings UI.
 */

import type { BuiltInVectorProviderId, VectorProviderConfig, VectorProviderId } from './types';

export const VECTOR_PROVIDER_ALIASES: Record<string, BuiltInVectorProviderId> = {
  'siliconflow-embedding': 'siliconflow',
  'chinese-xinhua-local': 'siliconflow',
};

export const LOCAL_BGE_BASE_ZH_MODEL_ID = 'BAAI/bge-base-zh-v1.5';

export function normalizeVectorProviderId(providerId: VectorProviderId): VectorProviderId {
  return VECTOR_PROVIDER_ALIASES[providerId] || providerId;
}

export const VECTOR_PROVIDERS: Record<BuiltInVectorProviderId, VectorProviderConfig> &
  Record<string, VectorProviderConfig> = {
  'openai-embedding': {
    id: 'openai-embedding',
    name: 'OpenAI Embeddings',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    icon: '/logos/openai.svg',
    models: [
      { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small' },
      { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large' },
    ],
    defaultModelId: 'text-embedding-3-small',
  },
  'qwen-embedding': {
    id: 'qwen-embedding',
    name: 'Qwen Embeddings',
    requiresApiKey: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    icon: '/logos/qwen.svg',
    models: [
      { id: 'text-embedding-v4', name: 'Text Embedding v4' },
      { id: 'text-embedding-v3', name: 'Text Embedding v3' },
    ],
    defaultModelId: 'text-embedding-v4',
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    icon: '/logos/siliconflow.svg',
    models: [
      { id: LOCAL_BGE_BASE_ZH_MODEL_ID, name: `${LOCAL_BGE_BASE_ZH_MODEL_ID} (Local)` },
      { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3' },
      { id: 'BAAI/bge-large-zh-v1.5', name: 'BAAI/bge-large-zh-v1.5' },
      { id: 'BAAI/bge-large-en-v1.5', name: 'BAAI/bge-large-en-v1.5' },
    ],
    defaultModelId: LOCAL_BGE_BASE_ZH_MODEL_ID,
  },
};

export function getAllVectorProviders(): VectorProviderConfig[] {
  return Object.values(VECTOR_PROVIDERS);
}

export function getVectorProvider(
  providerId: VectorProviderId,
): VectorProviderConfig | undefined {
  return VECTOR_PROVIDERS[normalizeVectorProviderId(providerId)];
}

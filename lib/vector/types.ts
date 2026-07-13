/**
 * Vector / embedding provider type definitions.
 */

export type BuiltInVectorProviderId =
  | 'openai-embedding'
  | 'qwen-embedding'
  | 'siliconflow';
export type VectorProviderId = BuiltInVectorProviderId | (string & {});

export interface VectorProviderConfig {
  id: VectorProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  icon?: string;
  models: Array<{ id: string; name: string }>;
  defaultModelId: string;
  dimensions?: number;
}

export interface VectorModelConfig {
  providerId: VectorProviderId;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Shared model resolution utilities for API routes.
 *
 * Extracts the repeated parseModelString → resolveApiKey → resolveBaseUrl →
 * resolveProxy → getModel boilerplate into a single call.
 */

import type { NextRequest } from 'next/server';
import { getModel, parseModelString, type ModelWithInfo } from '@/lib/server/ai-provider-runtime';
import { resolveApiKey, resolveBaseUrl, resolveProxy } from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import type { ModelInfo } from '@/lib/types/provider';

export interface ResolvedModel extends ModelWithInfo {
  /** Original model string (e.g. "openai/gpt-4o-mini") */
  modelString: string;
  /** Effective API key after server-side fallback resolution */
  apiKey: string;
  /** Effective base URL after request/server fallback resolution */
  baseUrl?: string;
}

function parseBooleanHeader(value: string | null): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

function mergeModelCapabilities(
  modelInfo: ModelInfo | null,
  capabilities: ModelInfo['capabilities'] | undefined,
): ModelInfo | null {
  if (!capabilities || Object.values(capabilities).every((value) => value === undefined)) {
    return modelInfo;
  }

  return {
    id: modelInfo?.id || '',
    name: modelInfo?.name || modelInfo?.id || '',
    ...modelInfo,
    capabilities: {
      ...modelInfo?.capabilities,
      ...capabilities,
    },
  };
}

/**
 * Resolve a language model from explicit parameters.
 *
 * Use this when model config comes from the request body.
 */
export function resolveModel(params: {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
  capabilities?: ModelInfo['capabilities'];
}): ResolvedModel {
  const modelString = params.modelString || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
  const { providerId, modelId } = parseModelString(modelString);

  const clientBaseUrl = params.baseUrl || undefined;
  if (clientBaseUrl && process.env.NODE_ENV === 'production') {
    const ssrfError = validateUrlForSSRF(clientBaseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  const apiKey = clientBaseUrl
    ? params.apiKey || ''
    : resolveApiKey(providerId, params.apiKey || '');
  const baseUrl = clientBaseUrl ? clientBaseUrl : resolveBaseUrl(providerId, params.baseUrl);
  const proxy = resolveProxy(providerId);
  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    proxy,
    providerType: params.providerType as 'openai' | 'anthropic' | 'google' | undefined,
    requiresApiKey: params.requiresApiKey,
  });

  return {
    model,
    modelInfo: mergeModelCapabilities(modelInfo, params.capabilities),
    modelString,
    apiKey,
    baseUrl,
  };
}

/**
 * Resolve a language model from standard request headers.
 *
 * Reads: x-model, x-api-key, x-base-url, x-provider-type, x-requires-api-key,
 * x-model-capability-vision, x-model-capability-tools, x-model-capability-streaming
 */
export function resolveModelFromHeaders(req: NextRequest): ResolvedModel {
  return resolveModel({
    modelString: req.headers.get('x-model') || undefined,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
    capabilities: {
      vision: parseBooleanHeader(req.headers.get('x-model-capability-vision')),
      tools: parseBooleanHeader(req.headers.get('x-model-capability-tools')),
      streaming: parseBooleanHeader(req.headers.get('x-model-capability-streaming')),
    },
  });
}

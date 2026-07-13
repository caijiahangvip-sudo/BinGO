import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import {
  resolveVectorApiKey,
  resolveVectorBaseUrl,
} from '@/lib/server/provider-config';
import {
  LOCAL_BGE_BASE_ZH_MODEL_ID,
  VECTOR_PROVIDERS,
  normalizeVectorProviderId,
} from '@/lib/vector/constants';
import type { VectorProviderId } from '@/lib/vector/types';
import { resolveEndpointUrl } from '@/lib/utils/api-url';

const log = createLogger('Verify Vector Model');

export const runtime = 'nodejs';

const VERIFY_TIMEOUT_MS = 15000;

interface EmbeddingResponse {
  data?: Array<{
    embedding?: unknown;
  }>;
  error?: {
    message?: string;
  };
}

function isAuthFailure(status: number, text: string): boolean {
  if (status === 401 || status === 403) return true;
  return /api\s*key|apikey|auth|token|unauthori[sz]ed|forbidden|invalid\s*key/i.test(text);
}

function getUpstreamError(status: number, text: string, providerId: string, modelId: string): string {
  if (isAuthFailure(status, text)) return 'API key is invalid or expired';
  if (status === 404 || /not\s*found/i.test(text)) {
    return `Model not found or API endpoint error for ${providerId}:${modelId}`;
  }
  if (status === 429) return 'API rate limit exceeded, please try again later';
  return text || `Embedding provider returned ${status}`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  let providerId: string | undefined;
  let modelId: string | undefined;

  try {
    const body = await req.json();
    providerId = typeof body.providerId === 'string' ? body.providerId : undefined;
    modelId = typeof body.modelId === 'string' ? body.modelId.trim() : undefined;
    const compatibleProviderId =
      typeof body.compatibleProviderId === 'string' ? body.compatibleProviderId : providerId;
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const requiresApiKey = body.requiresApiKey !== false;

    if (!providerId || !modelId) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'Provider ID and model ID are required',
      );
    }

    const runtimeProviderId = normalizeVectorProviderId(
      (compatibleProviderId || providerId) as VectorProviderId,
    );
    const provider = VECTOR_PROVIDERS[runtimeProviderId];
    if (!provider) {
      return apiError('INVALID_REQUEST', 400, `Unsupported vector provider: ${runtimeProviderId}`);
    }

    if (modelId === LOCAL_BGE_BASE_ZH_MODEL_ID) {
      return apiError(
        'INVALID_REQUEST',
        400,
        'Local BGE vector service is verified through its local health check',
      );
    }

    const clientBaseUrl = baseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const resolvedApiKey = clientBaseUrl
      ? apiKey
      : resolveVectorApiKey(runtimeProviderId, apiKey || undefined);
    if (requiresApiKey && !resolvedApiKey) {
      return apiError('MISSING_API_KEY', 400, 'API key cannot be empty');
    }

    const resolvedBaseUrl = clientBaseUrl
      ? clientBaseUrl
      : resolveVectorBaseUrl(runtimeProviderId, baseUrl || undefined);
    const endpointUrl = resolveEndpointUrl(
      resolvedBaseUrl,
      provider.defaultBaseUrl,
      '/embeddings',
    );

    const response = await fetchWithTimeout(endpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(resolvedApiKey ? { authorization: `Bearer ${resolvedApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        input: 'connection test',
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return apiError(
        'UPSTREAM_ERROR',
        response.status,
        getUpstreamError(response.status, responseText, runtimeProviderId, modelId),
      );
    }

    const data = JSON.parse(responseText || '{}') as EmbeddingResponse;
    if (data.error?.message) {
      return apiError('UPSTREAM_ERROR', 502, data.error.message);
    }

    const embedding = data.data?.[0]?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      !embedding.every((value) => typeof value === 'number')
    ) {
      return apiError('UPSTREAM_ERROR', 502, 'Embedding response did not include a valid vector');
    }

    return apiSuccess({
      message: 'Connection successful',
      dimensions: embedding.length,
    });
  } catch (error) {
    log.error(
      `Vector model verification failed [provider=${providerId ?? 'unknown'}, model=${modelId ?? 'unknown'}]:`,
      error,
    );

    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === 'AbortError') {
      return apiError('UPSTREAM_ERROR', 504, 'Connection timed out, please check your network');
    }
    if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(message)) {
      return apiError('UPSTREAM_ERROR', 502, 'Cannot connect to API server, please check the Base URL');
    }
    return apiError('INTERNAL_ERROR', 500, message || 'Connection failed');
  }
}

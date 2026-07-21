import { NextRequest } from 'next/server';
import { transcribeAudio } from '@/lib/audio/asr-providers';
import { resolveASRApiKey, resolveASRBaseUrl } from '@/lib/server/provider-config';
import type { ASRProviderId } from '@/lib/audio/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import {
  ensureLocalModelServiceRunning,
} from '@/lib/server/local-model-services';
const log = createLogger('Transcription');

export const maxDuration = 900;

const SENSEVOICE_DEFAULT_PORT = 50001;
const MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS = 5_000;
const MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS = 10 * 60 * 1000;

function isSenseVoiceUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('SenseVoice local service is not reachable');
}

function resolveSenseVoicePort(baseUrl?: string): number {
  if (!baseUrl) return SENSEVOICE_DEFAULT_PORT;

  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) {
      const port = Number.parseInt(parsed.port, 10);
      if (Number.isFinite(port) && port > 0) return port;
    }

    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return SENSEVOICE_DEFAULT_PORT;
  }
}

function parseLocalServiceStartupTimeoutMs(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(
    Math.max(parsed, MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS),
    MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS,
  );
}

async function transcribeAudioWithLocalSenseVoiceRetry(
  config: Parameters<typeof transcribeAudio>[0],
  buffer: Buffer,
  startupTimeoutMs?: number,
) {
  let requestConfig = config;
  if (config.providerId === 'sensevoice-asr' && startupTimeoutMs) {
    const port = resolveSenseVoicePort(config.baseUrl);
    const serviceResult = await ensureLocalModelServiceRunning('sensevoice', {
      port,
      timeoutMs: startupTimeoutMs,
    });
    requestConfig = serviceResult?.baseUrl ? { ...config, baseUrl: serviceResult.baseUrl } : config;
  }

  try {
    return await transcribeAudio(requestConfig, buffer);
  } catch (error) {
    if (requestConfig.providerId !== 'sensevoice-asr' || !isSenseVoiceUnavailableError(error)) {
      throw error;
    }

    const port = resolveSenseVoicePort(requestConfig.baseUrl);
    log.warn(`SenseVoice is not reachable; starting local service on port ${port} and retrying.`);
    const serviceResult = await ensureLocalModelServiceRunning('sensevoice', {
      port,
      ...(startupTimeoutMs ? { timeoutMs: startupTimeoutMs } : {}),
    });
    return transcribeAudio(
      serviceResult?.baseUrl
        ? { ...requestConfig, baseUrl: serviceResult.baseUrl }
        : requestConfig,
      buffer,
    );
  }
}

export async function POST(req: NextRequest) {
  let resolvedProviderId: string | undefined;
  let resolvedModelId: string | undefined;
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const providerId = formData.get('providerId') as ASRProviderId | null;
    const compatibleProviderId = formData.get('compatibleProviderId') as ASRProviderId | null;
    const modelId = formData.get('modelId') as string | null;
    const language = formData.get('language') as string | null;
    const apiKey = formData.get('apiKey') as string | null;
    const baseUrl = formData.get('baseUrl') as string | null;
    const localServiceStartupTimeoutMs = parseLocalServiceStartupTimeoutMs(
      formData.get('localServiceStartupTimeoutMs'),
    );

    if (!audioFile) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Audio file is required');
    }

    // providerId is required from the client — no server-side store to fall back to
    const requestedProviderId = providerId || ('openai-whisper' as ASRProviderId);
    const effectiveProviderId = compatibleProviderId || requestedProviderId;
    resolvedProviderId =
      requestedProviderId === effectiveProviderId
        ? effectiveProviderId
        : `${requestedProviderId} -> ${effectiveProviderId}`;
    resolvedModelId = modelId ?? undefined;

    const clientBaseUrl = baseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const config = {
      providerId: effectiveProviderId,
      modelId: modelId || undefined,
      language: language || 'auto',
      apiKey: clientBaseUrl
        ? apiKey || ''
        : resolveASRApiKey(effectiveProviderId, apiKey || undefined),
      baseUrl: clientBaseUrl
        ? clientBaseUrl
        : resolveASRBaseUrl(effectiveProviderId, baseUrl || undefined),
    };

    // Convert audio file to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Transcribe using the provider system
    const result = await transcribeAudioWithLocalSenseVoiceRetry(
      config,
      buffer,
      localServiceStartupTimeoutMs,
    );

    return apiSuccess({ text: result.text });
  } catch (error) {
    log.error(
      `Transcription failed [provider=${resolvedProviderId ?? 'unknown'}, model=${resolvedModelId ?? 'default'}]:`,
      error,
    );
    return apiError(
      'TRANSCRIPTION_FAILED',
      500,
      'Transcription failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

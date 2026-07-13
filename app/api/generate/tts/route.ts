/**
 * Single TTS Generation API
 *
 * Generates TTS audio for a single text string and returns base64-encoded audio.
 * Called by the client in parallel for each speech action after a scene is generated.
 *
 * POST /api/generate/tts
 */

import { NextRequest } from 'next/server';
import { generateTTS } from '@/lib/audio/tts-providers';
import { resolveTTSApiKey, resolveTTSBaseUrl } from '@/lib/server/provider-config';
import type { TTSModelConfig, TTSProviderId } from '@/lib/audio/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import {
  ensureLocalModelServiceRunning,
  releaseLocalModelServicesSafely,
} from '@/lib/server/local-model-services';

const log = createLogger('TTS API');

export const maxDuration = 900;

const COSYVOICE_DEFAULT_PORT = 50000;
const DEFAULT_COSYVOICE_IDLE_RELEASE_MS = 2 * 60 * 1000;
const DEFAULT_COSYVOICE_STARTUP_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_COSYVOICE_STARTUP_RETRY_ATTEMPTS = 30;
const DEFAULT_COSYVOICE_STARTUP_RETRY_DELAY_MS = 5000;
const MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS = 5_000;
const MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS = 10 * 60 * 1000;

interface CosyVoiceLifecycleState {
  activeRequests: number;
  activityVersion: number;
  releaseTimer?: ReturnType<typeof setTimeout>;
  releasePromise?: Promise<void>;
}

const COSYVOICE_LIFECYCLE_KEY = Symbol.for('bingo.cosyvoice.lifecycle');

function getCosyVoiceLifecycleState(): CosyVoiceLifecycleState {
  const globalState = globalThis as typeof globalThis & {
    [COSYVOICE_LIFECYCLE_KEY]?: CosyVoiceLifecycleState;
  };
  globalState[COSYVOICE_LIFECYCLE_KEY] ??= {
    activeRequests: 0,
    activityVersion: 0,
  };
  return globalState[COSYVOICE_LIFECYCLE_KEY];
}

function isCosyVoiceUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes('CosyVoice local service is not reachable')
  );
}

function isLocalModelServiceWaitTimeoutError(error: unknown, port?: number): boolean {
  if (!(error instanceof Error)) return false;
  const expectedMessage =
    port !== undefined
      ? `Timed out waiting for local model service on port ${port}.`
      : 'Timed out waiting for local model service on port ';
  return error.message.includes(expectedMessage);
}

function isCosyVoiceEmptyAudioError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes('CosyVoice local service returned empty audio')
  );
}

function isRetryableCosyVoiceStartupError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  const isWarmupApiError =
    message.includes('CosyVoice local TTS API error') &&
    /warming up|not ready|starting|loading|temporarily unavailable|service unavailable|timeout|502|503|504/i.test(
      message,
    );

  return (
    isCosyVoiceUnavailableError(error) ||
    isLocalModelServiceWaitTimeoutError(error) ||
    isWarmupApiError ||
    isCosyVoiceEmptyAudioError(error) ||
    message.includes('terminated') ||
    message.includes('fetch failed')
  );
}

function resolveCosyVoicePort(baseUrl?: string): number {
  if (!baseUrl) return COSYVOICE_DEFAULT_PORT;

  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) {
      const port = Number.parseInt(parsed.port, 10);
      if (Number.isFinite(port) && port > 0) return port;
    }

    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return COSYVOICE_DEFAULT_PORT;
  }
}

function getCosyVoiceIdleReleaseMs(): number {
  const envValue = Number.parseInt(process.env.BINGO_COSYVOICE_IDLE_RELEASE_MS ?? '', 10);
  return Number.isFinite(envValue) && envValue >= 0 ? envValue : DEFAULT_COSYVOICE_IDLE_RELEASE_MS;
}

function getCosyVoiceStartupTimeoutMs(): number {
  const envValue = Number.parseInt(process.env.BINGO_COSYVOICE_STARTUP_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(envValue) && envValue > 0
    ? Math.min(
        Math.max(envValue, MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS),
        MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS,
      )
    : DEFAULT_COSYVOICE_STARTUP_TIMEOUT_MS;
}

function getCosyVoiceStartupRetryAttempts(): number {
  const envValue = Number.parseInt(process.env.BINGO_COSYVOICE_STARTUP_RETRY_ATTEMPTS ?? '', 10);
  return Number.isFinite(envValue) && envValue > 0
    ? envValue
    : DEFAULT_COSYVOICE_STARTUP_RETRY_ATTEMPTS;
}

function getCosyVoiceStartupRetryDelayMs(): number {
  const envValue = Number.parseInt(process.env.BINGO_COSYVOICE_STARTUP_RETRY_DELAY_MS ?? '', 10);
  return Number.isFinite(envValue) && envValue >= 0
    ? envValue
    : DEFAULT_COSYVOICE_STARTUP_RETRY_DELAY_MS;
}

function parseLocalServiceStartupTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(
    Math.max(parsed, MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS),
    MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS,
  );
}

function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function beginCosyVoiceRequest(): Promise<void> {
  const state = getCosyVoiceLifecycleState();
  state.activityVersion += 1;
  state.activeRequests += 1;
  if (state.releaseTimer) {
    clearTimeout(state.releaseTimer);
    state.releaseTimer = undefined;
  }
  if (state.releasePromise) {
    log.info('Waiting for an in-progress CosyVoice release before starting a new request.');
    await state.releasePromise;
  }
  log.info(`CosyVoice acquired; active requests=${state.activeRequests}.`);
}

function scheduleCosyVoiceIdleRelease(): void {
  const state = getCosyVoiceLifecycleState();
  state.activeRequests = Math.max(0, state.activeRequests - 1);
  state.activityVersion += 1;
  const scheduledVersion = state.activityVersion;
  log.info(`CosyVoice request completed; active requests=${state.activeRequests}.`);
  if (state.activeRequests > 0) return;

  if (state.releaseTimer) {
    clearTimeout(state.releaseTimer);
  }

  const idleMs = getCosyVoiceIdleReleaseMs();
  log.info(`Scheduling CosyVoice release after ${idleMs}ms idle.`);
  state.releaseTimer = setTimeout(() => {
    const currentState = getCosyVoiceLifecycleState();
    currentState.releaseTimer = undefined;
    if (
      currentState.activeRequests > 0 ||
      currentState.activityVersion !== scheduledVersion ||
      currentState.releasePromise
    ) {
      return;
    }

    log.info(`Releasing CosyVoice after ${idleMs}ms idle.`);
    const releasePromise = releaseLocalModelServicesSafely(['cosyvoice'])
      .catch((error) => {
        log.warn('Failed to release idle CosyVoice service:', error);
      })
      .finally(() => {
        if (currentState.releasePromise === releasePromise) {
          currentState.releasePromise = undefined;
        }
      });
    currentState.releasePromise = releasePromise;
  }, idleMs);

  state.releaseTimer.unref?.();
}

function cancelCosyVoiceIdleRelease(): void {
  const state = getCosyVoiceLifecycleState();
  state.activityVersion += 1;
  if (!state.releaseTimer) return;
  clearTimeout(state.releaseTimer);
  state.releaseTimer = undefined;
}

async function releaseCosyVoiceAfterFailure(error: unknown): Promise<void> {
  cancelCosyVoiceIdleRelease();
  if (isLocalModelServiceWaitTimeoutError(error)) {
    log.warn(
      'CosyVoice startup is still not ready after the request timeout; leaving the startup process alone for the next request.',
      error,
    );
    return;
  }
  if (isCosyVoiceEmptyAudioError(error)) {
    log.warn(
      'CosyVoice returned empty audio after warmup retries; keeping the service alive until idle release.',
      error,
    );
    return;
  }

  const state = getCosyVoiceLifecycleState();
  if (state.activeRequests > 0) {
    log.warn(
      `CosyVoice request failed, but ${state.activeRequests} request(s) are still active; skipping immediate release.`,
      error,
    );
    return;
  }

  log.warn('CosyVoice request failed; releasing local CosyVoice service immediately.', error);
  await releaseLocalModelServicesSafely(['cosyvoice']).catch((releaseError) => {
    log.warn('Failed to release CosyVoice after failure:', releaseError);
  });
}

async function generateTTSWithLocalCosyVoiceRetry(
  config: TTSModelConfig,
  text: string,
  startupTimeoutMs?: number,
) {
  const requestConfig = config;

  try {
    return await generateTTS(requestConfig, text);
  } catch (error) {
    if (requestConfig.providerId !== 'cosyvoice-tts' || !isRetryableCosyVoiceStartupError(error)) {
      throw error;
    }

    let retryConfig = requestConfig;
    if (isCosyVoiceUnavailableError(error)) {
      const port = resolveCosyVoicePort(requestConfig.baseUrl);
      log.warn(`CosyVoice is not reachable; starting local service on port ${port} and retrying.`);
      const serviceResult = await ensureLocalModelServiceRunning('cosyvoice', {
        port,
        ...(startupTimeoutMs ? { timeoutMs: startupTimeoutMs } : {}),
      });
      retryConfig = serviceResult?.baseUrl
        ? { ...requestConfig, baseUrl: serviceResult.baseUrl }
        : requestConfig;
    } else {
      log.warn('CosyVoice request failed with a retryable error; retrying.', error);
    }

    const attempts = getCosyVoiceStartupRetryAttempts();
    const retryDelayMs = getCosyVoiceStartupRetryDelayMs();
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await generateTTS(retryConfig, text);
      } catch (retryError) {
        if (isCosyVoiceUnavailableError(retryError)) {
          const port = resolveCosyVoicePort(retryConfig.baseUrl);
          const serviceResult = await ensureLocalModelServiceRunning('cosyvoice', {
            port,
            ...(startupTimeoutMs ? { timeoutMs: startupTimeoutMs } : {}),
          });
          if (serviceResult.baseUrl) {
            retryConfig = { ...retryConfig, baseUrl: serviceResult.baseUrl };
          }
        }
        if (attempt >= attempts || !isRetryableCosyVoiceStartupError(retryError)) {
          throw retryError;
        }

        log.warn(
          `CosyVoice is not ready after startup (attempt ${attempt}/${attempts}); retrying in ${retryDelayMs}ms.`,
          retryError,
        );
        await waitForRetry(retryDelayMs);
      }
    }

    throw error;
  }
}

export async function POST(req: NextRequest) {
  let ttsProviderId: string | undefined;
  let runtimeProviderId: TTSProviderId | undefined;
  let ttsVoice: string | undefined;
  let audioId: string | undefined;
  try {
    const body = await req.json();
    const { text, ttsModelId, ttsSpeed, ttsApiKey, ttsBaseUrl } = body as {
      text: string;
      audioId: string;
      ttsProviderId: TTSProviderId;
      ttsCompatibleProviderId?: TTSProviderId;
      ttsModelId?: string;
      ttsVoice: string;
      ttsSpeed?: number;
      ttsApiKey?: string;
      ttsBaseUrl?: string;
      ttsProviderOptions?: Record<string, unknown>;
      localServiceStartupTimeoutMs?: number;
    };
    ttsProviderId = body.ttsProviderId;
    ttsVoice = body.ttsVoice;
    audioId = body.audioId;
    runtimeProviderId = (body.ttsCompatibleProviderId || ttsProviderId) as TTSProviderId;

    // Validate required fields
    if (!text || !audioId || !ttsProviderId || !ttsVoice) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'Missing required fields: text, audioId, ttsProviderId, ttsVoice',
      );
    }

    // Reject browser-native TTS — must be handled client-side
    if (runtimeProviderId === 'browser-native-tts') {
      return apiError('INVALID_REQUEST', 400, 'browser-native-tts must be handled client-side');
    }

    const clientBaseUrl = ttsBaseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfValidationUrl = clientBaseUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
      const ssrfError = validateUrlForSSRF(ssrfValidationUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const apiKey = clientBaseUrl
      ? ttsApiKey || ''
      : resolveTTSApiKey(runtimeProviderId, ttsApiKey || undefined);
    const baseUrl = clientBaseUrl
      ? clientBaseUrl
      : resolveTTSBaseUrl(runtimeProviderId, ttsBaseUrl || undefined);

    // Build TTS config
    const config = {
      providerId: runtimeProviderId,
      modelId: ttsModelId,
      voice: ttsVoice,
      speed: ttsSpeed ?? 1.0,
      apiKey,
      baseUrl,
      providerOptions: body.ttsProviderOptions,
    };
    const shouldScheduleCosyVoiceRelease = runtimeProviderId === 'cosyvoice-tts';
    const localServiceStartupTimeoutMs =
      runtimeProviderId === 'cosyvoice-tts'
        ? (parseLocalServiceStartupTimeoutMs(body.localServiceStartupTimeoutMs) ??
          getCosyVoiceStartupTimeoutMs())
        : parseLocalServiceStartupTimeoutMs(body.localServiceStartupTimeoutMs);

    log.info(
      `Generating TTS: provider=${ttsProviderId}, adapter=${runtimeProviderId}, model=${ttsModelId || 'default'}, voice=${ttsVoice}, audioId=${audioId}, textLen=${text.length}`,
    );

    // Generate audio
    if (shouldScheduleCosyVoiceRelease) {
      await beginCosyVoiceRequest();
    }
    let audio: Uint8Array;
    let format: string;
    try {
      const result = await generateTTSWithLocalCosyVoiceRetry(
        config,
        text,
        localServiceStartupTimeoutMs,
      );
      audio = result.audio;
      format = result.format;
    } finally {
      if (shouldScheduleCosyVoiceRelease) {
        scheduleCosyVoiceIdleRelease();
      }
    }

    // Convert to base64
    const base64 = Buffer.from(audio).toString('base64');

    return apiSuccess({ audioId, base64, format });
  } catch (error) {
    if (runtimeProviderId === 'cosyvoice-tts') {
      await releaseCosyVoiceAfterFailure(error);
    }

    log.error(
      `TTS generation failed [provider=${ttsProviderId ?? 'unknown'}, voice=${ttsVoice ?? 'unknown'}, audioId=${audioId ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      'GENERATION_FAILED',
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}

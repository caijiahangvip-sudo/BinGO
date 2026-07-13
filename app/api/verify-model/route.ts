import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';
const log = createLogger('Verify Model');

const VERIFY_TOKEN = 'BINGO_CONNECTION_OK';
const VERIFY_TIMEOUT_MS = 45_000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isVerificationTokenPresent(text: string): boolean {
  return /BINGO[\s_-]*CONNECTION[\s_-]*OK/i.test(text);
}

function formatSuccessMessage(model: string, baseUrl?: string): string {
  return `连接成功：${model}${baseUrl ? `，Base URL ${baseUrl}` : ''}`;
}

function toVerificationErrorResponse(error: unknown, model: string) {
  if (error instanceof Error && error.name === 'AbortError') {
    return apiError('UPSTREAM_ERROR', 504, 'Connection timed out, please check your network');
  }

  const message = getErrorMessage(error);

  if (/api\s*key\s*required/i.test(message)) {
    return apiError('MISSING_API_KEY', 400, 'API key is required for this provider');
  }
  if (message.includes('404') || /not\s*found/i.test(message)) {
    return apiError(
      'UPSTREAM_ERROR',
      404,
      `Model not found or API endpoint error for ${model}. Check that the selected model exists for this provider and that Base URL does not point to the wrong service.`,
    );
  }
  if (
    message.includes('401') ||
    message.includes('403') ||
    /unauthori[sz]ed|forbidden|invalid\s+(api\s*)?key|permission\s*denied/i.test(message)
  ) {
    return apiError('UPSTREAM_ERROR', 401, 'API key is invalid or expired');
  }
  if (/timeout|timed\s*out/i.test(message)) {
    return apiError('UPSTREAM_ERROR', 504, 'Connection timed out, please check your network');
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch\s*failed|network/i.test(message)) {
    return apiError('UPSTREAM_ERROR', 502, 'Cannot connect to API server, please check the Base URL');
  }
  if (/unsupported\s+provider|unknown\s+provider|invalid/i.test(message)) {
    return apiError('INVALID_REQUEST', 400, message);
  }

  return apiError('UPSTREAM_ERROR', 502, message || 'Connection failed');
}

export async function POST(req: NextRequest) {
  let model: string | undefined;
  try {
    const body = await req.json();
    const { apiKey, baseUrl, providerType, requiresApiKey } = body;
    model = body.model;

    if (!model) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }

    try {
      const result = resolveModel({
        modelString: model,
        apiKey: apiKey || '',
        baseUrl: baseUrl || undefined,
        providerType,
        requiresApiKey,
      });

      const verification = await generateText({
        model: result.model,
        prompt: `Connection test. Reply with exactly this token and no other text: ${VERIFY_TOKEN}`,
        maxOutputTokens: 32,
        timeout: {
          totalMs: VERIFY_TIMEOUT_MS,
          stepMs: VERIFY_TIMEOUT_MS,
        },
      });

      const text = verification.text?.trim() || '';
      if (
        verification.finishReason === 'error' ||
        verification.finishReason === 'content-filter'
      ) {
        return apiError(
          'UPSTREAM_ERROR',
          502,
          `Model verification failed: provider finished with ${verification.finishReason}`,
        );
      }

      if (!isVerificationTokenPresent(text)) {
        return apiError(
          'UPSTREAM_ERROR',
          502,
          `Model responded, but did not return the expected verification token. Check API key, Base URL, and model ID for ${model}.`,
        );
      }

      return apiSuccess({
        message: formatSuccessMessage(result.modelString, result.baseUrl),
        model: result.modelString,
        ...(result.baseUrl ? { baseUrl: result.baseUrl } : {}),
      });
    } catch (error) {
      return toVerificationErrorResponse(error, model);
    }
  } catch (error) {
    log.error(`Model verification failed [model="${model ?? 'unknown'}"]:`, error);

    let errorMessage = 'Connection failed';
    if (error instanceof Error) {
      // Parse common error messages
      if (
        error.message.includes('401') ||
        error.message.includes('Unauthorized') ||
        /invalid\s+(api\s*)?key/i.test(error.message)
      ) {
        errorMessage = 'API key is invalid or expired';
      } else if (error.message.includes('404') || error.message.includes('not found')) {
        errorMessage = 'Model not found or API endpoint error';
      } else if (error.message.includes('429')) {
        errorMessage = 'API rate limit exceeded, please try again later';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Cannot connect to API server, please check the Base URL';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Connection timed out, please check your network';
      } else {
        errorMessage = error.message;
      }
    }

    return apiError('INTERNAL_ERROR', 500, errorMessage);
  }
}

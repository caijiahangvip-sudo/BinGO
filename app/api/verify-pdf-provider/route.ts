import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { ensureLocalModelServiceRunning } from '@/lib/server/local-model-services';

const log = createLogger('Verify PDF Provider');

export const runtime = 'nodejs';
export const maxDuration = 900;

const MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS = 5_000;
const MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS = 10 * 60 * 1000;

function isAuthFailure(status: number, text: string): boolean {
  if (status === 401 || status === 403) return true;
  return /api\s*key|apikey|auth|token|unauthori[sz]ed|forbidden|invalid\s*key/i.test(text);
}

function resolvePort(baseUrl: string, defaultPort: number): number {
  try {
    const parsed = new URL(baseUrl);
    const port = Number.parseInt(parsed.port || '', 10);
    if (Number.isFinite(port) && port > 0) return port;
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return defaultPort;
  }
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

async function fetchHealth(baseUrl: string, apiKey: string): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
    method: 'GET',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    cache: 'no-store',
  });
}

export async function POST(req: NextRequest) {
  let providerId: string | undefined;
  try {
    const body = await req.json();
    providerId = body.providerId;
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const localServiceStartupTimeoutMs = parseLocalServiceStartupTimeoutMs(
      body.localServiceStartupTimeoutMs,
    );

    if (!providerId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Provider ID is required');
    }

    if (!(providerId in PDF_PROVIDERS)) {
      return apiError('INVALID_REQUEST', 400, `Unsupported PDF provider: ${providerId}`);
    }

    const provider = PDF_PROVIDERS[providerId];
    const verificationBaseUrl = baseUrl || provider.baseUrl || '';

    if (providerId === 'mineru-local') {
      const healthBaseUrl = verificationBaseUrl || provider.baseUrl || 'http://localhost:50002';
      const port = resolvePort(healthBaseUrl, 50002);
      try {
        const serviceResult = await ensureLocalModelServiceRunning('mineru', {
          port,
          ...(localServiceStartupTimeoutMs ? { timeoutMs: localServiceStartupTimeoutMs } : {}),
        });
        const response = await fetchHealth(serviceResult?.baseUrl || healthBaseUrl, apiKey);
        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          return apiError(
            'UPSTREAM_ERROR',
            response.status,
            `MinerU local service check failed: ${text || response.statusText}`,
          );
        }
      } catch (error) {
        return apiError(
          'SERVICE_UNAVAILABLE',
          503,
          error instanceof Error ? error.message : String(error),
        );
      }

      return apiSuccess({
        message: 'MinerU local PDF parser is available',
        status: 200,
      });
    }

    if (verificationBaseUrl) {
      if (process.env.NODE_ENV === 'production') {
        const ssrfError = validateUrlForSSRF(verificationBaseUrl);
        if (ssrfError) {
          return apiError('INVALID_URL', 403, ssrfError);
        }
      }

      const response = await fetch(verificationBaseUrl, {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        if (!isAuthFailure(response.status, text)) {
          return apiSuccess({
            message: 'PDF provider endpoint is reachable',
            status: 200,
          });
        }
        return apiError('UPSTREAM_ERROR', response.status, `PDF provider check failed: ${text}`);
      }

      return apiSuccess({
        message: 'PDF provider endpoint is reachable',
        status: 200,
      });
    }

    return apiSuccess({
      message: 'PDF parser is available locally and requires no remote connection',
      status: 200,
    });
  } catch (error) {
    log.error(`PDF provider verification failed [provider=${providerId ?? 'unknown'}]:`, error);

    const errorMessage =
      error instanceof Error ? error.message : 'PDF provider verification failed';

    return apiError('INTERNAL_ERROR', 500, errorMessage);
  }
}

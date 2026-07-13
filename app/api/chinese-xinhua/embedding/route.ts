import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  getChineseXinhuaEmbeddingStatus,
  scheduleChineseXinhuaEmbeddingIdleRelease,
  testChineseXinhuaEmbeddingConnection,
} from '@/lib/server/chinese-xinhua-embedding';

export const runtime = 'nodejs';
export const maxDuration = 900;

const MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS = 5_000;
const MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS = 10 * 60 * 1000;

function parseLocalServiceStartupTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(
    Math.max(parsed, MIN_LOCAL_SERVICE_TEST_TIMEOUT_MS),
    MAX_LOCAL_SERVICE_TEST_TIMEOUT_MS,
  );
}

export async function GET() {
  const status = await getChineseXinhuaEmbeddingStatus();
  return apiSuccess({ status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    baseUrl?: string;
    localServiceStartupTimeoutMs?: number;
  };

  if (body.action !== 'start') {
    return apiError('INVALID_REQUEST', 400, 'Unsupported action');
  }

  try {
    const { result, status, message } = await testChineseXinhuaEmbeddingConnection(
      body.baseUrl,
      parseLocalServiceStartupTimeoutMs(body.localServiceStartupTimeoutMs),
    );
    scheduleChineseXinhuaEmbeddingIdleRelease();
    return apiSuccess({ result, status, message });
  } catch (error) {
    const status = await getChineseXinhuaEmbeddingStatus(body.baseUrl).catch((statusError) => ({
      configuredBaseUrl: body.baseUrl || '',
      activeBaseUrl: body.baseUrl || '',
      candidateBaseUrls: body.baseUrl ? [body.baseUrl] : [],
      port: 0,
      listening: false,
      error: statusError instanceof Error ? statusError.message : String(statusError),
    }));
    return apiError(
      'SERVICE_UNAVAILABLE',
      503,
      error instanceof Error ? error.message : String(error),
      JSON.stringify(status),
    );
  }
}

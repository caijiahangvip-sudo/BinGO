import { type NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/server/api-response';
import { listMineruPdfTasks } from '@/lib/server/mineru-task-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MINERU_BASE_URL = 'http://localhost:50002';
const HEALTH_TIMEOUT_MS = 3000;

function isPrivate172(hostname: string): boolean {
  if (!hostname.startsWith('172.')) return false;
  const second = Number.parseInt(hostname.split('.')[1] || '', 10);
  return second >= 16 && second <= 31;
}

function isAllowedLocalMineruHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('169.254.') ||
    isPrivate172(normalized)
  );
}

function resolveMineruBaseUrl(req: NextRequest): string {
  const requested = req.nextUrl.searchParams.get('baseUrl')?.trim() || DEFAULT_MINERU_BASE_URL;
  try {
    const parsed = new URL(requested);
    if (!['http:', 'https:'].includes(parsed.protocol)) return DEFAULT_MINERU_BASE_URL;
    if (!isAllowedLocalMineruHost(parsed.hostname)) return DEFAULT_MINERU_BASE_URL;
    return requested.replace(/\/+$/, '');
  } catch {
    return DEFAULT_MINERU_BASE_URL;
  }
}

async function fetchMineruHealth(baseUrl: string): Promise<{
  reachable: boolean;
  health?: Record<string, unknown>;
  error?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const health = (await response.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
    return {
      reachable: response.ok,
      ...(health ? { health } : {}),
      ...(!response.ok ? { error: response.statusText } : {}),
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const baseUrl = resolveMineruBaseUrl(req);
  const status = await fetchMineruHealth(baseUrl);
  return apiSuccess({
    service: 'mineru',
    baseUrl,
    ...status,
    tasks: listMineruPdfTasks(),
  });
}

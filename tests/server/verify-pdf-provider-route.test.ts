import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureLocalModelServiceRunningMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/local-model-services', () => ({
  ensureLocalModelServiceRunning: ensureLocalModelServiceRunningMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/verify-pdf-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('verify-pdf-provider route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    ensureLocalModelServiceRunningMock.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
    );
  });

  it('starts MinerU before testing the local PDF parser', async () => {
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'mineru',
      port: 50002,
      started: true,
      baseUrl: 'http://172.19.88.193:50002',
    });

    const { POST } = await import('@/app/api/verify-pdf-provider/route');
    const response = await POST(
      buildRequest({
        providerId: 'mineru-local',
        baseUrl: 'http://localhost:50002',
        localServiceStartupTimeoutMs: 120_000,
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('mineru', {
      port: 50002,
      timeoutMs: 120_000,
    });
    expect(fetch).toHaveBeenCalledWith('http://172.19.88.193:50002/health', {
      method: 'GET',
      headers: undefined,
      cache: 'no-store',
    });
  });

  it('uses the configured MinerU base URL port', async () => {
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'mineru',
      port: 51002,
      started: true,
    });

    const { POST } = await import('@/app/api/verify-pdf-provider/route');
    const response = await POST(
      buildRequest({
        providerId: 'mineru-local',
        baseUrl: 'http://localhost:51002',
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('mineru', { port: 51002 });
    expect(fetch).toHaveBeenCalledWith('http://localhost:51002/health', {
      method: 'GET',
      headers: undefined,
      cache: 'no-store',
    });
  });
});

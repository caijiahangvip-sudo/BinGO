import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureLocalModelServiceRunningMock = vi.hoisted(() => vi.fn());
const releaseLocalModelServicesSafelyMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/local-model-services', () => ({
  ensureLocalModelServiceRunning: ensureLocalModelServiceRunningMock,
  releaseLocalModelServicesSafely: releaseLocalModelServicesSafelyMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

global.fetch = fetchMock as never;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sensevoice start route', () => {
  beforeEach(() => {
    ensureLocalModelServiceRunningMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockResolvedValue(undefined);
    fetchMock.mockReset();
    delete process.env.SENSEVOICE_PORT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SENSEVOICE_PORT;
  });

  it('returns success when SenseVoice starts successfully', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed')) // 初始健康检查失败
      .mockResolvedValueOnce(jsonResponse({ ok: true, warmed: true })); // 启动后健康检查成功

    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'sensevoice',
      port: 50001,
      started: true,
      baseUrl: 'http://172.19.88.193:50001',
    });

    const { POST } = await import('@/app/api/local-services/sensevoice/start/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.started).toBe(true);
    expect(body.warmed).toBe(true);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('sensevoice', expect.any(Object));
  });

  it('returns success when SenseVoice is already running and warmed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, warmed: true }));

    const { POST } = await import('@/app/api/local-services/sensevoice/start/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.started).toBe(false);
    expect(body.warmed).toBe(true);
    expect(ensureLocalModelServiceRunningMock).not.toHaveBeenCalled();
  });

  it('cleans up stale processes and retries when initial start fails', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed')) // 初始健康检查失败
      .mockRejectedValueOnce(new Error('fetch failed')) // 启动后健康检查仍失败
      .mockResolvedValueOnce(jsonResponse({ ok: true, warmed: true })); // 清理重启后成功

    ensureLocalModelServiceRunningMock
      .mockResolvedValueOnce({
        service: 'sensevoice',
        port: 50001,
        started: true,
        baseUrl: 'http://172.19.88.193:50001',
      })
      .mockResolvedValueOnce({
        service: 'sensevoice',
        port: 50001,
        started: true,
        baseUrl: 'http://172.19.88.193:50001',
      });

    const { POST } = await import('@/app/api/local-services/sensevoice/start/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.started).toBe(true);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['sensevoice']);
  });

  it('returns error when SenseVoice fails to start after cleanup', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    ensureLocalModelServiceRunningMock
      .mockResolvedValueOnce({
        service: 'sensevoice',
        port: 50001,
        started: true,
        baseUrl: 'http://172.19.88.193:50001',
      })
      .mockResolvedValueOnce({
        service: 'sensevoice',
        port: 50001,
        started: true,
        baseUrl: 'http://172.19.88.193:50001',
      });

    const { POST } = await import('@/app/api/local-services/sensevoice/start/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('SERVICE_UNAVAILABLE');
  });
});

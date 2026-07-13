import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureLocalModelServiceRunningMock = vi.hoisted(() => vi.fn());
const createConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/local-model-services', () => ({
  ensureLocalModelServiceRunning: ensureLocalModelServiceRunningMock,
  getWslIpAddresses: vi.fn().mockResolvedValue([]),
  releaseLocalModelServicesSafely: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('net', async () => {
  const { EventEmitter } = await import('events');
  return {
    default: {
      createConnection: createConnectionMock.mockImplementation(() => {
        const socket = new EventEmitter() as InstanceType<typeof EventEmitter> & {
          setTimeout: (timeoutMs: number) => void;
          destroy: () => void;
        };
        socket.setTimeout = vi.fn();
        socket.destroy = vi.fn();
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      }),
    },
  };
});

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/chinese-xinhua/embedding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('chinese-xinhua embedding route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    ensureLocalModelServiceRunningMock.mockReset();
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'embedding',
      port: 50003,
      started: false,
      baseUrl: 'http://localhost:50003',
    });
    createConnectionMock.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          model: 'BAAI/bge-base-zh-v1.5',
          cudaAvailable: true,
          torchHip: '6.3.42134-a9a80e791',
          cudaDevices: ['AMD Radeon RX 7900 GRE'],
        }),
      ),
    );
  });

  it('rejects invalid Base URL instead of reporting success from the default port', async () => {
    const { POST } = await import('@/app/api/chinese-xinhua/embedding/route');
    const response = await POST(
      buildRequest({
        action: 'start',
        baseUrl: 'http://localhost:50003大大苏打实打',
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid vector Base URL');
    expect(ensureLocalModelServiceRunningMock).not.toHaveBeenCalled();
  });

  it('returns success only with the expected local BGE model and ROCm health data', async () => {
    const { POST } = await import('@/app/api/chinese-xinhua/embedding/route');
    const response = await POST(
      buildRequest({
        action: 'start',
        baseUrl: 'http://localhost:50003',
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain('BAAI/bge-base-zh-v1.5');
    expect(body.message).toContain('ROCm 6.3.42134-a9a80e791');
    expect(body.message).toContain('AMD Radeon RX 7900 GRE');
  });

  it('rejects a service that is not the local BGE model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          model: 'BAAI/bge-m3',
          cudaAvailable: true,
          torchHip: '6.3.42134-a9a80e791',
        }),
      ),
    );

    const { POST } = await import('@/app/api/chinese-xinhua/embedding/route');
    const response = await POST(
      buildRequest({
        action: 'start',
        baseUrl: 'http://localhost:50003',
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Vector service model mismatch');
  });

  it('rejects a local BGE service that is not running on ROCm', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          model: 'BAAI/bge-base-zh-v1.5',
          cudaAvailable: false,
          torchHip: null,
        }),
      ),
    );

    const { POST } = await import('@/app/api/chinese-xinhua/embedding/route');
    const response = await POST(
      buildRequest({
        action: 'start',
        baseUrl: 'http://localhost:50003',
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error).toContain('ROCm/CUDA acceleration');
  });

  it('rejects a local BGE service that reports startup failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: false,
          model: 'BAAI/bge-base-zh-v1.5',
          cudaAvailable: true,
          torchHip: '6.3.42134-a9a80e791',
          startupError: 'index load failed',
        }),
      ),
    );

    const { POST } = await import('@/app/api/chinese-xinhua/embedding/route');
    const response = await POST(
      buildRequest({
        action: 'start',
        baseUrl: 'http://localhost:50003',
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error).toContain('index load failed');
  });
});

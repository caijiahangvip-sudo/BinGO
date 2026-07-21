import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const releaseLocalModelServicesSafelyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/local-model-services', () => ({
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

describe('sensevoice stop route', () => {
  beforeEach(() => {
    releaseLocalModelServicesSafelyMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success when SenseVoice is stopped successfully', async () => {
    releaseLocalModelServicesSafelyMock.mockResolvedValueOnce({
      services: ['sensevoice'],
      released: true,
    });

    const { POST } = await import('@/app/api/local-services/sensevoice/stop/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.released).toBe(true);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['sensevoice']);
  });

  it('returns success even when SenseVoice was not running', async () => {
    releaseLocalModelServicesSafelyMock.mockResolvedValueOnce({
      services: ['sensevoice'],
      released: false,
    });

    const { POST } = await import('@/app/api/local-services/sensevoice/stop/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.released).toBe(false);
  });

  it('returns error when release throws', async () => {
    releaseLocalModelServicesSafelyMock.mockRejectedValueOnce(new Error('release failed'));

    const { POST } = await import('@/app/api/local-services/sensevoice/stop/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('SERVICE_UNAVAILABLE');
  });
});

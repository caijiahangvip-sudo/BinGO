import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

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

describe('sensevoice status route', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns running=true and warmed=true when health endpoint responds with warmed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, warmed: true, model: 'iic/SenseVoiceSmall' }),
    );

    const { GET } = await import('@/app/api/local-services/sensevoice/status/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.running).toBe(true);
    expect(body.warmed).toBe(true);
    expect(body.model).toBe('iic/SenseVoiceSmall');
  });

  it('returns running=true and warmed=false when health endpoint responds without warmed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, warmed: false }),
    );

    const { GET } = await import('@/app/api/local-services/sensevoice/status/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.running).toBe(true);
    expect(body.warmed).toBe(false);
  });

  it('returns running=false when health endpoint is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

    const { GET } = await import('@/app/api/local-services/sensevoice/status/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.running).toBe(false);
    expect(body.warmed).toBe(false);
  });

  it('returns running=false when health endpoint returns non-200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not ready' }, 503));

    const { GET } = await import('@/app/api/local-services/sensevoice/status/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.running).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParsedPdfContent } from '@/lib/types/pdf';

const parsePDFMock = vi.hoisted(() => vi.fn());
const ensureLocalModelServiceRunningMock = vi.hoisted(() => vi.fn());
const releaseLocalModelServicesSafelyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/pdf/pdf-providers', () => ({
  parsePDF: parsePDFMock,
}));

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

function buildPdfResponse(text: string): ParsedPdfContent {
  return {
    text,
    images: [],
    metadata: {
      pageCount: 1,
      parser: 'mineru-local',
    },
  };
}

function buildRequest(
  baseUrl = 'http://localhost:50002',
  options: Record<string, string> = {},
): Request {
  const formData = new FormData();
  formData.append('pdf', new File(['%PDF-1.7'], 'document.pdf', { type: 'application/pdf' }));
  formData.append('providerId', 'mineru-local');
  formData.append('baseUrl', baseUrl);
  for (const [key, value] of Object.entries(options)) {
    formData.append(key, value);
  }

  return new Request('http://localhost/api/parse-pdf', {
    method: 'POST',
    body: formData,
  });
}

describe('parse-pdf route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    parsePDFMock.mockReset();
    ensureLocalModelServiceRunningMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockResolvedValue(undefined);
    delete process.env.BINGO_MINERU_IDLE_RELEASE_MS;
    delete process.env.BINGO_MINERU_FAST_PDF_TASK_TIMEOUT_MS;
    delete process.env.BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS;
    delete process.env.BINGO_MINERU_PDF_TASK_TIMEOUT_MS;
    delete process.env.BINGO_MINERU_UNBOUNDED_ACCURATE_MAX_PAGES;
    delete process.env.BINGO_MINERU_FAST_MAX_PAGES;
    delete process.env.BINGO_ALLOW_MINERU_UNBOUNDED_ACCURATE;
    delete process.env.PDF_MINERU_LOCAL_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.BINGO_MINERU_IDLE_RELEASE_MS;
    delete process.env.BINGO_MINERU_FAST_PDF_TASK_TIMEOUT_MS;
    delete process.env.BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS;
    delete process.env.BINGO_MINERU_PDF_TASK_TIMEOUT_MS;
    delete process.env.BINGO_MINERU_UNBOUNDED_ACCURATE_MAX_PAGES;
    delete process.env.BINGO_MINERU_FAST_MAX_PAGES;
    delete process.env.BINGO_ALLOW_MINERU_UNBOUNDED_ACCURATE;
    delete process.env.PDF_MINERU_LOCAL_TIMEOUT_MS;
  });

  it('starts MinerU and retries once when the local service is unreachable', async () => {
    parsePDFMock
      .mockRejectedValueOnce(
        new Error(
          'MinerU local service is not reachable at http://localhost:50002. Start scripts/mineru-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce(buildPdfResponse('parsed after startup'));
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'mineru',
      port: 50002,
      started: true,
    });

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.text).toBe('parsed after startup');
    expect(parsePDFMock).toHaveBeenCalledTimes(2);
    expect(parsePDFMock).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        mode: 'fast',
        maxPages: 8,
        needsImages: false,
        needsCover: false,
        needsMiddleJson: false,
      }),
    );
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('mineru', {
      port: 50002,
      timeoutMs: 2 * 60 * 1000,
    });
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
  });

  it('does not start MinerU for non-connectivity parser errors', async () => {
    parsePDFMock.mockRejectedValueOnce(new Error('MinerU PDF parsing failed (500): bad pdf'));

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest() as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.errorCode).toBe('PARSE_FAILED');
    expect(body.error).toContain('MinerU PDF parsing failed');
    expect(parsePDFMock).toHaveBeenCalledTimes(1);
    expect(ensureLocalModelServiceRunningMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
  });

  it('caches repeated parses for the same PDF and parse options', async () => {
    parsePDFMock.mockResolvedValue(buildPdfResponse('cached parse'));

    const { POST } = await import('@/app/api/parse-pdf/route');
    const first = await POST(
      buildRequest('http://localhost:50002', { needsCover: 'true' }) as never,
    );
    const firstBody = await first.json();
    const second = await POST(
      buildRequest('http://localhost:50002', { needsCover: 'true' }) as never,
    );
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(parsePDFMock).toHaveBeenCalledTimes(1);
    expect(firstBody.data.text).toBe('cached parse');
    expect(firstBody.data.metadata.cacheHit).toBe(false);
    expect(secondBody.data.text).toBe('cached parse');
    expect(secondBody.data.metadata.cacheHit).toBe(true);
  });

  it('uses the configured MinerU base URL port when starting the local service', async () => {
    parsePDFMock
      .mockRejectedValueOnce(
        new Error(
          'MinerU local service is not reachable at http://localhost:51002. Start scripts/mineru-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce(buildPdfResponse('parsed on custom port'));
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'mineru',
      port: 51002,
      started: true,
    });

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest('http://localhost:51002') as never);

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('mineru', {
      port: 51002,
      timeoutMs: 2 * 60 * 1000,
    });
  });

  it('uses the short fast-mode timeout when starting MinerU for book parsing', async () => {
    parsePDFMock
      .mockRejectedValueOnce(
        new Error(
          'MinerU local service is not reachable at http://localhost:50002. Start scripts/mineru-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce(buildPdfResponse('fast parsed after startup'));
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'mineru',
      port: 50002,
      started: true,
    });

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest('http://localhost:50002', { mode: 'fast' }) as never);

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('mineru', {
      port: 50002,
      timeoutMs: 2 * 60 * 1000,
    });
  });

  it('passes maxPages through to the PDF parser config', async () => {
    parsePDFMock.mockResolvedValue(buildPdfResponse('limited parse'));

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(
      buildRequest('http://localhost:50002', { mode: 'fast', maxPages: '12' }) as never,
    );

    expect(response.status).toBe(200);
    expect(parsePDFMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        mode: 'fast',
        maxPages: 12,
      }),
    );
  });

  it('retries MinerU against the reachable WSL base URL returned by startup', async () => {
    parsePDFMock
      .mockRejectedValueOnce(
        new Error(
          'MinerU local service is not reachable at http://localhost:50002. Start scripts/mineru-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce(buildPdfResponse('parsed through wsl ip'));
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'mineru',
      port: 50002,
      started: true,
      baseUrl: 'http://172.19.88.193:50002',
    });

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest() as never);

    expect(response.status).toBe(200);
    expect(parsePDFMock).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ baseUrl: 'http://172.19.88.193:50002' }),
    );
  });

  it('keeps MinerU alive during a short idle window for batch parsing', async () => {
    process.env.BINGO_MINERU_IDLE_RELEASE_MS = '5000';
    parsePDFMock
      .mockResolvedValueOnce(buildPdfResponse('first'))
      .mockResolvedValueOnce(buildPdfResponse('second'));

    const { POST } = await import('@/app/api/parse-pdf/route');
    const first = await POST(buildRequest() as never);
    expect(first.status).toBe(200);

    await vi.advanceTimersByTimeAsync(4000);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    const second = await POST(
      buildRequest('http://localhost:50002', { needsCover: 'true' }) as never,
    );
    expect(second.status).toBe(200);

    await vi.advanceTimersByTimeAsync(4000);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledTimes(1);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
  });

  it('can release MinerU immediately after the active parse batch finishes', async () => {
    process.env.BINGO_MINERU_IDLE_RELEASE_MS = '0';
    parsePDFMock.mockResolvedValueOnce(buildPdfResponse('parsed'));

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest() as never);

    expect(response.status).toBe(200);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
  });

  it('does not retry accurate-mode MinerU tasks when they hang past the task timeout', async () => {
    vi.useRealTimers();
    process.env.BINGO_MINERU_PDF_TASK_TIMEOUT_MS = '10';
    process.env.BINGO_ALLOW_MINERU_UNBOUNDED_ACCURATE = '1';
    parsePDFMock.mockImplementation(
      (_buffer: Buffer, config: { signal?: AbortSignal }) =>
        new Promise<ParsedPdfContent>(() => {
          config.signal?.addEventListener('abort', () => undefined);
        }),
    );

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest() as never);
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(parsePDFMock).toHaveBeenCalledTimes(1);
    expect(body.errorCode).toBe('PARSE_FAILED');
    expect(body.error).toContain('MinerU PDF task timed out');
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
  });

  it('retries fast-mode MinerU once with a longer timeout after the first task timeout', async () => {
    vi.useRealTimers();
    process.env.BINGO_MINERU_FAST_PDF_TASK_TIMEOUT_MS = '10';
    process.env.BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS = '50';
    parsePDFMock
      .mockImplementationOnce(
        (_buffer: Buffer, config: { signal?: AbortSignal }) =>
          new Promise<ParsedPdfContent>(() => {
            config.signal?.addEventListener('abort', () => undefined);
          }),
      )
      .mockResolvedValueOnce(buildPdfResponse('parsed on long retry'));

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest('http://localhost:50002', { mode: 'fast' }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(parsePDFMock).toHaveBeenCalledTimes(2);
    expect(body.success).toBe(true);
    expect(body.data.text).toBe('parsed on long retry');
    expect(body.data.metadata.mineruFastRetry).toBe(true);
    expect(body.data.metadata.mineruFastRetryFirstTimeoutMs).toBe(10);
    expect(body.data.metadata.mineruFastRetryTimeoutMs).toBe(50);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
  });

  it('returns 504 when the automatic fast-mode MinerU retry also times out', async () => {
    vi.useRealTimers();
    process.env.BINGO_MINERU_FAST_PDF_TASK_TIMEOUT_MS = '10';
    process.env.BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS = '20';
    parsePDFMock.mockImplementation(
      (_buffer: Buffer, config: { signal?: AbortSignal }) =>
        new Promise<ParsedPdfContent>(() => {
          config.signal?.addEventListener('abort', () => undefined);
        }),
    );

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(buildRequest('http://localhost:50002', { mode: 'fast' }) as never);
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(parsePDFMock).toHaveBeenCalledTimes(2);
    expect(body.error).toContain('retried once with a longer timeout');
    expect(body.error).toContain('BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS');
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledTimes(2);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenNthCalledWith(1, ['mineru']);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenNthCalledWith(2, ['mineru']);
  });
});

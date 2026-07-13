import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateTTSMock = vi.hoisted(() => vi.fn());
const ensureLocalModelServiceRunningMock = vi.hoisted(() => vi.fn());
const releaseLocalModelServicesSafelyMock = vi.hoisted(() => vi.fn());
const COSYVOICE_LIFECYCLE_KEY = Symbol.for('bingo.cosyvoice.lifecycle');

vi.mock('@/lib/audio/tts-providers', () => ({
  generateTTS: generateTTSMock,
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

function buildTTSRequest(
  baseUrl = 'http://localhost:50000',
  localServiceStartupTimeoutMs?: number,
): Request {
  return new Request('http://localhost/api/generate/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '你好，这是一段测试语音。',
      audioId: 'tts_1',
      ttsProviderId: 'cosyvoice-tts',
      ttsCompatibleProviderId: 'cosyvoice-tts',
      ttsModelId: 'Fun-CosyVoice3-0.5B-2512_RL',
      ttsVoice: 'zero_shot_prompt',
      ttsSpeed: 1,
      ttsBaseUrl: baseUrl,
      ...(localServiceStartupTimeoutMs ? { localServiceStartupTimeoutMs } : {}),
    }),
  });
}

describe('generate/tts route', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    generateTTSMock.mockReset();
    ensureLocalModelServiceRunningMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockResolvedValue(undefined);
    delete (globalThis as Record<symbol, unknown>)[COSYVOICE_LIFECYCLE_KEY];
    delete process.env.BINGO_COSYVOICE_IDLE_RELEASE_MS;
    delete process.env.BINGO_COSYVOICE_STARTUP_RETRY_ATTEMPTS;
    delete process.env.BINGO_COSYVOICE_STARTUP_RETRY_DELAY_MS;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.BINGO_COSYVOICE_IDLE_RELEASE_MS;
    delete process.env.BINGO_COSYVOICE_STARTUP_RETRY_ATTEMPTS;
    delete process.env.BINGO_COSYVOICE_STARTUP_RETRY_DELAY_MS;
    delete (globalThis as Record<symbol, unknown>)[COSYVOICE_LIFECYCLE_KEY];
  });

  it('starts CosyVoice and retries once when the local service is unreachable', async () => {
    generateTTSMock
      .mockRejectedValueOnce(
        new Error(
          'CosyVoice local service is not reachable at http://localhost:50000. Start scripts/cosyvoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce({ audio: new Uint8Array([1, 2, 3]), format: 'wav' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'cosyvoice',
      port: 50000,
      started: true,
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(buildTTSRequest() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.audioId).toBe('tts_1');
    expect(body.base64).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(body.format).toBe('wav');
    expect(generateTTSMock).toHaveBeenCalledTimes(2);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('cosyvoice', {
      port: 50000,
      timeoutMs: 600_000,
    });
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['cosyvoice']);
  });

  it('uses the configured CosyVoice base URL port when starting the local service', async () => {
    generateTTSMock
      .mockRejectedValueOnce(
        new Error(
          'CosyVoice local service is not reachable at http://localhost:51000. Start scripts/cosyvoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce({ audio: new Uint8Array([4, 5, 6]), format: 'wav' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'cosyvoice',
      port: 51000,
      started: true,
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(buildTTSRequest('http://localhost:51000') as never);

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('cosyvoice', {
      port: 51000,
      timeoutMs: 600_000,
    });
  });

  it('retries CosyVoice against the reachable WSL base URL returned by startup', async () => {
    generateTTSMock
      .mockRejectedValueOnce(
        new Error(
          'CosyVoice local service is not reachable at http://localhost:50000. Start scripts/cosyvoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce({ audio: new Uint8Array([9]), format: 'wav' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'cosyvoice',
      port: 50000,
      started: true,
      baseUrl: 'http://172.19.88.193:50000',
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(buildTTSRequest() as never);

    expect(response.status).toBe(200);
    expect(generateTTSMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: 'http://172.19.88.193:50000' }),
      expect.any(String),
    );
  });

  it('does not start CosyVoice when generation succeeds without a connectivity error', async () => {
    generateTTSMock.mockResolvedValueOnce({ audio: new Uint8Array([5]), format: 'wav' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'cosyvoice',
      port: 50000,
      started: true,
      baseUrl: 'http://172.19.88.193:50000',
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(buildTTSRequest('http://localhost:50000', 120_000) as never);

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).not.toHaveBeenCalled();
    expect(generateTTSMock).toHaveBeenCalledTimes(1);
    expect(generateTTSMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://localhost:50000' }),
      expect.any(String),
    );
  });

  it('retries briefly when CosyVoice is listening but not ready immediately after startup', async () => {
    process.env.BINGO_COSYVOICE_STARTUP_RETRY_ATTEMPTS = '3';
    process.env.BINGO_COSYVOICE_STARTUP_RETRY_DELAY_MS = '100';
    generateTTSMock
      .mockRejectedValueOnce(
        new Error(
          'CosyVoice local service is not reachable at http://localhost:50000. Start scripts/cosyvoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockRejectedValueOnce(new Error('CosyVoice local TTS API error: service warming up'))
      .mockResolvedValueOnce({ audio: new Uint8Array([7, 8, 9]), format: 'wav' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'cosyvoice',
      port: 50000,
      started: true,
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const responsePromise = POST(buildTTSRequest() as never);
    await vi.advanceTimersByTimeAsync(100);
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.base64).toBe(Buffer.from([7, 8, 9]).toString('base64'));
    expect(generateTTSMock).toHaveBeenCalledTimes(3);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('cosyvoice', {
      port: 50000,
      timeoutMs: 600_000,
    });
  });

  it('restarts CosyVoice when it becomes unreachable during warmup retries', async () => {
    process.env.BINGO_COSYVOICE_STARTUP_RETRY_ATTEMPTS = '3';
    process.env.BINGO_COSYVOICE_STARTUP_RETRY_DELAY_MS = '100';
    generateTTSMock
      .mockRejectedValueOnce(
        new Error(
          'CosyVoice local service is not reachable at http://localhost:50000. Start scripts/cosyvoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          'CosyVoice local service is not reachable at http://localhost:50000. Start scripts/cosyvoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce({ audio: new Uint8Array([4, 2]), format: 'wav' });
    ensureLocalModelServiceRunningMock
      .mockResolvedValueOnce({ service: 'cosyvoice', port: 50000, started: true })
      .mockResolvedValueOnce({
        service: 'cosyvoice',
        port: 50000,
        started: true,
        baseUrl: 'http://172.19.88.193:50000',
      });

    const { POST } = await import('@/app/api/generate/tts/route');
    const responsePromise = POST(buildTTSRequest() as never);
    await vi.advanceTimersByTimeAsync(100);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledTimes(2);
    expect(generateTTSMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: 'http://172.19.88.193:50000' }),
      expect.any(String),
    );
  });

  it('does not start CosyVoice for non-connectivity TTS errors', async () => {
    generateTTSMock.mockRejectedValueOnce(new Error('CosyVoice local TTS API error: bad request'));

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(buildTTSRequest() as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.errorCode).toBe('GENERATION_FAILED');
    expect(body.error).toContain('CosyVoice local TTS API error');
    expect(generateTTSMock).toHaveBeenCalledTimes(1);
    expect(ensureLocalModelServiceRunningMock).not.toHaveBeenCalled();
  });

  it('keeps CosyVoice alive during a short idle window for batch TTS generation', async () => {
    process.env.BINGO_COSYVOICE_IDLE_RELEASE_MS = '5000';
    generateTTSMock
      .mockResolvedValueOnce({ audio: new Uint8Array([1]), format: 'wav' })
      .mockResolvedValueOnce({ audio: new Uint8Array([2]), format: 'wav' });

    const { POST } = await import('@/app/api/generate/tts/route');
    const first = await POST(buildTTSRequest() as never);
    expect(first.status).toBe(200);

    await vi.advanceTimersByTimeAsync(4000);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    const second = await POST(buildTTSRequest() as never);
    expect(second.status).toBe(200);

    await vi.advanceTimersByTimeAsync(4000);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledTimes(1);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['cosyvoice']);
  });

  it('shares the idle lease across route module reloads', async () => {
    process.env.BINGO_COSYVOICE_IDLE_RELEASE_MS = '5000';
    let resolveSecondRequest: ((value: { audio: Uint8Array; format: string }) => void) | undefined;
    generateTTSMock
      .mockResolvedValueOnce({ audio: new Uint8Array([1]), format: 'wav' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondRequest = resolve;
          }),
      );

    const firstModule = await import('@/app/api/generate/tts/route');
    const first = await firstModule.POST(buildTTSRequest() as never);
    expect(first.status).toBe(200);

    await vi.advanceTimersByTimeAsync(4000);
    vi.resetModules();
    const secondModule = await import('@/app/api/generate/tts/route');
    const secondPromise = secondModule.POST(buildTTSRequest() as never);

    await vi.advanceTimersByTimeAsync(2000);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    resolveSecondRequest?.({ audio: new Uint8Array([2]), format: 'wav' });
    const second = await secondPromise;
    expect(second.status).toBe(200);

    await vi.advanceTimersByTimeAsync(4999);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledTimes(1);
  });

  it('can release CosyVoice immediately after the active TTS batch finishes', async () => {
    process.env.BINGO_COSYVOICE_IDLE_RELEASE_MS = '0';
    generateTTSMock.mockResolvedValueOnce({ audio: new Uint8Array([1]), format: 'wav' });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(buildTTSRequest() as never);

    expect(response.status).toBe(200);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['cosyvoice']);
  });
});

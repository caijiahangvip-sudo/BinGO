import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transcribeAudioMock = vi.hoisted(() => vi.fn());
const ensureLocalModelServiceRunningMock = vi.hoisted(() => vi.fn());
const releaseLocalModelServicesSafelyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/audio/asr-providers', () => ({
  transcribeAudio: transcribeAudioMock,
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

function buildRequest(
  baseUrl = 'http://localhost:50001',
  localServiceStartupTimeoutMs?: number,
): Request {
  const formData = new FormData();
  formData.append('audio', new File(['audio'], 'audio.webm', { type: 'audio/webm' }));
  formData.append('providerId', 'sensevoice-asr');
  formData.append('compatibleProviderId', 'sensevoice-asr');
  formData.append('modelId', 'iic/SenseVoiceSmall');
  formData.append('language', 'zh');
  formData.append('baseUrl', baseUrl);
  if (localServiceStartupTimeoutMs) {
    formData.append('localServiceStartupTimeoutMs', String(localServiceStartupTimeoutMs));
  }

  return new Request('http://localhost/api/transcription', {
    method: 'POST',
    body: formData,
  });
}

describe('transcription route', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    transcribeAudioMock.mockReset();
    ensureLocalModelServiceRunningMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockResolvedValue(undefined);
    delete process.env.BINGO_SENSEVOICE_IDLE_RELEASE_MS;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.BINGO_SENSEVOICE_IDLE_RELEASE_MS;
  });

  it('starts SenseVoice and retries when the local service is unreachable', async () => {
    transcribeAudioMock
      .mockRejectedValueOnce(
        new Error(
          'SenseVoice local service is not reachable at http://localhost:50001. Start scripts/sensevoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce({ text: '你好' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'sensevoice',
      port: 50001,
      started: true,
    });

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(buildRequest() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.text).toBe('你好');
    expect(transcribeAudioMock).toHaveBeenCalledTimes(2);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('sensevoice', { port: 50001 });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['sensevoice']);
  });

  it('uses the configured SenseVoice base URL port when starting the service', async () => {
    transcribeAudioMock
      .mockRejectedValueOnce(
        new Error(
          'SenseVoice local service is not reachable at http://localhost:51001. Start scripts/sensevoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce({ text: 'custom port' });

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(buildRequest('http://localhost:51001') as never);

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('sensevoice', { port: 51001 });
  });

  it('retries SenseVoice against the reachable WSL base URL returned by startup', async () => {
    transcribeAudioMock
      .mockRejectedValueOnce(
        new Error(
          'SenseVoice local service is not reachable at http://localhost:50001. Start scripts/sensevoice-local-server.ps1 first. fetch failed',
        ),
      )
      .mockResolvedValueOnce({ text: 'wsl base url' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'sensevoice',
      port: 50001,
      started: true,
      baseUrl: 'http://172.19.88.193:50001',
    });

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(buildRequest() as never);

    expect(response.status).toBe(200);
    expect(transcribeAudioMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: 'http://172.19.88.193:50001' }),
      expect.any(Buffer),
    );
  });

  it('starts SenseVoice before transcription when the test request supplies a startup timeout', async () => {
    transcribeAudioMock.mockResolvedValueOnce({ text: 'ready' });
    ensureLocalModelServiceRunningMock.mockResolvedValue({
      service: 'sensevoice',
      port: 50001,
      started: true,
      baseUrl: 'http://172.19.88.193:50001',
    });

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(buildRequest('http://localhost:50001', 120_000) as never);

    expect(response.status).toBe(200);
    expect(ensureLocalModelServiceRunningMock).toHaveBeenCalledWith('sensevoice', {
      port: 50001,
      timeoutMs: 120_000,
    });
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    expect(transcribeAudioMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://172.19.88.193:50001' }),
      expect.any(Buffer),
    );
  });

  it('keeps SenseVoice warm when requested by the caller', async () => {
    transcribeAudioMock.mockResolvedValueOnce({ text: 'warm chunk' });

    const request = buildRequest();
    const formData = await request.formData();
    formData.append('keepServiceWarm', 'true');
    const warmRequest = new Request('http://localhost/api/transcription', {
      method: 'POST',
      body: formData,
    });

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(warmRequest as never);

    expect(response.status).toBe(200);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();
  });
});

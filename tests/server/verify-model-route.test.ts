import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateTextResult, ToolSet } from 'ai';

const generateTextMock = vi.hoisted(() => vi.fn());
const resolveModelMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: resolveModelMock,
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
  return new Request('http://localhost/api/verify-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function generateTextResult(
  overrides: Partial<GenerateTextResult<ToolSet, never>>,
): GenerateTextResult<ToolSet, never> {
  return {
    text: '',
    finishReason: 'stop',
    ...overrides,
  } as GenerateTextResult<ToolSet, never>;
}

describe('verify-model route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    generateTextMock.mockReset();
    resolveModelMock.mockReset();
    resolveModelMock.mockReturnValue({
      model: {} as never,
      modelString: 'openai:gpt-4o-mini',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      modelInfo: null,
    });
  });

  it('returns success only when the model returns the verification token', async () => {
    generateTextMock.mockResolvedValue(
      generateTextResult({ text: 'BINGO_CONNECTION_OK', finishReason: 'stop' }),
    );

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      buildRequest({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'openai:gpt-4o-mini',
        providerType: 'openai',
        requiresApiKey: true,
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain('openai:gpt-4o-mini');
    expect(body.message).toContain('https://api.openai.com/v1');
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('BINGO_CONNECTION_OK'),
        maxOutputTokens: 32,
        timeout: { totalMs: 45_000, stepMs: 45_000 },
      }),
    );
  });

  it('rejects a successful SDK response that does not contain the verification token', async () => {
    generateTextMock.mockResolvedValue(
      generateTextResult({ text: 'hello', finishReason: 'stop' }),
    );

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      buildRequest({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'openai:gpt-4o-mini',
        providerType: 'openai',
        requiresApiKey: true,
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error).toContain('did not return the expected verification token');
  });

  it('rejects empty model output instead of reporting a false success', async () => {
    generateTextMock.mockResolvedValue(generateTextResult({ text: '', finishReason: 'stop' }));

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      buildRequest({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'openai:gpt-4o-mini',
        providerType: 'openai',
        requiresApiKey: true,
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
  });

  it('reports missing API key as a configuration error', async () => {
    resolveModelMock.mockImplementation(() => {
      throw new Error('API key required for provider: openai');
    });

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      buildRequest({
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'openai:gpt-4o-mini',
        providerType: 'openai',
        requiresApiKey: true,
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('MISSING_API_KEY');
  });

  it('maps invalid key errors to an authentication failure', async () => {
    generateTextMock.mockRejectedValue(new Error('401 Unauthorized: invalid api key'));

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      buildRequest({
        apiKey: 'bad-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'openai:gpt-4o-mini',
        providerType: 'openai',
        requiresApiKey: true,
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('API key is invalid or expired');
  });

  it('maps model or endpoint 404s to a model endpoint error', async () => {
    generateTextMock.mockRejectedValue(new Error('404 Not Found'));

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      buildRequest({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'openai:does-not-exist',
        providerType: 'openai',
        requiresApiKey: true,
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Model not found or API endpoint error');
  });
});

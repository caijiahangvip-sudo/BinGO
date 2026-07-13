import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock fs — only intercept server-providers.yml; delegate everything else to real fs.
// This prevents YAML config from leaking host-machine state into tests while keeping
// the mock scoped to what provider-config actually reads.
let yamlOverride: string | null = null;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const isYaml = (p: unknown) => typeof p === 'string' && p.endsWith('server-providers.yml');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
      readFileSync: (p: string, ...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
    },
    existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
    readFileSync: (p: string, ...args: unknown[]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
  };
});

describe('provider-config', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    yamlOverride = null;
  });

  describe('resolveApiKey', () => {
    it('returns client key when provided', async () => {
      const { resolveApiKey } = await import('@/lib/server/provider-config');
      expect(resolveApiKey('openai', 'sk-client')).toBe('sk-client');
    });

    it('returns server key from env when no client key', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-server');
      const { resolveApiKey } = await import('@/lib/server/provider-config');
      expect(resolveApiKey('openai')).toBe('sk-server');
    });

    it('returns empty string when neither client nor server key exists', async () => {
      const { resolveApiKey } = await import('@/lib/server/provider-config');
      expect(resolveApiKey('openai')).toBe('');
    });

    it('prefers client key over server key', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-server');
      const { resolveApiKey } = await import('@/lib/server/provider-config');
      expect(resolveApiKey('openai', 'sk-client')).toBe('sk-client');
    });

    it('resolves non-OpenAI providers via their env prefix', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-anthropic');
      const { resolveApiKey } = await import('@/lib/server/provider-config');
      expect(resolveApiKey('anthropic')).toBe('sk-anthropic');
    });

    it('returns empty string for unknown provider with no env var', async () => {
      const { resolveApiKey } = await import('@/lib/server/provider-config');
      expect(resolveApiKey('nonexistent-provider')).toBe('');
    });
  });

  describe('resolveBaseUrl', () => {
    it('returns client URL when provided', async () => {
      const { resolveBaseUrl } = await import('@/lib/server/provider-config');
      expect(resolveBaseUrl('openai', 'https://custom.api.com')).toBe('https://custom.api.com');
    });

    it('returns server URL from env when no client URL', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-test');
      vi.stubEnv('OPENAI_BASE_URL', 'https://proxy.example.com/v1');
      const { resolveBaseUrl } = await import('@/lib/server/provider-config');
      expect(resolveBaseUrl('openai')).toBe('https://proxy.example.com/v1');
    });

    it('returns undefined when neither client nor server URL exists', async () => {
      const { resolveBaseUrl } = await import('@/lib/server/provider-config');
      expect(resolveBaseUrl('openai')).toBeUndefined();
    });
  });

  describe('resolveProxy', () => {
    it('returns undefined when no proxy configured', async () => {
      const { resolveProxy } = await import('@/lib/server/provider-config');
      expect(resolveProxy('openai')).toBeUndefined();
    });

    it('returns proxy URL from YAML config', async () => {
      yamlOverride = `
providers:
  openai:
    apiKey: sk-yaml
    proxy: http://proxy.internal:8080
`;
      const { resolveProxy } = await import('@/lib/server/provider-config');
      expect(resolveProxy('openai')).toBe('http://proxy.internal:8080');
    });
  });

  describe('getServerProviders', () => {
    it('returns empty object when no providers configured', async () => {
      const { getServerProviders } = await import('@/lib/server/provider-config');
      expect(getServerProviders()).toEqual({});
    });

    it('returns provider metadata without API keys', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-secret');
      vi.stubEnv('OPENAI_BASE_URL', 'https://proxy.com/v1');
      vi.stubEnv('OPENAI_MODELS', 'gpt-4o,gpt-4o-mini');
      const { getServerProviders } = await import('@/lib/server/provider-config');
      const providers = getServerProviders();

      expect(providers.openai).toBeDefined();
      expect(providers.openai.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
      expect(providers.openai.baseUrl).toBe('https://proxy.com/v1');
      // API key must NOT be exposed
      expect((providers.openai as Record<string, unknown>).apiKey).toBeUndefined();
    });

    it('lists multiple providers', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-anthropic');
      const { getServerProviders } = await import('@/lib/server/provider-config');
      const providers = getServerProviders();

      expect(Object.keys(providers)).toContain('openai');
      expect(Object.keys(providers)).toContain('anthropic');
    });

    it('omits providers without API key', async () => {
      vi.stubEnv('OPENAI_BASE_URL', 'https://proxy.com/v1');
      // No OPENAI_API_KEY set
      const { getServerProviders } = await import('@/lib/server/provider-config');
      const providers = getServerProviders();

      expect(providers.openai).toBeUndefined();
    });

    it('does not expose Doubao as a server-side LLM provider', async () => {
      vi.stubEnv('DOUBAO_API_KEY', 'sk-doubao');
      yamlOverride = `
providers:
  doubao:
    apiKey: sk-yaml-doubao
`;
      const { getServerProviders, resolveApiKey } = await import('@/lib/server/provider-config');
      const providers = getServerProviders();

      expect(providers.doubao).toBeUndefined();
      expect(resolveApiKey('doubao')).toBe('');
    });
  });

  describe('TTS providers', () => {
    it('exposes local CosyVoice TTS with only a base URL', async () => {
      vi.stubEnv('TTS_COSYVOICE_BASE_URL', 'http://127.0.0.1:50000');
      const { getServerTTSProviders, resolveTTSBaseUrl } =
        await import('@/lib/server/provider-config');
      const providers = getServerTTSProviders();

      expect(providers['cosyvoice-tts']).toEqual({
        baseUrl: 'http://127.0.0.1:50000',
      });
      expect(resolveTTSBaseUrl('cosyvoice-tts')).toBe('http://127.0.0.1:50000');
    });

    it('does not expose Doubao TTS as a server-side TTS provider', async () => {
      vi.stubEnv('TTS_DOUBAO_API_KEY', 'app-id:access-key');
      yamlOverride = `
tts:
  doubao-tts:
    apiKey: yaml-app-id:yaml-access-key
`;
      const { getServerTTSProviders, resolveTTSApiKey } =
        await import('@/lib/server/provider-config');
      const providers = getServerTTSProviders();

      expect(providers['doubao-tts']).toBeUndefined();
      expect(resolveTTSApiKey('doubao-tts')).toBe('');
    });
  });

  describe('ASR providers', () => {
    it('exposes local SenseVoice ASR with only a base URL', async () => {
      vi.stubEnv('ASR_SENSEVOICE_BASE_URL', 'http://127.0.0.1:50001');
      const { getServerASRProviders, resolveASRBaseUrl } =
        await import('@/lib/server/provider-config');
      const providers = getServerASRProviders();

      expect(providers['sensevoice-asr']).toEqual({
        baseUrl: 'http://127.0.0.1:50001',
      });
      expect(resolveASRBaseUrl('sensevoice-asr')).toBe('http://127.0.0.1:50001');
    });
  });

  describe('env var model parsing', () => {
    it('splits comma-separated models and trims whitespace', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-test');
      vi.stubEnv('OPENAI_MODELS', ' gpt-4o , gpt-4o-mini , ');
      const { getServerProviders } = await import('@/lib/server/provider-config');
      const providers = getServerProviders();

      expect(providers.openai.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    });
  });

  describe('resolveWebSearchApiKey', () => {
    it('returns client key first', async () => {
      const { resolveWebSearchApiKey } = await import('@/lib/server/provider-config');
      expect(resolveWebSearchApiKey('client-key')).toBe('client-key');
    });

    it('falls back to TAVILY_API_KEY env var', async () => {
      vi.stubEnv('TAVILY_API_KEY', 'tvly-bare-env');
      const { resolveWebSearchApiKey } = await import('@/lib/server/provider-config');
      expect(resolveWebSearchApiKey()).toBe('tvly-bare-env');
    });
  });

  describe('PDF providers', () => {
    it('exposes MinerU local PDF provider from YAML when base URL is configured', async () => {
      yamlOverride = `
pdf:
  mineru-local:
    baseUrl: http://localhost:8888
`;
      const { getServerPDFProviders, resolvePDFBaseUrl } =
        await import('@/lib/server/provider-config');
      const providers = getServerPDFProviders();

      expect(providers).toEqual({
        'mineru-local': { baseUrl: 'http://localhost:8888' },
      });
      expect(resolvePDFBaseUrl('mineru-local')).toBe('http://localhost:8888');
    });

    it('exposes MinerU local PDF provider from env when base URL is configured', async () => {
      vi.stubEnv('PDF_MINERU_LOCAL_BASE_URL', 'http://localhost:8888');
      const { getServerPDFProviders, resolvePDFBaseUrl } =
        await import('@/lib/server/provider-config');
      const providers = getServerPDFProviders();

      expect(providers).toEqual({
        'mineru-local': { baseUrl: 'http://localhost:8888' },
      });
      expect(resolvePDFBaseUrl('mineru-local')).toBe('http://localhost:8888');
    });

    it('does not expose MinerU local without a base URL', async () => {
      yamlOverride = `
pdf:
  mineru-local:
    apiKey: sk-fake
`;
      const { getServerPDFProviders } = await import('@/lib/server/provider-config');
      const providers = getServerPDFProviders();

      expect(providers).toEqual({});
    });
  });

  describe('Vector providers', () => {
    it('exposes vector providers from env without leaking API keys', async () => {
      vi.stubEnv('VECTOR_OPENAI_API_KEY', 'sk-openai-vector');
      vi.stubEnv('VECTOR_OPENAI_BASE_URL', 'https://proxy.openai.com/v1');
      vi.stubEnv('VECTOR_OPENAI_MODELS', 'text-embedding-3-small, text-embedding-3-large');
      vi.stubEnv('VECTOR_QWEN_API_KEY', 'sk-qwen-vector');
      vi.stubEnv('BINGO_EMBEDDING_BASE_URL', 'http://127.0.0.1:50003');

      const { getServerVectorProviders, resolveVectorApiKey, resolveVectorBaseUrl } =
        await import('@/lib/server/provider-config');
      const providers = getServerVectorProviders();

      expect(providers['openai-embedding']).toEqual({
        models: ['text-embedding-3-small', 'text-embedding-3-large'],
        baseUrl: 'https://proxy.openai.com/v1',
      });
      expect(providers['qwen-embedding']).toEqual({});
      expect(providers.siliconflow).toEqual({
        models: ['BAAI/bge-base-zh-v1.5'],
        baseUrl: 'http://127.0.0.1:50003',
      });
      expect((providers['openai-embedding'] as Record<string, unknown>).apiKey).toBeUndefined();
      expect(resolveVectorApiKey('openai-embedding')).toBe('sk-openai-vector');
      expect(resolveVectorApiKey('qwen-embedding')).toBe('sk-qwen-vector');
      expect(resolveVectorBaseUrl('chinese-xinhua-local')).toBe('http://127.0.0.1:50003');
      expect(resolveVectorBaseUrl('siliconflow')).toBe('http://127.0.0.1:50003');
    });

    it('loads vector providers from YAML', async () => {
      yamlOverride = `
vector:
  openai-embedding:
    apiKey: sk-yaml-vector
    baseUrl: https://proxy.example.com/v1
    models:
      - text-embedding-3-small
  chinese-xinhua-local:
    baseUrl: http://localhost:8888
`;
      const { getServerVectorProviders, resolveVectorApiKey, resolveVectorBaseUrl } =
        await import('@/lib/server/provider-config');
      const providers = getServerVectorProviders();

      expect(providers['openai-embedding']).toEqual({
        models: ['text-embedding-3-small'],
        baseUrl: 'https://proxy.example.com/v1',
      });
      expect(providers.siliconflow).toEqual({
        models: ['BAAI/bge-base-zh-v1.5'],
        baseUrl: 'http://localhost:8888',
      });
      expect(resolveVectorApiKey('openai-embedding')).toBe('sk-yaml-vector');
      expect(resolveVectorBaseUrl('openai-embedding')).toBe('https://proxy.example.com/v1');
    });

    it('merges local BGE into SiliconFlow without overriding remote SiliconFlow config', async () => {
      vi.stubEnv('VECTOR_SILICONFLOW_API_KEY', 'sk-siliconflow-vector');
      vi.stubEnv('VECTOR_SILICONFLOW_BASE_URL', 'https://api.siliconflow.cn/v1');
      vi.stubEnv('VECTOR_SILICONFLOW_MODELS', 'BAAI/bge-m3');
      vi.stubEnv('BINGO_EMBEDDING_BASE_URL', 'http://127.0.0.1:50003');

      const { getServerVectorProviders, resolveVectorApiKey, resolveVectorBaseUrl } =
        await import('@/lib/server/provider-config');
      const providers = getServerVectorProviders();

      expect(providers.siliconflow).toEqual({
        models: ['BAAI/bge-base-zh-v1.5', 'BAAI/bge-m3'],
        baseUrl: 'https://api.siliconflow.cn/v1',
      });
      expect(resolveVectorApiKey('siliconflow')).toBe('sk-siliconflow-vector');
      expect(resolveVectorBaseUrl('siliconflow')).toBe('https://api.siliconflow.cn/v1');
    });
  });
});

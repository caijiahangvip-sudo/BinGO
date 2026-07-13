import net from 'net';
import {
  ensureLocalModelServiceRunning,
  getWslIpAddresses,
  releaseLocalModelServicesSafely,
} from '@/lib/server/local-model-services';
import { LOCAL_BGE_BASE_ZH_MODEL_ID } from '@/lib/vector/constants';

const DEFAULT_EMBEDDING_PORT = 50003;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_EMBEDDING_PORT}`;
const HEALTH_TIMEOUT_MS = 3000;
const DEFAULT_EMBEDDING_IDLE_RELEASE_MS = 10 * 60 * 1000;

export interface ChineseXinhuaSemanticMatch {
  score: number;
  type: string;
  key: string;
  text: string;
}

export interface ChineseXinhuaEmbeddingStatus {
  configuredBaseUrl: string;
  activeBaseUrl: string;
  candidateBaseUrls: string[];
  port: number;
  listening: boolean;
  service?: Record<string, unknown>;
  error?: string;
}

export interface ChineseXinhuaEmbeddingConnectionTestResult {
  result: Awaited<ReturnType<typeof ensureLocalModelServiceRunning>>;
  status: ChineseXinhuaEmbeddingStatus;
  message: string;
}

interface ChineseXinhuaEmbeddingEndpoint {
  configuredBaseUrl: string;
  activeBaseUrl: string;
  candidateBaseUrls: string[];
  port: number;
  listening: boolean;
}

let activeEmbeddingRequests = 0;
let embeddingReleaseTimer: ReturnType<typeof setTimeout> | undefined;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveConfiguredBaseUrl(baseUrl?: string): string {
  return trimTrailingSlash(
    baseUrl?.trim() || process.env.BINGO_EMBEDDING_BASE_URL?.trim() || DEFAULT_BASE_URL,
  );
}

function resolvePort(baseUrl = resolveConfiguredBaseUrl()): number {
  try {
    const parsed = new URL(baseUrl);
    const port = Number.parseInt(parsed.port || '', 10);
    if (Number.isFinite(port) && port > 0) return port;
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return DEFAULT_EMBEDDING_PORT;
  }
}

export function parseChineseXinhuaEmbeddingBaseUrl(baseUrl?: string): string {
  const resolvedBaseUrl = resolveConfiguredBaseUrl(baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(resolvedBaseUrl);
  } catch {
    throw new Error('Invalid vector Base URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Vector Base URL must start with http:// or https://');
  }

  if (!parsed.hostname) {
    throw new Error('Vector Base URL must include a host');
  }

  if (parsed.port) {
    const port = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('Vector Base URL port is invalid');
    }
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Vector Base URL must not include credentials, query, or hash');
  }

  return trimTrailingSlash(parsed.toString());
}

function getEmbeddingIdleReleaseMs(): number {
  const envValue = Number.parseInt(process.env.BINGO_EMBEDDING_IDLE_RELEASE_MS ?? '', 10);
  return Number.isFinite(envValue) && envValue >= 0
    ? envValue
    : DEFAULT_EMBEDDING_IDLE_RELEASE_MS;
}

function beginEmbeddingRequest(): void {
  activeEmbeddingRequests += 1;
  if (embeddingReleaseTimer) {
    clearTimeout(embeddingReleaseTimer);
    embeddingReleaseTimer = undefined;
  }
}

export function scheduleChineseXinhuaEmbeddingIdleRelease(): void {
  activeEmbeddingRequests = Math.max(0, activeEmbeddingRequests - 1);
  if (activeEmbeddingRequests > 0) return;

  if (embeddingReleaseTimer) {
    clearTimeout(embeddingReleaseTimer);
  }

  const idleMs = getEmbeddingIdleReleaseMs();
  embeddingReleaseTimer = setTimeout(() => {
    embeddingReleaseTimer = undefined;
    if (activeEmbeddingRequests > 0) return;
    releaseLocalModelServicesSafely(['embedding']).catch(() => undefined);
  }, idleMs);

  embeddingReleaseTimer.unref?.();
}

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    return isLoopbackHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

function getPortProbeHost(baseUrl: string): string {
  try {
    const hostname = new URL(baseUrl).hostname;
    return isLoopbackHost(hostname) ? '127.0.0.1' : hostname;
  } catch {
    return '127.0.0.1';
  }
}

function buildBaseUrlForHost(baseUrl: string, host: string): string | undefined {
  try {
    const parsed = new URL(baseUrl);
    parsed.hostname = host;
    parsed.port = String(resolvePort(baseUrl));
    return trimTrailingSlash(parsed.toString());
  } catch {
    return undefined;
  }
}

async function getCandidateBaseUrls(configuredBaseUrl: string): Promise<string[]> {
  const candidates = [configuredBaseUrl];
  if (process.platform === 'win32' && isLoopbackBaseUrl(configuredBaseUrl)) {
    for (const address of await getWslIpAddresses()) {
      const wslBaseUrl = buildBaseUrlForHost(configuredBaseUrl, address);
      if (wslBaseUrl) candidates.push(wslBaseUrl);
    }
  }

  return [...new Set(candidates.map(trimTrailingSlash))];
}

function testPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function resolveEndpoint(baseUrl?: string): Promise<ChineseXinhuaEmbeddingEndpoint> {
  const configuredBaseUrl = parseChineseXinhuaEmbeddingBaseUrl(baseUrl);
  const candidateBaseUrls = await getCandidateBaseUrls(configuredBaseUrl);
  const port = resolvePort(configuredBaseUrl);

  for (const candidateBaseUrl of candidateBaseUrls) {
    if (await testPortListening(resolvePort(candidateBaseUrl), getPortProbeHost(candidateBaseUrl))) {
      return {
        configuredBaseUrl,
        activeBaseUrl: candidateBaseUrl,
        candidateBaseUrls,
        port,
        listening: true,
      };
    }
  }

  return {
    configuredBaseUrl,
    activeBaseUrl: configuredBaseUrl,
    candidateBaseUrls,
    port,
    listening: false,
  };
}

async function fetchHealth(baseUrl: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function describeEmbeddingService(status: ChineseXinhuaEmbeddingStatus): string {
  const service = status.service || {};
  const device = typeof service.device === 'string' && service.device ? service.device : 'unknown';
  const torchHip =
    typeof service.torchHip === 'string' && service.torchHip ? service.torchHip : 'ROCm unknown';
  const devices = Array.isArray(service.cudaDevices)
    ? service.cudaDevices.filter((item): item is string => typeof item === 'string')
    : [];
  const deviceLabel = devices.length > 0 ? devices.join(', ') : device;

  return `连接成功：${status.activeBaseUrl}，模型 ${LOCAL_BGE_BASE_ZH_MODEL_ID}，ROCm ${torchHip}，设备 ${deviceLabel}`;
}

function validateEmbeddingServiceHealth(status: ChineseXinhuaEmbeddingStatus): void {
  const service = status.service || {};

  if (!status.listening) {
    throw new Error(`Embedding service is not listening on port ${status.port}`);
  }
  if (status.error) {
    throw new Error(status.error);
  }
  if (service.model !== LOCAL_BGE_BASE_ZH_MODEL_ID) {
    throw new Error(`Vector service model mismatch: expected ${LOCAL_BGE_BASE_ZH_MODEL_ID}`);
  }
  if (service.ok === false) {
    throw new Error(String(service.startupError || 'Vector service is not ready'));
  }
  if (service.cudaAvailable !== true) {
    throw new Error('Vector service is not using ROCm/CUDA acceleration');
  }
  if (typeof service.torchHip !== 'string' || !service.torchHip.trim()) {
    throw new Error('Vector service is not running on ROCm');
  }
}

export async function getChineseXinhuaEmbeddingStatus(
  baseUrl?: string,
): Promise<ChineseXinhuaEmbeddingStatus> {
  const endpoint = await resolveEndpoint(baseUrl);
  if (!endpoint.listening) {
    return endpoint;
  }

  try {
    const response = await fetchHealth(endpoint.activeBaseUrl);
    const service = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...endpoint,
      service,
      ...(response.ok ? {} : { error: `Embedding service returned ${response.status}` }),
    };
  } catch (error) {
    return {
      ...endpoint,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureChineseXinhuaEmbeddingRunning(timeoutMs?: number, baseUrl?: string) {
  const resolvedBaseUrl = parseChineseXinhuaEmbeddingBaseUrl(baseUrl);
  const port = resolvePort(resolvedBaseUrl);
  const result = await ensureLocalModelServiceRunning('embedding', {
    port,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return {
    ...result,
    baseUrl: result.baseUrl || resolvedBaseUrl,
  };
}

export async function testChineseXinhuaEmbeddingConnection(
  baseUrl?: string,
  timeoutMs?: number,
): Promise<ChineseXinhuaEmbeddingConnectionTestResult> {
  const resolvedBaseUrl = parseChineseXinhuaEmbeddingBaseUrl(baseUrl);
  const port = resolvePort(resolvedBaseUrl);
  const result = await ensureLocalModelServiceRunning('embedding', {
    port,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const status = await getChineseXinhuaEmbeddingStatus(resolvedBaseUrl);
  validateEmbeddingServiceHealth(status);

  return {
    result: {
      ...result,
      baseUrl: result.baseUrl || resolvedBaseUrl,
    },
    status,
    message: describeEmbeddingService(status),
  };
}

export async function semanticSearchChineseXinhua(
  query: string,
  limit: number,
): Promise<{ matches: ChineseXinhuaSemanticMatch[]; error?: string }> {
  beginEmbeddingRequest();
  try {
    let endpoint = await resolveEndpoint();
    if (!endpoint.listening) {
      await ensureChineseXinhuaEmbeddingRunning();
      endpoint = await resolveEndpoint();
    }

    if (!endpoint.listening) {
      return { matches: [], error: `Embedding service is not listening on port ${endpoint.port}` };
    }

    const response = await fetch(`${endpoint.activeBaseUrl}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    });

    if (!response.ok) {
      return { matches: [], error: `Embedding service returned ${response.status}` };
    }

    const data = (await response.json()) as { results?: ChineseXinhuaSemanticMatch[] };
    return { matches: Array.isArray(data.results) ? data.results : [] };
  } catch (error) {
    return {
      matches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    scheduleChineseXinhuaEmbeddingIdleRelease();
  }
}

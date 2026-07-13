/**
 * Server-side Provider Configuration
 *
 * Loads provider configs from YAML (primary) + environment variables (fallback).
 * Keys never leave the server; only provider IDs and metadata are exposed via API.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createLogger } from '@/lib/logger';
import { LOCAL_BGE_BASE_ZH_MODEL_ID, normalizeVectorProviderId } from '@/lib/vector/constants';

const log = createLogger('ServerProviderConfig');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServerProviderEntry {
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  proxy?: string;
}

interface ServerConfig {
  providers: Record<string, ServerProviderEntry>;
  tts: Record<string, ServerProviderEntry>;
  asr: Record<string, ServerProviderEntry>;
  pdf: Record<string, ServerProviderEntry>;
  vector: Record<string, ServerProviderEntry>;
  webSearch: Record<string, ServerProviderEntry>;
}

// ---------------------------------------------------------------------------
// Env-var prefix mappings
// ---------------------------------------------------------------------------

const LLM_ENV_MAP: Record<string, string> = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GOOGLE: 'google',
  DEEPSEEK: 'deepseek',
  QWEN: 'qwen',
  KIMI: 'kimi',
  MINIMAX: 'minimax',
  GLM: 'glm',
  SILICONFLOW: 'siliconflow',
  GROK: 'grok',
};

const TTS_ENV_MAP: Record<string, string> = {
  TTS_OPENAI: 'openai-tts',
  TTS_AZURE: 'azure-tts',
  TTS_GLM: 'glm-tts',
  TTS_QWEN: 'qwen-tts',
  TTS_COSYVOICE: 'cosyvoice-tts',
  TTS_ELEVENLABS: 'elevenlabs-tts',
  TTS_MINIMAX: 'minimax-tts',
};

const ASR_ENV_MAP: Record<string, string> = {
  ASR_OPENAI: 'openai-whisper',
  ASR_QWEN: 'qwen-asr',
  ASR_SENSEVOICE: 'sensevoice-asr',
};

const PDF_ENV_MAP: Record<string, string> = {
  PDF_MINERU_LOCAL: 'mineru-local',
};

const VECTOR_ENV_MAP: Record<string, string> = {
  VECTOR_OPENAI: 'openai-embedding',
  VECTOR_QWEN: 'qwen-embedding',
  VECTOR_SILICONFLOW: 'siliconflow',
  BINGO_EMBEDDING: 'chinese-xinhua-local',
};

const WEB_SEARCH_ENV_MAP: Record<string, string> = {
  TAVILY: 'tavily',
};

const CLIENT_ONLY_LLM_PROVIDER_IDS = new Set(['doubao']);
const CLIENT_ONLY_TTS_PROVIDER_IDS = new Set(['doubao-tts']);

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

type YamlData = Partial<{
  providers: Record<string, Partial<ServerProviderEntry>>;
  tts: Record<string, Partial<ServerProviderEntry>>;
  asr: Record<string, Partial<ServerProviderEntry>>;
  pdf: Record<string, Partial<ServerProviderEntry>>;
  vector: Record<string, Partial<ServerProviderEntry>>;
  'web-search': Record<string, Partial<ServerProviderEntry>>;
}>;

function loadYamlFile(filename: string): YamlData {
  try {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as YamlData;
  } catch (e) {
    log.warn(`[ServerProviderConfig] Failed to load ${filename}:`, e);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Env-var helpers
// ---------------------------------------------------------------------------

function loadEnvSection(
  envMap: Record<string, string>,
  yamlSection: Record<string, Partial<ServerProviderEntry>> | undefined,
  { requiresBaseUrl = false }: { requiresBaseUrl?: boolean } = {},
): Record<string, ServerProviderEntry> {
  const result: Record<string, ServerProviderEntry> = {};

  // First, add everything from YAML as defaults
  if (yamlSection) {
    for (const [id, entry] of Object.entries(yamlSection)) {
      const hasKey = !!entry?.apiKey;
      const hasUrl = !!entry?.baseUrl;
      if (requiresBaseUrl ? hasUrl : hasKey) {
        result[id] = {
          apiKey: entry.apiKey || '',
          baseUrl: entry.baseUrl,
          models: entry.models,
          proxy: entry.proxy,
        };
      }
    }
  }

  // Then, apply env vars (env takes priority over YAML)
  for (const [prefix, providerId] of Object.entries(envMap)) {
    const envApiKey = process.env[`${prefix}_API_KEY`] || undefined;
    const envBaseUrl = process.env[`${prefix}_BASE_URL`] || undefined;
    const envModelsStr = process.env[`${prefix}_MODELS`];
    const envModels = envModelsStr
      ? envModelsStr
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
      : undefined;

    if (result[providerId]) {
      // YAML entry exists; env vars override individual fields.
      if (envApiKey) result[providerId].apiKey = envApiKey;
      if (envBaseUrl) result[providerId].baseUrl = envBaseUrl;
      if (envModels) result[providerId].models = envModels;
      continue;
    }

    if (requiresBaseUrl ? !envBaseUrl : !envApiKey) continue;
    result[providerId] = {
      apiKey: envApiKey || '',
      baseUrl: envBaseUrl,
      models: envModels,
    };
  }

  return result;
}

function loadTtsEnvSection(
  yamlSection: Record<string, Partial<ServerProviderEntry>> | undefined,
): Record<string, ServerProviderEntry> {
  return {
    ...loadEnvSection(TTS_ENV_MAP, yamlSection),
    ...loadEnvSection(
      { TTS_COSYVOICE: 'cosyvoice-tts' },
      yamlSection ? { 'cosyvoice-tts': yamlSection['cosyvoice-tts'] } : undefined,
      { requiresBaseUrl: true },
    ),
  };
}

function loadAsrEnvSection(
  yamlSection: Record<string, Partial<ServerProviderEntry>> | undefined,
): Record<string, ServerProviderEntry> {
  return {
    ...loadEnvSection(ASR_ENV_MAP, yamlSection),
    ...loadEnvSection(
      { ASR_SENSEVOICE: 'sensevoice-asr' },
      yamlSection ? { 'sensevoice-asr': yamlSection['sensevoice-asr'] } : undefined,
      { requiresBaseUrl: true },
    ),
  };
}

function loadVectorEnvSection(
  yamlSection: Record<string, Partial<ServerProviderEntry>> | undefined,
): Record<string, ServerProviderEntry> {
  const entries = [
    ...Object.entries(loadEnvSection(VECTOR_ENV_MAP, yamlSection)),
    ...Object.entries(loadEnvSection(
      { BINGO_EMBEDDING: 'chinese-xinhua-local' },
      yamlSection ? { 'chinese-xinhua-local': yamlSection['chinese-xinhua-local'] } : undefined,
      { requiresBaseUrl: true },
    )),
  ];
  const result: Record<string, ServerProviderEntry> = {};
  for (const [id, entry] of entries) {
    const normalizedId = normalizeVectorProviderId(id);
    const existing = result[normalizedId];
    const models = entry.models || existing?.models;
    const isLocalEmbedding =
      id === 'chinese-xinhua-local' || (id === 'siliconflow' && !!entry.baseUrl && !entry.apiKey);
    const mergedModels =
      isLocalEmbedding && !(models || []).includes(LOCAL_BGE_BASE_ZH_MODEL_ID)
        ? [LOCAL_BGE_BASE_ZH_MODEL_ID, ...(models || [])]
        : models;
    const existingHasRemoteConfig =
      !!existing?.apiKey ||
      (!!existing?.baseUrl && existing.baseUrl !== entry.baseUrl && !/localhost|127\.0\.0\.1/.test(existing.baseUrl));
    const nextApiKey = entry.apiKey || existing?.apiKey || '';
    const nextBaseUrl =
      isLocalEmbedding && existingHasRemoteConfig
        ? existing?.baseUrl
        : entry.apiKey
          ? entry.baseUrl
          : existing?.baseUrl || entry.baseUrl;
    result[normalizedId] = {
      ...existing,
      ...entry,
      apiKey: nextApiKey,
      baseUrl: nextBaseUrl,
      models: mergedModels,
    };
  }
  return result;
}

function omitProviderIds(
  entries: Record<string, ServerProviderEntry>,
  providerIds: Set<string>,
): Record<string, ServerProviderEntry> {
  if (providerIds.size === 0) return entries;
  return Object.fromEntries(Object.entries(entries).filter(([id]) => !providerIds.has(id)));
}

// ---------------------------------------------------------------------------
// Module-level cache (process singleton)
// ---------------------------------------------------------------------------

const DEFAULT_FILENAME = 'server-providers.yml';

/** Cache keyed by YAML filename (empty string = default file). */
const _configs: Map<string, ServerConfig> = new Map();

function buildConfig(yamlData: YamlData): ServerConfig {
  return {
    providers: omitProviderIds(
      loadEnvSection(LLM_ENV_MAP, yamlData.providers),
      CLIENT_ONLY_LLM_PROVIDER_IDS,
    ),
    tts: omitProviderIds(loadTtsEnvSection(yamlData.tts), CLIENT_ONLY_TTS_PROVIDER_IDS),
    asr: loadAsrEnvSection(yamlData.asr),
    pdf: loadEnvSection(PDF_ENV_MAP, yamlData.pdf, { requiresBaseUrl: true }),
    vector: loadVectorEnvSection(yamlData.vector),
    webSearch: loadEnvSection(WEB_SEARCH_ENV_MAP, yamlData['web-search']),
  };
}

function logConfig(config: ServerConfig, label: string): void {
  const counts = [
    Object.keys(config.providers).length,
    Object.keys(config.tts).length,
    Object.keys(config.asr).length,
    Object.keys(config.pdf).length,
    Object.keys(config.vector).length,
    Object.keys(config.webSearch).length,
  ];
  if (counts.some((c) => c > 0)) {
    log.info(
      `[ServerProviderConfig] Loaded (${label}): ${counts[0]} LLM, ${counts[1]} TTS, ${counts[2]} ASR, ${counts[3]} PDF, ${counts[4]} Vector, ${counts[5]} WebSearch providers`,
    );
  }
}

function getConfig(): ServerConfig {
  const cached = _configs.get('');
  if (cached) return cached;

  const yamlData = loadYamlFile(DEFAULT_FILENAME);
  const config = buildConfig(yamlData);
  logConfig(config, DEFAULT_FILENAME);
  _configs.set('', config);
  return config;
}

// ---------------------------------------------------------------------------
// Public API - LLM
// ---------------------------------------------------------------------------

/** Returns server-configured LLM providers (no apiKeys) */
export function getServerProviders(): Record<string, { models?: string[]; baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { models?: string[]; baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.providers)) {
    result[id] = {};
    if (entry.models && entry.models.length > 0) result[id].models = entry.models;
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

/** Resolve API key: client key > server key > empty string */
export function resolveApiKey(providerId: string, clientKey?: string): string {
  if (clientKey) return clientKey;
  return getConfig().providers[providerId]?.apiKey || '';
}

/** Resolve base URL: client > server > undefined */
export function resolveBaseUrl(providerId: string, clientBaseUrl?: string): string | undefined {
  if (clientBaseUrl) return clientBaseUrl;
  return getConfig().providers[providerId]?.baseUrl;
}

/** Resolve proxy URL for a provider (server config only) */
export function resolveProxy(providerId: string): string | undefined {
  return getConfig().providers[providerId]?.proxy;
}

// ---------------------------------------------------------------------------
// Public API - TTS
// ---------------------------------------------------------------------------

export function getServerTTSProviders(): Record<string, { baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.tts)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

export function resolveTTSApiKey(providerId: string, clientKey?: string): string {
  if (clientKey) return clientKey;
  return getConfig().tts[providerId]?.apiKey || '';
}

export function resolveTTSBaseUrl(providerId: string, clientBaseUrl?: string): string | undefined {
  if (clientBaseUrl) return clientBaseUrl;
  return getConfig().tts[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API - ASR
// ---------------------------------------------------------------------------

export function getServerASRProviders(): Record<string, { baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.asr)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

export function resolveASRApiKey(providerId: string, clientKey?: string): string {
  if (clientKey) return clientKey;
  return getConfig().asr[providerId]?.apiKey || '';
}

export function resolveASRBaseUrl(providerId: string, clientBaseUrl?: string): string | undefined {
  if (clientBaseUrl) return clientBaseUrl;
  return getConfig().asr[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API - PDF
// ---------------------------------------------------------------------------

export function getServerPDFProviders(): Record<string, { baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.pdf)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

export function resolvePDFApiKey(providerId: string, clientKey?: string): string {
  if (clientKey) return clientKey;
  return getConfig().pdf[providerId]?.apiKey || '';
}

export function resolvePDFBaseUrl(providerId: string, clientBaseUrl?: string): string | undefined {
  if (clientBaseUrl) return clientBaseUrl;
  return getConfig().pdf[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API - Vector / Embedding
// ---------------------------------------------------------------------------

export function getServerVectorProviders(): Record<string, { models?: string[]; baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { models?: string[]; baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.vector)) {
    result[id] = {};
    if (entry.models && entry.models.length > 0) result[id].models = entry.models;
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

export function resolveVectorApiKey(providerId: string, clientKey?: string): string {
  if (clientKey) return clientKey;
  return getConfig().vector[normalizeVectorProviderId(providerId)]?.apiKey || '';
}

export function resolveVectorBaseUrl(
  providerId: string,
  clientBaseUrl?: string,
): string | undefined {
  if (clientBaseUrl) return clientBaseUrl;
  return getConfig().vector[normalizeVectorProviderId(providerId)]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API - Web Search (Tavily)
// ---------------------------------------------------------------------------

/** Returns server-configured web search providers (no apiKeys exposed) */
export function getServerWebSearchProviders(): Record<string, { baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.webSearch)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

/** Resolve Tavily API key: client key > server key > TAVILY_API_KEY env > empty */
export function resolveWebSearchApiKey(clientKey?: string): string {
  if (clientKey) return clientKey;
  const serverKey = getConfig().webSearch.tavily?.apiKey;
  if (serverKey) return serverKey;
  return process.env.TAVILY_API_KEY || '';
}

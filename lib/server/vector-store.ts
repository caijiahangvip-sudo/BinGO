import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { createLogger } from '@/lib/logger';
import type { LearningEvidenceRecord } from '@/lib/types/learning-profile';
import { getBingoDataRoot } from '@/lib/server/runtime-paths';
import { resolveVectorApiKey, resolveVectorBaseUrl } from '@/lib/server/provider-config';
import { VECTOR_PROVIDERS, normalizeVectorProviderId } from '@/lib/vector/constants';
import type { VectorProviderId } from '@/lib/vector/types';
import { resolveEndpointUrl } from '@/lib/utils/api-url';

const log = createLogger('StudentEvidenceVectorStore');

export const DEFAULT_RAG_STUDENT_ID = 'local-student';
const DEFAULT_PROVIDER_ID = 'openai-embedding';
const DEFAULT_MODEL_ID = 'text-embedding-3-small';
const FALLBACK_MODEL_ID = 'local-hash-embedding-v1';
const FALLBACK_DIMENSIONS = 256;
const TOP_K_DEFAULT = 3;
const VECTOR_OPERATION_TIMEOUT_MS = 5_000;

class VectorOperationTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'VectorOperationTimeoutError';
  }
}

interface EmbeddingResponse {
  data?: Array<{
    embedding?: unknown;
  }>;
  error?: {
    message?: string;
  };
}

interface PersistedStudentEvidenceVector {
  id: string;
  studentId: string;
  evidence: LearningEvidenceRecord;
  text: string;
  embedding: number[];
  embeddingModel: string;
  providerId: string;
  updatedAt: number;
}

interface PersistedVectorStore {
  version: 1;
  records: PersistedStudentEvidenceVector[];
}

export interface StudentEvidenceVectorMatch {
  evidence: LearningEvidenceRecord;
  text: string;
  score: number;
  embeddingModel: string;
}

export interface SearchStudentEvidenceEmbeddingsParams {
  studentId: string;
  query: string;
  topK?: number;
  planId?: string;
  lessonId?: string;
  stageId?: string;
}

function getStorePath(): string {
  return path.join(getBingoDataRoot(), 'vector-store', 'student-evidence.json');
}

async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new VectorOperationTimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readStore(): Promise<PersistedVectorStore> {
  try {
    const raw = await readFile(getStorePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedVectorStore>;
    if (!Array.isArray(parsed.records)) {
      return { version: 1, records: [] };
    }
    return {
      version: 1,
      records: parsed.records.filter(isPersistedStudentEvidenceVector),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { version: 1, records: [] };
    }
    log.warn('Failed to read vector store; starting with empty store:', error);
    return { version: 1, records: [] };
  }
}

async function writeStore(store: PersistedVectorStore): Promise<void> {
  const storePath = getStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isPersistedStudentEvidenceVector(value: unknown): value is PersistedStudentEvidenceVector {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PersistedStudentEvidenceVector>;
  return (
    typeof record.id === 'string' &&
    typeof record.studentId === 'string' &&
    typeof record.text === 'string' &&
    Array.isArray(record.embedding) &&
    record.embedding.every((item) => typeof item === 'number') &&
    !!record.evidence &&
    typeof record.evidence === 'object'
  );
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function getMetadataString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function buildEvidenceEmbeddingText(evidence: LearningEvidenceRecord): string {
  const metadata = evidence.metadata ?? {};
  const tags = getStringArray(metadata.tags);
  const evidenceKind = getMetadataString(metadata.evidenceKind);
  const assistantFeedback = getMetadataString(metadata.assistantFeedback);

  return [
    `Prompt: ${evidence.prompt}`,
    `Student response: ${evidence.response}`,
    evidence.aiComment ? `AI feedback: ${evidence.aiComment}` : '',
    assistantFeedback ? `Assistant feedback: ${assistantFeedback}` : '',
    evidenceKind ? `Evidence kind: ${evidenceKind}` : '',
    tags.length > 0 ? `Learning tags: ${tags.join(', ')}` : '',
    evidence.knowledgePointIds.length > 0
      ? `Knowledge points: ${evidence.knowledgePointIds.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function resolveEmbeddingRuntime(): {
  providerId: VectorProviderId;
  modelId: string;
  apiKey: string;
  endpointUrl: string | null;
} {
  const requestedProviderId = (process.env.BINGO_RAG_VECTOR_PROVIDER_ID ||
    DEFAULT_PROVIDER_ID) as VectorProviderId;
  const providerId = normalizeVectorProviderId(requestedProviderId);
  const provider = VECTOR_PROVIDERS[providerId];
  const modelId =
    process.env.BINGO_RAG_EMBEDDING_MODEL || provider?.defaultModelId || DEFAULT_MODEL_ID;
  const apiKey = resolveVectorApiKey(providerId);
  const baseUrl = resolveVectorBaseUrl(providerId);
  const endpointUrl = provider
    ? resolveEndpointUrl(baseUrl, provider.defaultBaseUrl, '/embeddings')
    : null;

  return { providerId, modelId, apiKey, endpointUrl };
}

async function createRemoteEmbedding(
  text: string,
  signal?: AbortSignal,
): Promise<{
  embedding: number[];
  embeddingModel: string;
  providerId: string;
} | null> {
  const { providerId, modelId, apiKey, endpointUrl } = resolveEmbeddingRuntime();
  const provider = VECTOR_PROVIDERS[providerId];
  if (!provider || !endpointUrl) {
    log.warn(`Vector provider "${providerId}" is not configured; using local fallback embedding`);
    return null;
  }
  if (provider.requiresApiKey && !apiKey) {
    log.warn(`Vector provider "${providerId}" has no API key; using local fallback embedding`);
    return null;
  }

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        input: text,
      }),
      cache: 'no-store',
      signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      log.warn(
        `Embedding provider returned ${response.status}; using local fallback embedding: ${responseText.slice(0, 240)}`,
      );
      return null;
    }

    const data = JSON.parse(responseText || '{}') as EmbeddingResponse;
    if (data.error?.message) {
      log.warn(`Embedding provider error; using local fallback embedding: ${data.error.message}`);
      return null;
    }

    const embedding = data.data?.[0]?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      !embedding.every((value) => typeof value === 'number')
    ) {
      log.warn('Embedding provider response did not include a valid vector; using local fallback');
      return null;
    }

    return {
      embedding,
      embeddingModel: modelId,
      providerId,
    };
  } catch (error) {
    log.warn('Embedding request failed; using local fallback embedding:', error);
    return null;
  }
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createFallbackEmbedding(text: string): number[] {
  const embedding = new Array<number>(FALLBACK_DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、()[\]{}"'“”‘’<>《》/\\|+-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const sourceTokens = tokens.length > 0 ? tokens : Array.from(text);
  for (const token of sourceTokens) {
    const hash = hashToken(token);
    const index = hash % FALLBACK_DIMENSIONS;
    const sign = hash & 1 ? 1 : -1;
    embedding[index] += sign * Math.sqrt(token.length || 1);
  }

  return normalizeVector(embedding);
}

async function createEmbedding(
  text: string,
  signal?: AbortSignal,
): Promise<{
  embedding: number[];
  embeddingModel: string;
  providerId: string;
}> {
  const remote = await createRemoteEmbedding(text, signal);
  if (remote) {
    return {
      ...remote,
      embedding: normalizeVector(remote.embedding),
    };
  }

  return {
    embedding: createFallbackEmbedding(text),
    embeddingModel: FALLBACK_MODEL_ID,
    providerId: 'local',
  };
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return vector;
  return vector.map((value) => value / magnitude);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA <= 0 || normB <= 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function upsertStudentEvidenceEmbedding(
  studentId: string,
  evidence: LearningEvidenceRecord,
): Promise<void> {
  await withTimeout(
    'upsertStudentEvidenceEmbedding',
    VECTOR_OPERATION_TIMEOUT_MS,
    async (signal) => {
      const resolvedStudentId = studentId || evidence.studentId || DEFAULT_RAG_STUDENT_ID;
      const text = buildEvidenceEmbeddingText(evidence);
      if (!text.trim()) {
        log.warn(`Skipping empty evidence embedding for evidence "${evidence.id}"`);
        return;
      }

      const { embedding, embeddingModel, providerId } = await createEmbedding(text, signal);
      const store = await readStore();
      const nextRecord: PersistedStudentEvidenceVector = {
        id: evidence.id,
        studentId: resolvedStudentId,
        evidence: {
          ...evidence,
          studentId: resolvedStudentId,
        },
        text,
        embedding,
        embeddingModel,
        providerId,
        updatedAt: Date.now(),
      };

      const existingIndex = store.records.findIndex(
        (record) => record.id === evidence.id && record.studentId === resolvedStudentId,
      );
      if (existingIndex >= 0) {
        store.records[existingIndex] = nextRecord;
      } else {
        store.records.push(nextRecord);
      }

      await writeStore(store);
    },
  );
}

export async function searchStudentEvidenceEmbeddings(
  params: SearchStudentEvidenceEmbeddingsParams,
): Promise<StudentEvidenceVectorMatch[]> {
  return withTimeout(
    'searchStudentEvidenceEmbeddings',
    VECTOR_OPERATION_TIMEOUT_MS,
    async (signal) => {
      const query = params.query.trim();
      if (!query) return [];

      const resolvedStudentId = params.studentId || DEFAULT_RAG_STUDENT_ID;
      const { embedding: queryEmbedding } = await createEmbedding(query, signal);
      const store = await readStore();
      const topK = Math.max(1, params.topK ?? TOP_K_DEFAULT);

      return store.records
        .filter((record) => record.studentId === resolvedStudentId)
        .filter((record) => (params.planId ? record.evidence.planId === params.planId : true))
        .filter((record) => (params.lessonId ? record.evidence.lessonId === params.lessonId : true))
        .filter((record) => (params.stageId ? record.evidence.stageId === params.stageId : true))
        .map((record) => ({
          evidence: record.evidence,
          text: record.text,
          embeddingModel: record.embeddingModel,
          score: cosineSimilarity(queryEmbedding, record.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  ).catch((error) => {
    log.warn('Vector search timed out or failed; returning empty RAG matches:', error);
    return [];
  });
}

export function buildLongTermMemoryContext(matches: StudentEvidenceVectorMatch[]): string {
  if (matches.length === 0) return '';

  const lines = matches.map((match, index) => {
    const tags = getStringArray(match.evidence.metadata?.tags);
    const scorePercent = Math.round(match.score * 100);
    return [
      `${index + 1}. Relevance ${scorePercent}%`,
      tags.length > 0 ? `Tags: ${tags.join(', ')}` : '',
      `Prompt: ${match.evidence.prompt}`,
      `Student response: ${match.evidence.response}`,
      match.evidence.aiComment ? `AI feedback: ${match.evidence.aiComment}` : '',
      match.evidence.knowledgePointIds.length > 0
        ? `Knowledge points: ${match.evidence.knowledgePointIds.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    'Use these retrieved long-term learning memories as private teaching context.',
    'Do not reveal raw record IDs. Adapt follow-up questions to the recurring weak points.',
    ...lines,
  ].join('\n\n');
}

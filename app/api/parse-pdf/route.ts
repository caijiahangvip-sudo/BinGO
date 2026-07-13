import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { parsePDF } from '@/lib/pdf/pdf-providers';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFParseMode, PDFParserConfig, PDFProviderId } from '@/lib/pdf/types';
import type { ParsedPdfContent } from '@/lib/types/pdf';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  ensureLocalModelServiceRunning,
  releaseLocalModelServicesSafely,
} from '@/lib/server/local-model-services';
import {
  enqueueMineruPdfTask,
  MineruTaskCancelledError,
  MineruTaskTimedOutError,
} from '@/lib/server/mineru-task-manager';
const log = createLogger('Parse PDF');

export const runtime = 'nodejs';

const MINERU_DEFAULT_PORT = 50002;
const DEFAULT_MINERU_IDLE_RELEASE_MS = 10 * 60 * 1000;
const DEFAULT_MINERU_PDF_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_FAST_MINERU_PDF_TASK_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_FAST_MINERU_PDF_RETRY_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MINERU_UNBOUNDED_ACCURATE_FALLBACK_MAX_PAGES = 8;
const PDF_PARSE_CACHE_MAX_ENTRIES = 12;
const PDF_PARSE_CACHE_TTL_MS = 30 * 60 * 1000;

let activeMineruParses = 0;
let mineruReleaseTimer: ReturnType<typeof setTimeout> | undefined;

type CachedPdfParse = {
  value: ParsedPdfContent;
  expiresAt: number;
};

type ParsePDFOptions = Required<Pick<PDFParserConfig, 'mode'>> &
  Pick<PDFParserConfig, 'needsImages' | 'needsCover' | 'needsMiddleJson' | 'maxPages'>;

type FastMineruRetryMetadata = {
  mineruFastRetry: true;
  mineruFastRetryFirstTimeoutMs: number;
  mineruFastRetryTimeoutMs: number;
};

const pdfParseCache = new Map<string, CachedPdfParse>();

class MineruFastRetryTimedOutError extends Error {
  constructor({
    fileName,
    firstTimeoutMs,
    retryTimeoutMs,
  }: {
    fileName: string;
    firstTimeoutMs: number;
    retryTimeoutMs: number;
  }) {
    super(
      `Fast MinerU PDF parsing timed out while parsing ${fileName}. Bingo already stopped MinerU after the initial fast timeout (${formatTimeoutMs(firstTimeoutMs)}), retried once with a longer timeout (${formatTimeoutMs(retryTimeoutMs)}), and stopped MinerU again so the queue can continue. Split a large PDF, retry later, or increase BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS.`,
    );
    this.name = 'MineruFastRetryTimedOutError';
  }
}

function isMineruUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('MinerU local service is not reachable');
}

function resolveMineruPort(baseUrl?: string): number {
  if (!baseUrl) return MINERU_DEFAULT_PORT;

  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) {
      const port = Number.parseInt(parsed.port, 10);
      if (Number.isFinite(port) && port > 0) return port;
    }

    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return MINERU_DEFAULT_PORT;
  }
}

function getMineruIdleReleaseMs(): number {
  const envValue = Number.parseInt(process.env.BINGO_MINERU_IDLE_RELEASE_MS ?? '', 10);
  return Number.isFinite(envValue) && envValue >= 0 ? envValue : DEFAULT_MINERU_IDLE_RELEASE_MS;
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  const envValue = Number.parseInt(value ?? '', 10);
  return Number.isFinite(envValue) && envValue >= 0 ? envValue : undefined;
}

function formatTimeoutMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (seconds >= 1) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  return `${ms} ms`;
}

function getMineruPdfTaskTimeoutMs(mode: PDFParseMode): number {
  const rawValue =
    mode === 'fast'
      ? (process.env.BINGO_MINERU_FAST_PDF_TASK_TIMEOUT_MS ??
        process.env.BINGO_MINERU_PDF_TASK_TIMEOUT_MS ??
        process.env.PDF_MINERU_LOCAL_TIMEOUT_MS)
      : (process.env.BINGO_MINERU_PDF_TASK_TIMEOUT_MS ?? process.env.PDF_MINERU_LOCAL_TIMEOUT_MS);
  const parsed = parseTimeoutMs(rawValue);
  if (parsed !== undefined) return parsed;

  return mode === 'fast'
    ? DEFAULT_FAST_MINERU_PDF_TASK_TIMEOUT_MS
    : DEFAULT_MINERU_PDF_TASK_TIMEOUT_MS;
}

function getMineruFastPdfRetryTaskTimeoutMs(): number {
  return (
    parseTimeoutMs(process.env.BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS) ??
    DEFAULT_FAST_MINERU_PDF_RETRY_TASK_TIMEOUT_MS
  );
}

function getMineruStartupTimeoutMs(mode: PDFParseMode): number | undefined {
  if (mode !== 'fast') return undefined;
  return getMineruPdfTaskTimeoutMs(mode);
}

async function ensureMineruForParse(config: PDFParserConfig) {
  const port = resolveMineruPort(config.baseUrl);
  const startupTimeoutMs = getMineruStartupTimeoutMs(config.mode ?? 'accurate');
  log.warn(`MinerU is not reachable; starting local service on port ${port} and retrying.`);
  return ensureLocalModelServiceRunning('mineru', {
    port,
    ...(startupTimeoutMs ? { timeoutMs: startupTimeoutMs } : {}),
  });
}

function beginMineruParse(): void {
  activeMineruParses += 1;
  if (mineruReleaseTimer) {
    clearTimeout(mineruReleaseTimer);
    mineruReleaseTimer = undefined;
  }
}

function scheduleMineruIdleRelease(): void {
  activeMineruParses = Math.max(0, activeMineruParses - 1);
  if (activeMineruParses > 0) return;

  if (mineruReleaseTimer) {
    clearTimeout(mineruReleaseTimer);
  }

  const idleMs = getMineruIdleReleaseMs();
  mineruReleaseTimer = setTimeout(() => {
    mineruReleaseTimer = undefined;
    if (activeMineruParses > 0) return;

    log.info(`Releasing MinerU after ${idleMs}ms idle.`);
    releaseLocalModelServicesSafely(['mineru']).catch((error) => {
      log.warn('Failed to release idle MinerU service:', error);
    });
  }, idleMs);

  mineruReleaseTimer.unref?.();
}

function parseBooleanFormValue(value: FormDataEntryValue | null, defaultValue = false): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parsePDFMode(value: FormDataEntryValue | null): PDFParseMode {
  return value === 'fast' ? 'fast' : 'accurate';
}

function parsePositiveIntegerFormValue(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isEnabledEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getUnboundedAccurateFallbackMaxPages(): number {
  return (
    parsePositiveIntegerEnv(process.env.BINGO_MINERU_UNBOUNDED_ACCURATE_MAX_PAGES) ??
    parsePositiveIntegerEnv(process.env.BINGO_MINERU_FAST_MAX_PAGES) ??
    DEFAULT_MINERU_UNBOUNDED_ACCURATE_FALLBACK_MAX_PAGES
  );
}

function resolveParseOptions(formData: FormData): ParsePDFOptions {
  return {
    mode: parsePDFMode(formData.get('mode')),
    needsImages: parseBooleanFormValue(formData.get('needsImages')),
    needsCover: parseBooleanFormValue(formData.get('needsCover')),
    needsMiddleJson: parseBooleanFormValue(formData.get('needsMiddleJson')),
    maxPages: parsePositiveIntegerFormValue(formData.get('maxPages')),
  };
}

function guardMineruParseOptions(
  providerId: PDFProviderId,
  options: ParsePDFOptions,
): ParsePDFOptions {
  if (
    providerId !== 'mineru-local' ||
    options.mode !== 'accurate' ||
    options.maxPages !== undefined ||
    isEnabledEnv(process.env.BINGO_ALLOW_MINERU_UNBOUNDED_ACCURATE)
  ) {
    return options;
  }

  const maxPages = getUnboundedAccurateFallbackMaxPages();
  log.warn(
    `Received an unbounded accurate MinerU parse request. Falling back to fast mode with maxPages=${maxPages}. Set BINGO_ALLOW_MINERU_UNBOUNDED_ACCURATE=1 to allow full-document accurate parsing.`,
  );

  return {
    ...options,
    mode: 'fast',
    maxPages,
  };
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildParseCacheKey(buffer: Buffer, config: PDFParserConfig): string {
  return JSON.stringify({
    version: 2,
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    providerId: config.providerId,
    baseUrl: config.baseUrl,
    apiKeyHash: config.apiKey ? hashString(config.apiKey) : undefined,
    mode: config.mode,
    maxPages: config.maxPages,
    needsImages: config.needsImages === true,
    needsCover: config.needsCover === true,
    needsMiddleJson: config.needsMiddleJson === true,
  });
}

function cloneParsedPdfContent(content: ParsedPdfContent): ParsedPdfContent {
  return structuredClone(content);
}

function getCachedParseResult(cacheKey: string): ParsedPdfContent | undefined {
  const entry = pdfParseCache.get(cacheKey);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    pdfParseCache.delete(cacheKey);
    return undefined;
  }

  pdfParseCache.delete(cacheKey);
  pdfParseCache.set(cacheKey, entry);
  return cloneParsedPdfContent(entry.value);
}

function setCachedParseResult(cacheKey: string, value: ParsedPdfContent): void {
  pdfParseCache.set(cacheKey, {
    value: cloneParsedPdfContent(value),
    expiresAt: Date.now() + PDF_PARSE_CACHE_TTL_MS,
  });

  while (pdfParseCache.size > PDF_PARSE_CACHE_MAX_ENTRIES) {
    const oldestKey = pdfParseCache.keys().next().value;
    if (!oldestKey) break;
    pdfParseCache.delete(oldestKey);
  }
}

async function parsePDFWithLocalMineruRetry(
  buffer: Buffer,
  config: PDFParserConfig,
  signal?: AbortSignal,
) {
  try {
    return await parsePDF(buffer, { ...config, signal });
  } catch (error) {
    if (config.providerId !== 'mineru-local' || !isMineruUnavailableError(error)) {
      throw error;
    }

    const serviceResult = await ensureMineruForParse(config);
    return parsePDF(
      buffer,
      serviceResult?.baseUrl
        ? { ...config, baseUrl: serviceResult.baseUrl, signal }
        : { ...config, signal },
    );
  }
}

function shouldRetryFastMineruTimeout(
  error: unknown,
  providerId: PDFProviderId,
  mode: PDFParseMode,
): error is MineruTaskTimedOutError {
  return (
    providerId === 'mineru-local' && mode === 'fast' && error instanceof MineruTaskTimedOutError
  );
}

async function enqueueMineruParseTask({
  fileName,
  buffer,
  config,
  signal,
  timeoutMs,
}: {
  fileName: string;
  buffer: Buffer;
  config: PDFParserConfig;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<ParsedPdfContent> {
  return enqueueMineruPdfTask({
    fileName,
    source: 'pdf-parse',
    signal,
    timeoutMs,
    execute: ({ signal: taskSignal }) => parsePDFWithLocalMineruRetry(buffer, config, taskSignal),
  });
}

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now();
  let pdfFileName: string | undefined;
  let resolvedProviderId: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      log.error('Invalid Content-Type for PDF upload:', contentType);
      return apiError(
        'INVALID_REQUEST',
        400,
        `Invalid Content-Type: expected multipart/form-data, got "${contentType}"`,
      );
    }

    const formData = await req.formData();
    const pdfFile = formData.get('pdf') as File | null;
    const providerId = formData.get('providerId') as PDFProviderId | null;
    const apiKey = formData.get('apiKey') as string | null;
    const baseUrl = formData.get('baseUrl') as string | null;
    const rawParseOptions = resolveParseOptions(formData);

    if (!pdfFile) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'No PDF file provided');
    }

    // Fall back to MinerU for old clients/localStorage values such as unpdf/mineru.
    const effectiveProviderId: PDFProviderId =
      providerId && providerId in PDF_PROVIDERS ? providerId : 'mineru-local';
    const parseOptions = guardMineruParseOptions(effectiveProviderId, rawParseOptions);
    pdfFileName = pdfFile?.name;
    resolvedProviderId = effectiveProviderId;

    const config = {
      providerId: effectiveProviderId,
      apiKey: apiKey?.trim() || undefined,
      baseUrl: baseUrl?.trim() || undefined,
      ...parseOptions,
    };
    const shouldScheduleMineruRelease = effectiveProviderId === 'mineru-local';

    // Convert PDF to buffer
    const arrayBuffer = await pdfFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const cacheKey = buildParseCacheKey(buffer, config);
    const cachedResult = getCachedParseResult(cacheKey);

    // Parse PDF using the provider system
    if (!cachedResult && shouldScheduleMineruRelease) {
      beginMineruParse();
    }
    let result: ParsedPdfContent;
    let cacheHit = false;
    let fastRetryMetadata: FastMineruRetryMetadata | undefined;
    if (cachedResult) {
      cacheHit = true;
      result = cachedResult;
    } else {
      try {
        const initialTimeoutMs = getMineruPdfTaskTimeoutMs(parseOptions.mode);
        try {
          result = shouldScheduleMineruRelease
            ? await enqueueMineruParseTask({
                fileName: pdfFile.name,
                buffer,
                config,
                signal: req.signal,
                timeoutMs: initialTimeoutMs,
              })
            : await parsePDFWithLocalMineruRetry(buffer, config);
        } catch (error) {
          if (!shouldRetryFastMineruTimeout(error, effectiveProviderId, parseOptions.mode)) {
            throw error;
          }

          const retryTimeoutMs = getMineruFastPdfRetryTaskTimeoutMs();
          log.warn(
            `Fast MinerU parse timed out after ${formatTimeoutMs(initialTimeoutMs)} while parsing ${pdfFile.name}; retrying once with ${formatTimeoutMs(retryTimeoutMs)}.`,
          );

          try {
            result = await enqueueMineruParseTask({
              fileName: pdfFile.name,
              buffer,
              config,
              signal: req.signal,
              timeoutMs: retryTimeoutMs,
            });
          } catch (retryError) {
            if (retryError instanceof MineruTaskTimedOutError) {
              throw new MineruFastRetryTimedOutError({
                fileName: pdfFile.name,
                firstTimeoutMs: initialTimeoutMs,
                retryTimeoutMs,
              });
            }
            throw retryError;
          }

          fastRetryMetadata = {
            mineruFastRetry: true,
            mineruFastRetryFirstTimeoutMs: initialTimeoutMs,
            mineruFastRetryTimeoutMs: retryTimeoutMs,
          };
        }
        setCachedParseResult(cacheKey, result);
      } finally {
        if (shouldScheduleMineruRelease) {
          scheduleMineruIdleRelease();
        }
      }
    }

    // Add file metadata
    const resultWithMetadata: ParsedPdfContent = {
      ...result,
      metadata: {
        ...result.metadata,
        pageCount: result.metadata?.pageCount ?? result.images.length,
        processingTime: Date.now() - requestStartedAt,
        cacheHit,
        ...fastRetryMetadata,
        fileName: pdfFile.name,
        fileSize: pdfFile.size,
      },
    };

    return apiSuccess({ data: resultWithMetadata });
  } catch (error) {
    log.error(
      `PDF parsing failed [provider=${resolvedProviderId ?? 'unknown'}, file="${pdfFileName ?? 'unknown'}"]:`,
      error,
    );
    if (error instanceof MineruTaskCancelledError) {
      return apiError('PARSE_FAILED', 409, error.message);
    }
    if (error instanceof MineruTaskTimedOutError) {
      return apiError('PARSE_FAILED', 504, error.message);
    }
    if (error instanceof MineruFastRetryTimedOutError) {
      return apiError('PARSE_FAILED', 504, error.message);
    }
    return apiError('PARSE_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}

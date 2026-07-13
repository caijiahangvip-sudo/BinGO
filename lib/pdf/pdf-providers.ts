/**
 * PDF Provider Registry
 *
 * Server-side only. Client components should import provider metadata from
 * `./constants` instead of this file.
 */

import { Agent, type Dispatcher } from 'undici';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';
import JSZip from 'jszip';

import { PDF_PROVIDERS } from './constants';
import { resolveEndpointUrl } from '@/lib/utils/api-url';
import { createLogger } from '@/lib/logger';
import type { ParsedPdfContent } from '@/lib/types/pdf';
import type { PDFParserConfig, PDFProviderConfig, PDFProviderId } from './types';

const log = createLogger('PDF Providers');
const MINERU_DEFAULT_BASE_URL = 'http://localhost:50002';
const DEFAULT_MINERU_LOCAL_FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const MINERU_CONNECT_TIMEOUT_MS = 30 * 1000;
const COVER_RENDER_TIMEOUT_MS = 60 * 1000;
const DEFAULT_FAST_MINERU_MAX_PAGES = 8;

type FetchInitWithDispatcher = RequestInit & { dispatcher: Dispatcher };

/**
 * Base PDF Parser Interface
 */
export interface PDFParser {
  parse(buffer: Buffer, config?: PDFParserConfig): Promise<ParsedPdfContent>;
}

function getMineruLocalFetchTimeoutMs(): number {
  const envTimeout = Number.parseInt(process.env.PDF_MINERU_LOCAL_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(envTimeout) && envTimeout >= 0
    ? envTimeout
    : DEFAULT_MINERU_LOCAL_FETCH_TIMEOUT_MS;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function getFastMineruMaxPages(configMaxPages?: number): number | undefined {
  const explicitMaxPages = parsePositiveInteger(configMaxPages);
  if (explicitMaxPages !== undefined) return explicitMaxPages;

  const envMaxPages = Number.parseInt(process.env.BINGO_MINERU_FAST_MAX_PAGES ?? '', 10);
  if (Number.isFinite(envMaxPages)) {
    return envMaxPages > 0 ? envMaxPages : undefined;
  }

  return DEFAULT_FAST_MINERU_MAX_PAGES;
}

function isEnabledEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function shouldEnableMineruOnnxTables(fastMode: boolean): boolean {
  if (fastMode) return false;
  return isEnabledEnv(process.env.BINGO_MINERU_ENABLE_ONNX_TABLES);
}

const mineruLocalFetchTimeoutMs = getMineruLocalFetchTimeoutMs();
const mineruLocalFetchDispatcher = new Agent({
  connect: { timeout: MINERU_CONNECT_TIMEOUT_MS },
  headersTimeout: mineruLocalFetchTimeoutMs,
  bodyTimeout: mineruLocalFetchTimeoutMs,
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasUndiciTimeoutCode(error: unknown, timeoutCodes: Set<string>): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const candidate = current as {
      cause?: unknown;
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    if (typeof candidate.code === 'string' && timeoutCodes.has(candidate.code)) {
      return true;
    }
    if (
      typeof candidate.name === 'string' &&
      /^(HeadersTimeoutError|BodyTimeoutError)$/.test(candidate.name)
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

function isMineruProcessingTimeout(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true;
  return hasUndiciTimeoutCode(error, new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']));
}

function formatDuration(ms: number): string {
  if (ms === 0) return 'the configured client timeout';
  const minutes = Math.round(ms / 60000);
  return minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${ms} ms`;
}

function buildMineruFetchError(error: unknown, baseUrl: string): Error {
  const detail = getErrorMessage(error);

  if (isMineruProcessingTimeout(error)) {
    return new Error(
      `MinerU local service timed out while parsing the PDF at ${baseUrl} after ${formatDuration(mineruLocalFetchTimeoutMs)}. The service may still be processing a large file. Increase PDF_MINERU_LOCAL_TIMEOUT_MS if this PDF needs more time. ${detail}`,
      { cause: error },
    );
  }

  return new Error(
    `MinerU local service is not reachable at ${baseUrl}. The app will try to start the WSL/ROCm MinerU service automatically; if it still fails, restart BinGo and check bingo-mineru.err.log. ${detail}`,
    { cause: error },
  );
}

function isProbablyBinaryText(value: string): boolean {
  if (!value) return false;
  const sample = value.slice(0, 200);
  let suspicious = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code === 0xfffd || code === 0 || (code < 32 && !/\s/.test(char))) {
      suspicious += 1;
    }
  }
  return suspicious > 5 || sample.startsWith('%PDF') || sample.startsWith('PK\u0003\u0004');
}

function buildMineruNonJsonError(response: Response, responseText: string): Error {
  const contentType = response.headers.get('content-type') || 'unknown content type';
  const status = `${response.status} ${response.statusText}`.trim();
  const hint =
    'Make sure the MinerU local base URL points to the fast_api service, for example http://localhost:50002, and that /file_parse returns JSON.';

  if (isProbablyBinaryText(responseText)) {
    return new Error(
      `MinerU returned a non-JSON/binary response (${status}, ${contentType}). ${hint}`,
    );
  }

  const preview = responseText.replace(/\s+/g, ' ').slice(0, 200);
  return new Error(
    `MinerU returned a non-JSON response (${status}, ${contentType})${preview ? `: ${preview}` : '.'} ${hint}`,
  );
}

function isZipBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

function tryDecompressResponseBuffer(buffer: Buffer): Buffer | undefined {
  if (buffer.length < 2) return undefined;

  try {
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return gunzipSync(buffer);
    }
    if (buffer[0] === 0x78) {
      return inflateSync(buffer);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getImageMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/png';
  }
}

function isInlineImageSrc(src: unknown): src is string {
  return typeof src === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(src.trim());
}

function normalizeZipEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '');
}

function getMineruZipResultKey(entryName: string): string {
  const normalized = normalizeZipEntryName(entryName);
  const parts = normalized.split('/').filter(Boolean);
  const imageIndex = parts.lastIndexOf('images');
  if (imageIndex > 0) return parts.slice(0, imageIndex).join('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'document';
}

function isHiddenZipEntry(entryName: string): boolean {
  return normalizeZipEntryName(entryName)
    .split('/')
    .some((part) => part.startsWith('.') || part === '__MACOSX');
}

async function tryParseMineruZipResponse(buffer: Buffer): Promise<MineruResponse | undefined> {
  if (!isZipBuffer(buffer)) return undefined;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return undefined;
  }

  const files = Object.values(zip.files).filter(
    (file) => !file.dir && !isHiddenZipEntry(file.name),
  );
  const groups = new Map<string, JSZip.JSZipObject[]>();
  for (const file of files) {
    const key = getMineruZipResultKey(file.name);
    const group = groups.get(key) || [];
    group.push(file);
    groups.set(key, group);
  }

  const results: Record<string, MineruParseResult> = {};
  for (const [key, entries] of groups) {
    const byName = entries.map((entry) => ({
      entry,
      name: normalizeZipEntryName(entry.name),
      basename: path.posix.basename(normalizeZipEntryName(entry.name)),
    }));
    const result: MineruParseResult = {};
    const mdEntry = byName.find(({ basename }) => basename.endsWith('.md'))?.entry;
    const middleJsonEntry = byName.find(({ basename }) => basename.endsWith('_middle.json'))?.entry;
    const modelOutputEntry = byName.find(({ basename }) => basename.endsWith('_model.json'))?.entry;
    const contentListEntry =
      byName.find(({ basename }) => basename.endsWith('_content_list.json'))?.entry ||
      byName.find(({ basename }) => basename.endsWith('_content_list_v2.json'))?.entry;
    const imageEntries = byName.filter(({ name }) => /\/images\/[^/]+$/i.test(name));

    if (mdEntry) result.md_content = await mdEntry.async('string');
    if (middleJsonEntry) result.middle_json = await middleJsonEntry.async('string');
    if (modelOutputEntry) result.model_output = await modelOutputEntry.async('string');
    if (contentListEntry) result.content_list = await contentListEntry.async('string');
    if (imageEntries.length > 0) {
      const images: Record<string, string> = {};
      for (const { entry, basename } of imageEntries) {
        const bytes = await entry.async('uint8array');
        images[basename] =
          `data:${getImageMimeType(basename)};base64,${Buffer.from(bytes).toString('base64')}`;
      }
      result.images = images;
    }

    if (Object.keys(result).length > 0) {
      results[key || 'document'] = result;
    }
  }

  return Object.keys(results).length > 0 ? { results } : undefined;
}

async function parseMineruResponsePayload(
  response: Response,
  responseBuffer: Buffer,
): Promise<MineruResponse> {
  const normalizedBuffer = tryDecompressResponseBuffer(responseBuffer) || responseBuffer;
  const zipPayload = await tryParseMineruZipResponse(normalizedBuffer);
  if (zipPayload) return zipPayload;

  const responseText = new TextDecoder('utf-8').decode(normalizedBuffer);
  try {
    return responseText ? (JSON.parse(responseText) as MineruResponse) : {};
  } catch {
    throw buildMineruNonJsonError(response, responseText);
  }
}

function toWslPath(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function getWslRuntimeRoot(): string {
  return process.env.BINGO_WSL_RUNTIME_ROOT?.trim() || '~/.cache/bingo';
}

function expandHomePath(value: string): string {
  return value.replace(/^~(?=\/|$)/, os.homedir());
}

function getDefaultMineruPythonPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.cwd(), 'dev', 'MinerU', '.venv', 'Scripts', 'python.exe');
  }

  return path.join(
    expandHomePath(getWslRuntimeRoot()),
    'services',
    'MinerU',
    '.venv',
    'bin',
    'python',
  );
}

function getMineruPythonPath(): string {
  return process.env.BINGO_MINERU_PYTHON?.trim() || getDefaultMineruPythonPath();
}

function getMineruPythonCommand(): {
  command: string;
  argsPrefix: string[];
  pdfPath: (path: string) => string;
} {
  if (process.env.BINGO_MINERU_PYTHON?.trim() || process.platform !== 'win32') {
    return { command: getMineruPythonPath(), argsPrefix: [], pdfPath: (value) => value };
  }

  const runtimeRoot = getWslRuntimeRoot()
    .replace(/\\/g, '/')
    .replace(/^~(?=\/|$)/, '$HOME');
  const pythonPath = `${runtimeRoot}/services/MinerU/.venv/bin/python`;
  const distro = process.env.BINGO_WSL_DISTRO?.trim();
  return {
    command: 'wsl.exe',
    argsPrefix: [
      ...(distro ? ['-d', distro] : []),
      '--exec',
      'bash',
      '-lc',
      `"${pythonPath}" "$@"`,
      'bingo-mineru-python',
    ],
    pdfPath: toWslPath,
  };
}

export async function renderFirstPageCover(buffer: Buffer): Promise<string | undefined> {
  const python = getMineruPythonCommand();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bingo-pdf-cover-'));
  const pdfPath = path.join(tempDir, `${randomUUID()}.pdf`);
  const script = [
    'import base64, io, sys',
    'import pypdfium2 as pdfium',
    'pdf = pdfium.PdfDocument(sys.argv[1])',
    'page = pdf[0]',
    'bitmap = page.render(scale=1.0)',
    'image = bitmap.to_pil().convert("RGB")',
    'buf = io.BytesIO()',
    'image.save(buf, format="PNG", optimize=True)',
    'sys.stdout.write(base64.b64encode(buf.getvalue()).decode("ascii"))',
  ].join('\n');

  try {
    await fs.writeFile(pdfPath, buffer);
    const pngBase64 = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        python.command,
        [...python.argsPrefix, '-c', script, python.pdfPath(pdfPath)],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('PDF cover render timed out'));
      }, COVER_RENDER_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
          return;
        }
        reject(new Error(stderr.trim() || `PDF cover render failed with code ${code}`));
      });
    });

    return `data:image/png;base64,${pngBase64}`;
  } catch (error) {
    log.warn('Failed to render PDF first page cover:', error);
    return undefined;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type MineruResponse = {
  results?: Record<string, MineruParseResult>;
  data?: Record<string, MineruParseResult> | MineruParseResult;
  error?: unknown;
  message?: unknown;
  [key: string]: unknown;
};

type MineruParseResult = {
  md_content?: unknown;
  middle_json?: unknown;
  content_list?: unknown;
  images?: unknown;
  model_output?: unknown;
  [key: string]: unknown;
};

type MineruContentItem = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  latex?: unknown;
  caption?: unknown;
  img_path?: unknown;
  image_path?: unknown;
  page_idx?: unknown;
  page?: unknown;
  table_body?: unknown;
  html?: unknown;
  bbox?: unknown;
  [key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pickFirstMineruResult(payload: MineruResponse): MineruParseResult | undefined {
  if (payload.results && typeof payload.results === 'object') {
    return Object.values(payload.results)[0];
  }

  if (payload.data && typeof payload.data === 'object') {
    const data = payload.data as Record<string, unknown>;
    if ('md_content' in data || 'middle_json' in data || 'content_list' in data) {
      return data as MineruParseResult;
    }
    const first = Object.values(data).find((value) => value && typeof value === 'object');
    return first as MineruParseResult | undefined;
  }

  if ('md_content' in payload || 'middle_json' in payload || 'content_list' in payload) {
    return payload as MineruParseResult;
  }

  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function toContentItems(value: unknown): MineruContentItem[] {
  const parsed = parseMaybeJson(value);
  return Array.isArray(parsed) ? (parsed.filter(Boolean) as MineruContentItem[]) : [];
}

function getItemPage(item: MineruContentItem): number {
  const raw = item.page_idx ?? item.page;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw + 1 : 1;
}

function getPageCount(middleJson: unknown, contentItems: MineruContentItem[]): number {
  const parsed = parseMaybeJson(middleJson);
  const record = asRecord(parsed);
  const pdfInfo = record?.pdf_info;
  if (Array.isArray(pdfInfo)) return pdfInfo.length;

  const pages = new Set<number>();
  for (const item of contentItems) pages.add(getItemPage(item));
  return Math.max(1, pages.size);
}

function textFromContentItems(items: MineruContentItem[]): string {
  return items
    .map((item) => {
      const value = item.text ?? item.content ?? item.latex ?? item.table_body ?? item.html;
      return typeof value === 'string' ? value.trim() : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function imagesFromMineru(
  imagesValue: unknown,
  contentItems: MineruContentItem[],
): {
  images: string[];
  imageMapping: Record<string, string>;
  pdfImages: NonNullable<ParsedPdfContent['metadata']>['pdfImages'];
} {
  const images: string[] = [];
  const imageMapping: Record<string, string> = {};
  const pdfImages: NonNullable<ParsedPdfContent['metadata']>['pdfImages'] = [];

  const addImage = (id: string, src: unknown, pageNumber = 1) => {
    if (typeof src !== 'string' || !src) return;
    images.push(src);
    imageMapping[id] = src;
    pdfImages.push({
      id,
      src,
      pageNumber,
      description: `PDF page ${pageNumber} image`,
    });
  };

  const parsedImages = parseMaybeJson(imagesValue);
  if (parsedImages && typeof parsedImages === 'object' && !Array.isArray(parsedImages)) {
    for (const [id, src] of Object.entries(parsedImages)) {
      addImage(id, src, 1);
    }
  }

  contentItems.forEach((item, index) => {
    const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
    if (!type.includes('image')) return;
    addImage(
      `img_${index + 1}`,
      item.img_path ?? item.image_path ?? item.content,
      getItemPage(item),
    );
  });

  return { images, imageMapping, pdfImages };
}

function extractTables(items: MineruContentItem[]): NonNullable<ParsedPdfContent['tables']> {
  return items
    .filter((item) =>
      String(item.type || '')
        .toLowerCase()
        .includes('table'),
    )
    .map((item) => ({
      page: getItemPage(item),
      data: [[String(item.table_body ?? item.html ?? item.text ?? item.content ?? '')]],
      caption: typeof item.caption === 'string' ? item.caption : undefined,
    }))
    .filter((table) => table.data[0][0]);
}

function extractFormulas(items: MineruContentItem[]): NonNullable<ParsedPdfContent['formulas']> {
  return items
    .filter((item) =>
      String(item.type || '')
        .toLowerCase()
        .includes('formula'),
    )
    .map((item) => ({
      page: getItemPage(item),
      latex: String(item.latex ?? item.text ?? item.content ?? ''),
    }))
    .filter((formula) => formula.latex);
}

function extractLayout(items: MineruContentItem[]): NonNullable<ParsedPdfContent['layout']> {
  return items
    .map((item) => {
      const rawType = String(item.type || 'text').toLowerCase();
      const type = rawType.includes('table')
        ? 'table'
        : rawType.includes('formula')
          ? 'formula'
          : rawType.includes('image')
            ? 'image'
            : rawType.includes('title')
              ? 'title'
              : 'text';
      const content = String(item.text ?? item.content ?? item.latex ?? item.table_body ?? '');
      return {
        page: getItemPage(item),
        type,
        content,
      };
    })
    .filter((item) => item.content) as NonNullable<ParsedPdfContent['layout']>;
}

/**
 * MinerU pipeline parser via the local mineru-api service.
 */
export class MineruLocalParser implements PDFParser {
  async parse(buffer: Buffer, config?: PDFParserConfig): Promise<ParsedPdfContent> {
    const startTime = Date.now();
    const fastMode = config?.mode === 'fast';
    const needsImages = config?.needsImages === true;
    const needsCover = config?.needsCover === true || needsImages;
    const needsMineruImages = needsImages || (needsCover && !fastMode);
    const needsMiddleJson = config?.needsMiddleJson === true;
    const maxPages = fastMode
      ? getFastMineruMaxPages(config?.maxPages)
      : parsePositiveInteger(config?.maxPages);
    const tableEnable = shouldEnableMineruOnnxTables(fastMode);
    const baseUrl =
      config?.baseUrl || PDF_PROVIDERS['mineru-local']?.baseUrl || MINERU_DEFAULT_BASE_URL;
    const endpoint = resolveEndpointUrl(baseUrl, MINERU_DEFAULT_BASE_URL, '/file_parse');
    const fileBytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const formData = new FormData();
    formData.append('files', new Blob([fileBytes], { type: 'application/pdf' }), 'document.pdf');
    formData.append('lang_list', 'ch');
    formData.append('backend', 'pipeline');
    formData.append('parse_method', fastMode ? 'txt' : 'auto');
    formData.append('formula_enable', fastMode ? 'false' : 'true');
    formData.append('table_enable', tableEnable ? 'true' : 'false');
    formData.append('image_analysis', 'false');
    formData.append('return_md', 'true');
    formData.append('return_middle_json', needsMiddleJson ? 'true' : 'false');
    formData.append('return_model_output', 'false');
    formData.append('return_content_list', fastMode ? 'false' : 'true');
    formData.append('return_images', needsMineruImages ? 'true' : 'false');
    formData.append('response_format_zip', 'false');
    formData.append('return_original_file', 'false');
    formData.append('start_page_id', '0');
    if (maxPages !== undefined) {
      formData.append('end_page_id', String(Math.max(0, maxPages - 1)));
    }

    const headers: HeadersInit = {};
    if (config?.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    let response: Response;
    try {
      const requestInit: FetchInitWithDispatcher = {
        method: 'POST',
        headers,
        body: formData,
        dispatcher: mineruLocalFetchDispatcher,
        signal: config?.signal,
      };
      response = await fetch(endpoint, requestInit);
    } catch (error) {
      throw buildMineruFetchError(error, baseUrl);
    }

    const responseBuffer = Buffer.from(await response.arrayBuffer());
    const payload = await parseMineruResponsePayload(response, responseBuffer);

    if (!response.ok) {
      const message =
        typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : response.statusText;
      throw new Error(`MinerU PDF parsing failed (${response.status}): ${message}`);
    }

    const result = pickFirstMineruResult(payload);
    if (!result) {
      throw new Error('MinerU did not return parse results.');
    }

    const contentItems = toContentItems(result.content_list);
    const markdown = typeof result.md_content === 'string' ? result.md_content : '';
    const text = markdown.trim() || textFromContentItems(contentItems);
    const collectedImages = needsMineruImages
      ? imagesFromMineru(result.images, contentItems)
      : { images: [], imageMapping: {}, pdfImages: [] };
    const renderedCoverImage = needsCover ? await renderFirstPageCover(buffer) : undefined;
    const { images, imageMapping, pdfImages } = needsImages
      ? collectedImages
      : { images: [], imageMapping: {}, pdfImages: [] };
    const tables = extractTables(contentItems);
    const formulas = extractFormulas(contentItems);
    const layout = extractLayout(contentItems);
    const middleJson = needsMiddleJson ? parseMaybeJson(result.middle_json) : undefined;

    return {
      text,
      images,
      coverImage: needsCover
        ? renderedCoverImage || collectedImages.images.find(isInlineImageSrc)
        : undefined,
      ...(tables.length > 0 ? { tables } : {}),
      ...(formulas.length > 0 ? { formulas } : {}),
      ...(layout.length > 0 ? { layout } : {}),
      metadata: {
        pageCount: getPageCount(result.middle_json, contentItems),
        parser: 'mineru-local',
        processingTime: Date.now() - startTime,
        imageMapping,
        pdfImages,
        ...(needsMiddleJson
          ? {
              middleJson,
              contentList: contentItems,
            }
          : {}),
      },
    };
  }
}

/**
 * Parser Registry
 */
export const PDF_PARSERS: Record<PDFProviderId, PDFParser> = {
  'mineru-local': new MineruLocalParser(),
};

/**
 * Get all available PDF providers
 */
export function getAllPDFProviders(): PDFProviderConfig[] {
  return Object.values(PDF_PROVIDERS);
}

/**
 * Get PDF provider by ID
 */
export function getPDFProvider(providerId: PDFProviderId): PDFProviderConfig | undefined {
  return PDF_PROVIDERS[providerId];
}

/**
 * Get PDF parser by provider ID
 */
export function getPDFParser(providerId: PDFProviderId): PDFParser | undefined {
  return PDF_PARSERS[providerId];
}

/**
 * Parse PDF with specified provider
 */
export async function parsePDF(buffer: Buffer, config: PDFParserConfig): Promise<ParsedPdfContent> {
  const parser = getPDFParser(config.providerId);
  if (!parser) {
    throw new Error(`PDF parser not found: ${config.providerId}`);
  }

  return parser.parse(buffer, config);
}

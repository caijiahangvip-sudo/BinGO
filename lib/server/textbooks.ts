import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import type { TextbookCatalogNode, TextbookListItem } from '@/lib/textbooks/types';

const TAGS_URL = 'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/tags/tch_material_tag.json';
const VERSION_URL =
  'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json';
const DETAIL_BASE_URL =
  'https://s-file-1.ykt.cbern.com.cn/zxx/ndrv2/resources/tch_material/details';
const SPECIAL_DETAIL_BASE_URL =
  'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/special_edu/resources/details';
const SPECIAL_COURSE_RESOURCE_BASE_URL =
  'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/special_edu/thematic_course';

const PRIVATE_RESOURCE_BASE_URL = 'https://r1-ndr-private.ykt.cbern.com.cn';
const PUBLIC_RESOURCE_BASE_URL = 'https://c1.ykt.cbern.com.cn';
const CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_LIMIT = 80;

interface YktTagNode {
  tag_id?: string;
  tag_name?: string;
  hierarchies?: Array<{ children?: YktTagNode[] }>;
}

interface YktTextbookRecord {
  id?: string;
  title?: string;
  name?: string;
  resource_type_code?: string;
  tag_paths?: string[];
  tag_list?: Array<{
    tag_id?: string;
    tag_name?: string;
    tag_dimension_id?: string;
    order_num?: number;
  }>;
  global_title?: Record<string, string>;
}

interface YktTextbookDetail {
  title?: string;
  ti_items?: YktResourceItem[];
  custom_properties?: {
    preview?: Record<string, string>;
  };
}

interface YktResourceItem {
  ti_file_flag?: string;
  ti_is_source_file?: boolean;
  ti_format?: string;
  ti_storage?: string;
  ti_storages?: string[];
}

interface CatalogCache {
  catalog: TextbookCatalogNode[];
  items: TextbookListItem[];
  expiresAt: number;
  updatedAt: number;
  authKey: string;
}

let catalogCache: CatalogCache | undefined;

export type TextbookErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_REQUIRED'
  | 'UPSTREAM_ERROR'
  | 'RESOURCE_NOT_FOUND';

export class TextbookError extends Error {
  constructor(
    public readonly code: TextbookErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TextbookError';
  }
}

function authHeaders(accessToken?: string): HeadersInit {
  const token = accessToken?.trim();
  if (!token) return { 'X-ND-AUTH': 'MAC id="0",nonce="0",mac="0"' };
  return { 'X-ND-AUTH': `MAC id="${token}",nonce="0",mac="0"` };
}

async function fetchJson<T>(url: string, accessToken?: string): Promise<T> {
  let response: Response;
  try {
    response = await proxyFetch(url, {
      headers: authHeaders(accessToken),
      cache: 'no-store',
    });
  } catch (error) {
    throw new TextbookError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Unable to reach textbook platform.',
    );
  }

  if (!response.ok) {
    const code: TextbookErrorCode =
      response.status === 401 || response.status === 403
        ? 'AUTH_REQUIRED'
        : response.status === 404
          ? 'RESOURCE_NOT_FOUND'
          : 'UPSTREAM_ERROR';
    throw new TextbookError(
      code,
      `Textbook upstream request failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

function parseHierarchy(nodes?: YktTagNode[]): Map<string, TextbookCatalogNode> {
  const parsed = new Map<string, TextbookCatalogNode>();
  if (!nodes) return parsed;

  for (const node of nodes) {
    const id = node.tag_id;
    if (!id) continue;
    parsed.set(id, {
      id,
      name: node.tag_name || id,
      children: parseHierarchyChildren(node.hierarchies),
    });
  }

  return parsed;
}

function parseHierarchyChildren(hierarchies?: Array<{ children?: YktTagNode[] }>) {
  const children: TextbookCatalogNode[] = [];
  for (const hierarchy of hierarchies || []) {
    for (const [, child] of parseHierarchy(hierarchy.children)) {
      children.push(child);
    }
  }
  return children;
}

function findChild(node: TextbookCatalogNode, id: string): TextbookCatalogNode | undefined {
  return node.children?.find((child) => child.id === id);
}

function ensureChildren(node: TextbookCatalogNode): TextbookCatalogNode[] {
  if (!node.children) node.children = [];
  return node.children;
}

function cloneCatalog(catalog: TextbookCatalogNode[]): TextbookCatalogNode[] {
  return structuredClone(catalog);
}

function flattenTextbooks(catalog: TextbookCatalogNode[]): TextbookListItem[] {
  const items: TextbookListItem[] = [];
  const walk = (node: TextbookCatalogNode) => {
    if (node.textbook) items.push(node.textbook);
    for (const child of node.children || []) walk(child);
  };
  for (const node of catalog) walk(node);
  return items;
}

function resolveTitle(book: YktTextbookRecord): string {
  return book.title || book.global_title?.['zh-CN'] || book.name || `(未知电子课本 ${book.id})`;
}

function getTagName(book: YktTextbookRecord, dimensionId: string): string | undefined {
  return book.tag_list?.find((tag) => tag.tag_dimension_id === dimensionId)?.tag_name;
}

function buildTextbookItem(
  book: YktTextbookRecord,
  pathIds: string[],
  pathNames: string[],
): TextbookListItem {
  return {
    id: book.id || '',
    title: resolveTitle(book),
    contentType: book.resource_type_code || 'assets_document',
    pathIds,
    pathNames,
    stage: getTagName(book, 'zxxxd'),
    subject: getTagName(book, 'zxxxk'),
    edition: getTagName(book, 'zxxbb'),
    grade: getTagName(book, 'zxxnj'),
    volume: getTagName(book, 'zxxcc'),
  };
}

function attachBook(root: TextbookCatalogNode, book: YktTextbookRecord): void {
  if (!book.id || !book.tag_paths?.[0]) return;

  const pathIds = book.tag_paths[0].split('/').slice(2);
  if (pathIds.length === 0) return;

  let current = root;
  const pathNames: string[] = [root.name];
  const usedPathIds: string[] = [root.id];

  for (const id of pathIds) {
    const child = findChild(current, id);
    if (!child) break;
    current = child;
    pathNames.push(child.name);
    usedPathIds.push(id);
  }

  const item = buildTextbookItem(book, usedPathIds, pathNames);
  const leaf: TextbookCatalogNode = {
    id: book.id,
    name: item.title,
    textbook: item,
    children: [],
  };
  ensureChildren(current).push(leaf);
}

async function buildCatalog(accessToken?: string): Promise<CatalogCache> {
  const tagsData = await fetchJson<{
    hierarchies?: Array<{ children?: YktTagNode[] }>;
  }>(TAGS_URL, accessToken);
  const topLevel = parseHierarchyChildren(tagsData.hierarchies);

  const versionData = await fetchJson<{ urls?: string | string[] }>(VERSION_URL, accessToken);
  const partUrls = Array.isArray(versionData.urls)
    ? versionData.urls
    : String(versionData.urls || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);

  const rootMap = new Map(topLevel.map((node) => [node.id, node]));

  for (const partUrl of partUrls) {
    const books = await fetchJson<YktTextbookRecord[]>(partUrl, accessToken);
    for (const book of books) {
      const rootId = book.tag_paths?.[0]?.split('/')[1];
      const root = rootId ? rootMap.get(rootId) : undefined;
      if (root) attachBook(root, book);
    }
  }

  const catalog = Array.from(rootMap.values());
  return {
    catalog,
    items: flattenTextbooks(catalog),
    expiresAt: Date.now() + CACHE_TTL_MS,
    updatedAt: Date.now(),
    authKey: accessToken?.trim() ? 'authenticated' : 'public',
  };
}

export async function getTextbookCatalog(accessToken?: string): Promise<CatalogCache> {
  const authKey = accessToken?.trim() ? 'authenticated' : 'public';
  if (catalogCache && catalogCache.expiresAt > Date.now() && catalogCache.authKey === authKey) {
    return catalogCache;
  }

  catalogCache = await buildCatalog(accessToken);
  return catalogCache;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function pathMatches(itemPathIds: string[], requestedPathIds: string[]): boolean {
  if (requestedPathIds.length === 0) return true;

  const matchesAt = (offset: number) =>
    requestedPathIds.every((id, index) => itemPathIds[index + offset] === id);

  return matchesAt(0) || matchesAt(1);
}

export async function searchTextbooks(params: {
  q?: string;
  pathIds?: string[];
  accessToken?: string;
}): Promise<TextbookListItem[]> {
  const cache = await getTextbookCatalog(params.accessToken);
  const query = normalizeSearchText(params.q || '');
  const pathIds = (params.pathIds || []).filter(Boolean);

  return cache.items
    .filter((item) => {
      if (!pathMatches(item.pathIds, pathIds)) {
        return false;
      }

      if (!query) return true;

      return normalizeSearchText(
        [
          item.title,
          item.stage,
          item.subject,
          item.edition,
          item.grade,
          item.volume,
          item.pathNames.join(''),
        ]
          .filter(Boolean)
          .join(' '),
      ).includes(query);
    })
    .slice(0, SEARCH_LIMIT);
}

function resourceStorageToUrl(storage?: string, accessToken?: string): string | undefined {
  if (!storage) return undefined;
  return storage.replace(
    'cs_path:${ref-path}',
    accessToken?.trim() ? PRIVATE_RESOURCE_BASE_URL : PUBLIC_RESOURCE_BASE_URL,
  );
}

function fallbackPublicUrl(url: string, accessToken?: string): string {
  if (accessToken?.trim()) return url;
  return url.replace(/^https?:\/\/(?:[^/]+)\.ykt\.cbern\.com\.cn\/(.+)$/, `${PUBLIC_RESOURCE_BASE_URL}/$1`);
}

function findSourceResourceUrl(items?: YktResourceItem[], accessToken?: string): string | undefined {
  for (const item of items || []) {
    if (!item.ti_is_source_file) continue;

    const directUrl = resourceStorageToUrl(item.ti_storage, accessToken);
    if (directUrl) return directUrl;

    const storageUrl = item.ti_storages?.find(Boolean);
    if (storageUrl) return fallbackPublicUrl(storageUrl, accessToken);
  }

  return undefined;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'textbook';
}

function orderedPreviewUrls(detail: YktTextbookDetail): string[] {
  return Object.entries(detail.custom_properties?.preview || {})
    .map(([key, url]) => ({ page: Number(key.replace(/\D+/g, '')), url }))
    .filter((item) => Number.isFinite(item.page) && /^https?:\/\//i.test(item.url))
    .sort((a, b) => a.page - b.page)
    .map((item) => item.url);
}

async function buildPdfFromPreviewImages(urls: string[]): Promise<Buffer> {
  const images = await Promise.all(
    urls.map(async (url) => {
      const response = await proxyFetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`教材页面下载失败：HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height || metadata.format !== 'jpeg') {
        throw new Error('教材页面图片格式无效');
      }
      return { bytes, width: metadata.width, height: metadata.height };
    }),
  );

  const objects: Buffer[] = [];
  const addObject = (body: Buffer | string) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary'));
    return objects.length;
  };
  const catalogId = addObject('');
  const pagesId = addObject('');
  const pageIds: number[] = [];

  for (const [index, image] of images.entries()) {
    const imageId = addObject(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`, 'binary'),
      image.bytes,
      Buffer.from('\nendstream', 'binary'),
    ]));
    const content = `q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im${index} Do\nQ`;
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    pageIds.push(addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }

  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'binary');
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`, 'binary');

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'binary'), object, Buffer.from('\nendobj\n', 'binary')]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xrefOffset = offset;
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'binary'));
  return Buffer.concat(chunks);
}

async function resolveTextbookDownload(params: {
  contentId: string;
  contentType?: string;
  accessToken?: string;
}): Promise<{ url: string; title: string }> {
  const contentType = params.contentType || 'assets_document';
  const detailUrl =
    contentType === 'thematic_course'
      ? `${SPECIAL_DETAIL_BASE_URL}/${encodeURIComponent(params.contentId)}.json`
      : `${DETAIL_BASE_URL}/${encodeURIComponent(params.contentId)}.json`;
  const detail = await fetchJson<YktTextbookDetail>(detailUrl, params.accessToken);
  let resourceUrl = findSourceResourceUrl(detail.ti_items, params.accessToken);

  if (!resourceUrl && contentType === 'thematic_course') {
    const resources = await fetchJson<Array<{ resource_type_code?: string; ti_items?: YktResourceItem[] }>>(
      `${SPECIAL_COURSE_RESOURCE_BASE_URL}/${encodeURIComponent(params.contentId)}/resources/list.json`,
      params.accessToken,
    );
    const documentResource = resources.find((resource) => resource.resource_type_code === 'assets_document');
    resourceUrl = findSourceResourceUrl(documentResource?.ti_items, params.accessToken);
  }

  if (!resourceUrl) {
    throw new Error('No downloadable PDF resource found for this textbook.');
  }

  return {
    url: resourceUrl,
    title: detail.title || params.contentId,
  };
}

export async function downloadTextbookPdf(params: {
  contentId: string;
  contentType?: string;
  accessToken?: string;
}): Promise<NextResponse> {
  const contentType = params.contentType || 'assets_document';
  const detailUrl = contentType === 'thematic_course'
    ? `${SPECIAL_DETAIL_BASE_URL}/${encodeURIComponent(params.contentId)}.json`
    : `${DETAIL_BASE_URL}/${encodeURIComponent(params.contentId)}.json`;
  const detail = await fetchJson<YktTextbookDetail>(detailUrl, params.accessToken);
  const resolved = await resolveTextbookDownload(params);
  let response: Response;
  try {
    response = await proxyFetch(resolved.url, {
      headers: authHeaders(params.accessToken),
      cache: 'no-store',
    });
  } catch (error) {
    const previewUrls = orderedPreviewUrls(detail);
    if (previewUrls.length > 0) {
      const pdf = await buildPdfFromPreviewImages(previewUrls);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.length),
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${sanitizeFilename(detail.title || params.contentId)}.pdf`)}`,
        },
      });
    }
    throw new TextbookError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Unable to download textbook PDF.',
    );
  }

  if (!response.ok || !response.body) {
    const previewUrls = orderedPreviewUrls(detail);
    if (previewUrls.length > 0) {
      const pdf = await buildPdfFromPreviewImages(previewUrls);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.length),
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${sanitizeFilename(detail.title || params.contentId)}.pdf`)}`,
        },
      });
    }
    const code: TextbookErrorCode =
      response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : 'UPSTREAM_ERROR';
    const authHint =
      response.status === 401 || response.status === 403
        ? ' Access Token may be required or expired.'
        : '';
    throw new TextbookError(
      code,
      `Textbook PDF download failed: ${response.status} ${response.statusText}.${authHint}`,
      response.status,
    );
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  headers.set(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${sanitizeFilename(resolved.title)}.pdf`)}`,
  );

  const contentLength = response.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  return new NextResponse(response.body, { status: 200, headers });
}

export function getPublicCatalog(catalog: TextbookCatalogNode[]): TextbookCatalogNode[] {
  const publicCatalog = cloneCatalog(catalog);
  if (publicCatalog.length === 1 && publicCatalog[0]?.name === '电子教材') {
    return publicCatalog[0].children || [];
  }
  return publicCatalog;
}

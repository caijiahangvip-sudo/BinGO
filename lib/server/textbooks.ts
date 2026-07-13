import { NextResponse } from 'next/server';
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
}

let catalogCache: CatalogCache | undefined;

function authHeaders(accessToken?: string): HeadersInit {
  const token = accessToken?.trim();
  if (!token) return { 'X-ND-AUTH': 'MAC id="0",nonce="0",mac="0"' };
  return { 'X-ND-AUTH': `MAC id="${token}",nonce="0",mac="0"` };
}

async function fetchJson<T>(url: string, accessToken?: string): Promise<T> {
  const response = await proxyFetch(url, {
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Textbook upstream request failed: ${response.status} ${response.statusText}`);
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

async function buildCatalog(): Promise<CatalogCache> {
  const tagsData = await fetchJson<{
    hierarchies?: Array<{ children?: YktTagNode[] }>;
  }>(TAGS_URL);
  const topLevel = parseHierarchyChildren(tagsData.hierarchies);

  const versionData = await fetchJson<{ urls?: string | string[] }>(VERSION_URL);
  const partUrls = Array.isArray(versionData.urls)
    ? versionData.urls
    : String(versionData.urls || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);

  const rootMap = new Map(topLevel.map((node) => [node.id, node]));

  for (const partUrl of partUrls) {
    const books = await fetchJson<YktTextbookRecord[]>(partUrl);
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
  };
}

export async function getTextbookCatalog(): Promise<CatalogCache> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache;
  }

  catalogCache = await buildCatalog();
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
}): Promise<TextbookListItem[]> {
  const cache = await getTextbookCatalog();
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
  const resolved = await resolveTextbookDownload(params);
  const response = await proxyFetch(resolved.url, {
    headers: authHeaders(params.accessToken),
    cache: 'no-store',
  });

  if (!response.ok || !response.body) {
    const authHint =
      response.status === 401 || response.status === 403
        ? ' Access Token may be required or expired.'
        : '';
    throw new Error(`Textbook PDF download failed: ${response.status} ${response.statusText}.${authHint}`);
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

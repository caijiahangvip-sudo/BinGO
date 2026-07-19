import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { TextbookCatalogNode } from '@/lib/textbooks/types';

// Mock proxyFetch so the textbooks module never touches the network.
// Each test seeds `fetchResponses` with URL substring -> response body mappings.
type FetchResponse =
  | { ok: true; body: unknown }
  | { ok: false; status: number; statusText: string };

let fetchResponses: Map<string, FetchResponse> = new Map();
let fetchCalls: string[] = [];

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;
}

function pdfResponse(body: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/pdf', 'content-length': '1024' }),
    json: async () => ({}),
    text: async () => '',
    body,
  } as unknown as Response;
}

function errorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => '',
    body: null,
  } as unknown as Response;
}

vi.mock('@/lib/server/proxy-fetch', () => ({
  proxyFetch: vi.fn(async (url: string) => {
    fetchCalls.push(url);
    for (const [key, response] of fetchResponses) {
      if (url.includes(key)) {
        if (response.ok) return jsonResponse(response.body);
        return errorResponse(response.status, response.statusText);
      }
    }
    return errorResponse(404, 'Not Found');
  }),
}));

// Minimal catalog fixture: a single root with one child stage and one leaf textbook.
const TAGS_FIXTURE = {
  hierarchies: [
    {
      children: [
        { tag_id: 'root-1', tag_name: '电子教材', hierarchies: [
          { children: [{ tag_id: 'stage-1', tag_name: '小学', hierarchies: [] }] },
        ] },
      ],
    },
  ],
};

const VERSION_FIXTURE = {
  urls: ['https://example.test/part-1.json'],
};

const BOOKS_FIXTURE = [
  {
    id: 'book-1',
    title: '小学语文一年级上册',
    resource_type_code: 'assets_document',
    tag_paths: ['/root-1/stage-1/book-1'],
    tag_list: [
      { tag_dimension_id: 'zxxxd', tag_name: '小学' },
      { tag_dimension_id: 'zxxxk', tag_name: '语文' },
      { tag_dimension_id: 'zxxbb', tag_name: '人教版' },
      { tag_dimension_id: 'zxxnj', tag_name: '一年级' },
      { tag_dimension_id: 'zxxcc', tag_name: '上册' },
    ],
  },
  {
    id: 'book-2',
    title: '小学数学二年级下册',
    resource_type_code: 'assets_document',
    tag_paths: ['/root-1/stage-1/book-2'],
    tag_list: [
      { tag_dimension_id: 'zxxxd', tag_name: '小学' },
      { tag_dimension_id: 'zxxxk', tag_name: '数学' },
      { tag_dimension_id: 'zxxbb', tag_name: '北师大版' },
      { tag_dimension_id: 'zxxnj', tag_name: '二年级' },
      { tag_dimension_id: 'zxxcc', tag_name: '下册' },
    ],
  },
];

const DETAIL_FIXTURE = {
  title: '小学语文一年级上册',
  ti_items: [
    {
      ti_is_source_file: true,
      ti_storage: 'cs_path:${ref-path}/pdf/book-1.pdf',
      ti_format: 'pdf',
    },
  ],
};

function seedCatalogResponses(): void {
  fetchResponses.set('tch_material_tag.json', { ok: true, body: TAGS_FIXTURE });
  fetchResponses.set('data_version.json', { ok: true, body: VERSION_FIXTURE });
  fetchResponses.set('part-1.json', { ok: true, body: BOOKS_FIXTURE });
}

beforeEach(() => {
  fetchResponses.clear();
  fetchCalls.length = 0;
  vi.resetModules();
});

describe('getPublicCatalog', () => {
  it('unwraps the single "电子教材" root node into its children', async () => {
    const { getPublicCatalog } = await import('@/lib/server/textbooks');
    const catalog: TextbookCatalogNode[] = [
      {
        id: 'root-1',
        name: '电子教材',
        children: [
          { id: 'stage-1', name: '小学', children: [] },
          { id: 'stage-2', name: '初中', children: [] },
        ],
      },
    ];
    const result = getPublicCatalog(catalog);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('小学');
    expect(result[1].name).toBe('初中');
  });

  it('returns the catalog unchanged when there is no single "电子教材" root', async () => {
    const { getPublicCatalog } = await import('@/lib/server/textbooks');
    const catalog: TextbookCatalogNode[] = [
      { id: 'a', name: '小学', children: [] },
      { id: 'b', name: '初中', children: [] },
    ];
    const result = getPublicCatalog(catalog);
    expect(result).toEqual(catalog);
  });

  it('returns the catalog unchanged when the single root is not named "电子教材"', async () => {
    const { getPublicCatalog } = await import('@/lib/server/textbooks');
    const catalog: TextbookCatalogNode[] = [
      { id: 'root-1', name: '教材', children: [{ id: 'c', name: '小学', children: [] }] },
    ];
    const result = getPublicCatalog(catalog);
    expect(result).toEqual(catalog);
  });

  it('returns an empty array when the single root has no children', async () => {
    const { getPublicCatalog } = await import('@/lib/server/textbooks');
    const catalog: TextbookCatalogNode[] = [{ id: 'root-1', name: '电子教材', children: [] }];
    const result = getPublicCatalog(catalog);
    expect(result).toEqual([]);
  });

  it('does not mutate the input catalog', async () => {
    const { getPublicCatalog } = await import('@/lib/server/textbooks');
    const catalog: TextbookCatalogNode[] = [
      { id: 'root-1', name: '电子教材', children: [{ id: 'c', name: '小学', children: [] }] },
    ];
    const original = JSON.parse(JSON.stringify(catalog));
    getPublicCatalog(catalog);
    expect(catalog).toEqual(original);
  });
});

describe('getTextbookCatalog', () => {
  it('fetches tags, version and parts once and builds a catalog with textbooks', async () => {
    seedCatalogResponses();
    const { getTextbookCatalog } = await import('@/lib/server/textbooks');

    const cache = await getTextbookCatalog();

    expect(fetchCalls.some((url) => url.includes('tch_material_tag.json'))).toBe(true);
    expect(fetchCalls.some((url) => url.includes('data_version.json'))).toBe(true);
    expect(fetchCalls.some((url) => url.includes('part-1.json'))).toBe(true);

    expect(cache.catalog).toHaveLength(1);
    expect(cache.catalog[0].name).toBe('电子教材');
    expect(cache.items).toHaveLength(2);
    expect(cache.items[0].title).toBe('小学语文一年级上册');
    expect(cache.items[0].stage).toBe('小学');
    expect(cache.items[0].subject).toBe('语文');
    expect(cache.items[1].title).toBe('小学数学二年级下册');
  });

  it('serves subsequent calls from cache without refetching', async () => {
    seedCatalogResponses();
    const { getTextbookCatalog } = await import('@/lib/server/textbooks');

    await getTextbookCatalog();
    const callsAfterFirst = fetchCalls.length;
    await getTextbookCatalog();

    expect(fetchCalls.length).toBe(callsAfterFirst);
  });

  it('throws when the tags endpoint fails', async () => {
    fetchResponses.set('tch_material_tag.json', {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });
    const { getTextbookCatalog } = await import('@/lib/server/textbooks');

    await expect(getTextbookCatalog()).rejects.toThrow(/Textbook upstream request failed: 502/);
  });

  it('classifies transport failures as NETWORK_ERROR', async () => {
    const { proxyFetch } = (await import('@/lib/server/proxy-fetch')) as any;
    proxyFetch.mockRejectedValueOnce(new Error('fetch failed'));
    const { getTextbookCatalog } = await import('@/lib/server/textbooks');

    await expect(getTextbookCatalog()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('searchTextbooks', () => {
  it('returns all items when no query or path is provided', async () => {
    seedCatalogResponses();
    const { searchTextbooks } = await import('@/lib/server/textbooks');

    const results = await searchTextbooks({});
    expect(results).toHaveLength(2);
  });

  it('filters by title keyword', async () => {
    seedCatalogResponses();
    const { searchTextbooks } = await import('@/lib/server/textbooks');

    const results = await searchTextbooks({ q: '语文' });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('小学语文一年级上册');
  });

  it('filters by subject keyword', async () => {
    seedCatalogResponses();
    const { searchTextbooks } = await import('@/lib/server/textbooks');

    const results = await searchTextbooks({ q: '数学' });
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe('数学');
  });

  it('filters by path ids', async () => {
    seedCatalogResponses();
    const { searchTextbooks } = await import('@/lib/server/textbooks');

    const results = await searchTextbooks({ pathIds: ['root-1', 'stage-1'] });
    expect(results).toHaveLength(2);
  });

  it('returns an empty array when no items match', async () => {
    seedCatalogResponses();
    const { searchTextbooks } = await import('@/lib/server/textbooks');

    const results = await searchTextbooks({ q: '高中物理' });
    expect(results).toEqual([]);
  });

  it('ignores leading/trailing whitespace in the query', async () => {
    seedCatalogResponses();
    const { searchTextbooks } = await import('@/lib/server/textbooks');

    const results = await searchTextbooks({ q: '  语文  ' });
    expect(results).toHaveLength(1);
  });
});

describe('downloadTextbookPdf', () => {
  it('resolves the source file URL and streams the PDF response', async () => {
    const pdfStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
        controller.close();
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { proxyFetch } = (await import('@/lib/server/proxy-fetch')) as any;
    proxyFetch.mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      if (url.includes('details/book-1.json')) return jsonResponse(DETAIL_FIXTURE);
      if (url.includes('c1.ykt.cbern.com.cn')) return pdfResponse(pdfStream);
      return errorResponse(404, 'Not Found');
    });

    const { downloadTextbookPdf } = await import('@/lib/server/textbooks');
    const response = await downloadTextbookPdf({ contentId: 'book-1' });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toContain("filename*=UTF-8''");
    expect(response.headers.get('Content-Disposition')).toContain('.pdf');
    expect(response.headers.get('Content-Length')).toBe('1024');
    expect(response.body).toBeTruthy();
  });

  it('throws when the detail endpoint has no source file', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { proxyFetch } = (await import('@/lib/server/proxy-fetch')) as any;
    proxyFetch.mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      if (url.includes('details/book-1.json')) {
        return jsonResponse({ title: 'No files', ti_items: [] });
      }
      return errorResponse(404, 'Not Found');
    });

    const { downloadTextbookPdf } = await import('@/lib/server/textbooks');
    await expect(downloadTextbookPdf({ contentId: 'book-1' })).rejects.toThrow(
      /No downloadable PDF resource found/,
    );
  });

  it('classifies 401 and 403 resource responses as AUTH_REQUIRED', async () => {
    const { proxyFetch } = (await import('@/lib/server/proxy-fetch')) as any;
    proxyFetch.mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      if (url.includes('details/book-1.json')) return errorResponse(403, 'Forbidden');
      return errorResponse(404, 'Not Found');
    });

    const { downloadTextbookPdf } = await import('@/lib/server/textbooks');

    await expect(downloadTextbookPdf({ contentId: 'book-1' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });
});

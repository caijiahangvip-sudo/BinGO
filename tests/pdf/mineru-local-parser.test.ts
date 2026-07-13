import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import JSZip from 'jszip';

import { MineruLocalParser } from '@/lib/pdf/pdf-providers';

function buildFetchError(causeCode: string, causeName = 'Error'): Error {
  const cause = Object.assign(new Error(causeName), {
    code: causeCode,
    name: causeName,
  });
  const error = new TypeError('fetch failed') as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

describe('MineruLocalParser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BINGO_MINERU_ENABLE_ONNX_TABLES;
  });

  it('requests lean accurate MinerU output by default', async () => {
    let requestBody: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        requestBody = init.body as FormData;
        return new Response(
          JSON.stringify({
            results: {
              document: {
                md_content: 'Parsed text',
                content_list: '[]',
              },
            },
          }),
          { status: 200 },
        );
      }),
    );

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'));

    expect(result.text).toBe('Parsed text');
    expect(result.images).toEqual([]);
    expect(result.coverImage).toBeUndefined();
    expect(result.metadata?.middleJson).toBeUndefined();
    expect(result.metadata?.contentList).toBeUndefined();
    expect(requestBody?.get('formula_enable')).toBe('true');
    expect(requestBody?.get('table_enable')).toBe('false');
    expect(requestBody?.get('return_content_list')).toBe('true');
    expect(requestBody?.get('return_images')).toBe('false');
    expect(requestBody?.get('return_middle_json')).toBe('false');
  });

  it('uses text-only MinerU settings in fast mode', async () => {
    let requestBody: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        requestBody = init.body as FormData;
        return new Response(
          JSON.stringify({
            results: {
              document: {
                md_content: 'Fast parsed text',
              },
            },
          }),
          { status: 200 },
        );
      }),
    );

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'), {
      providerId: 'mineru-local',
      mode: 'fast',
      needsCover: true,
    });

    expect(result.text).toBe('Fast parsed text');
    expect(requestBody?.get('parse_method')).toBe('txt');
    expect(requestBody?.get('formula_enable')).toBe('false');
    expect(requestBody?.get('table_enable')).toBe('false');
    expect(requestBody?.get('return_content_list')).toBe('false');
    expect(requestBody?.get('return_images')).toBe('false');
    expect(requestBody?.get('end_page_id')).toBe('7');
  });

  it('allows fast mode page limits to be overridden', async () => {
    let requestBody: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        requestBody = init.body as FormData;
        return new Response(
          JSON.stringify({
            results: {
              document: {
                md_content: 'Limited parsed text',
              },
            },
          }),
          { status: 200 },
        );
      }),
    );

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'), {
      providerId: 'mineru-local',
      mode: 'fast',
      maxPages: 4,
    });

    expect(result.text).toBe('Limited parsed text');
    expect(requestBody?.get('end_page_id')).toBe('3');
  });

  it('can explicitly enable MinerU ONNX table parsing when a GPU provider is installed', async () => {
    process.env.BINGO_MINERU_ENABLE_ONNX_TABLES = '1';
    let requestBody: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        requestBody = init.body as FormData;
        return new Response(
          JSON.stringify({
            results: {
              document: {
                md_content: 'Parsed table enabled',
                content_list: '[]',
              },
            },
          }),
          { status: 200 },
        );
      }),
    );

    const parser = new MineruLocalParser();
    await parser.parse(Buffer.from('%PDF-1.7'), {
      providerId: 'mineru-local',
    });

    expect(requestBody?.get('table_enable')).toBe('true');
  });

  it('requests images and raw middle JSON only when explicitly needed', async () => {
    let requestBody: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        requestBody = init.body as FormData;
        return new Response(
          JSON.stringify({
            results: {
              document: {
                md_content: 'Parsed with images',
                content_list: '[]',
                images: {
                  img_1: 'data:image/png;base64,abc',
                },
                middle_json: JSON.stringify({ pdf_info: [{}] }),
              },
            },
          }),
          { status: 200 },
        );
      }),
    );

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'), {
      providerId: 'mineru-local',
      needsImages: true,
      needsMiddleJson: true,
    });

    expect(requestBody?.get('return_images')).toBe('true');
    expect(requestBody?.get('return_middle_json')).toBe('true');
    expect(result.images).toEqual(['data:image/png;base64,abc']);
    expect(result.coverImage).toBe('data:image/png;base64,abc');
    expect(result.metadata?.middleJson).toEqual({ pdf_info: [{}] });
    expect(result.metadata?.contentList).toEqual([]);
  });

  it('can use returned MinerU images as a cover without exposing page images', async () => {
    let requestBody: FormData | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        requestBody = init.body as FormData;
        return new Response(
          JSON.stringify({
            results: {
              document: {
                md_content: 'Parsed cover',
                content_list: '[]',
                images: {
                  cover: 'data:image/png;base64,cover',
                },
              },
            },
          }),
          { status: 200 },
        );
      }),
    );

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'), {
      providerId: 'mineru-local',
      needsCover: true,
    });

    expect(requestBody?.get('return_images')).toBe('true');
    expect(result.coverImage).toBe('data:image/png;base64,cover');
    expect(result.images).toEqual([]);
    expect(result.metadata?.pdfImages).toEqual([]);
  });

  it('does not use inaccessible MinerU relative image paths as a cover', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: {
              document: {
                md_content: 'Parsed relative image cover',
                content_list: '[]',
                images: {
                  cover: '/images/cover.jpg',
                },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'), {
      providerId: 'mineru-local',
      needsCover: true,
    });

    expect(result.coverImage).toBeUndefined();
    expect(result.images).toEqual([]);
  });

  it('parses MinerU ZIP responses when fast_api returns a binary result', async () => {
    const zip = new JSZip();
    zip.file('document/auto/document.md', 'Parsed from zip');
    zip.file(
      'document/auto/document_content_list.json',
      JSON.stringify([
        { type: 'text', text: 'Parsed from content list', page_idx: 0 },
        { type: 'table', table_body: '<table><tr><td>A</td></tr></table>', page_idx: 1 },
      ]),
    );
    zip.file('document/auto/document_middle.json', JSON.stringify({ pdf_info: [{}, {}] }));
    zip.file('document/auto/images/figure.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const zipBody = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength,
    ) as ArrayBuffer;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(zipBody, { status: 200 })));

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'), {
      providerId: 'mineru-local',
      needsImages: true,
      needsMiddleJson: true,
    });

    expect(result.text).toBe('Parsed from zip');
    expect(result.images).toEqual(['data:image/png;base64,iVBORw==']);
    expect(result.coverImage).toBe('data:image/png;base64,iVBORw==');
    expect(result.tables?.[0]?.data[0][0]).toContain('<table>');
    expect(result.metadata?.pageCount).toBe(2);
    expect(result.metadata?.contentList).toEqual([
      { type: 'text', text: 'Parsed from content list', page_idx: 0 },
      { type: 'table', table_body: '<table><tr><td>A</td></tr></table>', page_idx: 1 },
    ]);
  });

  it('parses compressed MinerU JSON responses without content-type headers', async () => {
    const payload = {
      results: {
        document: {
          md_content: 'Parsed compressed JSON',
          content_list: '[]',
        },
      },
    };
    const gzipped = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
    const gzipBody = gzipped.buffer.slice(
      gzipped.byteOffset,
      gzipped.byteOffset + gzipped.byteLength,
    ) as ArrayBuffer;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gzipBody, { status: 200 })));

    const parser = new MineruLocalParser();
    const result = await parser.parse(Buffer.from('%PDF-1.7'));

    expect(result.text).toBe('Parsed compressed JSON');
  });

  it('reports local MinerU processing timeouts without marking the service unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(buildFetchError('UND_ERR_HEADERS_TIMEOUT', 'HeadersTimeoutError')),
    );

    const parser = new MineruLocalParser();

    await expect(parser.parse(Buffer.from('%PDF-1.7'))).rejects.toThrow(
      'MinerU local service timed out while parsing the PDF',
    );
    await expect(parser.parse(Buffer.from('%PDF-1.7'))).rejects.not.toThrow(
      'MinerU local service is not reachable',
    );
  });

  it('keeps connection failures classified as local MinerU availability errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(buildFetchError('ECONNREFUSED')));

    const parser = new MineruLocalParser();

    await expect(parser.parse(Buffer.from('%PDF-1.7'))).rejects.toThrow(
      'MinerU local service is not reachable',
    );
  });
});

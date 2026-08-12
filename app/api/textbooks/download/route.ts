import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { downloadTextbookPdf } from '@/lib/server/textbooks';
import { TextbookError } from '@/lib/server/textbooks';
import type { TextbookDownloadRequest } from '@/lib/textbooks/types';

export const runtime = 'nodejs';

const MIRROR_DIR = process.env.BINGO_TEXTBOOK_MIRROR_DIR || '/data/textbooks';

let mirrorManifestCache: { mtimeMs: number; titles: Record<string, string> } | null = null;

async function mirrorTitle(contentId: string): Promise<string> {
  try {
    const manifestPath = path.join(MIRROR_DIR, 'manifest.json');
    const st = await stat(manifestPath);
    if (!mirrorManifestCache || mirrorManifestCache.mtimeMs !== st.mtimeMs) {
      const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, { title?: string }>;
      const titles: Record<string, string> = {};
      for (const [id, entry] of Object.entries(raw)) {
        if (entry?.title) titles[id] = entry.title;
      }
      mirrorManifestCache = { mtimeMs: st.mtimeMs, titles };
    }
    return (mirrorManifestCache.titles[contentId] || contentId)
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim() || contentId;
  } catch {
    return contentId;
  }
}

async function tryMirroredTextbook(contentId: string): Promise<NextResponse | null> {
  try {
    const safeId = contentId.replace(/[^a-zA-Z0-9-]/g, '');
    if (!safeId) return null;
    const filePath = path.join(MIRROR_DIR, `${safeId}.pdf`);
    const st = await stat(filePath);
    if (!st.isFile() || st.size === 0) return null;
    const title = await mirrorTitle(safeId);
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.pdf`)}`,
        'X-Textbook-Source': 'mirror',
      },
    });
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<TextbookDownloadRequest>;
    const contentId = body.contentId?.trim();

    if (!contentId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'contentId is required.');
    }

    const mirrored = await tryMirroredTextbook(contentId);
    if (mirrored) return mirrored;

    return await downloadTextbookPdf({
      contentId,
      contentType: body.contentType,
    });
  } catch (error) {
    if (error instanceof TextbookError) {
      return apiError(error.code, error.status === 401 || error.status === 403 ? 401 : 502, error.message);
    }
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Failed to download textbook PDF.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

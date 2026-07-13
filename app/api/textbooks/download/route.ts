import { NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { downloadTextbookPdf } from '@/lib/server/textbooks';
import type { TextbookDownloadRequest } from '@/lib/textbooks/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<TextbookDownloadRequest>;
    const contentId = body.contentId?.trim();

    if (!contentId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'contentId is required.');
    }

    return await downloadTextbookPdf({
      contentId,
      contentType: body.contentType,
    });
  } catch (error) {
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Failed to download textbook PDF.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

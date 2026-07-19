import { NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { downloadTextbookPdf } from '@/lib/server/textbooks';
import { TextbookError } from '@/lib/server/textbooks';
import { cookies } from 'next/headers';
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
      accessToken: (await cookies()).get('bingo_desktop_session')?.value,
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

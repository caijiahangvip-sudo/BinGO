import { NextRequest } from 'next/server';
import { renderFirstPageCover } from '@/lib/pdf/pdf-providers';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('PDF Cover');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return apiError('INVALID_REQUEST', 400, 'Expected multipart/form-data');
    }

    const formData = await req.formData();
    const pdfFile = formData.get('pdf') as File | null;
    if (!pdfFile) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'No PDF file provided');
    }

    const buffer = Buffer.from(await pdfFile.arrayBuffer());
    const coverImage = await renderFirstPageCover(buffer);
    if (!coverImage) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to render PDF cover');
    }

    return apiSuccess({ coverImage });
  } catch (error) {
    log.error('PDF cover render failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to render PDF cover',
    );
  }
}

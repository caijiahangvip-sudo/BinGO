import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getPublicCatalog, getTextbookCatalog } from '@/lib/server/textbooks';
import { TextbookError } from '@/lib/server/textbooks';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const accessToken = (await cookies()).get('bingo_desktop_session')?.value;
    const cache = await getTextbookCatalog(accessToken);
    return apiSuccess({
      catalog: getPublicCatalog(cache.catalog),
      updatedAt: cache.updatedAt,
    });
  } catch (error) {
    if (error instanceof TextbookError) {
      return apiError(error.code, error.status === 401 || error.status === 403 ? 401 : 502, error.message);
    }
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Failed to load textbook catalog.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

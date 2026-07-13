import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getPublicCatalog, getTextbookCatalog } from '@/lib/server/textbooks';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const cache = await getTextbookCatalog();
    return apiSuccess({
      catalog: getPublicCatalog(cache.catalog),
      updatedAt: cache.updatedAt,
    });
  } catch (error) {
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Failed to load textbook catalog.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

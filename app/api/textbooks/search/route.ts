import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { searchTextbooks } from '@/lib/server/textbooks';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const path = searchParams.get('path') || '';
    const pathIds = path
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    const results = await searchTextbooks({ q, pathIds });
    return apiSuccess({ results, total: results.length });
  } catch (error) {
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Failed to search textbooks.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

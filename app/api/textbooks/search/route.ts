import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { searchTextbooks } from '@/lib/server/textbooks';
import { TextbookError } from '@/lib/server/textbooks';
import { cookies } from 'next/headers';

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
    const accessToken = (await cookies()).get('bingo_desktop_session')?.value;
    const results = await searchTextbooks({ q, pathIds, accessToken });
    return apiSuccess({ results, total: results.length });
  } catch (error) {
    if (error instanceof TextbookError) {
      return apiError(error.code, error.status === 401 || error.status === 403 ? 401 : 502, error.message);
    }
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Failed to search textbooks.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

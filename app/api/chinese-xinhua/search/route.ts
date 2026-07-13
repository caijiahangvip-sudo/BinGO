import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getChineseXinhuaStatus, searchChineseXinhua } from '@/lib/server/chinese-xinhua';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';
  const limit = Number.parseInt(searchParams.get('limit') || '', 10);

  if (!query) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'q is required');
  }

  const result = await searchChineseXinhua(query, {
    limit: Number.isFinite(limit) ? limit : undefined,
    includeSemantic: searchParams.get('semantic') === '1',
  });

  return apiSuccess({
    ...result,
    status: getChineseXinhuaStatus(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    limit?: number;
    includeSemantic?: boolean;
  };
  const query = body.query?.trim() || '';

  if (!query) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'query is required');
  }

  const result = await searchChineseXinhua(query, {
    limit: body.limit,
    includeSemantic: body.includeSemantic,
  });

  return apiSuccess({
    ...result,
    status: getChineseXinhuaStatus(),
  });
}

import { type NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { specializedJson } from '@/lib/server/specialized-model-client';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const response = await specializedJson('embeddings', await req.json(), 'bge-small-zh-v1.5');
    if (!response.ok) return apiError('UPSTREAM_ERROR', response.status, await response.text());
    return NextResponse.json(await response.json());
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, 'Embedding failed', String(error));
  }
}

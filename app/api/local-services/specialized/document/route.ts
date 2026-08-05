import { type NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { specializedMultipart } from '@/lib/server/specialized-model-client';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const response = await specializedMultipart(
      'document',
      await req.formData(),
      'pp-structure-v3',
    );
    if (!response.ok) return apiError('UPSTREAM_ERROR', response.status, await response.text());
    return NextResponse.json(await response.json());
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, 'Document parsing failed', String(error));
  }
}

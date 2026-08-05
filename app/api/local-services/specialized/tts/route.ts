import { type NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { specializedMultipart } from '@/lib/server/specialized-model-client';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const response = await specializedMultipart('tts', await req.formData(), 'melotts-zh');
    if (!response.ok) return apiError('UPSTREAM_ERROR', response.status, await response.text());
    return new NextResponse(await response.arrayBuffer(), {
      headers: { 'Content-Type': response.headers.get('content-type') || 'audio/wav' },
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, 'Speech synthesis failed', String(error));
  }
}

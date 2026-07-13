import { apiError } from '@/lib/server/api-response';

export const maxDuration = 300;

export async function POST() {
  return apiError(
    'INVALID_REQUEST',
    410,
    'Book lessons must be generated through the normal classroom pipeline, not as document-style lesson content.',
  );
}

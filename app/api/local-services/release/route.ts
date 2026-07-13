import { type NextRequest } from 'next/server';
import {
  type LocalModelServiceId,
  releaseLocalModelServices,
} from '@/lib/server/local-model-services';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';

function isLocalModelServiceId(value: unknown): value is LocalModelServiceId {
  return value === 'cosyvoice' || value === 'sensevoice' || value === 'mineru' || value === 'embedding';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { services?: unknown };
    const servicesInput = Array.isArray(body.services) ? body.services : [];
    const services = servicesInput.filter(isLocalModelServiceId);

    if (services.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'services must include a local model service');
    }

    const result = await releaseLocalModelServices(services);
    return apiSuccess({
      services: result.services,
      released: result.released,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to release local model services',
      error instanceof Error ? error.message : String(error),
    );
  }
}

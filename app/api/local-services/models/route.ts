import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  clearSpecializedModelCache,
  getSpecializedModelManagerSnapshot,
  installSpecializedModel,
  prepareRecommendedSpecializedModels,
  saveSpecializedModelPreferences,
  stopSpecializedModel,
  type SpecializedModelPreferences,
} from '@/lib/server/specialized-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return apiSuccess(await getSpecializedModelManagerSnapshot());
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, 'Failed to inspect specialized models', String(error));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: 'install' | 'stop' | 'save-preferences' | 'prepare-recommended' | 'clear-cache';
      modelId?: string;
      preferences?: SpecializedModelPreferences;
    };
    if (body.action === 'save-preferences' && body.preferences) {
      const preferences = await saveSpecializedModelPreferences(body.preferences);
      return apiSuccess({ preferences });
    }
    if (body.action === 'prepare-recommended') {
      return apiSuccess(await prepareRecommendedSpecializedModels());
    }
    if (body.action === 'clear-cache') {
      return apiSuccess(await clearSpecializedModelCache());
    }
    if (!body.modelId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'modelId is required');
    }
    if (body.action === 'install') {
      return apiSuccess(await installSpecializedModel(body.modelId));
    }
    if (body.action === 'stop') {
      return apiSuccess(await stopSpecializedModel(body.modelId));
    }
    return apiError('INVALID_REQUEST', 400, 'Unsupported specialized model action');
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Specialized model operation failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

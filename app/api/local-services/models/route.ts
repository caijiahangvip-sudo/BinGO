import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getInstallJob, startInstallJob } from '@/lib/server/model-install-jobs';
import {
  clearSpecializedModelCache,
  getSpecializedModelManagerSnapshot,
  installSpecializedModel,
  prepareRecommendedSpecializedModels,
  saveSpecializedModelPreferences,
  SPECIALIZED_MODEL_CATALOG,
  stopSpecializedModel,
  type SpecializedModelPreferences,
} from '@/lib/server/specialized-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 2000;

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get('jobId');
    if (jobId) {
      const job = getInstallJob(jobId);
      if (!job) {
        return apiError('RESOURCE_NOT_FOUND', 404, 'Model install job was not found');
      }
      return apiSuccess({ ...job, pollIntervalMs: POLL_INTERVAL_MS });
    }
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
      const snapshot = await getSpecializedModelManagerSnapshot();
      const modelIds = snapshot.recommendations.map((recommendation) => recommendation.usable.id);
      const jobId = startInstallJob('prepare', modelIds, async (report) => {
        report({ step: 'starting', message: '正在准备推荐模型…' });
        await prepareRecommendedSpecializedModels((modelId) => {
          const model = SPECIALIZED_MODEL_CATALOG.find((candidate) => candidate.id === modelId);
          report({
            step: 'starting',
            currentModelId: modelId,
            message: model ? `正在启动模型服务…（${model.name}）` : '正在启动模型服务…',
          });
        });
      });
      return apiSuccess({ jobId, pollIntervalMs: POLL_INTERVAL_MS });
    }
    if (body.action === 'clear-cache') {
      return apiSuccess(await clearSpecializedModelCache());
    }
    if (!body.modelId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'modelId is required');
    }
    if (body.action === 'install') {
      const model = SPECIALIZED_MODEL_CATALOG.find((candidate) => candidate.id === body.modelId);
      if (!model) {
        return apiError('INVALID_REQUEST', 400, `Unknown specialized model: ${body.modelId}`);
      }
      const jobId = startInstallJob('install', [model.id], async (report) => {
        report({
          step: 'starting',
          currentModelId: model.id,
          message: '正在启动模型服务…',
        });
        await installSpecializedModel(model.id);
        report({ step: 'warmup', message: '正在加载预热…' });
      });
      return apiSuccess({ jobId, pollIntervalMs: POLL_INTERVAL_MS });
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

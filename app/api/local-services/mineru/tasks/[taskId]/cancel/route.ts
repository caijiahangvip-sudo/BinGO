import { apiError, apiSuccess } from '@/lib/server/api-response';
import { cancelMineruPdfTask } from '@/lib/server/mineru-task-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  if (!taskId) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'MinerU task id is required');
  }

  const result = await cancelMineruPdfTask(taskId);
  if (!result) {
    return apiError('INVALID_REQUEST', 404, 'MinerU task was not found');
  }

  return apiSuccess({
    ...result,
  });
}

import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  isValidHomeworkSolveJobId,
  readHomeworkSolveJob,
} from '@/lib/server/homework-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('HomeworkJob API');

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  let resolvedJobId: string | undefined;
  try {
    const { jobId } = await context.params;
    resolvedJobId = jobId;

    if (!isValidHomeworkSolveJobId(jobId)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid homework solve job id');
    }

    const job = await readHomeworkSolveJob(jobId);
    if (!job) {
      return apiError('INVALID_REQUEST', 404, 'Homework solve job not found');
    }

    return apiSuccess({
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      message: job.message,
      logs: job.logs,
      inputSummary: job.inputSummary,
      heartbeatAt: job.heartbeatAt,
      updatedAt: job.updatedAt,
      pollUrl: `${buildRequestOrigin(req)}/api/homework/solve/${jobId}`,
      pollIntervalMs: 3000,
      done: job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled',
      result: job.result,
      error: job.error,
    });
  } catch (error) {
    log.error(`Homework job retrieval failed [jobId=${resolvedJobId ?? 'unknown'}]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to retrieve homework solve job',
      error instanceof Error ? error.message : String(error),
    );
  }
}

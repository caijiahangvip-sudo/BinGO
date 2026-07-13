import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  isValidHomeworkSolveJobId,
  markHomeworkSolveJobCancelled,
  readHomeworkSolveJob,
} from '@/lib/server/homework-job-store';
import { cancelMineruPdfTasksByOwner } from '@/lib/server/mineru-task-manager';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  if (!isValidHomeworkSolveJobId(jobId)) {
    return apiError('INVALID_REQUEST', 400, 'Invalid homework solve job id');
  }

  const job = await readHomeworkSolveJob(jobId);
  if (!job) {
    return apiError('INVALID_REQUEST', 404, 'Homework solve job not found');
  }

  const cancelledTasks = await cancelMineruPdfTasksByOwner(`homework:${jobId}`);
  const updated =
    job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled'
      ? job
      : await markHomeworkSolveJobCancelled(jobId);

  return apiSuccess({
    jobId,
    status: updated.status,
    stage: updated.stage,
    message: updated.message,
    cancelledTasks,
  });
}

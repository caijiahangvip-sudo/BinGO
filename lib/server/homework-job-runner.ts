import type { ResolvedModel } from '@/lib/server/resolve-model';
import { solveHomework } from '@/lib/server/homework-solver';
import {
  cleanupHomeworkSolveJobUploads,
  markHomeworkSolveJobCancelled,
  markHomeworkSolveJobFailed,
  markHomeworkSolveJobRunning,
  markHomeworkSolveJobSucceeded,
  readHomeworkSolveJob,
  readStoredHomeworkUploads,
  touchHomeworkSolveJob,
  updateHomeworkSolveJobProgress,
} from '@/lib/server/homework-job-store';
import { MineruTaskCancelledError } from '@/lib/server/mineru-task-manager';
import { createLogger } from '@/lib/logger';

const log = createLogger('HomeworkJob');
const runningJobs = new Map<string, Promise<void>>();
const HEARTBEAT_INTERVAL_MS = 15_000;

export function runHomeworkSolveJob(params: {
  jobId: string;
  resolvedModel: ResolvedModel;
  pdfProviderId?: string;
  pdfApiKey?: string;
  pdfBaseUrl?: string;
}): Promise<void> {
  const existing = runningJobs.get(params.jobId);
  if (existing) return existing;

  const jobPromise = (async () => {
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    try {
      await markHomeworkSolveJobRunning(params.jobId);
      heartbeatTimer = setInterval(() => {
        touchHomeworkSolveJob(params.jobId).catch((error) => {
          log.warn(`Failed to heartbeat homework job ${params.jobId}:`, error);
        });
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

      const job = await readHomeworkSolveJob(params.jobId);
      if (!job) throw new Error(`Homework solve job not found: ${params.jobId}`);
      const uploads = await readStoredHomeworkUploads(job);
      const result = await solveHomework(
        {
          uploads,
          language: job.inputSummary.language,
          pdfProviderId: params.pdfProviderId,
          pdfApiKey: params.pdfApiKey,
          pdfBaseUrl: params.pdfBaseUrl,
        },
        params.resolvedModel,
        {
          onProgress: async (progress) => {
            const latest = await readHomeworkSolveJob(params.jobId);
            if (latest?.status === 'cancelled') {
              throw new Error('Homework solve job was cancelled.');
            }
            await updateHomeworkSolveJobProgress(params.jobId, progress);
          },
          mineruOwnerId: `homework:${params.jobId}`,
        },
      );

      await markHomeworkSolveJobSucceeded(params.jobId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Homework solve job ${params.jobId} failed:`, error);
      try {
        const latest = await readHomeworkSolveJob(params.jobId);
        if (latest?.status === 'cancelled') {
          return;
        }
        if (error instanceof MineruTaskCancelledError) {
          await markHomeworkSolveJobCancelled(params.jobId);
          return;
        }
        await markHomeworkSolveJobFailed(params.jobId, message);
      } catch (markFailedError) {
        log.error(`Failed to persist failed status for homework job ${params.jobId}:`, markFailedError);
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await cleanupHomeworkSolveJobUploads(params.jobId);
      runningJobs.delete(params.jobId);
    }
  })();

  runningJobs.set(params.jobId, jobPromise);
  return jobPromise;
}

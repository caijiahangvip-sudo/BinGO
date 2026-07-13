import { promises as fs } from 'fs';
import path from 'path';
import type { HomeworkLanguage } from '@/lib/types/homework';
import type {
  HomeworkSolveJobLog,
  HomeworkSolveJobStage,
  HomeworkSolveJobStatus,
  HomeworkSolveProgress,
  HomeworkSolveResult,
} from '@/lib/server/homework-solve-types';
import type { HomeworkSolveUpload } from '@/lib/server/homework-solver';
import { writeJsonFileAtomic } from '@/lib/server/classroom-storage';

export const HOMEWORK_JOBS_DIR = path.join(process.cwd(), 'data', 'homework-jobs');

export interface StoredHomeworkSolveUpload {
  fileName: string;
  mimeType: string;
  size: number;
  isPdf: boolean;
  isImage: boolean;
  relativePath: string;
}

export interface HomeworkSolveJob {
  id: string;
  status: HomeworkSolveJobStatus;
  stage: HomeworkSolveJobStage;
  progress: number;
  message: string;
  logs: HomeworkSolveJobLog[];
  createdAt: string;
  updatedAt: string;
  heartbeatAt: string;
  startedAt?: string;
  completedAt?: string;
  inputSummary: {
    fileNames: string[];
    fileCount: number;
    totalBytes: number;
    language: HomeworkLanguage;
    pdfProviderId?: string;
    modelString: string;
  };
  uploads: StoredHomeworkSolveUpload[];
  result?: HomeworkSolveResult;
  error?: string;
}

async function ensureHomeworkJobsDir() {
  await fs.mkdir(HOMEWORK_JOBS_DIR, { recursive: true });
}

function jobDirPath(jobId: string) {
  return path.join(HOMEWORK_JOBS_DIR, jobId);
}

function uploadsDirPath(jobId: string) {
  return path.join(jobDirPath(jobId), 'uploads');
}

function jobFilePath(jobId: string) {
  return path.join(jobDirPath(jobId), 'job.json');
}

function uploadFileName(index: number, fileName: string): string {
  const ext = path.extname(fileName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  return `${String(index + 1).padStart(3, '0')}${ext || '.bin'}`;
}

function logEntry(
  stage: HomeworkSolveJobStage,
  message: string,
  progress?: number,
): HomeworkSolveJobLog {
  return {
    timestamp: new Date().toISOString(),
    stage,
    message,
    ...(typeof progress === 'number' ? { progress } : {}),
  };
}

const jobLocks = new Map<string, Promise<void>>();
const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000;

async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  jobLocks.set(jobId, next);
  try {
    await prev;
    return await fn();
  } finally {
    resolve!();
    if (jobLocks.get(jobId) === next) jobLocks.delete(jobId);
  }
}

function markStaleIfNeeded(job: HomeworkSolveJob): HomeworkSolveJob {
  if (job.status !== 'running' && job.status !== 'queued') return job;
  const lastActiveAt = new Date(job.heartbeatAt || job.updatedAt).getTime();
  if (Date.now() - lastActiveAt <= STALE_JOB_TIMEOUT_MS) return job;

  const now = new Date().toISOString();
  return {
    ...job,
    status: 'failed',
    stage: 'failed',
    message: 'Homework solve job appears stale.',
    error: 'Job appears stale: no progress heartbeat for 30 minutes.',
    completedAt: now,
    updatedAt: now,
    logs: [
      ...job.logs,
      logEntry('failed', 'Job appears stale: no progress heartbeat for 30 minutes.'),
    ],
  };
}

export function isValidHomeworkSolveJobId(jobId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(jobId);
}

export async function createHomeworkSolveJob(params: {
  jobId: string;
  uploads: HomeworkSolveUpload[];
  language: HomeworkLanguage;
  pdfProviderId?: string;
  modelString: string;
}): Promise<HomeworkSolveJob> {
  await ensureHomeworkJobsDir();
  await fs.mkdir(uploadsDirPath(params.jobId), { recursive: true });

  const storedUploads: StoredHomeworkSolveUpload[] = [];
  for (const [index, upload] of params.uploads.entries()) {
    const relativePath = path.join('uploads', uploadFileName(index, upload.fileName));
    const targetPath = path.join(jobDirPath(params.jobId), relativePath);
    const buffer = Buffer.from(await upload.file.arrayBuffer());
    await fs.writeFile(targetPath, buffer);
    storedUploads.push({
      fileName: upload.fileName,
      mimeType: upload.file.type || (upload.isPdf ? 'application/pdf' : 'application/octet-stream'),
      size: upload.file.size,
      isPdf: upload.isPdf,
      isImage: upload.isImage,
      relativePath,
    });
  }

  const now = new Date().toISOString();
  const fileNames = params.uploads.map((upload) => upload.fileName);
  const job: HomeworkSolveJob = {
    id: params.jobId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    message: 'Homework solve job queued.',
    logs: [logEntry('queued', 'Homework solve job queued.', 0)],
    createdAt: now,
    updatedAt: now,
    heartbeatAt: now,
    inputSummary: {
      fileNames,
      fileCount: params.uploads.length,
      totalBytes: params.uploads.reduce((sum, upload) => sum + upload.file.size, 0),
      language: params.language,
      pdfProviderId: params.pdfProviderId,
      modelString: params.modelString,
    },
    uploads: storedUploads,
  };

  await writeJsonFileAtomic(jobFilePath(params.jobId), job);
  return job;
}

export async function readHomeworkSolveJob(jobId: string): Promise<HomeworkSolveJob | null> {
  try {
    const content = await fs.readFile(jobFilePath(jobId), 'utf-8');
    return markStaleIfNeeded(JSON.parse(content) as HomeworkSolveJob);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function updateHomeworkSolveJob(
  jobId: string,
  patch: Partial<HomeworkSolveJob>,
): Promise<HomeworkSolveJob> {
  return withJobLock(jobId, async () => {
    const existing = await readHomeworkSolveJob(jobId);
    if (!existing) throw new Error(`Homework solve job not found: ${jobId}`);
    const updated: HomeworkSolveJob = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFileAtomic(jobFilePath(jobId), updated);
    return updated;
  });
}

export async function markHomeworkSolveJobRunning(jobId: string): Promise<HomeworkSolveJob> {
  const now = new Date().toISOString();
  return updateHomeworkSolveJob(jobId, {
    status: 'running',
    stage: 'validating',
    progress: 5,
    message: 'Homework solve started.',
    startedAt: now,
    heartbeatAt: now,
  });
}

export async function touchHomeworkSolveJob(jobId: string): Promise<void> {
  await updateHomeworkSolveJob(jobId, {
    heartbeatAt: new Date().toISOString(),
  });
}

export async function updateHomeworkSolveJobProgress(
  jobId: string,
  progress: HomeworkSolveProgress,
): Promise<HomeworkSolveJob> {
  const existing = await readHomeworkSolveJob(jobId);
  if (!existing) throw new Error(`Homework solve job not found: ${jobId}`);
  if (
    existing.status === 'cancelled' ||
    existing.status === 'failed' ||
    existing.status === 'succeeded'
  ) {
    return existing;
  }
  return updateHomeworkSolveJob(jobId, {
    status: 'running',
    stage: progress.stage,
    progress: progress.progress,
    message: progress.message,
    heartbeatAt: new Date().toISOString(),
    logs: [...existing.logs, logEntry(progress.stage, progress.message, progress.progress)].slice(
      -80,
    ),
  });
}

export async function markHomeworkSolveJobSucceeded(
  jobId: string,
  result: HomeworkSolveResult,
): Promise<HomeworkSolveJob> {
  const existing = await readHomeworkSolveJob(jobId);
  if (!existing) throw new Error(`Homework solve job not found: ${jobId}`);
  if (existing.status === 'cancelled') return existing;
  const now = new Date().toISOString();
  return updateHomeworkSolveJob(jobId, {
    status: 'succeeded',
    stage: 'completed',
    progress: 100,
    message: 'Homework answers generated.',
    heartbeatAt: now,
    completedAt: now,
    result,
    logs: [...existing.logs, logEntry('completed', 'Homework answers generated.', 100)].slice(-80),
  });
}

export async function markHomeworkSolveJobFailed(
  jobId: string,
  error: string,
): Promise<HomeworkSolveJob> {
  const existing = await readHomeworkSolveJob(jobId);
  if (!existing) throw new Error(`Homework solve job not found: ${jobId}`);
  if (existing.status === 'cancelled') return existing;
  const now = new Date().toISOString();
  return updateHomeworkSolveJob(jobId, {
    status: 'failed',
    stage: 'failed',
    message: 'Homework solve failed.',
    heartbeatAt: now,
    completedAt: now,
    error,
    logs: [...existing.logs, logEntry('failed', error)].slice(-80),
  });
}

export async function markHomeworkSolveJobCancelled(
  jobId: string,
  message = 'Homework solve job was cancelled.',
): Promise<HomeworkSolveJob> {
  const existing = await readHomeworkSolveJob(jobId);
  if (!existing) throw new Error(`Homework solve job not found: ${jobId}`);
  const now = new Date().toISOString();
  return updateHomeworkSolveJob(jobId, {
    status: 'cancelled',
    stage: 'cancelled',
    progress: existing.progress,
    message,
    heartbeatAt: now,
    completedAt: now,
    error: message,
    logs: [...existing.logs, logEntry('cancelled', message)].slice(-80),
  });
}

export async function readStoredHomeworkUploads(
  job: HomeworkSolveJob,
): Promise<HomeworkSolveUpload[]> {
  const uploads: HomeworkSolveUpload[] = [];
  for (const upload of job.uploads) {
    const buffer = await fs.readFile(path.join(jobDirPath(job.id), upload.relativePath));
    uploads.push({
      file: new File([new Uint8Array(buffer)], upload.fileName, { type: upload.mimeType }),
      fileName: upload.fileName,
      isPdf: upload.isPdf,
      isImage: upload.isImage,
    });
  }
  return uploads;
}

export async function cleanupHomeworkSolveJobUploads(jobId: string): Promise<void> {
  await fs.rm(uploadsDirPath(jobId), { recursive: true, force: true }).catch(() => undefined);
}

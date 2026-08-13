import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { getLocalModelServiceInstallMeta } from '@/lib/server/local-model-services';
import { getBingoRuntimeRoot } from '@/lib/server/runtime-paths';
import { SPECIALIZED_MODEL_CATALOG } from '@/lib/server/specialized-models';

export type ModelInstallJobKind = 'install' | 'prepare';
export type ModelInstallJobStatus = 'running' | 'succeeded' | 'failed';

export interface ModelInstallJobUpdate {
  step?: string;
  message?: string;
  progress?: number;
  currentModelId?: string;
}

export interface ModelInstallJobSnapshot {
  jobId: string;
  kind: ModelInstallJobKind;
  status: ModelInstallJobStatus;
  step: string;
  progress: number;
  message: string;
  currentModelId?: string;
  modelIds: string[];
  done: boolean;
  error?: string;
}

interface ModelInstallJob {
  jobId: string;
  kind: ModelInstallJobKind;
  status: ModelInstallJobStatus;
  step: string;
  progress: number;
  message: string;
  currentModelId?: string;
  modelIds: string[];
  done: boolean;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const FINISHED_JOB_TTL_MS = 30 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 2000;
const LOG_TAIL_BYTES = 4096;
const MAX_SAMPLED_PROGRESS = 95;

const JOBS_KEY = Symbol.for('bingo.modelInstallJobs');

function getJobs(): Map<string, ModelInstallJob> {
  const globalState = globalThis as typeof globalThis & {
    [JOBS_KEY]?: Map<string, ModelInstallJob>;
  };
  globalState[JOBS_KEY] ??= new Map();
  return globalState[JOBS_KEY];
}

function pruneFinishedJobs() {
  const now = Date.now();
  for (const [jobId, job] of getJobs()) {
    if (job.done && now - job.updatedAt > FINISHED_JOB_TTL_MS) {
      getJobs().delete(jobId);
    }
  }
}

function findModel(modelId: string) {
  return SPECIALIZED_MODEL_CATALOG.find((candidate) => candidate.id === modelId);
}

function formatModelSize(modelId: string): string {
  const model = findModel(modelId);
  if (!model || model.estimatedDiskBytes <= 0) return '';
  const gb = model.estimatedDiskBytes / 1024 ** 3;
  return gb >= 1
    ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
    : `${Math.max(1, Math.round(model.estimatedDiskBytes / 1024 ** 2))} MB`;
}

function downloadMessage(modelId: string, kind: ModelInstallJobKind): string {
  const model = findModel(modelId);
  const size = formatModelSize(modelId);
  const sizePart = size ? `（约 ${size}）` : '';
  if (kind === 'prepare' && model) {
    return `正在下载模型 ${model.name}${sizePart}…`;
  }
  return `正在下载模型${sizePart}…`;
}

/** Read the last few KB of a service log and extract the last percentage, preferring download-looking lines. */
async function readLogTailPercent(logName: string): Promise<number> {
  try {
    const logPath = path.join(process.cwd(), `bingo-${logName}.log`);
    const handle = await fs.open(logPath, 'r');
    try {
      const stat = await handle.stat();
      if (stat.size <= 0) return 0;
      const length = Math.min(stat.size, LOG_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      const lines = buffer.toString('utf8').split(/\r?\n/).reverse();
      const candidates = [
        ...lines.filter((line) => /B\/s|\d\s*(?:MB|GB|MiB|GiB)/i.test(line)),
        ...lines,
      ];
      for (const line of candidates) {
        const matches = [...line.matchAll(/(\d+(?:\.\d+)?)%/g)];
        if (matches.length === 0) continue;
        const value = Number(matches[matches.length - 1][1]);
        if (Number.isFinite(value)) return value;
      }
      return 0;
    } finally {
      await handle.close();
    }
  } catch {
    return 0;
  }
}

async function directorySizeBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await directorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        total += (await fs.stat(fullPath)).size;
      }
    } catch {
      // A single unreadable file must not break the whole sample.
    }
  }
  return total;
}

/** Estimate progress from actual bytes on disk vs. the catalog's estimated disk size. */
async function sampleDiskPercent(modelId: string): Promise<number> {
  const model = findModel(modelId);
  if (!model?.service || model.estimatedDiskBytes <= 0) return 0;
  const { serviceDir } = getLocalModelServiceInstallMeta(model.service);
  const runtimeRoot = getBingoRuntimeRoot();
  const dirs = [
    path.join(runtimeRoot, 'cache', 'hf'),
    path.join(runtimeRoot, 'cache', 'modelscope'),
    path.join(runtimeRoot, 'services', serviceDir),
  ];
  const sizes = await Promise.all(dirs.map((dir) => directorySizeBytes(dir)));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return (total / model.estimatedDiskBytes) * 100;
}

/**
 * Best-effort progress estimate (0-95) for a model installation, combining the
 * service log's textual progress bar with the on-disk size of its caches.
 */
export async function sampleModelProgress(modelId: string): Promise<number> {
  const model = findModel(modelId);
  if (!model?.service) return 0;
  const { logName } = getLocalModelServiceInstallMeta(model.service);
  const [logPercent, diskPercent] = await Promise.all([
    readLogTailPercent(logName),
    sampleDiskPercent(modelId),
  ]);
  return Math.min(MAX_SAMPLED_PROGRESS, Math.max(0, logPercent, diskPercent));
}

/**
 * Start a background install job. Returns the job id immediately; the sampler
 * updates progress every 2s and `run` reports stage messages via `report`.
 */
export function startInstallJob(
  kind: ModelInstallJobKind,
  modelIds: string[],
  run: (report: (update: ModelInstallJobUpdate) => void) => Promise<void>,
): string {
  pruneFinishedJobs();
  const jobId = randomUUID();
  const now = Date.now();
  const job: ModelInstallJob = {
    jobId,
    kind,
    status: 'running',
    step: 'starting',
    progress: 0,
    message: kind === 'install' ? '正在启动模型服务…' : '正在准备推荐模型…',
    currentModelId: modelIds[0],
    modelIds,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  getJobs().set(jobId, job);

  const report = (update: ModelInstallJobUpdate) => {
    if (update.step !== undefined) job.step = update.step;
    if (update.message !== undefined) job.message = update.message;
    if (update.currentModelId !== undefined) job.currentModelId = update.currentModelId;
    if (update.progress !== undefined) {
      // Monotonic within a job: never let progress move backwards.
      job.progress = Math.min(100, Math.max(job.progress, update.progress));
    }
    job.updatedAt = Date.now();
  };

  const sampler = setInterval(() => {
    const modelId = job.currentModelId ?? job.modelIds[0];
    if (!modelId || job.status !== 'running') return;
    void sampleModelProgress(modelId)
      .then((sampled) => {
        if (job.status !== 'running') return;
        if (sampled > job.progress) job.progress = sampled;
        if (sampled > 0 && job.step === 'starting') {
          job.step = 'downloading';
          job.message = downloadMessage(modelId, job.kind);
        }
        job.updatedAt = Date.now();
      })
      .catch(() => undefined);
  }, SAMPLE_INTERVAL_MS);
  sampler.unref?.();

  void (async () => {
    try {
      await run(report);
      job.status = 'succeeded';
      job.step = 'done';
      job.progress = 100;
      job.message = '完成';
      job.done = true;
    } catch (error) {
      job.status = 'failed';
      job.step = 'failed';
      job.done = true;
      job.error = error instanceof Error ? error.message : String(error);
      job.message = job.error;
    } finally {
      clearInterval(sampler);
      job.updatedAt = Date.now();
    }
  })();

  return jobId;
}

export function getInstallJob(jobId: string): ModelInstallJobSnapshot | undefined {
  pruneFinishedJobs();
  const job = getJobs().get(jobId);
  if (!job) return undefined;
  if (job.status === 'running' && Date.now() - job.updatedAt > STALE_JOB_TIMEOUT_MS) {
    job.status = 'failed';
    job.step = 'failed';
    job.done = true;
    job.error = '安装任务已超时（30 分钟无进度更新）';
    job.message = job.error;
    job.updatedAt = Date.now();
  }
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message,
    ...(job.currentModelId ? { currentModelId: job.currentModelId } : {}),
    modelIds: job.modelIds,
    done: job.done,
    ...(job.error ? { error: job.error } : {}),
  };
}

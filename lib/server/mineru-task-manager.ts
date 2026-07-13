import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { releaseLocalModelServicesSafely } from '@/lib/server/local-model-services';

const log = createLogger('MineruTaskManager');

export type MineruPdfTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type MineruPdfTaskSource = 'pdf-parse' | 'homework';
export type MineruPdfTaskCancelMode = 'remove-queued' | 'interrupt-running' | 'none';
export type MineruPdfTaskCancelAction =
  | 'removed-queued-task'
  | 'interrupted-running-task'
  | 'already-terminal';

export interface MineruPdfTaskSummary {
  id: string;
  fileName: string;
  source: MineruPdfTaskSource;
  ownerId?: string;
  status: MineruPdfTaskStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelledAt?: string;
  error?: string;
  queuePosition?: number;
  cancelMode: MineruPdfTaskCancelMode;
  serviceRestartRequired: boolean;
}

export interface MineruPdfTaskCancelResult {
  task: MineruPdfTaskSummary;
  action: MineruPdfTaskCancelAction;
}

export interface MineruTaskRunContext {
  taskId: string;
  signal: AbortSignal;
}

type MineruPdfTaskOptions<T> = {
  fileName: string;
  source: MineruPdfTaskSource;
  ownerId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  execute: (context: MineruTaskRunContext) => Promise<T>;
};

interface InternalMineruTask<T> {
  id: string;
  fileName: string;
  source: MineruPdfTaskSource;
  ownerId?: string;
  timeoutMs?: number;
  status: MineruPdfTaskStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancelledAt?: number;
  error?: string;
  controller: AbortController;
  interruptError?: Error;
  execute: (context: MineruTaskRunContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  releasePromise?: Promise<unknown>;
  cleanupParentAbort?: () => void;
}

export class MineruTaskCancelledError extends Error {
  taskId: string;

  constructor(taskId: string, message = 'MinerU PDF task was cancelled.') {
    super(message);
    this.name = 'MineruTaskCancelledError';
    this.taskId = taskId;
  }
}

export class MineruTaskTimedOutError extends Error {
  taskId: string;
  timeoutMs: number;

  constructor(taskId: string, timeoutMs: number, fileName: string) {
    super(
      `MinerU PDF task timed out after ${formatDuration(timeoutMs)} while parsing ${fileName}. The local MinerU service was stopped so the queue can continue.`,
    );
    this.name = 'MineruTaskTimedOutError';
    this.taskId = taskId;
    this.timeoutMs = timeoutMs;
  }
}

const TASK_HISTORY_LIMIT = 80;
const TASK_HISTORY_RETENTION_MS = 60 * 60 * 1000;

const tasks = new Map<string, InternalMineruTask<unknown>>();
const queue: Array<InternalMineruTask<unknown>> = [];
let activeTask: InternalMineruTask<unknown> | undefined;
let isDraining = false;

function toIsoTime(value?: number): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toSummary(task: InternalMineruTask<unknown>): MineruPdfTaskSummary {
  const queueIndex = queue.findIndex((item) => item.id === task.id);
  const cancelMode: MineruPdfTaskCancelMode =
    task.status === 'queued'
      ? 'remove-queued'
      : task.status === 'running'
        ? 'interrupt-running'
        : 'none';
  return {
    id: task.id,
    fileName: task.fileName,
    source: task.source,
    ...(task.ownerId ? { ownerId: task.ownerId } : {}),
    status: task.status,
    queuedAt: new Date(task.queuedAt).toISOString(),
    ...(toIsoTime(task.startedAt) ? { startedAt: toIsoTime(task.startedAt) } : {}),
    ...(toIsoTime(task.finishedAt) ? { finishedAt: toIsoTime(task.finishedAt) } : {}),
    ...(toIsoTime(task.cancelledAt) ? { cancelledAt: toIsoTime(task.cancelledAt) } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...(queueIndex >= 0 ? { queuePosition: queueIndex + 1 } : {}),
    cancelMode,
    serviceRestartRequired: cancelMode === 'interrupt-running',
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeCancelledError<T>(task: InternalMineruTask<T>): MineruTaskCancelledError {
  return new MineruTaskCancelledError(task.id, `MinerU PDF task was cancelled: ${task.fileName}`);
}

function isTaskCancelled(task: InternalMineruTask<unknown>): boolean {
  return task.status === 'cancelled' || task.interruptError instanceof MineruTaskCancelledError;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (seconds >= 1) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  return `${ms} ms`;
}

function getTaskInterruptError<T>(task: InternalMineruTask<T>): Error {
  return task.interruptError || makeCancelledError(task);
}

function stopMineruForInterruptedTask<T>(task: InternalMineruTask<T>): void {
  task.releasePromise = task.releasePromise || releaseLocalModelServicesSafely(['mineru']);
}

function markTaskCancelled(task: InternalMineruTask<unknown>, error = makeCancelledError(task)) {
  task.status = 'cancelled';
  task.cancelledAt = task.cancelledAt || Date.now();
  task.error = error.message;
  task.interruptError = error;
}

function removeQueuedTask(task: InternalMineruTask<unknown>, error: Error): boolean {
  const queuedIndex = queue.findIndex((item) => item.id === task.id);
  if (queuedIndex < 0) return false;

  queue.splice(queuedIndex, 1);
  task.finishedAt = Date.now();
  task.reject(error);
  task.cleanupParentAbort?.();
  pruneTaskHistory();
  scheduleDrain();
  return true;
}

function abortTaskFromParentSignal(task: InternalMineruTask<unknown>): void {
  if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
    return;
  }

  const error = new MineruTaskCancelledError(
    task.id,
    `MinerU PDF task was cancelled because the request was aborted: ${task.fileName}`,
  );
  markTaskCancelled(task, error);
  task.controller.abort();

  if (removeQueuedTask(task, error)) return;

  if (activeTask?.id === task.id) {
    stopMineruForInterruptedTask(task);
  }
}

function attachParentAbortSignal(task: InternalMineruTask<unknown>, signal?: AbortSignal): void {
  if (!signal) return;

  const abort = () => abortTaskFromParentSignal(task);
  if (signal.aborted) {
    abort();
    return;
  }

  signal.addEventListener('abort', abort, { once: true });
  task.cleanupParentAbort = () => signal.removeEventListener('abort', abort);
}

function runTaskWithInterrupt<T>(task: InternalMineruTask<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const interruptPromise = new Promise<never>((_resolve, reject) => {
    const rejectOnAbort = () => {
      reject(getTaskInterruptError(task));
    };

    if (task.controller.signal.aborted) {
      rejectOnAbort();
      return;
    }

    task.controller.signal.addEventListener('abort', rejectOnAbort, { once: true });

    if (task.timeoutMs && task.timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (task.status !== 'running') return;

        const timeoutError = new MineruTaskTimedOutError(
          task.id,
          task.timeoutMs || 0,
          task.fileName,
        );
        task.status = 'failed';
        task.error = timeoutError.message;
        task.interruptError = timeoutError;
        stopMineruForInterruptedTask(task);
        task.controller.abort();
        reject(timeoutError);
      }, task.timeoutMs);
      timeout.unref?.();
    }
  });

  return Promise.race([
    task.execute({ taskId: task.id, signal: task.controller.signal }),
    interruptPromise,
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function pruneTaskHistory(): void {
  const now = Date.now();
  const finished = [...tasks.values()]
    .filter((task) => task.status !== 'queued' && task.status !== 'running')
    .sort((a, b) => (a.finishedAt || a.cancelledAt || 0) - (b.finishedAt || b.cancelledAt || 0));

  for (const task of finished) {
    const terminalAt = task.finishedAt || task.cancelledAt || task.queuedAt;
    if (now - terminalAt <= TASK_HISTORY_RETENTION_MS && tasks.size <= TASK_HISTORY_LIMIT) {
      continue;
    }
    tasks.delete(task.id);
  }
}

function scheduleDrain(): void {
  if (isDraining) return;
  isDraining = true;
  queueMicrotask(() => {
    void drainQueue();
  });
}

async function drainQueue(): Promise<void> {
  try {
    if (activeTask) return;

    const task = queue.shift();
    if (!task) return;

    if (task.status === 'cancelled') {
      task.reject(makeCancelledError(task));
      scheduleDrain();
      return;
    }

    activeTask = task;
    task.status = 'running';
    task.startedAt = Date.now();

    try {
      const result = await runTaskWithInterrupt(task);
      if (isTaskCancelled(task)) {
        task.status = 'cancelled';
        task.finishedAt = Date.now();
        task.error = task.interruptError?.message || 'Cancelled by user.';
        task.reject(getTaskInterruptError(task));
        return;
      }

      task.status = 'succeeded';
      task.finishedAt = Date.now();
      task.resolve(result);
    } catch (error) {
      if (error instanceof MineruTaskTimedOutError) {
        task.status = 'failed';
        task.finishedAt = Date.now();
        task.error = error.message;
        task.reject(error);
        return;
      }

      if (isTaskCancelled(task)) {
        task.status = 'cancelled';
        task.cancelledAt = task.cancelledAt || Date.now();
        task.finishedAt = Date.now();
        task.error = task.interruptError?.message || 'Cancelled by user.';
        task.reject(getTaskInterruptError(task));
        return;
      }

      task.status = 'failed';
      task.finishedAt = Date.now();
      task.error = getErrorMessage(error);
      task.reject(error);
    } finally {
      if (task.releasePromise) {
        await task.releasePromise.catch((error) => {
          log.warn(`Failed to stop MinerU after cancelling task ${task.id}:`, error);
        });
      }
      if (activeTask?.id === task.id) {
        activeTask = undefined;
      }
      task.cleanupParentAbort?.();
      pruneTaskHistory();
      scheduleDrain();
    }
  } finally {
    isDraining = false;
    if (!activeTask && queue.length > 0) {
      scheduleDrain();
    }
  }
}

export function enqueueMineruPdfTask<T>(options: MineruPdfTaskOptions<T>): Promise<T> {
  pruneTaskHistory();

  const task: InternalMineruTask<T> = {
    id: randomUUID(),
    fileName: options.fileName,
    source: options.source,
    ownerId: options.ownerId,
    timeoutMs: options.timeoutMs,
    status: 'queued',
    queuedAt: Date.now(),
    controller: new AbortController(),
    execute: options.execute,
    resolve: () => undefined,
    reject: () => undefined,
  };

  const promise = new Promise<T>((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });

  tasks.set(task.id, task as InternalMineruTask<unknown>);
  queue.push(task as InternalMineruTask<unknown>);
  attachParentAbortSignal(task as InternalMineruTask<unknown>, options.signal);
  scheduleDrain();
  return promise;
}

export function listMineruPdfTasks(): MineruPdfTaskSummary[] {
  pruneTaskHistory();
  return [...tasks.values()]
    .map(toSummary)
    .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());
}

export function getMineruPdfTask(taskId: string): MineruPdfTaskSummary | undefined {
  const task = tasks.get(taskId);
  return task ? toSummary(task) : undefined;
}

export async function cancelMineruPdfTask(
  taskId: string,
): Promise<MineruPdfTaskCancelResult | undefined> {
  const task = tasks.get(taskId);
  if (!task) return undefined;

  if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
    return {
      task: toSummary(task),
      action: 'already-terminal',
    };
  }

  const error = makeCancelledError(task);
  markTaskCancelled(task, error);
  task.controller.abort();

  if (removeQueuedTask(task, error)) {
    return {
      task: toSummary(task),
      action: 'removed-queued-task',
    };
  }

  if (activeTask?.id === task.id) {
    stopMineruForInterruptedTask(task);
    const releasePromise = task.releasePromise;
    await releasePromise?.catch((error) => {
      log.warn(`Failed to stop MinerU after cancelling task ${task.id}:`, error);
    });
  }

  return {
    task: toSummary(task),
    action: 'interrupted-running-task',
  };
}

export async function cancelMineruPdfTasksByOwner(
  ownerId: string,
): Promise<MineruPdfTaskCancelResult[]> {
  const ownerTasks = [...tasks.values()].filter(
    (task) => task.ownerId === ownerId && (task.status === 'queued' || task.status === 'running'),
  );
  const cancelled: MineruPdfTaskCancelResult[] = [];
  for (const task of ownerTasks) {
    const result = await cancelMineruPdfTask(task.id);
    if (result) cancelled.push(result);
  }
  return cancelled;
}

export function __resetMineruTaskManagerForTests(): void {
  for (const task of tasks.values()) {
    if (task.status === 'queued' || task.status === 'running') {
      markTaskCancelled(task);
      task.controller.abort();
      task.reject(getTaskInterruptError(task));
      task.cleanupParentAbort?.();
    }
  }
  tasks.clear();
  queue.length = 0;
  activeTask = undefined;
  isDraining = false;
}

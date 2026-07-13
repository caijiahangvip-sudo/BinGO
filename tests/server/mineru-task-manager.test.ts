import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const releaseLocalModelServicesSafelyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/local-model-services', () => ({
  releaseLocalModelServicesSafely: releaseLocalModelServicesSafelyMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('mineru task manager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    releaseLocalModelServicesSafelyMock.mockReset();
    releaseLocalModelServicesSafelyMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    const manager = await import('@/lib/server/mineru-task-manager');
    manager.__resetMineruTaskManagerForTests();
  });

  it('runs MinerU PDF tasks serially', async () => {
    const manager = await import('@/lib/server/mineru-task-manager');
    const first = deferred<string>();
    let secondStarted = false;

    const firstPromise = manager.enqueueMineruPdfTask({
      fileName: 'first.pdf',
      source: 'pdf-parse',
      execute: () => first.promise,
    });
    const secondPromise = manager.enqueueMineruPdfTask({
      fileName: 'second.pdf',
      source: 'pdf-parse',
      execute: async () => {
        secondStarted = true;
        return 'second';
      },
    });

    await flushMicrotasks();
    expect(secondStarted).toBe(false);
    expect(
      manager
        .listMineruPdfTasks()
        .map((task) => task.status)
        .sort(),
    ).toEqual(['queued', 'running']);

    first.resolve('first');
    await expect(firstPromise).resolves.toBe('first');
    await expect(secondPromise).resolves.toBe('second');
    expect(secondStarted).toBe(true);
  });

  it('cancels a queued task without stopping MinerU', async () => {
    const manager = await import('@/lib/server/mineru-task-manager');
    const first = deferred<string>();

    const firstPromise = manager.enqueueMineruPdfTask({
      fileName: 'running.pdf',
      source: 'pdf-parse',
      execute: () => first.promise,
    });
    const queuedPromise = manager.enqueueMineruPdfTask({
      fileName: 'queued.pdf',
      source: 'pdf-parse',
      execute: async () => 'queued',
    });

    await flushMicrotasks();
    const queuedTask = manager.listMineruPdfTasks().find((task) => task.fileName === 'queued.pdf');
    expect(queuedTask?.status).toBe('queued');
    expect(queuedTask?.cancelMode).toBe('remove-queued');
    expect(queuedTask?.serviceRestartRequired).toBe(false);

    const cancelResult = await manager.cancelMineruPdfTask(queuedTask!.id);
    expect(cancelResult?.action).toBe('removed-queued-task');
    expect(cancelResult?.task.status).toBe('cancelled');
    await expect(queuedPromise).rejects.toThrow('MinerU PDF task was cancelled');
    expect(releaseLocalModelServicesSafelyMock).not.toHaveBeenCalled();

    first.resolve('running');
    await expect(firstPromise).resolves.toBe('running');
  });

  it('cancels the running task by aborting it, stopping MinerU, and keeping the queue', async () => {
    const manager = await import('@/lib/server/mineru-task-manager');
    const runningPromise = manager.enqueueMineruPdfTask({
      fileName: 'running.pdf',
      source: 'homework',
      execute: ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    let queuedStarted = false;
    const queuedPromise = manager.enqueueMineruPdfTask({
      fileName: 'queued-after-running.pdf',
      source: 'pdf-parse',
      execute: async () => {
        queuedStarted = true;
        return 'queued';
      },
    });

    await flushMicrotasks();
    const runningTask = manager
      .listMineruPdfTasks()
      .find((task) => task.fileName === 'running.pdf');
    expect(runningTask?.status).toBe('running');
    expect(runningTask?.cancelMode).toBe('interrupt-running');
    expect(runningTask?.serviceRestartRequired).toBe(true);
    expect(queuedStarted).toBe(false);

    const cancelResult = await manager.cancelMineruPdfTask(runningTask!.id);
    expect(cancelResult?.action).toBe('interrupted-running-task');
    expect(cancelResult?.task.status).toBe('cancelled');

    await expect(runningPromise).rejects.toThrow('MinerU PDF task was cancelled');
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
    await expect(queuedPromise).resolves.toBe('queued');
    expect(queuedStarted).toBe(true);
  });

  it('times out a hung running task, stops MinerU, and continues the queue', async () => {
    vi.useFakeTimers();
    const manager = await import('@/lib/server/mineru-task-manager');
    let timedOutSignal: AbortSignal | undefined;
    let queuedStarted = false;

    const hungPromise = manager.enqueueMineruPdfTask({
      fileName: 'hung.pdf',
      source: 'pdf-parse',
      timeoutMs: 5000,
      execute: ({ signal }) => {
        timedOutSignal = signal;
        return new Promise<string>(() => undefined);
      },
    });
    const queuedPromise = manager.enqueueMineruPdfTask({
      fileName: 'queued-after-timeout.pdf',
      source: 'pdf-parse',
      execute: async () => {
        queuedStarted = true;
        return 'queued';
      },
    });

    await flushMicrotasks();
    expect(queuedStarted).toBe(false);
    expect(timedOutSignal?.aborted).toBe(false);

    const hungExpectation = expect(hungPromise).rejects.toThrow(
      'MinerU PDF task timed out after 5 seconds',
    );
    await vi.advanceTimersByTimeAsync(5000);

    await hungExpectation;
    expect(timedOutSignal?.aborted).toBe(true);
    expect(releaseLocalModelServicesSafelyMock).toHaveBeenCalledWith(['mineru']);
    await expect(queuedPromise).resolves.toBe('queued');
    expect(queuedStarted).toBe(true);

    const timedOutTask = manager.listMineruPdfTasks().find((task) => task.fileName === 'hung.pdf');
    expect(timedOutTask?.status).toBe('failed');
    expect(timedOutTask?.error).toContain('timed out');
  });

  it('cancels only queued tasks for the requested owner', async () => {
    const manager = await import('@/lib/server/mineru-task-manager');
    const running = deferred<string>();

    const runningPromise = manager.enqueueMineruPdfTask({
      fileName: 'running.pdf',
      source: 'pdf-parse',
      execute: () => running.promise,
    });
    const ownerPromise = manager.enqueueMineruPdfTask({
      fileName: 'owner.pdf',
      source: 'homework',
      ownerId: 'homework:one',
      execute: async () => 'owner',
    });
    const otherPromise = manager.enqueueMineruPdfTask({
      fileName: 'other.pdf',
      source: 'homework',
      ownerId: 'homework:two',
      execute: async () => 'other',
    });

    await flushMicrotasks();
    const cancelled = await manager.cancelMineruPdfTasksByOwner('homework:one');

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.action).toBe('removed-queued-task');
    await expect(ownerPromise).rejects.toThrow('MinerU PDF task was cancelled');

    running.resolve('running');
    await expect(runningPromise).resolves.toBe('running');
    await expect(otherPromise).resolves.toBe('other');
  });
});

import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const openSyncMock = vi.hoisted(() => vi.fn());
const closeSyncMock = vi.hoisted(() => vi.fn());
const createConnectionMock = vi.hoisted(() => vi.fn());
const LOCAL_MODEL_START_PROMISES_KEY = Symbol.for('bingo.localModelService.startPromises');

vi.mock('child_process', () => ({
  spawn: spawnMock,
  execFile: execFileMock,
}));

vi.mock('fs', () => ({
  default: {
    existsSync: existsSyncMock,
    openSync: openSyncMock,
    closeSync: closeSyncMock,
  },
}));

vi.mock('net', () => ({
  default: {
    createConnection: createConnectionMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type SpawnCall = [string, string[], Record<string, unknown>];
const repoRoot = process.cwd();

function getPowerShellLauncherCalls(): SpawnCall[] {
  return execFileMock.mock.calls.filter(
    (call) =>
      call[0] === 'powershell.exe' &&
      Array.isArray(call[1]) &&
      call[1].join(' ').includes('Start-Process -FilePath "powershell.exe"'),
  ) as SpawnCall[];
}

function mockPlatform(value: NodeJS.Platform) {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(value);
}

function mockPortClosed() {
  createConnectionMock.mockImplementation(() => {
    const socket = new EventEmitter() as EventEmitter & {
      setTimeout: (timeoutMs: number) => void;
      destroy: () => void;
    };
    socket.setTimeout = vi.fn();
    socket.destroy = vi.fn();
    queueMicrotask(() => socket.emit('error', new Error('closed')));
    return socket;
  });
}

function mockSpawnSuccess() {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      once: EventEmitter['once'];
      unref: () => void;
    };
    child.unref = vi.fn();
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
}

describe('local model services', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mockPlatform('win32');
    process.chdir(repoRoot);
    delete process.env.BINGO_WSL_DISTRO;
    delete process.env.BINGO_LOCAL_MODEL_RUNTIME;
    spawnMock.mockReset();
    execFileMock.mockReset();
    existsSyncMock.mockReset();
    openSyncMock.mockReset();
    closeSyncMock.mockReset();
    createConnectionMock.mockReset();
    delete (globalThis as Record<symbol, unknown>)[LOCAL_MODEL_START_PROMISES_KEY];
    openSyncMock.mockReturnValue(101);
    closeSyncMock.mockReturnValue(undefined);
    existsSyncMock.mockReturnValue(true);
    mockPortClosed();
    mockSpawnSuccess();
    execFileMock.mockImplementation((_file, args, _options, callback) => {
      if (Array.isArray(args) && args.includes('hostname')) {
        callback(null, { stdout: '172.28.1.2 ', stderr: '' });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
  });

  it.each([
    ['cosyvoice', 'cosyvoice-local-server.ps1', 50000],
    ['sensevoice', 'sensevoice-local-server.ps1', 50001],
    ['mineru', 'mineru-local-server.ps1', 50002],
    ['embedding', 'chinese-xinhua-embedding-wsl-server.ps1', 50003],
  ] as const)(
    'starts %s through the PowerShell WSL ROCm wrapper by default',
    async (service, script, port) => {
      const { ensureLocalModelServiceRunning } = await import('@/lib/server/local-model-services');

      await expect(ensureLocalModelServiceRunning(service, { port, timeoutMs: 5 })).rejects.toThrow(
        `Timed out waiting for local model service on port ${port}.`,
      );

      const powerShellCalls = getPowerShellLauncherCalls();
      expect(powerShellCalls).toHaveLength(1);
      const [file, args, options] = powerShellCalls[0];
      expect(file).toBe('powershell.exe');
      expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-Command']));
      expect(args.join(' ')).toContain(script);
      expect(args.join(' ')).toContain(String(port));
      expect(args.join(' ')).not.toContain('.cmd');
      expect(args.join(' ')).not.toContain('.venv\\Scripts\\python.exe');
      expect(options.windowsHide).toBe(true);
    },
  );

  it.each([
    ['cosyvoice', 'cosyvoice-local-server.ps1', 50000],
    ['sensevoice', 'sensevoice-local-server.ps1', 50001],
    ['mineru', 'mineru-local-server.ps1', 50002],
  ] as const)(
    'keeps %s on the WSL ROCm wrapper even when Windows runtime is requested',
    async (service, script, port) => {
      process.env.BINGO_LOCAL_MODEL_RUNTIME = 'windows';
      const { ensureLocalModelServiceRunning } = await import('@/lib/server/local-model-services');

      await expect(ensureLocalModelServiceRunning(service, { port, timeoutMs: 5 })).rejects.toThrow(
        `Timed out waiting for local model service on port ${port}.`,
      );

      const powerShellCalls = getPowerShellLauncherCalls();
      expect(powerShellCalls).toHaveLength(1);
      const [file, args, options] = powerShellCalls[0];
      expect(file).toBe('powershell.exe');
      expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-Command']));
      expect(args.join(' ')).toContain(script);
      expect(args.join(' ')).not.toContain('.cmd');
      expect(options.env).toEqual(expect.objectContaining({ BINGO_LOCAL_MODEL_RUNTIME: 'rocm' }));
      expect(options.windowsHide).toBe(true);
    },
  );

  it('passes the configured WSL distro to service startup', async () => {
    process.env.BINGO_WSL_DISTRO = 'Ubuntu-24.04';
    const { ensureLocalModelServiceRunning } = await import('@/lib/server/local-model-services');

    await expect(
      ensureLocalModelServiceRunning('cosyvoice', { port: 50000, timeoutMs: 5 }),
    ).rejects.toThrow('Timed out waiting for local model service on port 50000.');

    const [, args] = getPowerShellLauncherCalls()[0];
    expect(args.join(' ')).toContain('Ubuntu-24.04');
  });

  it('shares an in-progress startup across module reloads', async () => {
    const firstModule = await import('@/lib/server/local-model-services');
    const firstStart = firstModule
      .ensureLocalModelServiceRunning('cosyvoice', {
        port: 50000,
        timeoutMs: 20,
      })
      .catch((error) => error as Error);

    await vi.waitFor(() => expect(getPowerShellLauncherCalls()).toHaveLength(1));
    vi.resetModules();
    const secondModule = await import('@/lib/server/local-model-services');
    const secondStart = secondModule
      .ensureLocalModelServiceRunning('cosyvoice', {
        port: 50000,
        timeoutMs: 20,
      })
      .catch((error) => error as Error);

    const firstResult = await firstStart;
    const secondResult = await secondStart;
    expect(firstResult).toBeInstanceOf(Error);
    expect(secondResult).toBeInstanceOf(Error);
    expect((firstResult as Error).message).toContain(
      'Timed out waiting for local model service on port 50000.',
    );
    expect((secondResult as Error).message).toContain(
      'Timed out waiting for local model service on port 50000.',
    );
    expect(getPowerShellLauncherCalls()).toHaveLength(1);
  });

  it('treats BINGO_LOCAL_MODEL_RUNTIME=rocm as the WSL ROCm startup path', async () => {
    process.env.BINGO_LOCAL_MODEL_RUNTIME = 'rocm';
    const { ensureLocalModelServiceRunning } = await import('@/lib/server/local-model-services');

    await expect(
      ensureLocalModelServiceRunning('cosyvoice', { port: 50000, timeoutMs: 5 }),
    ).rejects.toThrow('Timed out waiting for local model service on port 50000.');

    const [file, args] = getPowerShellLauncherCalls()[0];
    expect(file).toBe('powershell.exe');
    expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-Command']));
    expect(args.join(' ')).toContain('cosyvoice-local-server.ps1');
    expect(args.join(' ')).not.toContain('cosyvoice-local-server.cmd');
  });

  it('starts services directly from WSL/Linux when Bingo runs inside WSL', async () => {
    mockPlatform('linux');
    const { ensureLocalModelServiceRunning } = await import('@/lib/server/local-model-services');

    await expect(
      ensureLocalModelServiceRunning('mineru', { port: 50002, timeoutMs: 5 }),
    ).rejects.toThrow('Timed out waiting for local model service on port 50002.');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = spawnMock.mock.calls[0] as SpawnCall;
    expect(file).toBe('bash');
    expect(args[0]).toBe('-lc');
    expect(args[1]).toContain('RUNTIME_ROOT');
    expect(args[1]).toContain('mineru.cli.fast_api');
    expect(args[1]).toContain('--port 50002');
    expect(options.detached).toBe(true);
    expect(options.env).toEqual(
      expect.objectContaining({
        MINERU_PORT: '50002',
        BINGO_LOCAL_MODEL_RUNTIME: 'rocm',
      }),
    );
  });

  it('releases multiple services with separate PowerShell calls', async () => {
    const { releaseLocalModelServices } = await import('@/lib/server/local-model-services');

    const result = await releaseLocalModelServices(['cosyvoice', 'sensevoice', 'embedding']);

    expect(result.released).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(execFileMock.mock.calls.map((call) => call[1])).toEqual([
      expect.arrayContaining(['-Service', 'cosyvoice']),
      expect.arrayContaining(['-Service', 'sensevoice']),
      expect.arrayContaining(['-Service', 'embedding']),
    ]);
  });

  it('releases MinerU directly when Bingo runs inside WSL/Linux', async () => {
    mockPlatform('linux');
    execFileMock.mockImplementation((file, _args, _options, callback) => {
      if (file === 'ps') {
        callback(null, {
          stdout: [
            ' 2537 1 /home/jiahang/.cache/bingo/services/MinerU/.venv/bin/python -m mineru.cli.fast_api --host 0.0.0.0 --port 50002',
            ' 7111 1 tail -n 80 bingo-mineru.log',
          ].join('\n'),
          stderr: '',
        });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });
    const alive = new Set([2537]);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      const numericPid = Number(pid);
      if (signal === 0) {
        if (alive.has(numericPid)) return true;
        throw Object.assign(new Error('not found'), { code: 'ESRCH' });
      }
      if (signal === 'SIGTERM') {
        alive.delete(numericPid);
      }
      return true;
    });

    const { releaseLocalModelServices } = await import('@/lib/server/local-model-services');
    const result = await releaseLocalModelServices(['mineru']);

    expect(result.released).toBe(true);
    expect(result.stdout).toContain('mineru matched root processes: 1');
    expect(result.stdout).toContain('total target processes: 1');
    expect(killSpy).toHaveBeenCalledWith(2537, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(7111, expect.anything());
  });
});

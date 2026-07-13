import { execFile } from 'child_process';
import fs from 'fs/promises';
import { promisify } from 'util';
import { apiSuccess } from '@/lib/server/api-response';
import { getBingoRuntimeRoot } from '@/lib/server/runtime-paths';

const execFileAsync = promisify(execFile);

async function commandWorks(command: string, args: string[]) {
  try {
    const result = await execFileAsync(command, args, { windowsHide: true, timeout: 8000 });
    return { available: true, output: `${result.stdout || result.stderr}`.trim() };
  } catch (error) {
    return { available: false, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET() {
  const runtimeRoot = getBingoRuntimeRoot();
  await fs.mkdir(runtimeRoot, { recursive: true });
  const disk = await fs.statfs(runtimeRoot);
  const freeBytes = disk.bavail * disk.bsize;
  const [wsl, gpu] = await Promise.all([
    commandWorks('wsl.exe', ['--status']),
    commandWorks('nvidia-smi.exe', ['--query-gpu=name,memory.total', '--format=csv,noheader']),
  ]);
  return apiSuccess({
    desktop: process.env.BINGO_DESKTOP === '1',
    runtimeRoot,
    freeBytes,
    wsl,
    gpu,
    recommendations: {
      minimumFreeBytes: 20 * 1024 ** 3,
      preferredFreeBytes: 50 * 1024 ** 3,
    },
  });
}

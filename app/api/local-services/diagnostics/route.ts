import fs from 'fs/promises';
import { apiSuccess } from '@/lib/server/api-response';
import { getLocalRuntimeDiagnostics } from '@/lib/server/gpu-diagnostics';
import { getBingoRuntimeRoot } from '@/lib/server/runtime-paths';

export async function GET() {
  const runtimeRoot = getBingoRuntimeRoot();
  await fs.mkdir(runtimeRoot, { recursive: true });
  const disk = await fs.statfs(runtimeRoot);
  const freeBytes = disk.bavail * disk.bsize;
  const { wsl, gpu } = await getLocalRuntimeDiagnostics();
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

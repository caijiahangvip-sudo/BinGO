import { spawn } from 'child_process';
import path from 'path';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';

export async function POST() {
  if (process.platform !== 'win32' || process.env.BINGO_DESKTOP !== '1') {
    return apiError(
      'INVALID_REQUEST',
      403,
      'ROCm setup can only be started from the BinGO Windows client',
    );
  }

  const launcherPath = path.join(process.cwd(), 'scripts', 'launch-install-wsl-rocm-admin.vbs');
  try {
    const child = spawn('wscript.exe', [launcherPath], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return apiSuccess({ started: true });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to start WSL ROCm setup',
      error instanceof Error ? error.message : String(error),
    );
  }
}

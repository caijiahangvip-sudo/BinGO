import { spawn } from 'child_process';
import { access, readFile } from 'fs/promises';
import path from 'path';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';

const EXE_NAME = 'tchMaterial-parser-windows-x64.exe';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDownloaderPath(): Promise<string | null> {
  const configuredPath = process.env.TEXTBOOK_DOWNLOADER_EXE_PATH?.trim();
  const candidates = [
    configuredPath,
    path.join(process.cwd(), 'tools', 'textbook-downloader', EXE_NAME),
    path.join(process.cwd(), '..', 'tools', 'textbook-downloader', EXE_NAME),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }

  return null;
}

async function isWslWithWindowsInterop(): Promise<boolean> {
  if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME) {
    return true;
  }

  try {
    const osRelease = await readFile('/proc/sys/kernel/osrelease', 'utf8');
    return /microsoft|wsl/i.test(osRelease);
  } catch {
    return false;
  }
}

function toWindowsPath(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) {
    return filePath;
  }

  const match = filePath.match(/^\/mnt\/([a-zA-Z])\/(.+)$/);
  if (!match) {
    return filePath;
  }

  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function spawnDownloader(exePath: string, isWsl: boolean) {
  if (!isWsl) {
    return spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
  }

  return spawn('cmd.exe', ['/c', 'start', '', toWindowsPath(exePath)], {
    detached: true,
    stdio: 'ignore',
  });
}

export async function POST() {
  const isWsl = process.platform === 'linux' && (await isWslWithWindowsInterop());

  if (process.platform !== 'win32' && !isWsl) {
    return apiError(
      'SERVICE_UNAVAILABLE',
      400,
      'Textbook downloader is only available on Windows or WSL with Windows interop.',
    );
  }

  const exePath = await resolveDownloaderPath();
  if (!exePath) {
    return apiError(
      'SERVICE_UNAVAILABLE',
      404,
      'Textbook downloader executable was not found.',
    );
  }

  try {
    const child = spawnDownloader(exePath, isWsl);

    const launchError = await new Promise<Error | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 300);
      child.once('error', (error) => {
        clearTimeout(timer);
        resolve(error);
      });
    });

    if (launchError) {
      return apiError(
        'INTERNAL_ERROR',
        500,
        'Failed to launch textbook downloader.',
        launchError.message,
      );
    }

    child.unref();
    return apiSuccess({ launched: true, executable: path.basename(exePath) });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to launch textbook downloader.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

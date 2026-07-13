import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { type NextRequest, NextResponse } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BACKUP_PATH = 'seed/user-backup.zip';

function resolvePathInsideRoot(relativePath: string): string {
  if (!relativePath.trim()) {
    throw new Error('Backup path is required.');
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute paths are not allowed.');
  }

  const root = path.resolve(process.cwd());
  const resolved = path.resolve(root, relativePath);
  const rootWithSeparator = `${root}${path.sep}`;

  if (resolved !== root && !resolved.startsWith(rootWithSeparator)) {
    throw new Error('Backup path must stay inside the project root.');
  }

  return resolved;
}

async function getFileMetadata(relativePath: string) {
  const resolvedPath = resolvePathInsideRoot(relativePath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      exists: false,
      relativePath,
      resolvedPath,
    };
  }

  const stats = await fsp.stat(resolvedPath);
  return {
    exists: true,
    relativePath,
    resolvedPath,
    size: stats.size,
    updatedAt: stats.mtimeMs,
    signature: `${stats.size}:${stats.mtimeMs}`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const relativePath = searchParams.get('path') || DEFAULT_BACKUP_PATH;
    const shouldDownload = searchParams.get('download') === '1';
    const metadata = await getFileMetadata(relativePath);

    if (!metadata.exists) {
      return shouldDownload
        ? apiError('INVALID_REQUEST', 404, 'Local backup file was not found.')
        : apiSuccess({
            exists: false,
            relativePath,
          });
    }

    if (!shouldDownload) {
      return apiSuccess({
        exists: true,
        relativePath: metadata.relativePath,
        size: metadata.size,
        updatedAt: metadata.updatedAt,
        signature: metadata.signature,
      });
    }

    const fileBuffer = await fsp.readFile(metadata.resolvedPath);
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': String(metadata.size),
        'content-disposition': `attachment; filename="${path.basename(metadata.relativePath)}"`,
      },
    });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to access local backup.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const relativePath = String(formData.get('outputPath') || DEFAULT_BACKUP_PATH);

    if (!(file instanceof File)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'file is required.');
    }

    const resolvedPath = resolvePathInsideRoot(relativePath);
    await fsp.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fsp.writeFile(resolvedPath, Buffer.from(await file.arrayBuffer()));

    const metadata = await getFileMetadata(relativePath);
    return apiSuccess({
      exists: true,
      relativePath,
      size: metadata.size,
      updatedAt: metadata.updatedAt,
      signature: metadata.signature,
    });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to write local backup.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export async function storeEncryptedObject(payload: string): Promise<string> {
  await mkdir(config.BINGO_OBJECT_STORAGE_DIR, { recursive: true });
  const fileName = `${randomUUID()}.bgo`;
  await writeFile(resolve(config.BINGO_OBJECT_STORAGE_DIR, fileName), payload, { encoding: 'utf8', mode: 0o600 });
  return fileName;
}

export async function readEncryptedObject(storagePath: string): Promise<string> {
  if (!/^[a-f0-9-]+\.bgo$/i.test(storagePath)) throw new Error('附件存储路径无效');
  return readFile(resolve(config.BINGO_OBJECT_STORAGE_DIR, storagePath), 'utf8');
}

export async function deleteEncryptedObject(storagePath: string): Promise<void> {
  if (!/^[a-f0-9-]+\.bgo$/i.test(storagePath)) return;
  await unlink(resolve(config.BINGO_OBJECT_STORAGE_DIR, storagePath)).catch(() => undefined);
}

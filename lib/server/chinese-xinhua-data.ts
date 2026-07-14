import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const OPTIONAL_FILE = 'ci.json.gz';
const OPTIONAL_FILE_SHA256 = '6f30f3c75a039139b977e626d6f24a3b42b4389d968ead58e0e6b9522c6c8616';
const DOWNLOAD_RETRY_DELAY_MS = 30 * 60_000;
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

let activeDownload: Promise<void> | null = null;
let lastDownloadFailureAt = 0;

function packagedDataRoot() {
  return path.join(process.cwd(), 'data', 'chinese-xinhua', 'data');
}

function runtimeDataRoot() {
  const runtimeRoot = process.env.BINGO_RUNTIME_ROOT?.trim();
  return runtimeRoot ? path.join(runtimeRoot, 'data', 'chinese-xinhua', 'data') : null;
}

export function resolveChineseXinhuaDataFile(fileName: string): string | null {
  const roots = [runtimeDataRoot(), packagedDataRoot()].filter((value): value is string => !!value);
  for (const root of roots) {
    for (const candidate of [path.join(root, fileName), path.join(root, `${fileName}.gz`)]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function getChineseXinhuaDataRoots() {
  return {
    packaged: packagedDataRoot(),
    runtime: runtimeDataRoot(),
  };
}

export async function ensureOptionalChineseXinhuaData(): Promise<void> {
  if (resolveChineseXinhuaDataFile('ci.json')) return;
  const runtimeRoot = runtimeDataRoot();
  if (!runtimeRoot || process.env.BINGO_DESKTOP !== '1') return;
  if (Date.now() - lastDownloadFailureAt < DOWNLOAD_RETRY_DELAY_MS) return;
  if (activeDownload) return activeDownload;

  activeDownload = (async () => {
    const baseUrl =
      process.env.BINGO_CHINESE_XINHUA_ASSET_BASE_URL?.trim() ||
      'https://github.com/caijiahangvip-sudo/BinGO/releases/latest/download';
    const response = await fetch(`${baseUrl}/${OPTIONAL_FILE}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Dictionary asset is too large');
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== OPTIONAL_FILE_SHA256) throw new Error('Dictionary asset checksum mismatch');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const destination = path.join(runtimeRoot, OPTIONAL_FILE);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, destination);
  })()
    .catch(() => {
      lastDownloadFailureAt = Date.now();
    })
    .finally(() => {
      activeDownload = null;
    });
  return activeDownload;
}

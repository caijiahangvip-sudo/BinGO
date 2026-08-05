import { getRuntimePlatform, type BinGoRuntimePlatform } from './platform';

export type RuntimeApiTarget = 'cloud' | 'ipad-local' | 'windows-local';

const WINDOWS_LOCAL_PREFIXES = ['/api/desktop/', '/api/local-services/'];
const IPAD_LOCAL_PATHS = new Set([
  '/api/parse-pdf',
  '/api/pdf-cover',
  '/api/question-vision',
  '/api/transcription',
  '/api/generate/tts',
  '/api/local-backup',
]);

function matchesPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

export function getRuntimeApiTarget(path: string, platform = getRuntimePlatform()): RuntimeApiTarget {
  const pathname = path.split('?', 1)[0];
  if (platform === 'desktop' && matchesPrefix(pathname, WINDOWS_LOCAL_PREFIXES)) {
    return 'windows-local';
  }
  if (platform === 'ipados' && IPAD_LOCAL_PATHS.has(pathname)) return 'ipad-local';
  return 'cloud';
}

export function isCloudApiPath(path: string, platform = getRuntimePlatform()): boolean {
  return getRuntimeApiTarget(path, platform) === 'cloud';
}

export function isLocalApiPath(path: string, platform = getRuntimePlatform()): boolean {
  return getRuntimeApiTarget(path, platform) !== 'cloud';
}

export function getApiPlatformLabel(platform: BinGoRuntimePlatform): string {
  if (platform === 'desktop') return 'Windows 本地服务';
  if (platform === 'ipados') return 'iPad 本地能力';
  return '云端服务';
}

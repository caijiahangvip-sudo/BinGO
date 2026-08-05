export type BinGoRuntimePlatform = 'browser' | 'desktop' | 'ipados';

export interface NativePlatformInfo {
  platform: 'desktop' | 'ipados';
  deviceFamily: 'desktop' | 'ipad';
  architecture: string;
  localInference: boolean;
  modelExecution: 'local' | 'cloud-api' | 'computer-server';
  browserTtsAllowed: boolean;
}

function isIPadUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getRuntimePlatform(): BinGoRuntimePlatform {
  if (isIPadUserAgent()) return 'ipados';
  return isTauriRuntime() ? 'desktop' : 'browser';
}

async function invokeNative<T>(command: string): Promise<T> {
  if (!isTauriRuntime()) throw new Error(`${command} requires the BinGO native runtime`);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command);
}

export async function getNativePlatformInfo(): Promise<NativePlatformInfo | null> {
  if (!isTauriRuntime()) return null;
  return invokeNative<NativePlatformInfo>('bingo_platform_info');
}

export function isBrowserTtsAllowed(): boolean {
  return true;
}

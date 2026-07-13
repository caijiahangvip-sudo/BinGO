export function formatContextWindow(size?: number): string {
  if (!size) return '-';

  // For M: prefer decimal (use decimal for exact thousands)
  if (size >= 1000000) {
    if (size % 1000000 === 0) {
      return `${size / 1000000}M`;
    }
    return `${(size / 1000000).toFixed(1)}M`;
  }

  // For K: prefer decimal if divisible by 1000, otherwise use binary
  if (size >= 1000) {
    if (size % 1000 === 0) {
      return `${size / 1000}K`;
    }
    return `${Math.floor(size / 1024)}K`;
  }

  return size.toString();
}

export function getProviderTypeLabel(type: string, t: (key: string) => string): string {
  const translationKey = `settings.providerTypes.${type}`;
  const translated = t(translationKey);
  // If translation exists (not equal to key), use it; otherwise fallback to type
  return translated !== translationKey ? translated : type;
}

export const LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS = 10 * 60 * 1000;
export const SETTINGS_CONNECTION_TEST_TIMEOUT_MS = LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS + 60_000;

export interface SettingsTestOptions {
  signal?: AbortSignal;
  localServiceStartupTimeoutMs?: number;
}

export function getAbortErrorMessage(
  t: (key: string) => string,
  timeoutMs = SETTINGS_CONNECTION_TEST_TIMEOUT_MS,
): string {
  const translated = t('settings.connectionTestTimeout');
  if (translated !== 'settings.connectionTestTimeout') {
    return translated;
  }
  return `Connection test timed out after ${Math.round(timeoutMs / 1000)} seconds`;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export async function fetchWithSettingsTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = SETTINGS_CONNECTION_TEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

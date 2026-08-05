import { getRuntimePlatform } from './platform';

const CLOUD_API_BASE_URL_KEY = 'bingo:ipad-cloud-api-base-url';
const CLOUD_API_TOKEN_KEY = 'bingo:ipad-cloud-api-token';

interface RuntimeWindow extends Window {
  __BINGO_RUNTIME_CONFIG__?: {
    apiBaseUrl?: string;
    apiToken?: string;
  };
}

function trimBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || null;
}

export function getCloudApiBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const runtimeConfig = (window as RuntimeWindow).__BINGO_RUNTIME_CONFIG__;
  return trimBaseUrl(
    runtimeConfig?.apiBaseUrl || window.localStorage.getItem(CLOUD_API_BASE_URL_KEY),
  );
}

export function setCloudApiBaseUrl(value: string | null): void {
  if (typeof window === 'undefined') return;
  const normalized = trimBaseUrl(value);
  if (normalized) window.localStorage.setItem(CLOUD_API_BASE_URL_KEY, normalized);
  else window.localStorage.removeItem(CLOUD_API_BASE_URL_KEY);
}

export function getCloudApiToken(): string | null {
  if (typeof window === 'undefined') return null;
  const runtimeConfig = (window as RuntimeWindow).__BINGO_RUNTIME_CONFIG__;
  return runtimeConfig?.apiToken?.trim() || window.localStorage.getItem(CLOUD_API_TOKEN_KEY);
}

export function setCloudApiToken(value: string | null): void {
  if (typeof window === 'undefined') return;
  const normalized = value?.trim();
  if (normalized) window.localStorage.setItem(CLOUD_API_TOKEN_KEY, normalized);
  else window.localStorage.removeItem(CLOUD_API_TOKEN_KEY);
}

function addCloudApiAuthorization(init?: RequestInit): RequestInit | undefined {
  const token = getCloudApiToken();
  if (!token) return init;
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function getSyncServerUrl(): string | null {
  return null;
}

export function setSyncServerUrl(value: string | null): void {
  void value;
}

export function resolveRuntimeApiUrl(path: string): string {
  if (!path.startsWith('/')) throw new Error('BinGO runtime API paths must start with /');
  if (getRuntimePlatform() !== 'ipados') return path;
  const baseUrl = getCloudApiBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : path;
}

export function runtimeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(resolveRuntimeApiUrl(path), addCloudApiAuthorization(init));
}

export function installRuntimeFetchBridge(): () => void {
  if (typeof window === 'undefined' || getRuntimePlatform() !== 'ipados') return () => {};

  const nativeFetch = window.fetch.bind(window);
  const bridgedFetch: typeof window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(resolveRuntimeApiUrl(input), addCloudApiAuthorization(init));
    }
    if (input instanceof URL && input.pathname.startsWith('/api/')) {
      return nativeFetch(
        resolveRuntimeApiUrl(`${input.pathname}${input.search}`),
        addCloudApiAuthorization(init),
      );
    }
    if (input instanceof Request && input.url.includes('/api/')) {
      const url = new URL(input.url);
      if (url.pathname.startsWith('/api/')) {
        const bridgedRequest = new Request(
          resolveRuntimeApiUrl(`${url.pathname}${url.search}`),
          input,
        );
        const headers = new Headers(bridgedRequest.headers);
        const token = getCloudApiToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        return nativeFetch(new Request(bridgedRequest, { headers }), init);
      }
    }
    return nativeFetch(input, init);
  };

  window.fetch = bridgedFetch;
  return () => {
    if (window.fetch === bridgedFetch) window.fetch = nativeFetch;
  };
}

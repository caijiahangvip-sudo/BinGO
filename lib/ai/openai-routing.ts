import { stripEndpointPath, trimUrl } from '@/lib/utils/api-url';
import type { ProviderId } from '@/lib/types/provider';

export const OPENAI_REASONING_EFFORT_XHIGH = 'xhigh' as const;

export function baseUrlRequestsResponses(baseUrl?: string): boolean {
  const trimmed = trimUrl(baseUrl);
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.split('/').some((segment) => segment.toLowerCase() === 'responses');
  } catch {
    return trimmed.split(/[/?#]/).some((segment) => segment.toLowerCase() === 'responses');
  }
}

export function baseUrlRequestsChatCompletions(baseUrl?: string): boolean {
  const trimmed = trimUrl(baseUrl);
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split('/').map((segment) => segment.toLowerCase());
    return segments.includes('chat') && segments.includes('completions');
  } catch {
    const segments = trimmed.split(/[/?#]/).map((segment) => segment.toLowerCase());
    return segments.includes('chat') && segments.includes('completions');
  }
}

function isOfficialOpenAIBaseUrl(baseUrl?: string): boolean {
  const trimmed = trimUrl(baseUrl);
  if (!trimmed) return true;

  try {
    const parsed = new URL(trimmed);
    return parsed.hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

export function normalizeOpenAIBaseUrlForSdk(baseUrl?: string): string | undefined {
  return stripEndpointPath(baseUrl, ['/chat/completions', '/responses']);
}

export function shouldUseOpenAIResponsesApi(providerId: ProviderId, baseUrl?: string): boolean {
  if (baseUrlRequestsResponses(baseUrl)) return true;
  if (baseUrlRequestsChatCompletions(baseUrl)) return false;
  if (providerId !== 'openai') return false;

  return isOfficialOpenAIBaseUrl(baseUrl);
}

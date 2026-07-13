import { describe, expect, it } from 'vitest';

import {
  baseUrlRequestsChatCompletions,
  baseUrlRequestsResponses,
  normalizeOpenAIBaseUrlForSdk,
  shouldUseOpenAIResponsesApi,
} from '@/lib/ai/openai-routing';

describe('OpenAI Responses routing', () => {
  it('uses Responses for native OpenAI even without a base URL', () => {
    expect(shouldUseOpenAIResponsesApi('openai')).toBe(true);
  });

  it('uses Responses for native OpenAI official base URLs', () => {
    expect(shouldUseOpenAIResponsesApi('openai', 'https://api.openai.com/v1')).toBe(true);
  });

  it('routes native OpenAI custom proxy URLs through chat by default', () => {
    expect(shouldUseOpenAIResponsesApi('openai', 'https://proxy.example.test/v1')).toBe(false);
  });

  it('uses Responses when a compatible base URL contains /responses', () => {
    expect(shouldUseOpenAIResponsesApi('custom-local', 'https://example.test/v1/responses')).toBe(
      true,
    );
    expect(baseUrlRequestsResponses('https://example.test/v1/Responses')).toBe(true);
  });

  it('keeps chat routing for compatible base URLs without /responses', () => {
    expect(shouldUseOpenAIResponsesApi('custom-local', 'https://example.test/v1')).toBe(false);
    expect(
      shouldUseOpenAIResponsesApi('custom-local', 'https://example.test/v1/chat/completions'),
    ).toBe(false);
    expect(baseUrlRequestsChatCompletions('https://example.test/v1/chat/completions')).toBe(true);
  });

  it('normalizes endpoint URLs before passing baseURL to the SDK', () => {
    expect(normalizeOpenAIBaseUrlForSdk('https://example.test/v1/responses')).toBe(
      'https://example.test/v1',
    );
    expect(normalizeOpenAIBaseUrlForSdk('https://example.test/v1/chat/completions')).toBe(
      'https://example.test/v1',
    );
  });
});

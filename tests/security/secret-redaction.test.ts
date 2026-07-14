import { describe, expect, it } from 'vitest';

import { redactApiKeys } from '@/lib/store/settings';
import { redactSecrets, sanitizeStorageValue } from '@/lib/utils/local-backup';

describe('desktop secret redaction', () => {
  it('removes provider API keys without changing other settings', () => {
    const result = redactApiKeys({
      openai: { apiKey: 'sk-secret', baseUrl: 'https://example.com' },
      local: { apiKey: '', enabled: true },
    });

    expect(result).toEqual({
      openai: { apiKey: '', baseUrl: 'https://example.com' },
      local: { apiKey: '', enabled: true },
    });
  });

  it('recursively removes API keys from backup values', () => {
    expect(
      redactSecrets({
        apiKey: 'root-secret',
        nested: [{ APIKEY: 'nested-secret', label: 'kept' }],
      }),
    ).toEqual({
      apiKey: '',
      nested: [{ APIKEY: '', label: 'kept' }],
    });
  });

  it('sanitizes JSON storage while preserving non-JSON values', () => {
    expect(sanitizeStorageValue('{"state":{"apiKey":"secret","theme":"dark"}}')).toBe(
      '{"state":{"apiKey":"","theme":"dark"}}',
    );
    expect(sanitizeStorageValue('plain-value')).toBe('plain-value');
  });
});

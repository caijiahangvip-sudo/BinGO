'use client';

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore, type SettingsState } from '@/lib/store/settings';

type SecretScope =
  | 'llm'
  | 'lightweight-llm'
  | 'tts'
  | 'asr'
  | 'pdf'
  | 'vector'
  | 'web-search';

type ConfigKey =
  | 'providersConfig'
  | 'lightweightProvidersConfig'
  | 'ttsProvidersConfig'
  | 'asrProvidersConfig'
  | 'pdfProvidersConfig'
  | 'vectorProvidersConfig'
  | 'webSearchProvidersConfig';

const SECRET_CONFIGS: Array<{ scope: SecretScope; key: ConfigKey }> = [
  { scope: 'llm', key: 'providersConfig' },
  { scope: 'lightweight-llm', key: 'lightweightProvidersConfig' },
  { scope: 'tts', key: 'ttsProvidersConfig' },
  { scope: 'asr', key: 'asrProvidersConfig' },
  { scope: 'pdf', key: 'pdfProvidersConfig' },
  { scope: 'vector', key: 'vectorProvidersConfig' },
  { scope: 'web-search', key: 'webSearchProvidersConfig' },
];

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function secretSnapshot(state: SettingsState) {
  return SECRET_CONFIGS.flatMap(({ scope, key }) =>
    Object.entries(state[key]).map(([providerId, config]) => ({
      scope,
      key,
      providerId,
      value: config?.apiKey || '',
    })),
  );
}

export function DesktopSecretBootstrap() {
  const hydrated = useSettingsStore((state) => state.secretsHydrated);
  const error = useSettingsStore((state) => state.secretMigrationError);
  const syncing = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) {
      useSettingsStore.getState().setSecretHydrationState(true);
      return;
    }

    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    async function hydrate() {
      try {
        const current = useSettingsStore.getState();
        const nextConfigs = new Map<ConfigKey, Record<string, unknown>>();

        for (const secret of secretSnapshot(current)) {
          if (secret.value) {
            await invoke('desktop_secret_write', {
              scope: secret.scope,
              providerId: secret.providerId,
              value: secret.value,
            });
            continue;
          }
          const stored = await invoke<string | null>('desktop_secret_read', {
            scope: secret.scope,
            providerId: secret.providerId,
          });
          if (!stored) continue;
          const source = (nextConfigs.get(secret.key) || current[secret.key]) as Record<
            string,
            { apiKey?: string }
          >;
          nextConfigs.set(secret.key, {
            ...source,
            [secret.providerId]: { ...source[secret.providerId], apiKey: stored },
          });
        }

        if (disposed) return;
        syncing.current = true;
        useSettingsStore.setState(Object.fromEntries(nextConfigs) as Partial<SettingsState>);
        useSettingsStore.getState().setSecretHydrationState(true);
        syncing.current = false;

        let previous = new Map(
          secretSnapshot(useSettingsStore.getState()).map((secret) => [
            `${secret.scope}/${secret.providerId}`,
            secret.value,
          ]),
        );
        unsubscribe = useSettingsStore.subscribe((state) => {
          if (syncing.current || !state.secretsHydrated) return;
          const next = secretSnapshot(state);
          const nextMap = new Map(
            next.map((secret) => [`${secret.scope}/${secret.providerId}`, secret.value]),
          );
          for (const secret of next) {
            const id = `${secret.scope}/${secret.providerId}`;
            if (previous.get(id) === secret.value) continue;
            const command = secret.value ? 'desktop_secret_write' : 'desktop_secret_delete';
            void invoke(command, {
              scope: secret.scope,
              providerId: secret.providerId,
              ...(secret.value ? { value: secret.value } : {}),
            }).catch((reason) => {
              useSettingsStore
                .getState()
                .setSecretHydrationState(false, `保存安全密钥失败：${String(reason)}`);
            });
          }
          for (const id of previous.keys()) {
            if (nextMap.has(id)) continue;
            const separator = id.indexOf('/');
            void invoke('desktop_secret_delete', {
              scope: id.slice(0, separator),
              providerId: id.slice(separator + 1),
            }).catch((reason) => {
              useSettingsStore
                .getState()
                .setSecretHydrationState(false, `删除安全密钥失败：${String(reason)}`);
            });
          }
          previous = nextMap;
        });
      } catch (reason) {
        if (!disposed) {
          useSettingsStore
            .getState()
            .setSecretHydrationState(false, `迁移安全密钥失败：${String(reason)}`);
        }
      }
    }

    void hydrate();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  if (hydrated) return null;

  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-background/95 p-6 backdrop-blur">
      <div className="max-w-lg rounded-2xl border bg-card p-6 text-center shadow-2xl">
        <h2 className="text-lg font-semibold">{error ? '安全密钥迁移失败' : '正在保护 API Key'}</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {error || '正在将现有密钥迁移到 Windows Credential Manager，请稍候…'}
        </p>
      </div>
    </div>
  );
}

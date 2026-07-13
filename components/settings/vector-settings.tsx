'use client';

import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import {
  LOCAL_BGE_BASE_ZH_MODEL_ID,
  VECTOR_PROVIDERS,
  normalizeVectorProviderId,
} from '@/lib/vector/constants';
import type { VectorProviderId } from '@/lib/vector/types';
import { CheckCircle2, Database, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ServiceModelManager, type ServiceModelInfo } from './service-model-manager';
import {
  fetchWithSettingsTimeout,
  getAbortErrorMessage,
  isAbortError,
  LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
  type SettingsTestOptions,
} from './utils';

interface VectorSettingsProps {
  selectedProviderId: VectorProviderId;
}

export function VectorSettings({ selectedProviderId }: VectorSettingsProps) {
  const { t } = useI18n();
  const vectorProvidersConfig = useSettingsStore((state) => state.vectorProvidersConfig);
  const setVectorProviderConfig = useSettingsStore((state) => state.setVectorProviderConfig);
  const selectedProviderConfig = vectorProvidersConfig[selectedProviderId];
  const compatibleProviderId = normalizeVectorProviderId(
    (selectedProviderConfig?.compatibleProviderId || selectedProviderId) as VectorProviderId,
  );
  const vectorProvider = VECTOR_PROVIDERS[compatibleProviderId] || VECTOR_PROVIDERS.siliconflow;
  const visibleModels = selectedProviderConfig?.models || [
    ...vectorProvider.models,
    ...(selectedProviderConfig?.customModels || []),
  ];
  const requiresApiKey = selectedProviderConfig?.requiresApiKey ?? vectorProvider.requiresApiKey;
  const isServerConfigured = !!selectedProviderConfig?.isServerConfigured;
  const hasLocalBgeModel = visibleModels.some((model) => model.id === LOCAL_BGE_BASE_ZH_MODEL_ID);

  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [localBaseUrlInput, setLocalBaseUrlInput] = useState(selectedProviderConfig?.baseUrl || '');

  const handleModelsChange = useCallback(
    (models: ServiceModelInfo[]) => {
      setVectorProviderConfig(selectedProviderId, {
        models,
        customModels: [],
      });

      const currentModelId = selectedProviderConfig?.modelId || vectorProvider.defaultModelId;
      if (!models.some((model) => model.id === currentModelId)) {
        setVectorProviderConfig(selectedProviderId, { modelId: models[0]?.id || '' });
      }
    },
    [
      selectedProviderConfig?.modelId,
      selectedProviderId,
      setVectorProviderConfig,
      vectorProvider.defaultModelId,
    ],
  );

  const handleSelectedModelChange = useCallback(
    (modelId: string) => {
      setVectorProviderConfig(selectedProviderId, { modelId });
    },
    [selectedProviderId, setVectorProviderConfig],
  );

  const handleTestModel = useCallback(
    async (model: ServiceModelInfo, options?: SettingsTestOptions) => {
      const isLocalBgeModel = model.id === LOCAL_BGE_BASE_ZH_MODEL_ID;
      if (!isLocalBgeModel) {
        const response = await fetchWithSettingsTimeout('/api/verify-vector-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: options?.signal,
          body: JSON.stringify({
            providerId: selectedProviderId,
            compatibleProviderId,
            modelId: model.id,
            apiKey: selectedProviderConfig?.apiKey || '',
            baseUrl: selectedProviderConfig?.baseUrl || '',
            requiresApiKey,
          }),
        });
        const data = await response.json().catch(() => ({}));
        return {
          success: response.ok && !!data.success,
          message: data.error || data.message || t('settings.connectionFailed'),
        };
      }

      const response = await fetchWithSettingsTimeout('/api/chinese-xinhua/embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options?.signal,
        body: JSON.stringify({
          action: 'start',
          baseUrl: localBaseUrlInput,
          localServiceStartupTimeoutMs: options?.localServiceStartupTimeoutMs,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const status = data.status || {};
      const success = response.ok && !!data.success && !!status.listening && !status.error;

      return {
        success,
        message:
          data.message ||
          data.error ||
          status.error ||
          (success
            ? t('settings.connectionSuccess')
            : t('settings.vectorLocalServiceNotRunning')),
      };
    },
    [
      compatibleProviderId,
      requiresApiKey,
      localBaseUrlInput,
      selectedProviderConfig?.apiKey,
      selectedProviderConfig?.baseUrl,
      selectedProviderId,
      t,
    ],
  );

  const handleStartLocalService = async () => {
    const baseUrl = localBaseUrlInput.trim();
    setTestStatus('testing');
    setTestMessage('');
    try {
      const response = await fetchWithSettingsTimeout('/api/chinese-xinhua/embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          baseUrl,
          localServiceStartupTimeoutMs: LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const status = data.status || {};
      const success = response.ok && !!data.success && !!status.listening && !status.error;
      if (success) {
        setVectorProviderConfig(selectedProviderId, { baseUrl });
      }
      setTestStatus(success ? 'success' : 'error');
      setTestMessage(
        data.message ||
          data.error ||
          status.error ||
          (success ? t('settings.connectionSuccess') : t('settings.vectorLocalServiceNotRunning')),
      );
    } catch (error) {
      setTestStatus('error');
      setTestMessage(
        isAbortError(error)
          ? getAbortErrorMessage(t)
          : error instanceof Error
            ? error.message
            : String(error),
      );
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {isServerConfigured && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
          {t('settings.serverConfiguredNotice')}
        </div>
      )}

      {hasLocalBgeModel && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <Database className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium text-foreground">{t('settings.vectorLocalTitle')}</p>
              <p>{t('settings.vectorLocalDescription')}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStartLocalService}
              disabled={testStatus === 'testing'}
              className="shrink-0 gap-1.5"
            >
              {testStatus === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('settings.startService')}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {(requiresApiKey || isServerConfigured) && (
          <div className="space-y-2">
            <Label className="text-sm">{t('settings.vectorApiKey')}</Label>
            <div className="relative">
              <Input
                name={`vector-api-key-${selectedProviderId}`}
                type={showApiKey ? 'text' : 'password'}
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={
                  isServerConfigured ? t('settings.optionalOverride') : t('settings.enterApiKey')
                }
                value={selectedProviderConfig?.apiKey || ''}
                onChange={(event) =>
                  setVectorProviderConfig(selectedProviderId, {
                    apiKey: event.target.value,
                  })
                }
                className="font-mono text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-sm">{t('settings.vectorBaseUrl')}</Label>
          <Input
            name={`vector-base-url-${selectedProviderId}`}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              selectedProviderConfig?.defaultBaseUrl ||
              vectorProvider.defaultBaseUrl ||
              t('settings.enterCustomBaseUrl')
            }
            value={localBaseUrlInput}
            onChange={(event) => {
              setTestStatus('idle');
              setTestMessage('');
              setLocalBaseUrlInput(event.target.value);
            }}
            onBlur={() => setVectorProviderConfig(selectedProviderId, { baseUrl: localBaseUrlInput.trim() })}
            className="text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">{t('settings.vectorCapabilities')}</Label>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="font-normal">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {t('settings.featureSemanticSearch')}
          </Badge>
          {vectorProvider.dimensions && (
            <Badge variant="secondary" className="font-normal">
              {vectorProvider.dimensions}D
            </Badge>
          )}
        </div>
      </div>

      {testMessage && (
        <div
          className={cn(
            'rounded-lg p-3 text-sm overflow-hidden',
            testStatus === 'success' &&
              'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
            testStatus === 'error' &&
              'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
          )}
        >
          <div className="flex items-start gap-2 min-w-0">
            {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
            {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <p className="flex-1 min-w-0 break-all">{testMessage}</p>
          </div>
        </div>
      )}

      <ServiceModelManager
        models={visibleModels}
        onModelsChange={handleModelsChange}
        onSelectedModelChange={handleSelectedModelChange}
        onTestModel={handleTestModel}
        isTestDisabled={(model) =>
          model.id !== LOCAL_BGE_BASE_ZH_MODEL_ID &&
          requiresApiKey &&
          !selectedProviderConfig?.apiKey?.trim() &&
          !isServerConfigured
        }
      />
    </div>
  );
}

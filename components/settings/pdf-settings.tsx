'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { useSettingsStore } from '@/lib/store/settings';
import type { PDFProviderId } from '@/lib/pdf/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { ServiceModelManager, type ServiceModelInfo } from './service-model-manager';
import {
  fetchWithSettingsTimeout,
  getAbortErrorMessage,
  isAbortError,
  LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
  type SettingsTestOptions,
} from './utils';

function getFeatureLabel(feature: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    text: t('settings.featureText'),
    images: t('settings.featureImages'),
    metadata: t('settings.featureMetadata'),
    tables: t('settings.featureTables'),
    formulas: t('settings.featureFormulas'),
    'layout-analysis': t('settings.featureLayoutAnalysis'),
    ocr: t('settings.featureOcr'),
  };
  return labels[feature] || feature;
}

interface PDFSettingsProps {
  selectedProviderId: PDFProviderId;
}

type MineruTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type MineruTaskCancelMode = 'remove-queued' | 'interrupt-running' | 'none';
type MineruTaskCancelAction =
  | 'removed-queued-task'
  | 'interrupted-running-task'
  | 'already-terminal';

interface MineruTaskSummary {
  id: string;
  fileName: string;
  source: 'pdf-parse' | 'homework';
  ownerId?: string;
  status: MineruTaskStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  queuePosition?: number;
  cancelMode: MineruTaskCancelMode;
  serviceRestartRequired: boolean;
}

interface MineruTaskStatusResponse {
  success?: boolean;
  reachable?: boolean;
  baseUrl?: string;
  health?: {
    status?: string;
    queued_tasks?: number;
    processing_tasks?: number;
    completed_tasks?: number;
    failed_tasks?: number;
    max_concurrent_requests?: number;
  };
  tasks?: MineruTaskSummary[];
  error?: string;
}

interface MineruTaskCancelResponse {
  success?: boolean;
  task?: MineruTaskSummary;
  action?: MineruTaskCancelAction;
  error?: string;
}

function formatMineruTaskStatus(status: MineruTaskStatus, t: (key: string) => string): string {
  const labels: Record<MineruTaskStatus, string> = {
    queued: t('settings.mineruTaskQueued'),
    running: t('settings.mineruTaskRunning'),
    succeeded: t('settings.mineruTaskSucceeded'),
    failed: t('settings.mineruTaskFailed'),
    cancelled: t('settings.mineruTaskCancelled'),
  };
  return labels[status] || status;
}

function getMineruTaskCancelLabel(
  task: MineruTaskSummary,
  t: (key: string) => string,
): string {
  if (task.cancelMode === 'remove-queued') return t('settings.mineruCancelQueuedTask');
  if (task.cancelMode === 'interrupt-running') return t('settings.mineruStopRunningTask');
  return t('settings.mineruCancelTask');
}

export function PDFSettings({ selectedProviderId }: PDFSettingsProps) {
  const { t } = useI18n();
  const pdfProvidersConfig = useSettingsStore((state) => state.pdfProvidersConfig);
  const setPDFProviderConfig = useSettingsStore((state) => state.setPDFProviderConfig);
  const selectedProviderConfig = pdfProvidersConfig[selectedProviderId];
  const compatibleProviderId = selectedProviderConfig?.compatibleProviderId || selectedProviderId;
  const pdfProvider = PDF_PROVIDERS[compatibleProviderId] || PDF_PROVIDERS['mineru-local'];
  const providerModels =
    selectedProviderConfig?.models || selectedProviderConfig?.customModels || [];
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [mineruStatus, setMineruStatus] = useState<MineruTaskStatusResponse | null>(null);
  const [mineruStatusLoading, setMineruStatusLoading] = useState(false);
  const [mineruStatusMessage, setMineruStatusMessage] = useState('');
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [resettingMineru, setResettingMineru] = useState(false);

  const handleModelsChange = useCallback(
    (models: ServiceModelInfo[]) => {
      setPDFProviderConfig(selectedProviderId, {
        models,
        customModels: [],
      });
    },
    [selectedProviderId, setPDFProviderConfig],
  );

  const handleTestModel = useCallback(
    async (_model: ServiceModelInfo, options?: SettingsTestOptions) => {
      const response = await fetchWithSettingsTimeout('/api/verify-pdf-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options?.signal,
        body: JSON.stringify({
          providerId: compatibleProviderId,
          apiKey: selectedProviderConfig?.apiKey || '',
          baseUrl: selectedProviderConfig?.baseUrl || '',
          localServiceStartupTimeoutMs: options?.localServiceStartupTimeoutMs,
        }),
      });
      const data = await response.json().catch(() => ({ error: response.statusText }));
      return {
        success: response.ok && !!data.success,
        message:
          data.message ||
          data.error ||
          (data.success ? t('settings.connectionSuccess') : t('settings.connectionFailed')),
      };
    },
    [compatibleProviderId, selectedProviderConfig?.apiKey, selectedProviderConfig?.baseUrl, t],
  );

  const handleTestConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestMessage('');

    try {
      const result = await handleTestModel(
        {
          id: compatibleProviderId,
          name: pdfProvider.name,
        },
        {
          localServiceStartupTimeoutMs: LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
        },
      );

      setTestStatus(result.success ? 'success' : 'error');
      setTestMessage(result.success ? t('settings.connectionSuccess') : result.message);
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
  }, [compatibleProviderId, handleTestModel, pdfProvider.name, t]);

  const refreshMineruStatus = useCallback(async () => {
    if (compatibleProviderId !== 'mineru-local') return;
    setMineruStatusLoading(true);
    setMineruStatusMessage('');
    try {
      const params = new URLSearchParams();
      if (selectedProviderConfig?.baseUrl?.trim()) {
        params.set('baseUrl', selectedProviderConfig.baseUrl.trim());
      }
      const response = await fetch(`/api/local-services/mineru/tasks?${params.toString()}`);
      const data = (await response.json().catch(() => ({}))) as MineruTaskStatusResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || response.statusText);
      }
      setMineruStatus(data);
    } catch (error) {
      setMineruStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setMineruStatusLoading(false);
    }
  }, [compatibleProviderId, selectedProviderConfig?.baseUrl]);

  useEffect(() => {
    if (compatibleProviderId !== 'mineru-local') return;
    void refreshMineruStatus();
    const timer = window.setInterval(() => {
      void refreshMineruStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [compatibleProviderId, refreshMineruStatus]);

  const handleCancelMineruTask = useCallback(
    async (taskId: string) => {
      setCancellingTaskId(taskId);
      setMineruStatusMessage('');
      try {
        const response = await fetch(
          `/api/local-services/mineru/tasks/${encodeURIComponent(taskId)}/cancel`,
          { method: 'POST' },
        );
        const data = (await response.json().catch(() => ({}))) as MineruTaskCancelResponse;
        if (!response.ok) {
          throw new Error(data.error || response.statusText);
        }
        await refreshMineruStatus();
      } catch (error) {
        setMineruStatusMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setCancellingTaskId(null);
      }
    },
    [refreshMineruStatus],
  );

  const handleResetMineru = useCallback(async () => {
    setResettingMineru(true);
    setMineruStatusMessage('');
    try {
      const response = await fetch('/api/local-services/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: ['mineru'] }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        released?: boolean;
        error?: string;
      };
      if (!response.ok || data.released === false) {
        throw new Error(data.error || response.statusText);
      }
      await refreshMineruStatus();
    } catch (error) {
      setMineruStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setResettingMineru(false);
    }
  }, [refreshMineruStatus]);

  const mineruTasks = mineruStatus?.tasks || [];
  const activeMineruTasks = mineruTasks.filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'running' ? -1 : 1;
    const aPosition = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
    const bPosition = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
    if (aPosition !== bPosition) return aPosition - bPosition;
    return new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
  });
  const mineruHealth = mineruStatus?.health;
  const mineruInternalProcessingCount = mineruHealth?.processing_tasks ?? 0;
  const mineruInternalQueuedCount = mineruHealth?.queued_tasks ?? 0;
  const hasMineruInternalActivity =
    mineruInternalProcessingCount > 0 || mineruInternalQueuedCount > 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium text-foreground">{t('settings.mineruBuiltInTitle')}</p>
            <p>{t('settings.mineruBuiltInDescription')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={testStatus === 'testing'}
            className={cn(
              'shrink-0 gap-1.5',
              testStatus === 'success' && 'border-green-600 text-green-600 hover:bg-green-50',
              testStatus === 'error' && 'border-red-600 text-red-600 hover:bg-red-50',
            )}
          >
            {testStatus === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testStatus === 'success' && <CheckCircle2 className="h-3.5 w-3.5" />}
            {testStatus === 'error' && <XCircle className="h-3.5 w-3.5" />}
            {testStatus === 'testing' ? t('settings.testing') : t('settings.testConnection')}
          </Button>
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

      {compatibleProviderId === 'mineru-local' && (
        <div className="rounded-lg border bg-background p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-foreground">{t('settings.mineruTaskControlTitle')}</p>
              <p className="text-muted-foreground">
                {mineruStatus?.reachable
                  ? t('settings.mineruTaskControlOnline')
                  : t('settings.mineruTaskControlOffline')}
              </p>
              {mineruHealth && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                  <span className="font-medium">{t('settings.mineruInternalTasks')}</span>
                  <Badge variant="secondary" className="font-normal">
                    {t('settings.mineruProcessing')}: {mineruInternalProcessingCount}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    {t('settings.mineruQueued')}: {mineruInternalQueuedCount}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    {t('settings.mineruConcurrency')}: {mineruHealth.max_concurrent_requests ?? 1}
                  </Badge>
                </div>
              )}
              {hasMineruInternalActivity && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {t('settings.mineruInternalTasksHint')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                    onClick={() => void handleResetMineru()}
                    disabled={resettingMineru}
                  >
                    {resettingMineru ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                    {t('settings.mineruStopInternalTasks')}
                  </Button>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void refreshMineruStatus()}
                disabled={mineruStatusLoading}
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', mineruStatusLoading && 'animate-spin')}
                />
                {t('settings.refresh')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => void handleResetMineru()}
                disabled={resettingMineru}
              >
                {resettingMineru ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {t('settings.mineruResetService')}
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {activeMineruTasks.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-muted-foreground">
                {hasMineruInternalActivity
                  ? t('settings.mineruNoBingoTasksWithInternalActivity')
                  : t('settings.mineruNoActiveTasks')}
              </div>
            ) : (
              activeMineruTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{task.fileName}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{formatMineruTaskStatus(task.status, t)}</span>
                      <span>{task.source === 'homework' ? 'Homework' : 'PDF'}</span>
                      {task.queuePosition && <span>#{task.queuePosition}</span>}
                      {task.serviceRestartRequired && (
                        <span>{t('settings.mineruRunningTaskRestartHint')}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                    onClick={() => void handleCancelMineruTask(task.id)}
                    disabled={cancellingTaskId === task.id}
                  >
                    {cancellingTaskId === task.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                    {getMineruTaskCancelLabel(task, t)}
                  </Button>
                </div>
              ))
            )}
          </div>

          {mineruStatusMessage && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
              {mineruStatusMessage}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-sm">{t('settings.pdfFeatures')}</Label>
        <div className="flex flex-wrap gap-2">
          {pdfProvider.features.map((feature) => (
            <Badge key={feature} variant="secondary" className="font-normal">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {getFeatureLabel(feature, t)}
            </Badge>
          ))}
        </div>
      </div>

      <ServiceModelManager
        models={providerModels}
        onModelsChange={handleModelsChange}
        onTestModel={handleTestModel}
      />
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
import { getCurrentLocalDataState, importLocalBackup } from '@/lib/utils/local-backup';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';

const log = createLogger('LocalSeedBootstrap');
const SEED_DECISION_PREFIX = 'bingo.localSeed.';

type SeedMetadataResponse = {
  success?: boolean;
  exists?: boolean;
  relativePath?: string;
  signature?: string;
};

type BootstrapState = 'idle' | 'checking' | 'auto-importing' | 'prompt' | 'importing' | 'error';

export function LocalSeedBootstrap() {
  const pathname = usePathname();
  const { locale } = useI18n();
  const [state, setState] = useState<BootstrapState>('checking');
  const [seedSignature, setSeedSignature] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const copy = useMemo(
    () =>
      locale === 'zh-CN'
        ? {
            autoImportingTitle: '正在导入本地学习数据',
            autoImportingDescription: '检测到 Bingo2.0 自带的历史数据，正在写入当前浏览器。',
            promptTitle: '检测到迁移数据',
            promptDescription:
              'Bingo2.0 自带了一份本地学习记录与设置。当前浏览器已经有数据，是否用打包时的历史数据覆盖当前内容？',
            skip: '跳过',
            replace: '覆盖导入',
            retry: '重试',
            failed: '导入本地学习数据失败',
            success: '已导入打包时的本地学习数据',
          }
        : {
            autoImportingTitle: 'Importing packaged learning data',
            autoImportingDescription:
              'Bingo2.0 includes a packaged local backup. It is being restored into this browser.',
            promptTitle: 'Packaged learning data detected',
            promptDescription:
              'Bingo2.0 includes a local backup of learning history and settings. This browser already has data. Replace the current browser data with the packaged backup?',
            skip: 'Skip',
            replace: 'Replace import',
            retry: 'Retry',
            failed: 'Failed to import packaged learning data',
            success: 'Packaged learning data has been restored',
          },
    [locale],
  );

  useEffect(() => {
    if (pathname === '/local-backup') {
      setState('idle');
      return;
    }

    let cancelled = false;

    const downloadAndImport = async (decisionKey: string, nextState: BootstrapState) => {
      try {
        setState(nextState);
        const response = await fetch('/api/local-backup?download=1', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Seed download failed with status ${response.status}`);
        }

        const blob = await response.blob();
        await importLocalBackup(blob);
        window.localStorage.setItem(decisionKey, 'applied');
        toast.success(copy.success);
        window.location.reload();
      } catch (error) {
        const nextMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to import packaged seed backup:', error);
        setErrorMessage(nextMessage);
        setState('error');
        toast.error(copy.failed);
      }
    };

    const load = async () => {
      try {
        setState('checking');
        const response = await fetch('/api/local-backup', { cache: 'no-store' });
        const result = (await response.json()) as SeedMetadataResponse;
        if (cancelled) return;

        if (!response.ok || !result.success || !result.exists || !result.signature) {
          setState('idle');
          return;
        }

        setSeedSignature(result.signature);
        const decisionKey = `${SEED_DECISION_PREFIX}${result.signature}`;
        const previousDecision = window.localStorage.getItem(decisionKey);
        if (previousDecision === 'applied' || previousDecision === 'skipped') {
          setState('idle');
          return;
        }

        const { isEmpty } = await getCurrentLocalDataState();
        if (cancelled) return;

        if (isEmpty) {
          await downloadAndImport(decisionKey, 'auto-importing');
          return;
        }

        setState('prompt');
      } catch (error) {
        if (cancelled) return;
        log.warn('Failed to inspect packaged seed backup:', error);
        setState('idle');
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [copy.failed, copy.success, pathname]);

  const decisionKey = seedSignature ? `${SEED_DECISION_PREFIX}${seedSignature}` : null;

  const handleImport = async () => {
    if (!decisionKey) return;
    try {
      setState('importing');
      const response = await fetch('/api/local-backup?download=1', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Seed download failed with status ${response.status}`);
      }

      const blob = await response.blob();
      await importLocalBackup(blob);
      window.localStorage.setItem(decisionKey, 'applied');
      toast.success(copy.success);
      window.location.reload();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      log.error('Failed to import packaged seed backup:', error);
      setErrorMessage(nextMessage);
      setState('error');
      toast.error(copy.failed);
    }
  };

  const handleSkip = () => {
    if (decisionKey) {
      window.localStorage.setItem(decisionKey, 'skipped');
    }
    setState('idle');
  };

  if (state === 'idle' || state === 'checking') {
    return null;
  }

  const busy = state === 'auto-importing' || state === 'importing';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/82 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start gap-3">
          {busy ? (
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">
              {state === 'prompt' || state === 'error'
                ? copy.promptTitle
                : copy.autoImportingTitle}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {state === 'prompt' || state === 'error'
                ? copy.promptDescription
                : copy.autoImportingDescription}
            </p>
            {errorMessage && (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </p>
            )}
          </div>
        </div>

        {(state === 'prompt' || state === 'error') && (
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="outline" onClick={handleSkip}>
              {copy.skip}
            </Button>
            <Button onClick={handleImport}>{state === 'error' ? copy.retry : copy.replace}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

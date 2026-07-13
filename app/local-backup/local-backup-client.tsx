'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { exportLocalBackup } from '@/lib/utils/local-backup';
import { createLogger } from '@/lib/logger';

const log = createLogger('LocalBackupPage');

type BackupRunState = 'idle' | 'running' | 'success' | 'error';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function LocalBackupClient({
  mode,
  outputPath,
  autoRun,
}: {
  mode: string;
  outputPath: string;
  autoRun: boolean;
}) {
  const [state, setState] = useState<BackupRunState>('idle');
  const [message, setMessage] = useState('');

  const title = useMemo(
    () => (mode === 'upload' ? 'Exporting local backup' : 'Preparing local backup'),
    [mode],
  );

  useEffect(() => {
    if (!autoRun || state !== 'idle') return;

    let cancelled = false;

    const run = async () => {
      setState('running');
      setMessage('Reading local IndexedDB and browser settings...');

      try {
        const { blob, manifest } = await exportLocalBackup();
        if (cancelled) return;

        if (mode === 'upload') {
          setMessage('Uploading backup file to the package directory...');
          const body = new FormData();
          body.append('file', new File([blob], 'user-backup.zip', { type: 'application/zip' }));
          body.append('outputPath', outputPath);

          const response = await fetch('/api/local-backup', {
            method: 'POST',
            body,
          });
          const result = (await response.json()) as { success?: boolean; error?: string };
          if (!response.ok || !result.success) {
            throw new Error(result.error || 'Upload failed.');
          }

          setState('success');
          setMessage(
            `Backup exported successfully. ${manifest.localStorageEntries} local settings entries included.`,
          );
          return;
        }

        downloadBlob(blob, 'bingo-user-backup.zip');
        setState('success');
        setMessage('Backup file has been downloaded.');
      } catch (error) {
        if (cancelled) return;
        const nextMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to export local backup:', error);
        setState('error');
        setMessage(nextMessage);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [autoRun, mode, outputPath, state]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-16">
        <div
          data-backup-status={state}
          className="rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is used by the packaging flow to export the current local learning data.
          </p>
          <div className="mt-4 rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            {message || 'Waiting to start...'}
          </div>
          {state === 'error' && (
            <Button className="mt-4" onClick={() => setState('idle')}>
              Retry
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

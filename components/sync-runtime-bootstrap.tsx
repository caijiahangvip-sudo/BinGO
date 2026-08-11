'use client';

import { useEffect } from 'react';
import { getSyncConfiguration, syncClientState } from '@/lib/sync/session';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;

export function SyncRuntimeBootstrap() {
  useEffect(() => {
    let stopped = false;
    let running = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const synchronize = async () => {
      if (stopped || running || !navigator.onLine || !getSyncConfiguration().account) return;
      running = true;
      try {
        await syncClientState();
      } catch {
        if (!stopped) retryTimer = setTimeout(() => void synchronize(), RETRY_INTERVAL_MS);
      } finally {
        running = false;
      }
    };

    const interval = setInterval(() => void synchronize(), SYNC_INTERVAL_MS);
    const handleOnline = () => void synchronize();
    window.addEventListener('online', handleOnline);
    void synchronize();

    return () => {
      stopped = true;
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return null;
}

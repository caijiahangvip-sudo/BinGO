'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useDesktopUpdaterStore } from '@/lib/store/desktop-updater';

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const RETRY_DELAYS = [60_000, 5 * 60_000, 30 * 60_000];
const PERIODIC_CHECK_INTERVAL = 6 * 60 * 60_000;

export function DesktopUpdater() {
  const checkForUpdates = useDesktopUpdaterStore((state) => state.checkForUpdates);
  const availableVersion = useDesktopUpdaterStore((state) => state.availableVersion);
  const installUpdate = useDesktopUpdaterStore((state) => state.installUpdate);
  const announcedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime() || process.env.NODE_ENV !== 'production') return;
    const timers: number[] = [];
    let disposed = false;

    const runAutomaticCheck = async (retryIndex = 0) => {
      const available = await checkForUpdates();
      if (disposed || available) return;
      const status = useDesktopUpdaterStore.getState().status;
      if (status === 'error' && retryIndex < RETRY_DELAYS.length) {
        timers.push(
          window.setTimeout(() => void runAutomaticCheck(retryIndex + 1), RETRY_DELAYS[retryIndex]),
        );
      }
    };

    timers.push(window.setTimeout(() => void runAutomaticCheck(), 5_000));
    const interval = window.setInterval(() => void runAutomaticCheck(), PERIODIC_CHECK_INTERVAL);
    return () => {
      disposed = true;
      timers.forEach(window.clearTimeout);
      window.clearInterval(interval);
    };
  }, [checkForUpdates]);

  useEffect(() => {
    if (!availableVersion || announcedVersion.current === availableVersion) return;
    announcedVersion.current = availableVersion;
    toast(`发现 BinGO ${availableVersion}`, {
      description: '新版本已准备好，是否立即更新？',
      duration: Infinity,
      action: { label: '立即更新', onClick: () => void installUpdate() },
      cancel: { label: '稍后', onClick: () => undefined },
    });
  }, [availableVersion, installUpdate]);

  return null;
}

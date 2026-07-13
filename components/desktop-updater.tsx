'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'error';

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function DesktopUpdater() {
  const [state, setState] = useState<UpdateState>('idle');

  useEffect(() => {
    if (!isTauri() || process.env.NODE_ENV !== 'production') return;
    const timer = window.setTimeout(async () => {
      setState('checking');
      try {
        const [{ check }, { relaunch }] = await Promise.all([
          import('@tauri-apps/plugin-updater'),
          import('@tauri-apps/plugin-process'),
        ]);
        const update = await check();
        if (!update) {
          setState('idle');
          return;
        }
        setState('available');
        toast(`发现 BinGO ${update.version}`, {
          description: update.body || '新版本已准备好，是否立即更新？',
          duration: Infinity,
          action: {
            label: '立即更新',
            onClick: async () => {
              setState('downloading');
              const progressToast = toast.loading('正在下载并安装 BinGO 更新…');
              try {
                await update.downloadAndInstall();
                toast.success('更新安装完成，正在重启…', { id: progressToast });
                await relaunch();
              } catch (error) {
                setState('error');
                toast.error('更新失败', { id: progressToast, description: String(error) });
              }
            },
          },
          cancel: { label: '稍后', onClick: () => setState('idle') },
        });
      } catch (error) {
        setState('error');
        console.warn('[DesktopUpdater] Update check failed:', error);
      }
    }, 5000);
    return () => window.clearTimeout(timer);
  }, []);

  return <span data-desktop-update-state={state} hidden />;
}

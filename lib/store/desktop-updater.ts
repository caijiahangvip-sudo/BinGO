'use client';

import { create } from 'zustand';
import type { Update, DownloadEvent } from '@tauri-apps/plugin-updater';

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'upToDate'
  | 'error';

interface RuntimeStatus {
  running: boolean;
  port?: number;
  version: string;
  logDir: string;
}

interface DesktopUpdaterState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  checkForUpdates: () => Promise<boolean>;
  installUpdate: () => Promise<void>;
  openLogDir: () => Promise<void>;
}

let pendingUpdate: Update | null = null;
let activeCheck: Promise<boolean> | null = null;

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function resolveProxy(invoke: typeof import('@tauri-apps/api/core').invoke) {
  const manual = window.localStorage.getItem('bingo.desktop.manualProxy')?.trim();
  if (manual) return manual;
  return invoke<string | null>('desktop_system_proxy');
}

export const useDesktopUpdaterStore = create<DesktopUpdaterState>((set, get) => ({
  status: 'idle',
  currentVersion: '',
  availableVersion: null,
  progress: null,
  error: null,
  lastCheckedAt: null,

  checkForUpdates: async () => {
    if (!isTauriRuntime()) return false;
    if (activeCheck) return activeCheck;
    activeCheck = (async () => {
      set({ status: 'checking', error: null, progress: null });
      try {
        const [{ check }, { invoke }] = await Promise.all([
          import('@tauri-apps/plugin-updater'),
          import('@tauri-apps/api/core'),
        ]);
        const runtime = await invoke<RuntimeStatus>('desktop_runtime_status');
        set({ currentVersion: runtime.version });
        let update: Update | null;
        try {
          update = await check({ timeout: 15_000 });
        } catch (directError) {
          const proxy = await resolveProxy(invoke);
          if (!proxy) throw directError;
          update = await check({ proxy, timeout: 30_000 });
        }
        pendingUpdate?.close().catch(() => undefined);
        pendingUpdate = update;
        const checkedAt = Date.now();
        if (!update) {
          set({
            status: 'upToDate',
            availableVersion: null,
            lastCheckedAt: checkedAt,
            error: null,
          });
          return false;
        }
        set({
          status: 'available',
          availableVersion: update.version,
          lastCheckedAt: checkedAt,
          error: null,
        });
        return true;
      } catch (reason) {
        set({ status: 'error', error: String(reason), lastCheckedAt: Date.now() });
        return false;
      } finally {
        activeCheck = null;
      }
    })();
    return activeCheck;
  },

  installUpdate: async () => {
    const update = pendingUpdate;
    if (!update || get().status === 'downloading') return;
    set({ status: 'downloading', progress: 0, error: null });
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      let downloaded = 0;
      let total: number | undefined;
      const onEvent = (event: DownloadEvent) => {
        if (event.event === 'Started') total = event.data.contentLength;
        if (event.event === 'Progress') downloaded += event.data.chunkLength;
        set({ progress: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null });
      };
      await update.downloadAndInstall(onEvent, { timeout: 5 * 60_000 });
      await relaunch();
    } catch (reason) {
      set({ status: 'error', error: String(reason), progress: null });
    }
  },

  openLogDir: async () => {
    if (!isTauriRuntime()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('desktop_open_log_dir');
  },
}));

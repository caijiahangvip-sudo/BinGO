'use client';

import { useEffect, useState } from 'react';
import { Download, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDesktopUpdaterStore } from '@/lib/store/desktop-updater';

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function DesktopUpdateSettings() {
  const updater = useDesktopUpdaterStore();
  const [manualProxy, setManualProxy] = useState('');
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDesktop(isTauriRuntime());
      setManualProxy(window.localStorage.getItem('bingo.desktop.manualProxy') || '');
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!desktop) return null;
  const busy = updater.status === 'checking' || updater.status === 'downloading';

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">客户端更新</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          当前版本 {updater.currentVersion || '读取中'}
          {updater.availableVersion ? `，可更新至 ${updater.availableVersion}` : ''}
        </p>
      </div>
      {updater.status === 'downloading' && (
        <div className="h-2 overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${updater.progress ?? 15}%` }}
          />
        </div>
      )}
      {updater.error && <p className="text-xs text-destructive">{updater.error}</p>}
      {updater.status === 'upToDate' && <p className="text-xs text-emerald-600">当前已是最新版</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => updater.checkForUpdates()}>
          {updater.status === 'checking' ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
          检查更新
        </Button>
        {updater.availableVersion && (
          <Button size="sm" disabled={busy} onClick={() => updater.installUpdate()}>
            <Download className="mr-1.5 size-3.5" />立即更新
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => updater.openLogDir()}>
          <FolderOpen className="mr-1.5 size-3.5" />打开日志
        </Button>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">手动代理（留空时使用 Windows 系统代理）</label>
        <Input
          className="mt-1"
          value={manualProxy}
          placeholder="http://127.0.0.1:7897"
          onChange={(event) => {
            const value = event.target.value;
            setManualProxy(value);
            if (value.trim()) window.localStorage.setItem('bingo.desktop.manualProxy', value.trim());
            else window.localStorage.removeItem('bingo.desktop.manualProxy');
          }}
        />
      </div>
    </div>
  );
}

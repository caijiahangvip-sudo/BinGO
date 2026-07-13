'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Diagnostics {
  desktop: boolean;
  runtimeRoot: string;
  freeBytes: number;
  wsl: { available: boolean; output: string };
  gpu: { available: boolean; output: string };
  recommendations: { minimumFreeBytes: number; preferredFreeBytes: number };
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function LocalRuntimeDiagnostics({ chinese }: { chinese: boolean }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/local-services/diagnostics', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || response.statusText);
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const lowDisk = data ? data.freeBytes < data.recommendations.minimumFreeBytes : false;
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{chinese ? '本地模型运行环境' : 'Local model environment'}</h3>
          <p className="text-xs text-muted-foreground mt-1">{chinese ? '安装模型前检查磁盘、WSL 和 GPU。条件不足时仍可继续尝试，或改用云模型。' : 'Check disk, WSL and GPU before installing models. You may still continue or use cloud models.'}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <StatusCard ok={!lowDisk} icon={<HardDrive className="h-4 w-4" />} title={chinese ? '可用磁盘' : 'Free disk'} detail={formatBytes(data.freeBytes)} />
          <StatusCard ok={data.wsl.available} title="WSL" detail={data.wsl.available ? (chinese ? '已安装' : 'Available') : (chinese ? '未检测到' : 'Unavailable')} />
          <StatusCard ok={data.gpu.available} title="GPU" detail={data.gpu.available ? data.gpu.output.split('\n')[0] : (chinese ? '未检测到 NVIDIA GPU；ROCm/其他 GPU 仍可手动尝试' : 'No NVIDIA GPU detected; other runtimes may still work')} />
        </div>
      )}
      {data && <p className="break-all text-xs text-muted-foreground">{chinese ? '模型与缓存目录：' : 'Models and cache: '}{data.runtimeRoot}</p>}
    </div>
  );
}

function StatusCard({ ok, title, detail, icon }: { ok: boolean; title: string; detail: string; icon?: React.ReactNode }) {
  return <div className="rounded-lg border p-3"><div className="flex items-center gap-2 font-medium">{icon ?? (ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />)}{title}</div><p className="mt-1 text-xs text-muted-foreground line-clamp-2">{detail}</p></div>;
}

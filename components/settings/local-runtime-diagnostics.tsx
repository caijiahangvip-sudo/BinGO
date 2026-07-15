'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Diagnostics {
  desktop: boolean;
  runtimeRoot: string;
  freeBytes: number;
  wsl: { available: boolean; output: string };
  gpu: {
    available: boolean;
    output: string;
    vendor: 'amd' | 'nvidia' | 'unknown';
    runtime: 'rocm-wsl' | 'cuda-windows' | 'none';
    name: string;
    configured: boolean;
    amdDetected: boolean;
    nvidiaDetected: boolean;
  };
  recommendations: { minimumFreeBytes: number; preferredFreeBytes: number };
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function LocalRuntimeDiagnostics({ chinese }: { chinese: boolean }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configuringRocm, setConfiguringRocm] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/local-services/diagnostics', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || response.statusText);
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configureRocm = useCallback(async () => {
    setConfiguringRocm(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/local-services/configure-rocm', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || response.statusText);
      setNotice(
        chinese
          ? '已打开 WSL/ROCm 配置窗口。完成后点击刷新重新检测。'
          : 'WSL/ROCm setup opened. Refresh after it finishes.',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setConfiguringRocm(false);
    }
  }, [chinese]);

  const lowDisk = data ? data.freeBytes < data.recommendations.minimumFreeBytes : false;
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {chinese ? '本地模型运行环境' : 'Local model environment'}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {chinese
              ? '安装模型前检查磁盘、WSL 和 GPU。条件不足时仍可继续尝试，或改用云模型。'
              : 'Check disk, WSL and GPU before installing models. You may still continue or use cloud models.'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-green-600 dark:text-green-400">{notice}</p>}
      {data && (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <StatusCard
            ok={!lowDisk}
            icon={<HardDrive className="h-4 w-4" />}
            title={chinese ? '可用磁盘' : 'Free disk'}
            detail={formatBytes(data.freeBytes)}
          />
          <StatusCard
            ok={data.wsl.available}
            title="WSL"
            detail={
              data.wsl.available
                ? chinese
                  ? '已安装'
                  : 'Available'
                : chinese
                  ? '未检测到'
                  : 'Unavailable'
            }
          />
          <StatusCard
            ok={data.gpu.available}
            title="GPU"
            detail={
              data.gpu.available
                ? data.gpu.output.split('\n')[0]
                : data.gpu.amdDetected
                  ? chinese
                    ? '检测到 AMD GPU，需要配置 WSL ROCm/HIP'
                    : 'AMD GPU detected; WSL ROCm/HIP setup is required'
                  : chinese
                    ? '未检测到支持的 AMD ROCm 或 NVIDIA CUDA GPU'
                    : 'No supported AMD ROCm or NVIDIA CUDA GPU detected'
            }
          />
        </div>
      )}
      {data?.desktop && data.gpu.amdDetected && !data.gpu.configured && (
        <Button variant="outline" onClick={configureRocm} disabled={configuringRocm}>
          {configuringRocm && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {chinese ? '配置 WSL + AMD ROCm' : 'Set up WSL + AMD ROCm'}
        </Button>
      )}
      {data && (
        <p className="break-all text-xs text-muted-foreground">
          {chinese ? '模型与缓存目录：' : 'Models and cache: '}
          {data.runtimeRoot}
        </p>
      )}
    </div>
  );
}

function StatusCard({
  ok,
  title,
  detail,
  icon,
}: {
  ok: boolean;
  title: string;
  detail: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 font-medium">
        {icon ??
          (ok ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ))}
        {title}
      </div>
      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{detail}</p>
    </div>
  );
}

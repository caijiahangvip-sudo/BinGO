'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import type { ReactNode } from 'react';

type Task = 'ocr' | 'document' | 'asr' | 'tts' | 'embedding';
type Profile = 'speed' | 'balanced' | 'quality';

interface ModelDefinition {
  id: string;
  task: Task;
  name: string;
  description: string;
  availability: 'bundled' | 'system' | 'managed-service' | 'planned';
  estimatedDiskBytes: number;
}

interface ModelState {
  id: string;
  installed: boolean;
  running: boolean;
}

interface Recommendation {
  task: Task;
  primary: ModelDefinition;
  usable: ModelDefinition;
  reason: string;
  requiresInstallerAdapter: boolean;
}

interface Snapshot {
  hardware: {
    cpuModel: string;
    logicalCores: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    freeDiskBytes: number;
    gpuAvailable: boolean;
    gpuName: string;
    gpuRuntime: string;
    gpuMemoryBytes?: number;
  };
  catalog: ModelDefinition[];
  states: ModelState[];
  preferences: {
    profile: Profile;
    autoDownload: boolean;
    autoDownloadLimitBytes: number;
    selectedModels: Partial<Record<Task, string>>;
  };
  recommendations: Recommendation[];
}

interface InstallJobView {
  jobId: string;
  status: 'running' | 'succeeded' | 'failed';
  step: string;
  progress: number;
  message: string;
  done: boolean;
  currentModelId?: string;
  error?: string;
}

const TASK_LABELS: Record<Task, { zh: string; en: string }> = {
  ocr: { zh: '图片 OCR', en: 'Image OCR' },
  document: { zh: '复杂文档', en: 'Complex documents' },
  asr: { zh: '语音识别', en: 'Speech recognition' },
  tts: { zh: '语音合成', en: 'Speech synthesis' },
  embedding: { zh: '教材检索', en: 'Embedding search' },
};

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 GB';
  return `${(bytes / 1024 ** 3).toFixed(bytes < 1024 ** 3 ? 2 : 1)} GB`;
}

export function LocalModelAutoManager({ chinese }: { chinese: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeModel, setActiveModel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [installJob, setInstallJob] = useState<InstallJobView | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const activePollJobRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/local-services/models', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.details || result.error || response.statusText);
      setSnapshot(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
      activePollJobRef.current = null;
    },
    [],
  );

  const stateMap = useMemo(
    () => new Map(snapshot?.states.map((state) => [state.id, state]) ?? []),
    [snapshot?.states],
  );

  const installingModelId = installJob && !installJob.done ? installJob.currentModelId || '' : '';

  const savePreferences = useCallback(
    async (next: Snapshot['preferences']) => {
      if (!snapshot) return;
      setSaving(true);
      setError('');
      try {
        const response = await fetch('/api/local-services/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save-preferences', preferences: next }),
        });
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(result.details || result.error || response.statusText);
        setSnapshot((current) =>
          current ? { ...current, preferences: result.preferences } : current,
        );
        await refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setSaving(false);
      }
    },
    [refresh, snapshot],
  );

  const pollInstallJob = useCallback(
    async (jobId: string) => {
      activePollJobRef.current = jobId;
      let nextDelay = 2000;
      try {
        const response = await fetch(
          `/api/local-services/models?jobId=${encodeURIComponent(jobId)}`,
          { cache: 'no-store' },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          if (response.status === 404) {
            activePollJobRef.current = null;
            setInstallJob(null);
            setActiveModel('');
            setError(chinese ? '安装任务不存在或已过期。' : 'The install job was not found.');
            return;
          }
          throw new Error(data.details || data.error || response.statusText);
        }

        nextDelay = data.pollIntervalMs || nextDelay;
        setInstallJob({
          jobId,
          status: data.status,
          step: data.step,
          progress: Number(data.progress) || 0,
          message: data.message || '',
          done: data.done === true,
          currentModelId: data.currentModelId,
          error: data.error,
        });

        if (data.done) {
          activePollJobRef.current = null;
          setInstallJob(null);
          setActiveModel('');
          if (data.status === 'succeeded') {
            setNotice(chinese ? '模型服务已经准备完成。' : 'The model service is ready.');
            await refresh();
          } else {
            setError(data.error || (chinese ? '模型安装失败。' : 'Model installation failed.'));
          }
          return;
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }

      if (activePollJobRef.current === jobId) {
        pollTimerRef.current = window.setTimeout(() => void pollInstallJob(jobId), nextDelay);
      }
    },
    [chinese, refresh],
  );

  const operate = useCallback(
    async (action: 'install' | 'stop', modelId: string) => {
      setActiveModel(modelId);
      setError('');
      setNotice('');
      try {
        const response = await fetch('/api/local-services/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, modelId }),
        });
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(result.details || result.error || response.statusText);
        if (action === 'install' && result.jobId) {
          setInstallJob({
            jobId: result.jobId,
            status: 'running',
            step: 'starting',
            progress: 0,
            message: chinese ? '正在启动模型服务…' : 'Starting model service…',
            done: false,
            currentModelId: modelId,
          });
          void pollInstallJob(result.jobId);
          return;
        }
        setNotice(chinese ? '模型服务已经停止。' : 'The model service has stopped.');
        await refresh();
        setActiveModel('');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setActiveModel('');
      }
    },
    [chinese, pollInstallJob, refresh],
  );

  const prepareRecommended = useCallback(async () => {
    setActiveModel('prepare-recommended');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/local-services/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare-recommended' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.details || result.error || response.statusText);
      if (result.jobId) {
        setInstallJob({
          jobId: result.jobId,
          status: 'running',
          step: 'starting',
          progress: 0,
          message: chinese ? '正在准备推荐模型…' : 'Preparing recommended models…',
          done: false,
        });
        void pollInstallJob(result.jobId);
        return;
      }
      await refresh();
      setActiveModel('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setActiveModel('');
    }
  }, [chinese, pollInstallJob, refresh]);

  const clearCache = useCallback(async () => {
    setActiveModel('clear-cache');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/local-services/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-cache' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.details || result.error || response.statusText);
      setNotice(chinese ? '已停止服务并清理下载的轻量模型。' : 'Downloaded models were cleared.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActiveModel('');
    }
  }, [chinese, refresh]);

  const copy = chinese
    ? {
        title: '专用模型自动推荐',
        description: '只保存模型目录，根据电脑和任务选择模型；未使用的模型不会自动下载。',
        cpu: '处理器',
        memory: '内存',
        disk: '可用磁盘',
        gpu: '图形加速',
        noGpu: 'CPU 模式',
        autoDownload: '允许自动下载小模型',
        autoDownloadHint: '当前上限 2 GB；超过上限仍需确认。',
        best: '最佳候选',
        fallback: '当前可用',
        planned: '安装适配器开发中',
        ready: '已安装',
        install: '按需安装/启动',
        stop: '停止释放内存',
        prepare: '应用推荐并按上限准备模型',
        clear: '清理已下载模型',
        selection: '使用模型',
      }
    : {
        title: 'Automatic specialized model selection',
        description: 'Keep only a catalog, select per task, and download models only when needed.',
        cpu: 'CPU',
        memory: 'Memory',
        disk: 'Free disk',
        gpu: 'Acceleration',
        noGpu: 'CPU mode',
        autoDownload: 'Allow automatic small-model downloads',
        autoDownloadHint: 'Current limit is 2 GB; larger downloads still require confirmation.',
        best: 'Best candidate',
        fallback: 'Usable now',
        planned: 'Installer adapter in development',
        ready: 'Installed',
        install: 'Install/start on demand',
        stop: 'Stop and release memory',
        prepare: 'Apply recommendations and prepare models',
        clear: 'Clear downloaded models',
        selection: 'Selected model',
      };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{copy.title}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
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

      {snapshot && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <HardwareItem
              icon={<Cpu className="h-4 w-4" />}
              label={copy.cpu}
              value={`${snapshot.hardware.cpuModel} · ${snapshot.hardware.logicalCores}`}
            />
            <HardwareItem
              label={copy.memory}
              value={`${formatBytes(snapshot.hardware.totalMemoryBytes)} / ${formatBytes(snapshot.hardware.freeMemoryBytes)} free`}
            />
            <HardwareItem
              icon={<HardDrive className="h-4 w-4" />}
              label={copy.disk}
              value={formatBytes(snapshot.hardware.freeDiskBytes)}
            />
            <HardwareItem
              label={copy.gpu}
              value={
                snapshot.hardware.gpuAvailable
                  ? `${snapshot.hardware.gpuName} · ${snapshot.hardware.gpuRuntime}`
                  : copy.noGpu
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {(['speed', 'balanced', 'quality'] as Profile[]).map((profile) => (
              <Button
                key={profile}
                size="sm"
                variant={snapshot.preferences.profile === profile ? 'default' : 'outline'}
                disabled={saving}
                onClick={() => void savePreferences({ ...snapshot.preferences, profile })}
              >
                {profile === 'speed'
                  ? chinese
                    ? '速度优先'
                    : 'Speed'
                  : profile === 'balanced'
                    ? chinese
                      ? '均衡'
                      : 'Balanced'
                    : chinese
                      ? '质量优先'
                      : 'Quality'}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              disabled={activeModel === 'prepare-recommended'}
              onClick={() => void prepareRecommended()}
            >
              {activeModel === 'prepare-recommended' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {copy.prepare}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={activeModel === 'clear-cache'}
              onClick={() => void clearCache()}
            >
              {activeModel === 'clear-cache' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              {copy.clear}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{copy.autoDownload}</p>
              <p className="text-xs text-muted-foreground">{copy.autoDownloadHint}</p>
            </div>
            <Switch
              checked={snapshot.preferences.autoDownload}
              disabled={saving}
              onCheckedChange={(autoDownload) =>
                void savePreferences({ ...snapshot.preferences, autoDownload })
              }
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {snapshot.recommendations.map((recommendation) => {
              const selectedId =
                snapshot.preferences.selectedModels[recommendation.task] ||
                recommendation.usable.id;
              const selectedModel =
                snapshot.catalog.find((model) => model.id === selectedId) || recommendation.usable;
              const usableState = stateMap.get(selectedModel.id);
              const managed = selectedModel.availability === 'managed-service';
              return (
                <div key={recommendation.task} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {TASK_LABELS[recommendation.task][chinese ? 'zh' : 'en']}
                      </p>
                      <p className="text-xs text-muted-foreground">{recommendation.reason}</p>
                    </div>
                    {usableState?.installed && (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    )}
                  </div>
                  <div className="text-xs space-y-1">
                    <p>
                      <span className="text-muted-foreground">{copy.best}：</span>
                      {recommendation.primary.name}
                    </p>
                    {recommendation.primary.id !== recommendation.usable.id && (
                      <p>
                        <span className="text-muted-foreground">{copy.fallback}：</span>
                        {recommendation.usable.name}
                      </p>
                    )}
                    <p>
                      <span className="text-muted-foreground">Disk：</span>
                      {formatBytes(selectedModel.estimatedDiskBytes)}
                    </p>
                  </div>
                  <label className="block text-xs text-muted-foreground">
                    <span>{copy.selection}</span>
                    <select
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                      value={selectedModel.id}
                      disabled={saving}
                      onChange={(event) =>
                        void savePreferences({
                          ...snapshot.preferences,
                          selectedModels: {
                            ...snapshot.preferences.selectedModels,
                            [recommendation.task]: event.target.value,
                          },
                        })
                      }
                    >
                      {snapshot.catalog
                        .filter((model) => model.task === recommendation.task)
                        .map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name} · {formatBytes(model.estimatedDiskBytes)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {selectedModel.availability === 'planned' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">{copy.planned}</p>
                  )}
                  {managed &&
                    (installJob && installingModelId === selectedModel.id ? (
                      <div className="space-y-1.5">
                        <Progress value={installJob.progress} />
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{installJob.message}</span>
                          <span className="shrink-0">{Math.round(installJob.progress)}%</span>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={activeModel === selectedModel.id || !!installingModelId}
                        onClick={() =>
                          void operate(usableState?.running ? 'stop' : 'install', selectedModel.id)
                        }
                      >
                        {activeModel === selectedModel.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : usableState?.running ? (
                          <Square className="mr-1.5 h-3.5 w-3.5" />
                        ) : (
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {usableState?.running
                          ? copy.stop
                          : usableState?.installed
                            ? copy.install
                            : copy.install}
                      </Button>
                    ))}
                  {!managed && usableState?.installed && (
                    <p className="text-xs text-green-600">{copy.ready}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function HardwareItem({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 truncate font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

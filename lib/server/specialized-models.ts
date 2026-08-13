import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { getLocalRuntimeDiagnostics } from '@/lib/server/gpu-diagnostics';
import {
  ensureLocalModelServiceRunning,
  type LocalModelServiceId,
  releaseLocalModelServices,
} from '@/lib/server/local-model-services';
import { getBingoRuntimeRoot } from '@/lib/server/runtime-paths';

export type SpecializedModelTask = 'ocr' | 'document' | 'asr' | 'tts' | 'embedding';
export type SpecializedModelProfile = 'speed' | 'balanced' | 'quality';
export type SpecializedModelAvailability = 'bundled' | 'system' | 'managed-service' | 'planned';

export interface SpecializedModelDefinition {
  id: string;
  task: SpecializedModelTask;
  name: string;
  description: string;
  availability: SpecializedModelAvailability;
  service?: LocalModelServiceId;
  qualityScore: number;
  speedScore: number;
  minimumMemoryBytes: number;
  preferredMemoryBytes: number;
  estimatedDiskBytes: number;
  gpuRequired: boolean;
  chineseOptimized: boolean;
}

export interface SpecializedHardwareProfile {
  platform: NodeJS.Platform;
  cpuModel: string;
  logicalCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  freeDiskBytes: number;
  gpuAvailable: boolean;
  gpuName: string;
  gpuVendor: 'amd' | 'nvidia' | 'unknown';
  gpuRuntime: 'rocm-wsl' | 'cuda-windows' | 'none';
  gpuMemoryBytes?: number;
}

export interface SpecializedModelState {
  id: string;
  installed: boolean;
  running: boolean;
}

export interface SpecializedModelRecommendation {
  task: SpecializedModelTask;
  primary: SpecializedModelDefinition;
  usable: SpecializedModelDefinition;
  reason: string;
  requiresInstallerAdapter: boolean;
}

export interface SpecializedModelPreferences {
  profile: SpecializedModelProfile;
  autoDownload: boolean;
  autoDownloadLimitBytes: number;
  selectedModels: Partial<Record<SpecializedModelTask, string>>;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const SPECIALIZED_MODEL_CATALOG: SpecializedModelDefinition[] = [
  {
    id: 'tesseract-zh-en',
    task: 'ocr',
    name: 'Tesseract 中文+英文',
    description: '随 BinGO 提供的快速离线 OCR，适合清晰印刷文字。',
    availability: 'bundled',
    qualityScore: 68,
    speedScore: 92,
    minimumMemoryBytes: 512 * MB,
    preferredMemoryBytes: 1 * GB,
    estimatedDiskBytes: 32 * MB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'pp-ocrv6-medium',
    task: 'ocr',
    name: 'PP-OCRv6 Medium',
    description: '兼顾中文识别质量和资源占用的中档 OCR。',
    availability: 'managed-service',
    service: 'specialized',
    qualityScore: 91,
    speedScore: 84,
    minimumMemoryBytes: 2 * GB,
    preferredMemoryBytes: 4 * GB,
    estimatedDiskBytes: 1 * GB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'pp-structure-v3',
    task: 'document',
    name: 'PP-StructureV3',
    description: '中档复杂文档解析，面向版面、表格和公式。',
    availability: 'managed-service',
    service: 'specialized',
    qualityScore: 90,
    speedScore: 72,
    minimumMemoryBytes: 6 * GB,
    preferredMemoryBytes: 10 * GB,
    estimatedDiskBytes: 5 * GB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'mineru',
    task: 'document',
    name: 'MinerU',
    description: '高质量复杂 PDF、表格和公式解析。',
    availability: 'managed-service',
    service: 'mineru',
    qualityScore: 96,
    speedScore: 48,
    minimumMemoryBytes: 12 * GB,
    preferredMemoryBytes: 20 * GB,
    estimatedDiskBytes: 15 * GB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'windows-speech',
    task: 'asr',
    name: 'Windows 系统语音识别',
    description: '无需下载，适合低资源和短语音输入。',
    availability: 'system',
    qualityScore: 62,
    speedScore: 94,
    minimumMemoryBytes: 512 * MB,
    preferredMemoryBytes: 1 * GB,
    estimatedDiskBytes: 0,
    gpuRequired: false,
    chineseOptimized: false,
  },
  {
    id: 'sensevoice-small',
    task: 'asr',
    name: 'SenseVoice-Small',
    description: '中文语音识别的速度与质量均衡方案。',
    availability: 'managed-service',
    service: 'sensevoice',
    qualityScore: 89,
    speedScore: 91,
    minimumMemoryBytes: 3 * GB,
    preferredMemoryBytes: 6 * GB,
    estimatedDiskBytes: 4 * GB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'windows-tts',
    task: 'tts',
    name: 'Windows 系统语音',
    description: '无需下载，适合普通文字朗读。',
    availability: 'system',
    qualityScore: 65,
    speedScore: 96,
    minimumMemoryBytes: 256 * MB,
    preferredMemoryBytes: 512 * MB,
    estimatedDiskBytes: 0,
    gpuRequired: false,
    chineseOptimized: false,
  },
  {
    id: 'melotts-zh',
    task: 'tts',
    name: 'MeloTTS 中文',
    description: '比 CosyVoice 更轻的自然中文语音合成。',
    availability: 'managed-service',
    service: 'specialized',
    qualityScore: 84,
    speedScore: 87,
    minimumMemoryBytes: 3 * GB,
    preferredMemoryBytes: 6 * GB,
    estimatedDiskBytes: 3 * GB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'cosyvoice',
    task: 'tts',
    name: 'CosyVoice',
    description: '高质量教师声音和声音克隆。',
    availability: 'managed-service',
    service: 'cosyvoice',
    qualityScore: 96,
    speedScore: 52,
    minimumMemoryBytes: 10 * GB,
    preferredMemoryBytes: 18 * GB,
    estimatedDiskBytes: 12 * GB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'bge-small-zh-v1.5',
    task: 'embedding',
    name: 'BGE Small 中文',
    description: '速度优先的教材和知识点检索模型。',
    availability: 'managed-service',
    service: 'specialized',
    qualityScore: 78,
    speedScore: 95,
    minimumMemoryBytes: 1 * GB,
    preferredMemoryBytes: 2 * GB,
    estimatedDiskBytes: 512 * MB,
    gpuRequired: false,
    chineseOptimized: true,
  },
  {
    id: 'bge-base-zh-v1.5',
    task: 'embedding',
    name: 'BGE Base 中文',
    description: '教材检索的质量与速度均衡方案。',
    availability: 'managed-service',
    service: 'embedding',
    qualityScore: 89,
    speedScore: 86,
    minimumMemoryBytes: 2 * GB,
    preferredMemoryBytes: 4 * GB,
    estimatedDiskBytes: 2 * GB,
    gpuRequired: false,
    chineseOptimized: true,
  },
];

const DEFAULT_PREFERENCES: SpecializedModelPreferences = {
  profile: 'balanced',
  autoDownload: false,
  autoDownloadLimitBytes: 2 * GB,
  selectedModels: {},
};

function preferencesPath() {
  return path.join(getBingoRuntimeRoot(), 'data', 'specialized-model-preferences.json');
}

function parseGpuMemory(output: string): number | undefined {
  const match = output.match(/([\d.]+)\s*(MiB|GiB)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return value * (match[2].toLowerCase() === 'gib' ? GB : MB);
}

export async function getSpecializedHardwareProfile(): Promise<SpecializedHardwareProfile> {
  const runtimeRoot = getBingoRuntimeRoot();
  await fs.mkdir(runtimeRoot, { recursive: true });
  const [disk, diagnostics] = await Promise.all([
    fs.statfs(runtimeRoot),
    getLocalRuntimeDiagnostics(),
  ]);
  const cpus = os.cpus();
  return {
    platform: process.platform,
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    logicalCores: cpus.length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    freeDiskBytes: disk.bavail * disk.bsize,
    gpuAvailable: diagnostics.gpu.available,
    gpuName: diagnostics.gpu.name,
    gpuVendor: diagnostics.gpu.vendor,
    gpuRuntime: diagnostics.gpu.runtime,
    gpuMemoryBytes: parseGpuMemory(diagnostics.gpu.output),
  };
}

function runtimeInstallPaths(model: SpecializedModelDefinition): string[] {
  if (!model.service) return [];
  const directoryNames: Record<LocalModelServiceId, string> = {
    cosyvoice: 'CosyVoice',
    sensevoice: 'SenseVoice',
    mineru: 'MinerU',
    embedding: 'ChineseXinhuaEmbedding',
    specialized: 'SpecializedModels',
  };
  const root = path.join(getBingoRuntimeRoot(), 'services', directoryNames[model.service], '.venv');
  return [path.join(root, 'Scripts', 'python.exe'), path.join(root, 'bin', 'python')];
}

function legacyInstallPaths(model: SpecializedModelDefinition): string[] {
  if (!model.service) return [];
  const directories: Record<LocalModelServiceId, string> = {
    cosyvoice: 'CosyVoice',
    sensevoice: 'SenseVoice',
    mineru: 'MinerU',
    embedding: 'ChineseXinhuaEmbedding',
    specialized: 'SpecializedModels',
  };
  const root = path.join(process.cwd(), 'dev', directories[model.service], '.venv');
  return [path.join(root, 'Scripts', 'python.exe'), path.join(root, 'bin', 'python')];
}

function servicePort(service: LocalModelServiceId): number {
  return {
    cosyvoice: 50000,
    sensevoice: 50001,
    mineru: 50002,
    embedding: 50003,
    specialized: 50004,
  }[service];
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function getSpecializedModelStates(): Promise<SpecializedModelState[]> {
  let specializedInstalled = new Set<string>();
  const stateFiles = [
    path.join(getBingoRuntimeRoot(), 'services', 'SpecializedModels', 'installed-models.json'),
    path.join(process.cwd(), 'dev', 'SpecializedModels', 'installed-models.json'),
  ];
  for (const stateFile of stateFiles) {
    try {
      const installed = JSON.parse(await fs.readFile(stateFile, 'utf8')) as string[];
      specializedInstalled = new Set([...specializedInstalled, ...installed]);
    } catch {}
  }
  return Promise.all(
    SPECIALIZED_MODEL_CATALOG.map(async (model) => {
      if (model.availability === 'bundled' || model.availability === 'system') {
        return { id: model.id, installed: true, running: true };
      }
      const candidates = [...runtimeInstallPaths(model), ...legacyInstallPaths(model)];
      const installedChecks = await Promise.all(
        candidates.map((candidate) =>
          fs
            .stat(candidate)
            .then(() => true)
            .catch(() => false),
        ),
      );
      const running = model.service ? await isPortListening(servicePort(model.service)) : false;
      const installed =
        model.service === 'specialized'
          ? specializedInstalled.has(model.id)
          : installedChecks.some(Boolean);
      return { id: model.id, installed, running };
    }),
  );
}

function modelScore(
  model: SpecializedModelDefinition,
  hardware: SpecializedHardwareProfile,
  profile: SpecializedModelProfile,
  installed: boolean,
): number {
  if (model.minimumMemoryBytes > hardware.totalMemoryBytes * 0.75) return Number.NEGATIVE_INFINITY;
  if (model.estimatedDiskBytes > hardware.freeDiskBytes * 0.8) return Number.NEGATIVE_INFINITY;
  if (model.gpuRequired && !hardware.gpuAvailable) return Number.NEGATIVE_INFINITY;

  const resourceScore = Math.max(
    0,
    100 - (model.preferredMemoryBytes / Math.max(hardware.totalMemoryBytes, 1)) * 100,
  );
  const weights =
    profile === 'speed'
      ? { quality: 0.25, speed: 0.55, resource: 0.2 }
      : profile === 'quality'
        ? { quality: 0.65, speed: 0.2, resource: 0.15 }
        : { quality: 0.45, speed: 0.35, resource: 0.2 };
  return (
    model.qualityScore * weights.quality +
    model.speedScore * weights.speed +
    resourceScore * weights.resource +
    (installed ? 5 : 0) +
    (model.chineseOptimized ? 3 : 0)
  );
}

export function recommendSpecializedModels(
  hardware: SpecializedHardwareProfile,
  states: SpecializedModelState[],
  profile: SpecializedModelProfile,
): SpecializedModelRecommendation[] {
  const stateMap = new Map(states.map((state) => [state.id, state]));
  const tasks: SpecializedModelTask[] = ['ocr', 'document', 'asr', 'tts', 'embedding'];

  return tasks.map((task) => {
    const candidates = SPECIALIZED_MODEL_CATALOG.filter((model) => model.task === task)
      .map((model) => ({
        model,
        score: modelScore(model, hardware, profile, stateMap.get(model.id)?.installed === true),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => b.score - a.score);
    const primary =
      candidates[0]?.model ?? SPECIALIZED_MODEL_CATALOG.find((model) => model.task === task)!;
    const usable =
      candidates.find((entry) => entry.model.availability !== 'planned')?.model ?? primary;
    const requiresInstallerAdapter = primary.availability === 'planned';
    const reason = requiresInstallerAdapter
      ? `${primary.name} 最符合当前硬件和“${profile}”偏好；安装适配器完成前将使用 ${usable.name}。`
      : `${primary.name} 在当前内存、磁盘和“${profile}”偏好下得分最高。`;
    return { task, primary, usable, reason, requiresInstallerAdapter };
  });
}

export async function loadSpecializedModelPreferences(): Promise<SpecializedModelPreferences> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(preferencesPath(), 'utf8'),
    ) as Partial<SpecializedModelPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      selectedModels: parsed.selectedModels ?? {},
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function saveSpecializedModelPreferences(
  preferences: SpecializedModelPreferences,
): Promise<SpecializedModelPreferences> {
  const normalized: SpecializedModelPreferences = {
    profile: ['speed', 'balanced', 'quality'].includes(preferences.profile)
      ? preferences.profile
      : 'balanced',
    autoDownload: preferences.autoDownload === true,
    autoDownloadLimitBytes: Math.max(0, Number(preferences.autoDownloadLimitBytes) || 0),
    selectedModels: preferences.selectedModels ?? {},
  };
  const filePath = preferencesPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function installSpecializedModel(modelId: string) {
  const model = SPECIALIZED_MODEL_CATALOG.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown specialized model: ${modelId}`);
  if (model.availability === 'planned') {
    throw new Error(
      `${model.name} is listed in the catalog, but its installer adapter is not available yet.`,
    );
  }
  const result = model.service
    ? await ensureLocalModelServiceRunning(model.service)
    : { started: false, baseUrl: undefined };
  if (model.service === 'specialized') {
    const response = await fetch(`${result.baseUrl || 'http://localhost:50004'}/models/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: model.id }),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok) throw new Error(await response.text());
  }
  const preferences = await loadSpecializedModelPreferences();
  await saveSpecializedModelPreferences({
    ...preferences,
    selectedModels: { ...preferences.selectedModels, [model.task]: model.id },
  });
  return { model, installed: true, started: result.started, baseUrl: result.baseUrl };
}

export async function stopSpecializedModel(modelId: string) {
  const model = SPECIALIZED_MODEL_CATALOG.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown specialized model: ${modelId}`);
  if (!model.service) return { model, released: true };
  const result = await releaseLocalModelServices([model.service]);
  return { model, released: result.released, error: result.error };
}

export async function clearSpecializedModelCache() {
  await releaseLocalModelServices(['specialized']);
  const serviceRoots = [
    path.join(getBingoRuntimeRoot(), 'services', 'SpecializedModels'),
    path.join(process.cwd(), 'dev', 'SpecializedModels'),
  ];
  await Promise.all(
    serviceRoots.flatMap((serviceRoot) => [
      fs.rm(path.join(serviceRoot, 'cache'), { recursive: true, force: true }),
      fs.rm(path.join(serviceRoot, 'installed-models.json'), { force: true }),
    ]),
  );

  const preferences = await loadSpecializedModelPreferences();
  const selectedModels = { ...preferences.selectedModels };
  for (const task of ['ocr', 'document', 'tts', 'embedding'] as SpecializedModelTask[]) {
    const selected = SPECIALIZED_MODEL_CATALOG.find((model) => model.id === selectedModels[task]);
    if (selected?.service === 'specialized') delete selectedModels[task];
  }
  await saveSpecializedModelPreferences({ ...preferences, selectedModels });
  return { cleared: true };
}

export async function getSpecializedModelManagerSnapshot() {
  const [hardware, states, preferences] = await Promise.all([
    getSpecializedHardwareProfile(),
    getSpecializedModelStates(),
    loadSpecializedModelPreferences(),
  ]);
  return {
    hardware,
    catalog: SPECIALIZED_MODEL_CATALOG,
    states,
    preferences,
    recommendations: recommendSpecializedModels(hardware, states, preferences.profile),
  };
}

export async function prepareRecommendedSpecializedModels(
  onModelInstallStart?: (modelId: string) => void,
) {
  const snapshot = await getSpecializedModelManagerSnapshot();
  const stateMap = new Map(snapshot.states.map((state) => [state.id, state]));
  const selectedModels: Partial<Record<SpecializedModelTask, string>> = {};
  const installed: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let downloadBudget = snapshot.preferences.autoDownloadLimitBytes;

  for (const recommendation of snapshot.recommendations) {
    const model = recommendation.usable;
    selectedModels[recommendation.task] = model.id;
    const state = stateMap.get(model.id);
    if (state?.installed || model.availability === 'bundled' || model.availability === 'system') {
      continue;
    }
    if (model.availability !== 'managed-service') {
      skipped.push({ id: model.id, reason: 'Installer adapter is not available.' });
      continue;
    }
    if (!snapshot.preferences.autoDownload) {
      skipped.push({ id: model.id, reason: 'Automatic downloads are disabled.' });
      continue;
    }
    if (model.estimatedDiskBytes > downloadBudget) {
      skipped.push({ id: model.id, reason: 'Automatic download limit would be exceeded.' });
      continue;
    }
    onModelInstallStart?.(model.id);
    await installSpecializedModel(model.id);
    installed.push(model.id);
    downloadBudget -= model.estimatedDiskBytes;
  }

  const preferences = await saveSpecializedModelPreferences({
    ...snapshot.preferences,
    selectedModels,
  });
  return { installed, skipped, preferences };
}

export async function resolveSelectedSpecializedModel(task: SpecializedModelTask) {
  const snapshot = await getSpecializedModelManagerSnapshot();
  const selectedId = snapshot.preferences.selectedModels[task];
  const selected = SPECIALIZED_MODEL_CATALOG.find(
    (model) => model.task === task && model.id === selectedId,
  );
  return selected ?? snapshot.recommendations.find((item) => item.task === task)?.usable;
}

import { execFile, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { ensureOptionalChineseXinhuaData, getChineseXinhuaDataRoots } from '@/lib/server/chinese-xinhua-data';
import { promisify } from 'util';
import { createLogger } from '@/lib/logger';

const execFileAsync = promisify(execFile);
const log = createLogger('LocalModelServices');

export type LocalModelServiceId = 'cosyvoice' | 'sensevoice' | 'mineru' | 'embedding';

export interface ReleaseLocalModelServicesResult {
  services: LocalModelServiceId[];
  released: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface EnsureLocalModelServiceOptions {
  port?: number;
  timeoutMs?: number;
  skipExistingStartupProcessWait?: boolean;
}

export interface EnsureLocalModelServiceResult {
  service: LocalModelServiceId;
  port: number;
  started: boolean;
  baseUrl?: string;
}

const DEFAULT_START_TIMEOUT_MS = 10 * 60 * 1000;
const WSL_IP_CACHE_MS = 3000;
const EXISTING_PROCESS_WAIT_POLL_MS = 1000;
const RELEASE_GRACE_TIMEOUT_MS = 3000;

const serviceDefinitions: Record<
  LocalModelServiceId,
  {
    defaultPort: number;
    psScriptName: string;
    cmdScriptName: string;
    portEnvName: string;
    readyFile: string;
    logName: string;
    wsl?: boolean;
  }
> = {
  cosyvoice: {
    defaultPort: 50000,
    psScriptName: 'cosyvoice-local-server.ps1',
    cmdScriptName: 'cosyvoice-local-server.cmd',
    portEnvName: 'COSYVOICE_PORT',
    readyFile: 'dev\\CosyVoice\\.venv\\Scripts\\python.exe',
    logName: 'cosyvoice',
    wsl: true,
  },
  sensevoice: {
    defaultPort: 50001,
    psScriptName: 'sensevoice-local-server.ps1',
    cmdScriptName: 'sensevoice-local-server.cmd',
    portEnvName: 'SENSEVOICE_PORT',
    readyFile: 'dev\\SenseVoice\\.venv\\Scripts\\python.exe',
    logName: 'sensevoice',
    wsl: true,
  },
  mineru: {
    defaultPort: 50002,
    psScriptName: 'mineru-local-server.ps1',
    cmdScriptName: 'mineru-local-server.cmd',
    portEnvName: 'MINERU_PORT',
    readyFile: 'dev\\MinerU\\.venv\\Scripts\\python.exe',
    logName: 'mineru',
    wsl: true,
  },
  embedding: {
    defaultPort: 50003,
    psScriptName: 'chinese-xinhua-embedding-wsl-server.ps1',
    cmdScriptName: 'chinese-xinhua-embedding-wsl-server.ps1',
    portEnvName: 'BINGO_EMBEDDING_PORT',
    readyFile: 'dev\\ChineseXinhuaEmbedding\\.venv\\bin\\python',
    logName: 'embedding',
    wsl: true,
  },
};

const wslRuntimeDefinitions: Record<
  LocalModelServiceId,
  {
    serviceDir: string;
    readyMarker: string;
    modelId?: string;
    modelDir?: string;
  }
> = {
  cosyvoice: {
    serviceDir: 'CosyVoice',
    readyMarker: '.bingo-cosyvoice-rocm-ready',
    modelId: 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
    modelDir: 'pretrained_models/Fun-CosyVoice3-0.5B',
  },
  sensevoice: {
    serviceDir: 'SenseVoice',
    readyMarker: '.bingo-sensevoice-rocm-ready',
    modelId: 'iic/SenseVoiceSmall',
  },
  mineru: {
    serviceDir: 'MinerU',
    readyMarker: '.bingo-mineru-rocm-ready',
  },
  embedding: {
    serviceDir: 'ChineseXinhuaEmbedding',
    readyMarker: '.bingo-embedding-rocm-ready',
    modelId: 'BAAI/bge-base-zh-v1.5',
  },
};

const LOCAL_MODEL_START_PROMISES_KEY = Symbol.for('bingo.localModelService.startPromises');

function getStartPromises(): Map<string, Promise<EnsureLocalModelServiceResult>> {
  const globalState = globalThis as typeof globalThis & {
    [LOCAL_MODEL_START_PROMISES_KEY]?: Map<string, Promise<EnsureLocalModelServiceResult>>;
  };
  globalState[LOCAL_MODEL_START_PROMISES_KEY] ??= new Map();
  return globalState[LOCAL_MODEL_START_PROMISES_KEY];
}

let wslIpAddressCache: { expiresAt: number; addresses: string[] } | undefined;

function normalizeServices(services: LocalModelServiceId[]): LocalModelServiceId[] {
  return [...new Set(services)].filter((service): service is LocalModelServiceId =>
    ['cosyvoice', 'sensevoice', 'mineru', 'embedding'].includes(service),
  );
}

function getStartTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;

  const envTimeout = Number.parseInt(process.env.BINGO_LOCAL_SERVICE_START_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_START_TIMEOUT_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function testPortListening(port: number, host = '127.0.0.1', timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function getWslDistroArgs(): string[] {
  const distro = process.env.BINGO_WSL_DISTRO?.trim();
  return distro ? ['-d', distro] : [];
}

function isUsableIpv4Address(value: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;

  const parts = value.split('.').map((part) => Number.parseInt(part, 10));
  return (
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    parts[0] !== 0 &&
    parts[0] !== 127
  );
}

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function getPortProbeHost(baseUrl: string): string {
  try {
    const hostname = new URL(baseUrl).hostname;
    return isLoopbackHost(hostname) ? '127.0.0.1' : hostname;
  } catch {
    return '127.0.0.1';
  }
}

function buildBaseUrlForHost(baseUrl: string, host: string): string | undefined {
  try {
    const parsed = new URL(baseUrl);
    parsed.hostname = host;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export async function getWslIpAddresses(): Promise<string[]> {
  if (process.platform !== 'win32') return [];

  const now = Date.now();
  if (wslIpAddressCache && wslIpAddressCache.expiresAt > now) {
    return wslIpAddressCache.addresses;
  }

  try {
    const { stdout } = await execFileAsync(
      'wsl.exe',
      [...getWslDistroArgs(), '--exec', 'hostname', '-I'],
      {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 64 * 1024,
      },
    );
    const addresses = [
      ...new Set(
        stdout
          .split(/\s+/)
          .map((value) => value.trim())
          .filter(isUsableIpv4Address),
      ),
    ];
    wslIpAddressCache = { expiresAt: now + WSL_IP_CACHE_MS, addresses };
    return addresses;
  } catch (error) {
    log.debug('Failed to resolve WSL IP addresses', error);
    wslIpAddressCache = { expiresAt: now + WSL_IP_CACHE_MS, addresses: [] };
    return [];
  }
}

async function testLocalModelServiceListening(
  service: LocalModelServiceId,
  port: number,
): Promise<boolean> {
  if (await testPortListening(port)) {
    return true;
  }

  if (!serviceDefinitions[service].wsl) {
    return false;
  }

  for (const address of await getWslIpAddresses()) {
    if (await testPortListening(port, address)) {
      return true;
    }
  }

  return false;
}

export async function resolveReachableLocalModelServiceBaseUrl(
  service: LocalModelServiceId,
  configuredBaseUrl?: string,
): Promise<string> {
  const definition = serviceDefinitions[service];
  const fallbackBaseUrl = `http://localhost:${definition.defaultPort}`;
  const baseUrl = (configuredBaseUrl?.trim() || fallbackBaseUrl).replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return fallbackBaseUrl;
  }

  const port = Number.parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
  if (!Number.isFinite(port) || port <= 0) {
    return baseUrl;
  }

  if (await testPortListening(port, getPortProbeHost(baseUrl))) {
    return baseUrl;
  }

  if (!definition.wsl || !isLoopbackHost(parsed.hostname)) {
    return baseUrl;
  }

  for (const address of await getWslIpAddresses()) {
    if (await testPortListening(port, address)) {
      return buildBaseUrlForHost(baseUrl, address) || baseUrl;
    }
  }

  return baseUrl;
}

async function waitForServicePort(
  service: LocalModelServiceId,
  port: number,
  timeoutMs: number,
  getEarlyFailure?: () => string | undefined,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const earlyFailure = getEarlyFailure?.();
    if (earlyFailure) {
      throw new Error(earlyFailure);
    }

    if (await testLocalModelServiceListening(service, port)) {
      return;
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for local model service on port ${port}.`);
}

function closeFd(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    fs.closeSync(fd);
  } catch {
    // The child process may already own the handle; startup should not fail on log cleanup.
  }
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function powerShellSingleQuoted(value: string): string {
  return `'${escapePowerShellSingleQuoted(value)}'`;
}

function shellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

interface UnixProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

const unixReleaseMarkers: Record<
  LocalModelServiceId,
  {
    commandMarkers: string[];
    portMarkers: string[];
  }
> = {
  cosyvoice: {
    commandMarkers: ['runtime/python/fastapi/server.py', 'cosyvoice'],
    portMarkers: ['--port 50000', '--port=50000'],
  },
  sensevoice: {
    commandMarkers: ['sensevoice_server.py', 'sensevoice'],
    portMarkers: ['--port 50001', '--port=50001'],
  },
  mineru: {
    commandMarkers: ['mineru.cli.fast_api', 'mineru-local-server', 'MinerU/.venv/bin/python'],
    portMarkers: ['--port 50002', '--port=50002'],
  },
  embedding: {
    commandMarkers: ['chinese_xinhua_embedding_server', 'ChineseXinhuaEmbedding'],
    portMarkers: ['--port 50003', '--port=50003', 'BINGO_EMBEDDING_PORT=50003'],
  },
};

function normalizeCommand(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function getUnixProcesses(): Promise<UnixProcessInfo[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,args='], {
    cwd: process.cwd(),
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });

  return stdout
    .split('\n')
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (!match) return undefined;
      return {
        pid: Number.parseInt(match[1], 10),
        ppid: Number.parseInt(match[2], 10),
        command: normalizeCommand(match[3] || ''),
      };
    })
    .filter(
      (processInfo): processInfo is UnixProcessInfo =>
        !!processInfo &&
        Number.isFinite(processInfo.pid) &&
        Number.isFinite(processInfo.ppid) &&
        processInfo.pid !== process.pid &&
        !!processInfo.command,
    );
}

function matchesUnixServiceProcess(
  service: LocalModelServiceId,
  processInfo: UnixProcessInfo,
): boolean {
  const markers = unixReleaseMarkers[service];
  const command = processInfo.command;
  const lowerCommand = command.toLowerCase();
  const hasCommandMarker = markers.commandMarkers.some((marker) =>
    lowerCommand.includes(marker.toLowerCase()),
  );
  const hasPortMarker = markers.portMarkers.some((marker) =>
    lowerCommand.includes(marker.toLowerCase()),
  );
  return hasCommandMarker && hasPortMarker;
}

function collectUnixProcessTree(
  rootPids: number[],
  processes: UnixProcessInfo[],
): UnixProcessInfo[] {
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const childrenByParent = new Map<number, UnixProcessInfo[]>();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) || [];
    children.push(processInfo);
    childrenByParent.set(processInfo.ppid, children);
  }

  const targetPids = new Set<number>();
  const addTree = (pid: number) => {
    if (targetPids.has(pid)) return;
    targetPids.add(pid);
    for (const child of childrenByParent.get(pid) || []) {
      addTree(child.pid);
    }
  };

  for (const pid of rootPids) addTree(pid);

  return [...targetPids]
    .map((pid) => byPid.get(pid))
    .filter((processInfo): processInfo is UnixProcessInfo => !!processInfo)
    .sort((a, b) => b.ppid - a.ppid || b.pid - a.pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessesToExit(pids: number[], timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !isProcessAlive(pid))) return;
    await delay(100);
  }
}

async function releaseUnixLocalModelServices(
  services: LocalModelServiceId[],
): Promise<ReleaseLocalModelServicesResult> {
  const processes = await getUnixProcesses();
  const targetByPid = new Map<number, UnixProcessInfo>();
  const stdoutParts: string[] = [];
  const errors: string[] = [];

  for (const service of services) {
    const roots = processes
      .filter((processInfo) => matchesUnixServiceProcess(service, processInfo))
      .map((processInfo) => processInfo.pid);
    const targets = collectUnixProcessTree(roots, processes);
    stdoutParts.push(`${service} matched root processes: ${roots.length}`);
    for (const target of targets) targetByPid.set(target.pid, target);
  }

  const targets = [...targetByPid.values()].sort((a, b) => b.ppid - a.ppid || b.pid - a.pid);
  for (const target of targets) {
    stdoutParts.push(`Stopping PID ${target.pid}: ${target.command}`);
    try {
      process.kill(target.pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        errors.push(`PID ${target.pid}: ${getErrorMessage(error)}`);
      }
    }
  }

  await waitForProcessesToExit(
    targets.map((target) => target.pid),
    RELEASE_GRACE_TIMEOUT_MS,
  );

  for (const target of targets) {
    if (!isProcessAlive(target.pid)) continue;
    stdoutParts.push(`Force stopping PID ${target.pid}: ${target.command}`);
    try {
      process.kill(target.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        errors.push(`PID ${target.pid}: ${getErrorMessage(error)}`);
      }
    }
  }

  stdoutParts.push(`total target processes: ${targets.length}`);
  return {
    services,
    released: errors.length === 0,
    stdout: stdoutParts.join('\n'),
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  };
}

function getWslRuntimeRoot(): string {
  return process.env.BINGO_WSL_RUNTIME_ROOT?.trim() || '~/.cache/bingo';
}

function getHfEndpoint(): string {
  return process.env.HF_ENDPOINT?.trim() || 'https://hf-mirror.com';
}

function buildWslNativeStartCommand(service: LocalModelServiceId, port: number): string {
  const runtime = wslRuntimeDefinitions[service];
  const serviceScript = serviceDefinitions[service].psScriptName;
  const lines = [
    'set -euo pipefail',
    `cd ${shellSingleQuoted(process.cwd())}`,
    `SERVICE=${shellSingleQuoted(service)}`,
    `RUNTIME_ROOT=${shellSingleQuoted(getWslRuntimeRoot())}`,
    'if [[ "$RUNTIME_ROOT" == "~"* ]]; then',
    '  RUNTIME_ROOT="$HOME${RUNTIME_ROOT:1}"',
    'fi',
    `VENV_PY="$RUNTIME_ROOT/services/${runtime.serviceDir}/.venv/bin/python"`,
    `READY_MARKER="$RUNTIME_ROOT/services/${runtime.serviceDir}/.venv/${runtime.readyMarker}"`,
    'if [ ! -x "$VENV_PY" ] || [ ! -f "$READY_MARKER" ]; then',
    `  echo ${shellSingleQuoted(`${service} ROCm environment is not installed. Start Bingo with scripts/start-bingo.ps1 or run scripts/${serviceScript} from Windows PowerShell once.`)} >&2`,
    '  exit 2',
    'fi',
    'export PYTHONUTF8=1',
    'export PYTHONIOENCODING=utf-8',
    `export HF_ENDPOINT=${shellSingleQuoted(getHfEndpoint())}`,
    'export HF_HOME="$RUNTIME_ROOT/cache/hf"',
    'export MPLCONFIGDIR="$RUNTIME_ROOT/cache/matplotlib"',
    'export MODELSCOPE_CACHE="$RUNTIME_ROOT/cache/modelscope"',
    'export MODELSCOPE_CACHE_HOME="$RUNTIME_ROOT/cache/modelscope"',
    'export MODELSCOPE_MODULES_CACHE="$RUNTIME_ROOT/cache/modelscope/modules"',
    'export TORCH_HOME="$RUNTIME_ROOT/cache/torch"',
    'export XDG_CACHE_HOME="$RUNTIME_ROOT/cache/xdg"',
    'export TMPDIR="$RUNTIME_ROOT/tmp"',
    'mkdir -p "$HF_HOME" "$MPLCONFIGDIR" "$MODELSCOPE_CACHE" "$MODELSCOPE_MODULES_CACHE" "$TORCH_HOME" "$XDG_CACHE_HOME" "$TMPDIR"',
    '"$VENV_PY" - <<\'PY\'',
    'import torch',
    '',
    'if not getattr(torch.version, "hip", None):',
    '    raise SystemExit(f"Installed PyTorch is not a ROCm build: torch={torch.__version__}")',
    'if not torch.cuda.is_available():',
    '    raise SystemExit("ROCm PyTorch is installed, but no HIP GPU is visible to torch.")',
    'print(',
    '    "ROCm torch ready: torch={} hip={} device_count={} device={}".format(',
    '        torch.__version__,',
    '        torch.version.hip,',
    '        torch.cuda.device_count(),',
    '        torch.cuda.get_device_name(0) if torch.cuda.device_count() else "none",',
    '    ),',
    '    flush=True,',
    ')',
    'PY',
    'export BINGO_REQUIRE_ROCM=1',
  ];

  switch (service) {
    case 'cosyvoice':
      lines.push(
        'cd dev/CosyVoice',
        `MODEL_DIR=${shellSingleQuoted(runtime.modelDir || 'pretrained_models/Fun-CosyVoice3-0.5B')}`,
        'if [ ! -f "$MODEL_DIR/cosyvoice3.yaml" ] || [ ! -f "$MODEL_DIR/llm.pt" ]; then',
        `  "$VENV_PY" -m huggingface_hub.commands.huggingface_cli download ${shellSingleQuoted(runtime.modelId || '')} --local-dir "$MODEL_DIR" --resume-download --exclude .DS_Store`,
        'fi',
        'if [ -f "$MODEL_DIR/llm.rl.pt" ]; then',
        '  [ -f "$MODEL_DIR/llm.base.pt" ] || cp "$MODEL_DIR/llm.pt" "$MODEL_DIR/llm.base.pt"',
        '  cp "$MODEL_DIR/llm.rl.pt" "$MODEL_DIR/llm.pt"',
        'fi',
        'export COSYVOICE_DEVICE=cuda',
        'COSYVOICE_FP16_FLAG=""',
        'if [ "${BINGO_COSYVOICE_FP16:-0}" = "1" ]; then',
        '  COSYVOICE_FP16_FLAG="--fp16"',
        'fi',
        `exec "$VENV_PY" runtime/python/fastapi/server.py --model_dir "$MODEL_DIR" --port ${port} --device cuda $COSYVOICE_FP16_FLAG`,
      );
      break;
    case 'sensevoice':
      lines.push(
        'export SENSEVOICE_DEVICE=cuda',
        `export SENSEVOICE_MODEL=${shellSingleQuoted(runtime.modelId || 'iic/SenseVoiceSmall')}`,
        `exec "$VENV_PY" scripts/sensevoice_server.py --model ${shellSingleQuoted(runtime.modelId || 'iic/SenseVoiceSmall')} --port ${port} --device cuda`,
      );
      break;
    case 'mineru':
      lines.push(
        'export MINERU_MODEL_SOURCE="${MINERU_MODEL_SOURCE:-modelscope}"',
        'export BINGO_REQUIRE_ROCM=1',
        'export MINERU_DEVICE_MODE=cuda',
        'export BINGO_MINERU_ACCELERATOR=rocm',
        'export BINGO_MINERU_LAYOUT_ACCELERATOR=cuda',
        'export BINGO_MINERU_MFR_ACCELERATOR=cuda',
        'export BINGO_MINERU_OCR_ACCELERATOR=cuda',
        'export MINERU_API_MAX_CONCURRENT_REQUESTS="${MINERU_API_MAX_CONCURRENT_REQUESTS:-1}"',
        'export MINERU_PROCESSING_WINDOW_SIZE="${MINERU_PROCESSING_WINDOW_SIZE:-32}"',
        'export MINERU_API_OUTPUT_ROOT="$RUNTIME_ROOT/services/MinerU/output"',
        'export BINGO_MINERU_TRT_CACHE="$RUNTIME_ROOT/services/MinerU/trt-cache"',
        'mkdir -p "$MINERU_API_OUTPUT_ROOT" "$BINGO_MINERU_TRT_CACHE"',
        '"$VENV_PY" scripts/mineru_patch_gpu.py',
        'echo "MinerU ROCm/runtime probe:"',
        '"$VENV_PY" scripts/mineru_gpu_check.py',
        `exec "$VENV_PY" -m mineru.cli.fast_api --host 127.0.0.1 --port ${port}`,
      );
      break;
    case 'embedding': {
      const dictionaryRoots = getChineseXinhuaDataRoots();
      lines.push(
        'export BINGO_REQUIRE_ROCM=1',
        `export BINGO_EMBEDDING_MODEL=${shellSingleQuoted(runtime.modelId || 'BAAI/bge-base-zh-v1.5')}`,
        `export BINGO_EMBEDDING_PORT=${port}`,
        `export BINGO_CHINESE_XINHUA_DATA=${shellSingleQuoted(dictionaryRoots.runtime || dictionaryRoots.packaged)}`,
        `export BINGO_CHINESE_XINHUA_FALLBACK_DATA=${shellSingleQuoted(dictionaryRoots.packaged)}`,
        'export BINGO_CHINESE_XINHUA_INDEX="$RUNTIME_ROOT/data/chinese-xinhua-index"',
        'export TRANSFORMERS_CACHE="$HF_HOME"',
        'mkdir -p "$BINGO_CHINESE_XINHUA_INDEX"',
        `exec "$VENV_PY" -m uvicorn scripts.chinese_xinhua_embedding_server:app --host 127.0.0.1 --port ${port}`,
      );
      break;
    }
  }

  return `${lines.join('\n')}\n`;
}

async function spawnWslNativeLocalModelService(
  service: LocalModelServiceId,
  port: number,
  timeoutMs: number,
): Promise<EnsureLocalModelServiceResult> {
  if (process.platform !== 'linux') {
    throw new Error('Local model service startup is only implemented for Windows or WSL/Linux.');
  }

  const definition = serviceDefinitions[service];
  const root = process.cwd();
  const stdoutPath = path.join(root, `bingo-${definition.logName}.log`);
  const stderrPath = path.join(root, `bingo-${definition.logName}.err.log`);
  let stdoutFd: number | undefined;
  let stderrFd: number | undefined;

  try {
    stdoutFd = fs.openSync(stdoutPath, 'a');
    stderrFd = fs.openSync(stderrPath, 'a');
    const child = spawn('bash', ['-lc', buildWslNativeStartCommand(service, port)], {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        [definition.portEnvName]: String(port),
        BINGO_LOCAL_MODEL_RUNTIME: 'rocm',
      },
      stdio: ['ignore', stdoutFd, stderrFd],
    });

    let childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    child.once('exit', (code, signal) => {
      childExit = { code, signal };
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        closeFd(stdoutFd);
        closeFd(stderrFd);
        stdoutFd = undefined;
        stderrFd = undefined;
        callback();
      };

      child.once('spawn', () => settle(resolve));
      child.once('error', (error) => settle(() => reject(error)));
    });

    child.unref();
    await waitForServicePort(service, port, timeoutMs, () =>
      childExit && (childExit.code !== 0 || childExit.signal)
        ? `${service} startup process exited before port ${port} was ready (code=${childExit.code}, signal=${childExit.signal ?? 'none'}). Check ${stderrPath}.`
        : undefined,
    );

    return {
      service,
      port,
      started: true,
      baseUrl: await resolveReachableLocalModelServiceBaseUrl(service, `http://localhost:${port}`),
    };
  } finally {
    closeFd(stdoutFd);
    closeFd(stderrFd);
  }
}

async function hasExistingStartupProcess(
  service: LocalModelServiceId,
  port: number,
): Promise<boolean> {
  if (process.platform !== 'win32') return false;

  const definition = serviceDefinitions[service];
  const root = escapePowerShellSingleQuoted(process.cwd().toLowerCase());
  const psScriptName = escapePowerShellSingleQuoted(definition.psScriptName.toLowerCase());
  const cmdScriptName = escapePowerShellSingleQuoted(definition.cmdScriptName.toLowerCase());
  const portText = String(port);
  const command = `
$root = '${root}'
$psScript = '${psScriptName}'
$cmdScript = '${cmdScriptName}'
$port = '${portText}'
$matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $line = ([string]$_.CommandLine).ToLowerInvariant()
  $line.Contains($root) -and
    ($line.Contains($psScript) -or $line.Contains($cmdScript)) -and
    ($line.Contains("-port $port") -or $line.Contains("--port $port") -or $line.Contains("--port=$port") -or $line.Contains($cmdScript))
})
if ($matches.Count -gt 0) { "1" } else { "0" }
`.trim();

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    return stdout.trim() === '1';
  } catch (error) {
    log.debug(`Failed to inspect ${service} startup processes`, error);
    return false;
  }
}

async function waitForExistingStartupProcess(
  service: LocalModelServiceId,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  if (!(await hasExistingStartupProcess(service, port))) {
    return false;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await testLocalModelServiceListening(service, port)) {
      return true;
    }

    if (!(await hasExistingStartupProcess(service, port))) {
      return false;
    }

    await delay(EXISTING_PROCESS_WAIT_POLL_MS);
  }

  return false;
}

async function spawnLocalModelService(
  service: LocalModelServiceId,
  port: number,
  timeoutMs: number,
): Promise<EnsureLocalModelServiceResult> {
  if (process.platform !== 'win32') {
    return spawnWslNativeLocalModelService(service, port, timeoutMs);
  }

  const definition = serviceDefinitions[service];
  const root = process.cwd();
  const psScriptPath = path.join(root, 'scripts', definition.psScriptName);
  const stdoutPath = path.join(root, `bingo-${definition.logName}.log`);
  const stderrPath = path.join(root, `bingo-${definition.logName}.err.log`);

  if (definition.wsl) {
    if (process.platform !== 'win32') {
      throw new Error('WSL local model service startup is only implemented from Windows.');
    }
    if (!fs.existsSync(psScriptPath)) {
      throw new Error(`${service} startup script not found: ${psScriptPath}`);
    }

    const wslDistro = process.env.BINGO_WSL_DISTRO?.trim();
    const scriptArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      psScriptPath,
      '-Port',
      String(port),
      ...(wslDistro ? ['-Distro', wslDistro] : []),
    ];
    const scriptArgsLiteral = scriptArgs.map(powerShellSingleQuoted).join(', ');
    const startCommand = `
$ErrorActionPreference = "Stop"
$env:BINGO_LOCAL_MODEL_RUNTIME = "rocm"
$env:BINGO_REQUIRE_ROCM = "1"
$process = Start-Process -FilePath "powershell.exe" -ArgumentList @(${scriptArgsLiteral}) -WorkingDirectory ${powerShellSingleQuoted(root)} -WindowStyle Hidden -RedirectStandardOutput ${powerShellSingleQuoted(stdoutPath)} -RedirectStandardError ${powerShellSingleQuoted(stderrPath)} -PassThru
$process.Id
`.trim();

    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', startCommand],
      {
        cwd: root,
        env: {
          ...process.env,
          BINGO_LOCAL_MODEL_RUNTIME: 'rocm',
          BINGO_REQUIRE_ROCM: '1',
        },
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 64 * 1024,
      },
    );
    const processId = stdout.trim();
    log.info(`Started ${service} local service launcher${processId ? ` (PID ${processId})` : ''}.`);

    await waitForServicePort(service, port, timeoutMs);

    return {
      service,
      port,
      started: true,
      baseUrl: await resolveReachableLocalModelServiceBaseUrl(service, `http://localhost:${port}`),
    };
  }

  if (!fs.existsSync(psScriptPath)) {
    throw new Error(`Local model service startup script not found: ${psScriptPath}`);
  }

  let stdoutFd: number | undefined;
  let stderrFd: number | undefined;
  try {
    stdoutFd = fs.openSync(stdoutPath, 'a');
    stderrFd = fs.openSync(stderrPath, 'a');

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath, '-Port', String(port)],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
        windowsHide: true,
      },
    );

    let childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    child.once('exit', (code, signal) => {
      childExit = { code, signal };
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        closeFd(stdoutFd);
        closeFd(stderrFd);
        stdoutFd = undefined;
        stderrFd = undefined;
        callback();
      };

      child.once('spawn', () => settle(resolve));
      child.once('error', (error) => settle(() => reject(error)));
    });

    child.unref();
    await waitForServicePort(service, port, timeoutMs, () =>
      childExit && (childExit.code !== 0 || childExit.signal)
        ? `${service} startup process exited before port ${port} was ready (code=${childExit.code}, signal=${childExit.signal ?? 'none'}). Check ${stderrPath}.`
        : undefined,
    );

    return {
      service,
      port,
      started: true,
      baseUrl: await resolveReachableLocalModelServiceBaseUrl(service, `http://localhost:${port}`),
    };
  } finally {
    closeFd(stdoutFd);
    closeFd(stderrFd);
  }
}

export async function ensureLocalModelServiceRunning(
  service: LocalModelServiceId,
  options: EnsureLocalModelServiceOptions = {},
): Promise<EnsureLocalModelServiceResult> {
  if (service === 'embedding') await ensureOptionalChineseXinhuaData();
  const definition = serviceDefinitions[service];
  const port = options.port ?? definition.defaultPort;
  const timeoutMs = getStartTimeoutMs(options.timeoutMs);

  if (await testLocalModelServiceListening(service, port)) {
    return {
      service,
      port,
      started: false,
      baseUrl: await resolveReachableLocalModelServiceBaseUrl(service, `http://localhost:${port}`),
    };
  }

  const key = `${service}:${port}`;
  const startPromises = getStartPromises();
  const existingStart = startPromises.get(key);
  if (existingStart) {
    return existingStart;
  }

  if (
    !options.skipExistingStartupProcessWait &&
    (await waitForExistingStartupProcess(service, port, timeoutMs))
  ) {
    return {
      service,
      port,
      started: false,
      baseUrl: await resolveReachableLocalModelServiceBaseUrl(service, `http://localhost:${port}`),
    };
  }

  const startPromise = spawnLocalModelService(service, port, timeoutMs);
  startPromises.set(key, startPromise);
  try {
    return await startPromise;
  } finally {
    startPromises.delete(key);
  }
}

export async function startLocalModelService(
  service: LocalModelServiceId,
  options: EnsureLocalModelServiceOptions = {},
): Promise<EnsureLocalModelServiceResult> {
  if (service === 'embedding') await ensureOptionalChineseXinhuaData();
  const definition = serviceDefinitions[service];
  const port = options.port ?? definition.defaultPort;
  const timeoutMs = getStartTimeoutMs(options.timeoutMs);
  const key = `${service}:${port}`;
  const startPromises = getStartPromises();
  const existingStart = startPromises.get(key);
  if (existingStart) {
    return existingStart;
  }

  const startPromise = spawnLocalModelService(service, port, timeoutMs);
  startPromises.set(key, startPromise);
  try {
    return await startPromise;
  } finally {
    startPromises.delete(key);
  }
}

export async function releaseLocalModelServices(
  services: LocalModelServiceId[],
): Promise<ReleaseLocalModelServicesResult> {
  const normalizedServices = normalizeServices(services);
  if (normalizedServices.length === 0) {
    return { services: [], released: true };
  }

  if (process.platform !== 'win32') {
    return releaseUnixLocalModelServices(normalizedServices);
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'release-local-model-services.ps1');
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const errors: string[] = [];

  for (const service of normalizedServices) {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Service',
      service,
    ];

    try {
      const { stdout, stderr } = await execFileAsync('powershell.exe', args, {
        cwd: process.cwd(),
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });

      if (stdout.trim()) {
        stdoutParts.push(stdout);
        log.info(stdout.trim());
      }
      if (stderr.trim()) {
        stderrParts.push(stderr);
        log.warn(stderr.trim());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const details = error as Partial<{ stdout: string; stderr: string }>;
      if (details.stdout?.trim()) stdoutParts.push(details.stdout);
      if (details.stderr?.trim()) stderrParts.push(details.stderr);
      errors.push(`${service}: ${message}`);
      log.warn(`Failed to release local model service: ${service}`, error);
    }
  }

  const stdout = stdoutParts.join('\n');
  const stderr = stderrParts.join('\n');
  return {
    services: normalizedServices,
    released: errors.length === 0,
    stdout,
    stderr,
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  };
}

export async function releaseLocalModelServicesSafely(
  services: LocalModelServiceId[],
): Promise<void> {
  const result = await releaseLocalModelServices(services);
  if (!result.released) {
    log.warn(
      `Local model service release did not complete: ${services.join(', ')}${result.error ? ` (${result.error})` : ''}`,
    );
  }
}

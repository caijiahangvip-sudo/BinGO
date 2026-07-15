import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type GpuVendor = 'amd' | 'nvidia' | 'unknown';
export type GpuRuntime = 'rocm-wsl' | 'cuda-windows' | 'none';

export interface CommandStatus {
  available: boolean;
  output: string;
}

export interface GpuStatus extends CommandStatus {
  vendor: GpuVendor;
  runtime: GpuRuntime;
  name: string;
  configured: boolean;
  amdDetected: boolean;
  nvidiaDetected: boolean;
}

interface CommandResult {
  ok: boolean;
  output: string;
}

async function runCommand(
  command: string,
  args: string[],
  timeout: number,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, output: `${result.stdout || result.stderr}`.trim() };
  } catch (error) {
    const processError = error as Error & { stdout?: string; stderr?: string };
    const output = `${processError.stdout || processError.stderr || processError.message}`.trim();
    return { ok: false, output };
  }
}

export function parseRocmProbe(output: string): { ready: boolean; name: string; version: string } {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  return {
    ready: values.get('ROCM_READY') === '1',
    name: values.get('GPU_NAME') || '',
    version: values.get('ROCM_VERSION') || '',
  };
}

export function hasAmdDisplayAdapter(output: string): boolean {
  return /VEN_1002/i.test(output) || /\bAMD\b|Advanced Micro Devices|Radeon/i.test(output);
}

function getWslDistroArgs(): string[] {
  const distro = process.env.BINGO_WSL_DISTRO?.trim();
  return distro ? ['-d', distro] : [];
}

async function probeRocmInWsl(): Promise<CommandResult> {
  const script = [
    'set +e',
    'ROCM_OUT="$(rocminfo 2>&1)"',
    'ROCM_CODE=$?',
    'GPU_NAME="$(printf "%s\\n" "$ROCM_OUT" | sed -n "s/^[[:space:]]*Marketing Name:[[:space:]]*\\(AMD Radeon.*\\)$/\\1/p" | head -n 1 | sed "s/[[:space:]]*$//")"',
    'ROCM_VERSION="$(dpkg-query -W -f=\'${Version}\' rocm-core 2>/dev/null || true)"',
    'if [ "$ROCM_CODE" -eq 0 ] && [ -n "$GPU_NAME" ]; then ROCM_READY=1; else ROCM_READY=0; fi',
    'printf "ROCM_READY=%s\\nGPU_NAME=%s\\nROCM_VERSION=%s\\n" "$ROCM_READY" "$GPU_NAME" "$ROCM_VERSION"',
    'if [ "$ROCM_READY" -ne 1 ]; then printf "%s\\n" "$ROCM_OUT" | tail -n 20; fi',
  ].join('\n');

  return runCommand('wsl.exe', [...getWslDistroArgs(), '--exec', 'bash', '-lc', script], 15_000);
}

export async function getLocalRuntimeDiagnostics(): Promise<{
  wsl: CommandStatus;
  gpu: GpuStatus;
}> {
  if (process.platform !== 'win32') {
    return {
      wsl: { available: false, output: 'WSL diagnostics are only available on Windows.' },
      gpu: {
        available: false,
        output: 'Desktop GPU diagnostics are only available on Windows.',
        vendor: 'unknown',
        runtime: 'none',
        name: '',
        configured: false,
        amdDetected: false,
        nvidiaDetected: false,
      },
    };
  }

  const [wslResult, nvidiaResult, displayResult] = await Promise.all([
    runCommand('wsl.exe', ['--status'], 8_000),
    runCommand('nvidia-smi.exe', ['--query-gpu=name,memory.total', '--format=csv,noheader'], 8_000),
    runCommand('pnputil.exe', ['/enum-devices', '/class', 'Display', '/connected'], 8_000),
  ]);
  const amdDetected = hasAmdDisplayAdapter(displayResult.output);
  const nvidiaDetected = nvidiaResult.ok && nvidiaResult.output.length > 0;
  const rocmResult =
    wslResult.ok && amdDetected ? await probeRocmInWsl() : { ok: false, output: '' };
  const rocm = parseRocmProbe(rocmResult.output);

  if (rocm.ready) {
    const version = rocm.version ? `ROCm ${rocm.version}` : 'ROCm/HIP';
    return {
      wsl: { available: true, output: 'WSL2 is available.' },
      gpu: {
        available: true,
        output: `${rocm.name} · ${version}`,
        vendor: 'amd',
        runtime: 'rocm-wsl',
        name: rocm.name,
        configured: true,
        amdDetected: true,
        nvidiaDetected,
      },
    };
  }

  if (nvidiaDetected) {
    const name = nvidiaResult.output.split(/\r?\n/)[0]?.trim() || 'NVIDIA GPU';
    return {
      wsl: {
        available: wslResult.ok,
        output: wslResult.ok ? 'WSL2 is available.' : wslResult.output,
      },
      gpu: {
        available: true,
        output: name,
        vendor: 'nvidia',
        runtime: 'cuda-windows',
        name,
        configured: true,
        amdDetected,
        nvidiaDetected: true,
      },
    };
  }

  if (amdDetected) {
    return {
      wsl: {
        available: wslResult.ok,
        output: wslResult.ok ? 'WSL2 is available.' : wslResult.output,
      },
      gpu: {
        available: false,
        output: rocmResult.output || 'AMD GPU detected, but ROCm/HIP is not ready in WSL.',
        vendor: 'amd',
        runtime: 'none',
        name: 'AMD Radeon GPU',
        configured: false,
        amdDetected: true,
        nvidiaDetected: false,
      },
    };
  }

  return {
    wsl: {
      available: wslResult.ok,
      output: wslResult.ok ? 'WSL2 is available.' : wslResult.output,
    },
    gpu: {
      available: false,
      output: 'No supported AMD ROCm or NVIDIA CUDA GPU detected.',
      vendor: 'unknown',
      runtime: 'none',
      name: '',
      configured: false,
      amdDetected: false,
      nvidiaDetected: false,
    },
  };
}

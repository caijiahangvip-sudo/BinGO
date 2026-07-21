import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  ensureLocalModelServiceRunning,
  releaseLocalModelServicesSafely,
} from '@/lib/server/local-model-services';
import { createLogger } from '@/lib/logger';

const log = createLogger('SenseVoiceStart');

const SENSEVOICE_DEFAULT_PORT = 50001;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const WARMUP_WAIT_MAX_ATTEMPTS = 30;
const WARMUP_WAIT_INTERVAL_MS = 1000;

function resolveSenseVoicePort(): number {
  const envValue = Number.parseInt(process.env.SENSEVOICE_PORT ?? '', 10);
  return Number.isFinite(envValue) && envValue > 0 ? envValue : SENSEVOICE_DEFAULT_PORT;
}

function resolveSenseVoiceBaseUrl(): string {
  return `http://localhost:${resolveSenseVoicePort()}`;
}

async function checkSenseVoiceHealth(): Promise<{ running: boolean; warmed: boolean }> {
  try {
    const response = await fetch(`${resolveSenseVoiceBaseUrl()}/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return { running: false, warmed: false };
    const health = await response.json();
    return { running: true, warmed: health.warmed === true };
  } catch {
    return { running: false, warmed: false };
  }
}

async function waitForWarmup(): Promise<boolean> {
  for (let attempt = 0; attempt < WARMUP_WAIT_MAX_ATTEMPTS; attempt++) {
    const status = await checkSenseVoiceHealth();
    if (status.running && status.warmed) return true;
    if (!status.running) return false;
    await new Promise((resolve) => setTimeout(resolve, WARMUP_WAIT_INTERVAL_MS));
  }
  return false;
}

export async function POST() {
  try {
    // 1. 先检查是否已在运行且已预热
    const initialStatus = await checkSenseVoiceHealth();
    if (initialStatus.running && initialStatus.warmed) {
      return apiSuccess({ started: false, warmed: true, message: 'SenseVoice is already running and warmed' });
    }

    // 2. 启动服务
    const port = resolveSenseVoicePort();
    log.info(`Starting SenseVoice on port ${port}...`);
    await ensureLocalModelServiceRunning('sensevoice', { port, timeoutMs: 120_000 });

    // 3. 等待预热完成
    const warmed = await waitForWarmup();
    if (warmed) {
      return apiSuccess({ started: true, warmed: true, message: 'SenseVoice started and warmed' });
    }

    // 4. 首次启动失败——清理遗留进程后重试
    log.warn('SenseVoice did not warm up after first start; cleaning up and retrying.');
    await releaseLocalModelServicesSafely(['sensevoice']);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await ensureLocalModelServiceRunning('sensevoice', { port, timeoutMs: 120_000 });
    const warmedOnRetry = await waitForWarmup();
    if (warmedOnRetry) {
      return apiSuccess({ started: true, warmed: true, message: 'SenseVoice started after cleanup' });
    }

    return apiError('SERVICE_UNAVAILABLE', 500, 'SenseVoice 启动失败，请检查 WSL 和 ROCm 环境。');
  } catch (error) {
    log.error('Failed to start SenseVoice:', error);
    return apiError(
      'SERVICE_UNAVAILABLE',
      500,
      'SenseVoice 启动失败',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

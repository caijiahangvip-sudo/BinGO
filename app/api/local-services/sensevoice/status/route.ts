import { apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('SenseVoiceStatus');

const SENSEVOICE_DEFAULT_PORT = 50001;

function resolveSenseVoiceBaseUrl(): string {
  const port = process.env.SENSEVOICE_PORT || SENSEVOICE_DEFAULT_PORT;
  return `http://localhost:${port}`;
}

export async function GET() {
  const baseUrl = resolveSenseVoiceBaseUrl();
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return apiSuccess({ running: false, warmed: false });
    }
    const health = await response.json();
    return apiSuccess({
      running: true,
      warmed: health.warmed === true,
      model: health.model,
    });
  } catch (error) {
    log.debug('SenseVoice health check failed:', error);
    return apiSuccess({ running: false, warmed: false });
  }
}

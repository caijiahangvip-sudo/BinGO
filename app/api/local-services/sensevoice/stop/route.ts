import { apiError, apiSuccess } from '@/lib/server/api-response';
import { releaseLocalModelServicesSafely } from '@/lib/server/local-model-services';
import { createLogger } from '@/lib/logger';

const log = createLogger('SenseVoiceStop');

export async function POST() {
  try {
    log.info('Stopping SenseVoice...');
    const result = await releaseLocalModelServicesSafely(['sensevoice']);
    return apiSuccess({
      released: result.released,
      message: result.released
        ? 'SenseVoice stopped'
        : 'SenseVoice was not running',
    });
  } catch (error) {
    log.error('Failed to stop SenseVoice:', error);
    return apiError(
      'SERVICE_UNAVAILABLE',
      500,
      'SenseVoice 停止失败',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

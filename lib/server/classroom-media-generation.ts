/**
 * Server-side TTS generation for classrooms.
 *
 * Generates TTS audio for a classroom, writes it to disk, and stores serving URLs
 * on speech actions. AI image and video generation are intentionally not part of
 * Bingo anymore.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_VOICES, DEFAULT_TTS_MODELS, TTS_PROVIDERS } from '@/lib/audio/constants';
import {
  getServerTTSProviders,
  resolveTTSApiKey,
  resolveTTSBaseUrl,
} from '@/lib/server/provider-config';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { TTSProviderId } from '@/lib/audio/types';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import { normalizeAudioFormat } from '@/lib/audio/mime';
import { releaseLocalModelServicesSafely } from '@/lib/server/local-model-services';

const log = createLogger('ClassroomMedia');
const TTS_RETRY_DELAY_MS = 1500;

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mediaServingUrl(baseUrl: string, classroomId: string, subPath: string): string {
  return `${baseUrl}/api/classroom-media/${classroomId}/${subPath}`;
}

export async function generateTTSForClassroom(
  scenes: Scene[],
  classroomId: string,
  baseUrl: string,
): Promise<void> {
  const audioDir = path.join(CLASSROOMS_DIR, classroomId, 'audio');
  await ensureDir(audioDir);

  const ttsProviderIds = Object.keys(getServerTTSProviders()).filter(
    (id) => id !== 'browser-native-tts',
  );
  if (ttsProviderIds.length === 0) {
    log.warn('No server TTS provider configured, skipping TTS generation');
    return;
  }

  const providerId = ttsProviderIds[0] as TTSProviderId;
  const apiKey = resolveTTSApiKey(providerId);
  if (!apiKey) {
    log.warn(`No API key for TTS provider "${providerId}", skipping TTS generation`);
    return;
  }

  const ttsBaseUrl = resolveTTSBaseUrl(providerId) || TTS_PROVIDERS[providerId]?.defaultBaseUrl;
  const voice = DEFAULT_TTS_VOICES[providerId] || 'default';
  try {
    for (const scene of scenes) {
      if (!scene.actions) continue;

      scene.actions = splitLongSpeechActions(scene.actions, providerId);

      for (const action of scene.actions) {
        if (action.type !== 'speech' || !(action as SpeechAction).text) continue;
        const speechAction = action as SpeechAction;
        const audioId = `tts_${action.id}`;
        let generated = false;

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const result = await generateTTS(
              {
                providerId,
                modelId: DEFAULT_TTS_MODELS[providerId] || '',
                apiKey,
                baseUrl: ttsBaseUrl,
                voice,
                speed: speechAction.speed,
              },
              speechAction.text,
            );

            const format = normalizeAudioFormat(result.format);
            const filename = `${audioId}.${format}`;
            await fs.writeFile(path.join(audioDir, filename), result.audio);

            speechAction.audioId = audioId;
            speechAction.audioUrl = mediaServingUrl(baseUrl, classroomId, `audio/${filename}`);
            log.info(`Generated TTS: ${filename} (${result.audio.length} bytes)`);
            generated = true;
            break;
          } catch (err) {
            if (attempt < 2) {
              log.warn(`TTS generation failed for action ${action.id}, retrying once:`, err);
              await waitForRetry(TTS_RETRY_DELAY_MS);
              continue;
            }

            log.warn(`TTS generation failed for action ${action.id} after retry:`, err);
          }
        }

        if (!generated) speechAction.audioId = undefined;
      }
    }
  } finally {
    if (providerId === 'cosyvoice-tts') {
      await releaseLocalModelServicesSafely(['cosyvoice']);
    }
  }
}

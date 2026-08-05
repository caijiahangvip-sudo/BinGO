import type { TTSProviderId } from '@/lib/audio/types';
import { getRuntimePlatform } from './platform';

export type ModelExecutionTarget = 'windows-local-service' | 'cloud-api';

export function getModelExecutionTarget(): ModelExecutionTarget {
  return getRuntimePlatform() === 'desktop'
    ? 'windows-local-service'
    : 'cloud-api';
}

export function assertTtsProviderAllowed(providerId: TTSProviderId): void {
  if (getRuntimePlatform() === 'ipados' && providerId === 'browser-native-tts') return;
}

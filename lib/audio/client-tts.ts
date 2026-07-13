'use client';

import { generateTTS } from '@/lib/audio/tts-providers';
import { createAudioBlob, normalizeAudioFormat } from '@/lib/audio/mime';
import type { TTSModelConfig, TTSProviderId } from '@/lib/audio/types';

export interface RequestTTSParams {
  text: string;
  audioId: string;
  ttsProviderId: TTSProviderId;
  ttsCompatibleProviderId?: TTSProviderId;
  ttsModelId?: string;
  ttsVoice: string;
  ttsSpeed?: number;
  ttsApiKey?: string;
  ttsBaseUrl?: string;
  ttsProviderOptions?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface RequestTTSResult {
  success: boolean;
  format: string;
  blob: Blob;
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function base64ToBlob(base64: string, format: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return createAudioBlob(bytes, format);
}

export async function requestTTS(params: RequestTTSParams): Promise<RequestTTSResult> {
  const runtimeProviderId = params.ttsCompatibleProviderId || params.ttsProviderId;
  if (runtimeProviderId === 'browser-native-tts') {
    throw new Error('Browser native TTS must be handled by the Web Speech API');
  }

  if (isTauriRuntime()) {
    const config: TTSModelConfig = {
      providerId: runtimeProviderId,
      modelId: params.ttsModelId,
      apiKey: params.ttsApiKey,
      baseUrl: params.ttsBaseUrl,
      voice: params.ttsVoice,
      speed: params.ttsSpeed,
      format: 'mp3',
      providerOptions: params.ttsProviderOptions,
    };
    const result = await generateTTS(config, params.text);
    const audioBytes = new Uint8Array(result.audio);
    const format = normalizeAudioFormat(result.format);
    return {
      success: true,
      format,
      blob: createAudioBlob(audioBytes, format),
    };
  }

  const response = await fetch('/api/generate/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: params.text,
      audioId: params.audioId,
      ttsProviderId: params.ttsProviderId,
      ttsCompatibleProviderId: runtimeProviderId,
      ttsModelId: params.ttsModelId,
      ttsVoice: params.ttsVoice,
      ttsSpeed: params.ttsSpeed,
      ttsApiKey: params.ttsApiKey,
      ttsBaseUrl: params.ttsBaseUrl,
      ttsProviderOptions: params.ttsProviderOptions,
    }),
    signal: params.signal,
  });

  const data = await response
    .json()
    .catch(() => ({ success: false, error: response.statusText || 'Invalid TTS response' }));

  if (!response.ok || !data.success || !data.base64 || !data.format) {
    throw new Error(data.details || data.error || `TTS request failed: HTTP ${response.status}`);
  }

  const format = normalizeAudioFormat(data.format);
  return {
    success: true,
    format,
    blob: base64ToBlob(data.base64, format),
  };
}

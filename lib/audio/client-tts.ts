'use client';

import { generateTTS } from '@/lib/audio/tts-providers';
import { createAudioBlob, normalizeAudioFormat } from '@/lib/audio/mime';
import type { TTSModelConfig, TTSProviderId } from '@/lib/audio/types';
import { getRuntimePlatform, isTauriRuntime } from '@/lib/runtime/platform';
import { assertTtsProviderAllowed } from '@/lib/runtime/model-routing';
import { resolveRuntimeTtsProvider } from '@/lib/runtime/audio-routing';

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

function base64ToBlob(base64: string, format: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return createAudioBlob(bytes, format);
}

export async function requestTTS(params: RequestTTSParams): Promise<RequestTTSResult> {
  const runtimeProviderId = resolveRuntimeTtsProvider(
    params.ttsProviderId,
    params.ttsCompatibleProviderId || params.ttsProviderId,
  );
  assertTtsProviderAllowed(runtimeProviderId);
  if (runtimeProviderId === 'browser-native-tts') {
    throw new Error('Browser native TTS returns no audio file; use speakTextLocally() instead');
  }

  if (isTauriRuntime() && getRuntimePlatform() !== 'ipados') {
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

export interface LocalSpeechOptions {
  text: string;
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export function isLocalSpeechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

export function cancelLocalSpeech(): void {
  if (isLocalSpeechAvailable()) window.speechSynthesis.cancel();
}

export function speakTextLocally(options: LocalSpeechOptions): Promise<void> {
  if (!isLocalSpeechAvailable()) {
    return Promise.reject(new Error('当前设备不支持本地语音合成'));
  }

  cancelLocalSpeech();
  const utterance = new SpeechSynthesisUtterance(options.text);
  utterance.rate = Math.min(10, Math.max(0.1, options.rate ?? 1));
  utterance.pitch = Math.min(2, Math.max(0, options.pitch ?? 1));
  utterance.volume = Math.min(1, Math.max(0, options.volume ?? 1));

  if (options.voice) {
    const voice = window.speechSynthesis
      .getVoices()
      .find(
        (candidate) => candidate.voiceURI === options.voice || candidate.name === options.voice,
      );
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
  }

  return new Promise((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error || '本地语音合成失败'));
    window.speechSynthesis.speak(utterance);
  });
}

import { describe, expect, it } from 'vitest';
import {
  getSpeechRecognitionErrorMessage,
  resolveRuntimeAsrProvider,
  resolveRuntimeTtsProvider,
} from '@/lib/runtime/audio-routing';

describe('iPad audio routing', () => {
  it('overrides saved server ASR settings on iPad', () => {
    expect(resolveRuntimeAsrProvider('sensevoice-asr', 'sensevoice-asr', 'ipados')).toBe(
      'browser-native',
    );
  });

  it('overrides saved server TTS settings on iPad', () => {
    expect(resolveRuntimeTtsProvider('cosyvoice-tts', 'cosyvoice-tts', 'ipados')).toBe(
      'browser-native-tts',
    );
  });

  it('keeps Windows providers unchanged', () => {
    expect(resolveRuntimeAsrProvider('sensevoice-asr', 'sensevoice-asr', 'desktop')).toBe(
      'sensevoice-asr',
    );
    expect(resolveRuntimeTtsProvider('cosyvoice-tts', 'cosyvoice-tts', 'desktop')).toBe(
      'cosyvoice-tts',
    );
  });

  it('maps permission and microphone errors to actionable messages', () => {
    expect(getSpeechRecognitionErrorMessage('not-allowed')).toContain('iPad 设置');
    expect(getSpeechRecognitionErrorMessage('audio-capture')).toContain('系统权限');
    expect(getSpeechRecognitionErrorMessage('aborted')).toBeNull();
  });
});

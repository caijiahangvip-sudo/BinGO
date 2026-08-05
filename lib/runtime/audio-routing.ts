import type { ASRProviderId, TTSProviderId } from '@/lib/audio/types';
import type { BinGoRuntimePlatform } from './platform';
import { getRuntimePlatform } from './platform';

export function resolveRuntimeAsrProvider(
  configuredProviderId: ASRProviderId,
  compatibleProviderId: ASRProviderId,
  platform: BinGoRuntimePlatform = getRuntimePlatform(),
): ASRProviderId {
  return platform === 'ipados' ? 'browser-native' : compatibleProviderId || configuredProviderId;
}

export function resolveRuntimeTtsProvider(
  configuredProviderId: TTSProviderId,
  compatibleProviderId: TTSProviderId,
  platform: BinGoRuntimePlatform = getRuntimePlatform(),
): TTSProviderId {
  return platform === 'ipados'
    ? 'browser-native-tts'
    : compatibleProviderId || configuredProviderId;
}

export function getSpeechRecognitionErrorMessage(error: string): string | null {
  switch (error) {
    case 'aborted':
      return null;
    case 'no-speech':
      return '未检测到语音输入';
    case 'audio-capture':
      return '无法访问麦克风，请检查设备和系统权限';
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风或语音识别权限被拒绝，请在 iPad 设置中允许 BinGO 使用麦克风和语音识别';
    case 'network':
      return '系统语音识别暂时不可用';
    default:
      return `语音识别错误: ${error}`;
  }
}

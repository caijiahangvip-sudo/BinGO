import type { TTSVoiceInfo } from './types';

export const COSYVOICE_DEFAULT_PROMPT_PREFIX = 'You are a helpful assistant.<|endofprompt|>';
export const COSYVOICE_DEFAULT_READ_TEXT = '希望你以后能够做的比我还好呦。';
export const COSYVOICE_DEFAULT_PROMPT_TEXT = `${COSYVOICE_DEFAULT_PROMPT_PREFIX}${COSYVOICE_DEFAULT_READ_TEXT}`;
export const COSYVOICE_DEFAULT_VOICE_ID = 'zero_shot_prompt';

export interface CosyVoiceCloneVoice {
  id: string;
  name: string;
  promptText: string;
  promptAudioPath: string;
  createdAt: number;
  audioSize?: number;
}

export interface CosyVoiceProviderOptions {
  selectedCloneVoiceId?: string;
  cloneVoices?: CosyVoiceCloneVoice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function formatCosyVoicePromptText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return COSYVOICE_DEFAULT_PROMPT_TEXT;
  return trimmed.includes('<|endofprompt|>')
    ? trimmed
    : `${COSYVOICE_DEFAULT_PROMPT_PREFIX}${trimmed}`;
}

export function getCosyVoiceProviderOptions(value: unknown): CosyVoiceProviderOptions {
  if (!isRecord(value)) return {};
  const selectedCloneVoiceId =
    typeof value.selectedCloneVoiceId === 'string' ? value.selectedCloneVoiceId : undefined;
  const cloneVoices = Array.isArray(value.cloneVoices)
    ? value.cloneVoices
        .filter(isRecord)
        .map((voice): CosyVoiceCloneVoice | null => {
          if (
            typeof voice.id !== 'string' ||
            typeof voice.name !== 'string' ||
            typeof voice.promptText !== 'string' ||
            typeof voice.promptAudioPath !== 'string'
          ) {
            return null;
          }

          return {
            id: voice.id,
            name: voice.name,
            promptText: voice.promptText,
            promptAudioPath: voice.promptAudioPath,
            createdAt: typeof voice.createdAt === 'number' ? voice.createdAt : Date.now(),
            audioSize: typeof voice.audioSize === 'number' ? voice.audioSize : undefined,
          };
        })
        .filter((voice): voice is CosyVoiceCloneVoice => !!voice)
    : undefined;

  return {
    ...(selectedCloneVoiceId ? { selectedCloneVoiceId } : {}),
    ...(cloneVoices ? { cloneVoices } : {}),
  };
}

export function getCosyVoiceCloneVoices(value: unknown): CosyVoiceCloneVoice[] {
  return getCosyVoiceProviderOptions(value).cloneVoices || [];
}

export function getCosyVoiceCloneVoiceOptions(value: unknown): TTSVoiceInfo[] {
  return getCosyVoiceCloneVoices(value).map((voice) => ({
    id: voice.id,
    name: voice.name,
    language: 'zh-CN',
    gender: 'neutral',
  }));
}

export function findCosyVoiceCloneVoice(
  providerOptions: unknown,
  voiceId?: string,
): CosyVoiceCloneVoice | undefined {
  const options = getCosyVoiceProviderOptions(providerOptions);
  const targetVoiceId =
    voiceId && voiceId !== COSYVOICE_DEFAULT_VOICE_ID ? voiceId : options.selectedCloneVoiceId;
  if (!targetVoiceId || targetVoiceId === COSYVOICE_DEFAULT_VOICE_ID) return undefined;
  return (options.cloneVoices || []).find((voice) => voice.id === targetVoiceId);
}

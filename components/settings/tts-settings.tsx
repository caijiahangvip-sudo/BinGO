'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { TTS_PROVIDERS, getDefaultTTSVoice } from '@/lib/audio/constants';
import type { TTSProviderId } from '@/lib/audio/types';
import {
  Volume2,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Mic,
  Square,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { useTTSPreview } from '@/lib/audio/use-tts-preview';
import {
  COSYVOICE_DEFAULT_READ_TEXT,
  COSYVOICE_DEFAULT_VOICE_ID,
  getCosyVoiceProviderOptions,
  type CosyVoiceCloneVoice,
} from '@/lib/audio/cosyvoice-clone';
import { ServiceModelManager, type ServiceModelInfo } from './service-model-manager';
import {
  fetchWithSettingsTimeout,
  getAbortErrorMessage,
  isAbortError,
  LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
  type SettingsTestOptions,
} from './utils';

const log = createLogger('TTSSettings');

const RECORDING_SAMPLE_RATE = 24000;

interface TTSSettingsProps {
  selectedProviderId: TTSProviderId;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const length = buffer.length;
  const dataLength = length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);
  const channel = buffer.getChannelData(0);
  let offset = 0;

  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
    offset += value.length;
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataLength, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, buffer.sampleRate, true);
  offset += 4;
  view.setUint32(offset, buffer.sampleRate * 2, true);
  offset += 4;
  view.setUint16(offset, 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataLength, true);
  offset += 4;

  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

async function blobToWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('AudioContext is not supported');
  }
  const context = new AudioContextCtor({ sampleRate: RECORDING_SAMPLE_RATE });
  try {
    const sourceBuffer = await blob.arrayBuffer();
    const decoded = await context.decodeAudioData(sourceBuffer.slice(0));
    if (decoded.sampleRate === RECORDING_SAMPLE_RATE && decoded.numberOfChannels === 1) {
      return audioBufferToWav(decoded);
    }

    const offlineContext = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * RECORDING_SAMPLE_RATE),
      RECORDING_SAMPLE_RATE,
    );
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start(0);
    const rendered = await offlineContext.startRendering();
    return audioBufferToWav(rendered);
  } finally {
    void context.close();
  }
}

export function TTSSettings({ selectedProviderId }: TTSSettingsProps) {
  const { t } = useI18n();

  const ttsVoice = useSettingsStore((state) => state.ttsVoice);
  const ttsSpeed = useSettingsStore((state) => state.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((state) => state.ttsProvidersConfig);
  const setTTSProviderConfig = useSettingsStore((state) => state.setTTSProviderConfig);
  const setTTSVoice = useSettingsStore((state) => state.setTTSVoice);
  const activeProviderId = useSettingsStore((state) => state.ttsProviderId);
  const selectedProviderConfig = ttsProvidersConfig[selectedProviderId];
  const compatibleProviderId = selectedProviderConfig?.compatibleProviderId || selectedProviderId;
  const cosyVoiceOptions = getCosyVoiceProviderOptions(selectedProviderConfig?.providerOptions);
  const cosyVoiceCloneVoices = useMemo(
    () => cosyVoiceOptions.cloneVoices || [],
    [cosyVoiceOptions.cloneVoices],
  );
  const selectedCosyVoiceId = cosyVoiceOptions.selectedCloneVoiceId || COSYVOICE_DEFAULT_VOICE_ID;

  // When testing a non-active provider, use that provider's default voice
  // instead of the active provider's voice (which may be incompatible).
  const effectiveVoice =
    selectedProviderId === activeProviderId
      ? ttsVoice
      : getDefaultTTSVoice(
          compatibleProviderId,
          selectedProviderConfig?.modelId || TTS_PROVIDERS[compatibleProviderId]?.defaultModelId,
        );

  const ttsProvider = TTS_PROVIDERS[compatibleProviderId] ?? TTS_PROVIDERS['openai-tts'];
  const visibleModels = selectedProviderConfig?.models || [
    ...ttsProvider.models,
    ...(selectedProviderConfig?.customModels || []),
  ];
  const requiresApiKey = selectedProviderConfig?.requiresApiKey ?? ttsProvider.requiresApiKey;
  const isServerConfigured = !!selectedProviderConfig?.isServerConfigured;

  const [showApiKey, setShowApiKey] = useState(false);
  const [testText, setTestText] = useState(t('settings.ttsTestTextDefault'));
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const { previewing: testingTTS, startPreview, stopPreview } = useTTSPreview();
  const [cloneName, setCloneName] = useState('');
  const [clonePromptText, setClonePromptText] = useState(COSYVOICE_DEFAULT_READ_TEXT);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingError, setRecordingError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Doubao TTS uses compound "appId:accessKey" — split for separate UI fields
  const isDoubao = compatibleProviderId === 'doubao-tts';
  const rawApiKey = selectedProviderConfig?.apiKey || '';
  const doubaoColonIdx = rawApiKey.indexOf(':');
  const doubaoAppId = isDoubao && doubaoColonIdx > 0 ? rawApiKey.slice(0, doubaoColonIdx) : '';
  const doubaoAccessKey =
    isDoubao && doubaoColonIdx > 0
      ? rawApiKey.slice(doubaoColonIdx + 1)
      : isDoubao
        ? rawApiKey
        : '';

  const setDoubaoCompoundKey = (appId: string, accessKey: string) => {
    const combined = appId && accessKey ? `${appId}:${accessKey}` : appId || accessKey;
    setTTSProviderConfig(selectedProviderId, { apiKey: combined });
  };

  const handleModelsChange = useCallback(
    (models: ServiceModelInfo[]) => {
      setTTSProviderConfig(selectedProviderId, {
        models,
        customModels: [],
      });

      const currentModelId = selectedProviderConfig?.modelId || ttsProvider.defaultModelId;
      if (!models.some((model) => model.id === currentModelId)) {
        setTTSProviderConfig(selectedProviderId, { modelId: models[0]?.id || '' });
      }
    },
    [selectedProviderConfig?.modelId, selectedProviderId, setTTSProviderConfig, ttsProvider],
  );

  const handleSelectedModelChange = useCallback(
    (modelId: string) => {
      setTTSProviderConfig(selectedProviderId, { modelId });
    },
    [selectedProviderId, setTTSProviderConfig],
  );

  const handleTestModel = useCallback(
    async (model: ServiceModelInfo, options?: SettingsTestOptions) => {
      if (compatibleProviderId === 'browser-native-tts') {
        return {
          success: true,
          message: t('settings.connectionSuccess'),
        };
      }

      const response = await fetchWithSettingsTimeout('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options?.signal,
        body: JSON.stringify({
          text: t('settings.ttsTestTextDefault'),
          audioId: `test-${Date.now()}`,
          ttsProviderId: selectedProviderId,
          ttsCompatibleProviderId: compatibleProviderId,
          ttsModelId: model.id,
          ttsVoice: effectiveVoice,
          ttsSpeed,
          ttsApiKey: selectedProviderConfig?.apiKey,
          ttsBaseUrl: selectedProviderConfig?.baseUrl,
          localServiceStartupTimeoutMs: options?.localServiceStartupTimeoutMs,
        }),
      });
      const data = await response.json().catch(() => ({ error: response.statusText }));
      return {
        success: response.ok && !!data.success,
        message:
          data.message ||
          data.error ||
          (data.success ? t('settings.connectionSuccess') : t('settings.connectionFailed')),
      };
    },
    [
      compatibleProviderId,
      effectiveVoice,
      selectedProviderConfig?.apiKey,
      selectedProviderConfig?.baseUrl,
      selectedProviderId,
      t,
      ttsSpeed,
    ],
  );

  // Keep the sample text in sync with locale changes.
  useEffect(() => {
    setTestText(t('settings.ttsTestTextDefault'));
  }, [t]);

  // Reset transient UI state when switching providers.
  useEffect(() => {
    stopPreview();
    setShowApiKey(false);
    setTestStatus('idle');
    setTestMessage('');
    setRecordingState('idle');
    setRecordedBlob(null);
    setRecordingError('');
  }, [selectedProviderId, stopPreview]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const handleTestTTS = async () => {
    if (!testText.trim()) return;

    setTestStatus('testing');
    setTestMessage('');

    try {
      await startPreview({
        text: testText,
        providerId: selectedProviderId,
        compatibleProviderId,
        modelId: selectedProviderConfig?.modelId || ttsProvider.defaultModelId,
        voice: effectiveVoice,
        speed: ttsSpeed,
        apiKey: selectedProviderConfig?.apiKey,
        baseUrl: selectedProviderConfig?.baseUrl,
        providerOptions: selectedProviderConfig?.providerOptions,
        localServiceStartupTimeoutMs: LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
      });
      setTestStatus('success');
      setTestMessage(t('settings.ttsTestSuccess'));
    } catch (error) {
      log.error('TTS test failed:', error);
      setTestStatus('error');
      setTestMessage(
        isAbortError(error)
          ? getAbortErrorMessage(t)
          : error instanceof Error && error.message
          ? `${t('settings.ttsTestFailed')}: ${error.message}`
          : t('settings.ttsTestFailed'),
      );
    }
  };

  const updateCosyVoiceOptions = useCallback(
    (nextOptions: ReturnType<typeof getCosyVoiceProviderOptions>) => {
      setTTSProviderConfig(selectedProviderId, {
        providerOptions: {
          ...(selectedProviderConfig?.providerOptions || {}),
          ...nextOptions,
        },
      });
    },
    [selectedProviderConfig?.providerOptions, selectedProviderId, setTTSProviderConfig],
  );

  const handleCosyVoiceSelectionChange = useCallback(
    (voiceId: string) => {
      updateCosyVoiceOptions({ ...cosyVoiceOptions, selectedCloneVoiceId: voiceId });
      if (selectedProviderId === activeProviderId) {
        setTTSVoice(voiceId);
      }
    },
    [activeProviderId, cosyVoiceOptions, selectedProviderId, setTTSVoice, updateCosyVoiceOptions],
  );

  const handleStartCloneRecording = useCallback(async () => {
    setRecordingError('');
    setRecordedBlob(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecordedBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecordingState('idle');
      };

      recorder.start();
      setRecordingState('recording');
    } catch (error) {
      setRecordingState('idle');
      setRecordingError(
        error instanceof Error ? error.message : t('settings.microphoneAccessFailed'),
      );
    }
  }, [t]);

  const handleStopCloneRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleSaveCloneVoice = useCallback(async () => {
    const name = cloneName.trim();
    const promptText = clonePromptText.trim();
    if (!name || !promptText || !recordedBlob) return;

    setRecordingState('saving');
    setRecordingError('');
    try {
      const wavBlob = await blobToWav(recordedBlob);
      const formData = new FormData();
      formData.set('name', name);
      formData.set('promptText', promptText);
      formData.set('audio', wavBlob, `${name}.wav`);

      const response = await fetch('/api/cosyvoice/voices', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({ error: response.statusText }));
      if (!response.ok || !data.success || !data.voice) {
        throw new Error(data.error || 'Failed to save voice');
      }

      const voice = data.voice as CosyVoiceCloneVoice;
      const nextVoices = [...cosyVoiceCloneVoices.filter((item) => item.id !== voice.id), voice];
      updateCosyVoiceOptions({
        ...cosyVoiceOptions,
        selectedCloneVoiceId: voice.id,
        cloneVoices: nextVoices,
      });
      if (selectedProviderId === activeProviderId) {
        setTTSVoice(voice.id);
      }
      setCloneName('');
      setRecordedBlob(null);
      setRecordingState('idle');
    } catch (error) {
      setRecordingState('idle');
      setRecordingError(error instanceof Error ? error.message : String(error));
    }
  }, [
    cloneName,
    clonePromptText,
    cosyVoiceCloneVoices,
    cosyVoiceOptions,
    recordedBlob,
    activeProviderId,
    selectedProviderId,
    setTTSVoice,
    updateCosyVoiceOptions,
  ]);

  const handleDeleteCloneVoice = useCallback(
    (voiceId: string) => {
      const nextVoices = cosyVoiceCloneVoices.filter((voice) => voice.id !== voiceId);
      updateCosyVoiceOptions({
        ...cosyVoiceOptions,
        selectedCloneVoiceId:
          selectedCosyVoiceId === voiceId ? COSYVOICE_DEFAULT_VOICE_ID : selectedCosyVoiceId,
        cloneVoices: nextVoices,
      });
      if (selectedProviderId === activeProviderId && ttsVoice === voiceId) {
        setTTSVoice(COSYVOICE_DEFAULT_VOICE_ID);
      }
    },
    [
      activeProviderId,
      cosyVoiceCloneVoices,
      cosyVoiceOptions,
      selectedCosyVoiceId,
      selectedProviderId,
      setTTSVoice,
      ttsVoice,
      updateCosyVoiceOptions,
    ],
  );

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Server-configured notice */}
      {isServerConfigured && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
          {t('settings.serverConfiguredNotice')}
        </div>
      )}

      {/* API Key & Base URL */}
      {(requiresApiKey || isServerConfigured) && (
        <>
          <div className={cn('grid gap-4', isDoubao ? 'grid-cols-3' : 'grid-cols-2')}>
            {isDoubao ? (
              <>
                <div className="space-y-2">
                  <Label className="text-sm">{t('settings.doubaoAppId')}</Label>
                  <div className="relative">
                    <Input
                      name={`tts-app-id-${selectedProviderId}`}
                      type={showApiKey ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={
                        isServerConfigured
                          ? t('settings.optionalOverride')
                          : t('settings.enterApiKey')
                      }
                      value={doubaoAppId}
                      onChange={(e) => setDoubaoCompoundKey(e.target.value, doubaoAccessKey)}
                      className="font-mono text-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">{t('settings.doubaoAccessKey')}</Label>
                  <div className="relative">
                    <Input
                      name={`tts-access-key-${selectedProviderId}`}
                      type={showApiKey ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={
                        isServerConfigured
                          ? t('settings.optionalOverride')
                          : t('settings.enterApiKey')
                      }
                      value={doubaoAccessKey}
                      onChange={(e) => setDoubaoCompoundKey(doubaoAppId, e.target.value)}
                      className="font-mono text-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm">{t('settings.ttsApiKey')}</Label>
                <div className="relative">
                  <Input
                    name={`tts-api-key-${selectedProviderId}`}
                    type={showApiKey ? 'text' : 'password'}
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={
                      isServerConfigured
                        ? t('settings.optionalOverride')
                        : t('settings.enterApiKey')
                    }
                    value={selectedProviderConfig?.apiKey || ''}
                    onChange={(e) =>
                      setTTSProviderConfig(selectedProviderId, {
                        apiKey: e.target.value,
                      })
                    }
                    className="font-mono text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm">{t('settings.ttsBaseUrl')}</Label>
              <Input
                name={`tts-base-url-${selectedProviderId}`}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={
                  selectedProviderConfig?.defaultBaseUrl ||
                  ttsProvider.defaultBaseUrl ||
                  t('settings.enterCustomBaseUrl')
                }
                value={selectedProviderConfig?.baseUrl || ''}
                onChange={(e) =>
                  setTTSProviderConfig(selectedProviderId, {
                    baseUrl: e.target.value,
                  })
                }
                className="text-sm"
              />
            </div>
          </div>
        </>
      )}

      {/* Test TTS */}
      <div className="space-y-2">
        <Label className="text-sm">{t('settings.testTTS')}</Label>
        <div className="flex gap-2">
          <Input
            placeholder={t('settings.ttsTestTextPlaceholder')}
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="flex-1"
          />
          <Button
            onClick={handleTestTTS}
            disabled={
              testingTTS ||
              !testText.trim() ||
              (requiresApiKey && !selectedProviderConfig?.apiKey?.trim() && !isServerConfigured)
            }
            size="default"
            className="gap-2 w-32"
          >
            {testingTTS ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            {t('settings.testTTS')}
          </Button>
        </div>
      </div>

      {testMessage && (
        <div
          className={cn(
            'rounded-lg p-3 text-sm overflow-hidden',
            testStatus === 'success' &&
              'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
            testStatus === 'error' &&
              'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
          )}
        >
          <div className="flex items-start gap-2 min-w-0">
            {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
            {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <p className="flex-1 min-w-0 break-all">{testMessage}</p>
          </div>
        </div>
      )}

      <ServiceModelManager
        models={visibleModels}
        onModelsChange={handleModelsChange}
        onSelectedModelChange={handleSelectedModelChange}
        onTestModel={handleTestModel}
        testDisabled={
          requiresApiKey && !selectedProviderConfig?.apiKey?.trim() && !isServerConfigured
        }
      />

      {compatibleProviderId === 'cosyvoice-tts' && (
        <div className="space-y-4 rounded-lg border border-border/60 p-4">
          <div className="space-y-1">
            <Label className="text-base">声音克隆</Label>
            <p className="text-xs text-muted-foreground">
              朗读下面这句话并保存为一个音色，之后 CosyVoice 会用这段录音作为参考声音。
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">当前音色</Label>
            <Select value={selectedCosyVoiceId} onValueChange={handleCosyVoiceSelectionChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={COSYVOICE_DEFAULT_VOICE_ID}>内置参考音色</SelectItem>
                {cosyVoiceCloneVoices.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    {voice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {cosyVoiceCloneVoices.length > 0 && (
            <div className="space-y-2">
              {cosyVoiceCloneVoices.map((voice) => (
                <div
                  key={voice.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{voice.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{voice.promptText}</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteCloneVoice(voice.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <Label className="text-sm">音色名称</Label>
              <Input
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
                placeholder="例如：我的声音"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">录音状态</Label>
              <div
                className={cn(
                  'flex h-9 items-center rounded-md border px-3 text-sm',
                  recordedBlob
                    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
                    : 'border-border text-muted-foreground',
                )}
              >
                {recordingState === 'recording' ? '录音中' : recordedBlob ? '已录音' : '未录音'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">要读的话</Label>
            <Textarea
              value={clonePromptText}
              onChange={(event) => setClonePromptText(event.target.value)}
              className="min-h-20"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {recordingState === 'recording' ? (
              <Button type="button" variant="outline" onClick={handleStopCloneRecording}>
                <Square className="mr-2 h-4 w-4" />
                停止录音
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={handleStartCloneRecording}
                disabled={recordingState === 'saving'}
              >
                <Mic className="mr-2 h-4 w-4" />
                开始录音
              </Button>
            )}
            <Button
              type="button"
              onClick={handleSaveCloneVoice}
              disabled={
                recordingState !== 'idle' ||
                !recordedBlob ||
                !cloneName.trim() ||
                !clonePromptText.trim()
              }
            >
              {recordingState === 'saving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存音色
            </Button>
          </div>

          {recordingError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
              {recordingError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

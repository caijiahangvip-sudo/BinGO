'use client';

import { useState, useRef, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import type { ASRProviderId } from '@/lib/audio/types';
import { Mic, MicOff, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { ServiceModelManager, type ServiceModelInfo } from './service-model-manager';
import {
  fetchWithSettingsTimeout,
  getAbortErrorMessage,
  isAbortError,
  LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS,
  type SettingsTestOptions,
} from './utils';

const log = createLogger('ASRSettings');

function createSilentWavBlob(durationSeconds = 0.2, sampleRate = 16000): Blob {
  const samples = Math.floor(durationSeconds * sampleRate);
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: 'audio/wav' });
}

interface ASRSettingsProps {
  selectedProviderId: ASRProviderId;
}

export function ASRSettings({ selectedProviderId }: ASRSettingsProps) {
  const { t } = useI18n();

  const asrLanguage = useSettingsStore((state) => state.asrLanguage);
  const asrProvidersConfig = useSettingsStore((state) => state.asrProvidersConfig);
  const setASRProviderConfig = useSettingsStore((state) => state.setASRProviderConfig);

  const selectedProviderConfig = asrProvidersConfig[selectedProviderId];
  const compatibleProviderId = selectedProviderConfig?.compatibleProviderId || selectedProviderId;
  const asrProvider = ASR_PROVIDERS[compatibleProviderId] ?? ASR_PROVIDERS['openai-whisper'];
  const visibleModels = selectedProviderConfig?.models || [
    ...asrProvider.models,
    ...(selectedProviderConfig?.customModels || []),
  ];
  const requiresApiKey = selectedProviderConfig?.requiresApiKey ?? asrProvider.requiresApiKey;
  const isServerConfigured = !!selectedProviderConfig?.isServerConfigured;

  const [showApiKey, setShowApiKey] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [asrResult, setASRResult] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Reset state when provider changes (derived state pattern)
  const [prevProviderId, setPrevProviderId] = useState(selectedProviderId);
  if (selectedProviderId !== prevProviderId) {
    setPrevProviderId(selectedProviderId);
    setShowApiKey(false);
    setTestStatus('idle');
    setTestMessage('');
    setASRResult('');
  }

  const handleModelsChange = useCallback(
    (models: ServiceModelInfo[]) => {
      setASRProviderConfig(selectedProviderId, {
        models,
        customModels: [],
      });

      const currentModelId = selectedProviderConfig?.modelId || asrProvider.defaultModelId;
      if (!models.some((model) => model.id === currentModelId)) {
        setASRProviderConfig(selectedProviderId, { modelId: models[0]?.id || '' });
      }
    },
    [asrProvider, selectedProviderConfig?.modelId, selectedProviderId, setASRProviderConfig],
  );

  const handleSelectedModelChange = useCallback(
    (modelId: string) => {
      setASRProviderConfig(selectedProviderId, { modelId });
    },
    [selectedProviderId, setASRProviderConfig],
  );

  const handleTestModel = useCallback(
    async (model: ServiceModelInfo, options?: SettingsTestOptions) => {
      if (compatibleProviderId === 'browser-native') {
        return {
          success: true,
          message: t('settings.connectionSuccess'),
        };
      }

      const formData = new FormData();
      formData.append('audio', createSilentWavBlob(), 'test.wav');
      formData.append('providerId', selectedProviderId);
      formData.append('compatibleProviderId', compatibleProviderId);
      formData.append('modelId', model.id);
      formData.append('language', asrLanguage || 'auto');
      if (selectedProviderConfig?.apiKey?.trim()) {
        formData.append('apiKey', selectedProviderConfig.apiKey);
      }
      if (selectedProviderConfig?.baseUrl?.trim()) {
        formData.append('baseUrl', selectedProviderConfig.baseUrl);
      }
      if (options?.localServiceStartupTimeoutMs) {
        formData.append(
          'localServiceStartupTimeoutMs',
          String(options.localServiceStartupTimeoutMs),
        );
      }

      const response = await fetchWithSettingsTimeout('/api/transcription', {
        method: 'POST',
        body: formData,
        signal: options?.signal,
      });
      const data = await response.json().catch(() => ({ error: response.statusText }));
      return {
        success: response.ok && !!data.success,
        message:
          data.message ||
          data.error ||
          data.details ||
          (data.success ? t('settings.connectionSuccess') : t('settings.connectionFailed')),
      };
    },
    [
      asrLanguage,
      compatibleProviderId,
      selectedProviderConfig,
      selectedProviderId,
      t,
    ],
  );

  const handleToggleASRRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      setASRResult('');
      setTestStatus('testing');
      setTestMessage('');

      if (compatibleProviderId === 'browser-native') {
        const SpeechRecognitionCtor =
          (window as unknown as Record<string, unknown>).SpeechRecognition ||
          (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
          setTestStatus('error');
          setTestMessage(t('settings.asrNotSupported'));
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vendor-prefixed API without standard typings
        const recognition = new (SpeechRecognitionCtor as new () => any)();
        recognition.lang = asrLanguage || 'zh-CN';
        recognition.onresult = (event: {
          results: {
            [index: number]: { [index: number]: { transcript: string } };
          };
        }) => {
          const transcript = event.results[0][0].transcript;
          setASRResult(transcript);
          setTestStatus('success');
          setTestMessage(t('settings.asrTestSuccess'));
        };
        recognition.onerror = (event: { error: string }) => {
          setTestStatus('error');
          setTestMessage(t('settings.asrTestFailed') + ': ' + event.error);
        };
        recognition.onend = () => {
          setIsRecording(false);
        };
        recognition.start();
        setIsRecording(true);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          const audioChunks: Blob[] = [];
          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };
          mediaRecorder.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('providerId', selectedProviderId);
            formData.append('compatibleProviderId', compatibleProviderId);
            formData.append(
              'modelId',
              selectedProviderConfig?.modelId || asrProvider.defaultModelId,
            );
            formData.append('language', asrLanguage);
            const apiKeyValue = selectedProviderConfig?.apiKey;
            if (apiKeyValue?.trim()) formData.append('apiKey', apiKeyValue);
            const baseUrlValue = selectedProviderConfig?.baseUrl;
            if (baseUrlValue?.trim()) formData.append('baseUrl', baseUrlValue);
            formData.append(
              'localServiceStartupTimeoutMs',
              String(LOCAL_SERVICE_TEST_STARTUP_TIMEOUT_MS),
            );

            try {
              const response = await fetchWithSettingsTimeout('/api/transcription', {
                method: 'POST',
                body: formData,
              });
              if (response.ok) {
                const data = await response.json();
                setASRResult(data.text);
                setTestStatus('success');
                setTestMessage(t('settings.asrTestSuccess'));
              } else {
                setTestStatus('error');
                const errorData = await response
                  .json()
                  .catch(() => ({ error: response.statusText }));
                setTestMessage(errorData.details || errorData.error || t('settings.asrTestFailed'));
              }
            } catch (error) {
              log.error('ASR test failed:', error);
              setTestStatus('error');
              setTestMessage(
                isAbortError(error) ? getAbortErrorMessage(t) : t('settings.asrTestFailed'),
              );
            }
          };
          mediaRecorder.start();
          setIsRecording(true);
        } catch (error) {
          log.error('Failed to access microphone:', error);
          setTestStatus('error');
          setTestMessage(t('settings.microphoneAccessFailed'));
        }
      }
    }
  };

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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">{t('settings.asrApiKey')}</Label>
              <div className="relative">
                <Input
                  name={`asr-api-key-${selectedProviderId}`}
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={
                    isServerConfigured ? t('settings.optionalOverride') : t('settings.enterApiKey')
                  }
                  value={selectedProviderConfig?.apiKey || ''}
                  onChange={(e) =>
                    setASRProviderConfig(selectedProviderId, {
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
            <div className="space-y-2">
              <Label className="text-sm">{t('settings.asrBaseUrl')}</Label>
              <Input
                name={`asr-base-url-${selectedProviderId}`}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={
                  selectedProviderConfig?.defaultBaseUrl ||
                  asrProvider.defaultBaseUrl ||
                  t('settings.enterCustomBaseUrl')
                }
                value={selectedProviderConfig?.baseUrl || ''}
                onChange={(e) =>
                  setASRProviderConfig(selectedProviderId, {
                    baseUrl: e.target.value,
                  })
                }
                className="text-sm"
              />
            </div>
          </div>
        </>
      )}

      {/* Test ASR */}
      <div className="space-y-2">
        <Label className="text-sm">{t('settings.testASR')}</Label>
        <div className="flex gap-2">
          <Input
            value={asrResult}
            readOnly
            placeholder={t('settings.asrResultPlaceholder')}
            className="flex-1 bg-muted/50"
          />
          <Button
            onClick={handleToggleASRRecording}
            disabled={
              requiresApiKey && !selectedProviderConfig?.apiKey?.trim() && !isServerConfigured
            }
            className="gap-2 w-[140px]"
          >
            {isRecording ? (
              <>
                <MicOff className="h-4 w-4" />
                {t('settings.stopRecording')}
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                {t('settings.startRecording')}
              </>
            )}
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

      {/* Model Selection */}
      {visibleModels.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm">{t('settings.ttsModel')}</Label>
          <Select
            value={selectedProviderConfig?.modelId || asrProvider.defaultModelId}
            onValueChange={(value) => setASRProviderConfig(selectedProviderId, { modelId: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibleModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
    </div>
  );
}

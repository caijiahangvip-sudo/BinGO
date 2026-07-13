'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  X,
  Box,
  Settings,
  CheckCircle2,
  XCircle,
  FileText,
  Volume2,
  Mic,
  Database,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { isLightweightProviderAllowed, useSettingsStore } from '@/lib/store/settings';
import { toast } from 'sonner';
import { type ProviderId } from '@/lib/ai/providers';
import { PROVIDERS } from '@/lib/ai/providers';
import { cn } from '@/lib/utils';
import { getProviderTypeLabel } from './utils';
import { ProviderList } from './provider-list';
import { ProviderConfigPanel } from './provider-config-panel';
import { PDFSettings } from './pdf-settings';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFProviderId } from '@/lib/pdf/types';
import { VectorSettings } from './vector-settings';
import { VECTOR_PROVIDERS, normalizeVectorProviderId } from '@/lib/vector/constants';
import type { VectorProviderId } from '@/lib/vector/types';
import { TTSSettings } from './tts-settings';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import type { TTSProviderId } from '@/lib/audio/types';
import { ASRSettings } from './asr-settings';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import type { ASRProviderId } from '@/lib/audio/types';
import { GeneralSettings } from './general-settings';
import { ModelEditDialog } from './model-edit-dialog';
import { AddProviderDialog, type NewProviderData } from './add-provider-dialog';
import {
  AddServiceProviderDialog,
  type NewServiceProviderData,
  type ServiceProviderOption,
} from './add-service-provider-dialog';
import type { SettingsSection, EditingModel } from '@/lib/types/settings';

// ─── Provider List Column (reusable) ───
function ProviderListColumn<T extends string>({
  providers,
  configs,
  selectedId,
  onSelect,
  onAddProvider,
  onDeleteProvider,
  canAddProvider = false,
  width,
  t,
}: {
  providers: Array<{ id: T; name: string; icon?: string }>;
  configs: Record<string, { isServerConfigured?: boolean }>;
  selectedId: T | '';
  onSelect: (id: T) => void;
  onAddProvider?: () => void;
  onDeleteProvider?: (id: T) => void;
  canAddProvider?: boolean;
  width: number;
  t: (key: string) => string;
}) {
  const selectedProvider = providers.find((provider) => provider.id === selectedId);

  return (
    <div className="flex-shrink-0 bg-background flex flex-col" style={{ width }}>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all border text-left',
              selectedId === provider.id
                ? 'bg-primary/5 border-primary/50 shadow-sm'
                : 'border-transparent hover:bg-muted/50',
            )}
          >
            {provider.icon ? (
              <img
                src={provider.icon}
                alt={provider.name}
                className="w-5 h-5 rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Box className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium text-sm flex-1 truncate">{provider.name}</span>
            {configs[provider.id]?.isServerConfigured && (
              <span className="text-[10px] px-1 py-0 h-4 leading-4 rounded shrink-0 bg-muted text-muted-foreground">
                {t('settings.serverConfigured')}
              </span>
            )}
          </button>
        ))}
      </div>
      {onAddProvider && onDeleteProvider && (
        <div className="p-3 border-t">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!canAddProvider}
              onClick={onAddProvider}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('settings.addProviderButton')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!selectedProvider}
              onClick={() => {
                if (selectedProvider) onDeleteProvider(selectedProvider.id);
              }}
            >
              <Minus className="h-3.5 w-3.5" />
              {t('settings.deleteProviderButton')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper: get TTS/ASR provider display name ───
function getTTSProviderName(providerId: TTSProviderId, t: (key: string) => string): string {
  const names: Record<string, string> = {
    'openai-tts': t('settings.providerOpenAITTS'),
    'azure-tts': t('settings.providerAzureTTS'),
    'glm-tts': t('settings.providerGLMTTS'),
    'qwen-tts': t('settings.providerQwenTTS'),
    'cosyvoice-tts': t('settings.providerCosyVoiceTTS'),
    'doubao-tts': t('settings.providerDoubaoTTS'),
    'elevenlabs-tts': t('settings.providerElevenLabsTTS'),
    'minimax-tts': t('settings.providerMiniMaxTTS'),
    'browser-native-tts': t('settings.providerBrowserNativeTTS'),
  };
  return names[providerId] || providerId;
}

function getASRProviderName(providerId: ASRProviderId, t: (key: string) => string): string {
  const names: Record<string, string> = {
    'openai-whisper': t('settings.providerOpenAIWhisper'),
    'browser-native': t('settings.providerBrowserNative'),
    'qwen-asr': t('settings.providerQwenASR'),
    'sensevoice-asr': t('settings.providerSenseVoiceASR'),
  };
  return names[providerId] || providerId;
}

function getVectorProviderName(providerId: VectorProviderId, t: (key: string) => string): string {
  const names: Record<string, string> = {
    'openai-embedding': t('settings.providerOpenAIEmbedding'),
    'qwen-embedding': t('settings.providerQwenEmbedding'),
    siliconflow: t('settings.providerSiliconFlow'),
  };
  return names[providerId] || providerId;
}

// Service provider helper types
interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

type ManagedProviderSection = 'pdf' | 'tts' | 'asr' | 'vector';
type LanguageProviderSection = 'providers' | 'lightweight-providers';
type RestorableProviderSection = LanguageProviderSection | ManagedProviderSection;

type ProviderDeleteTarget =
  | { section: LanguageProviderSection; id: ProviderId }
  | { section: 'pdf'; id: PDFProviderId }
  | { section: 'tts'; id: TTSProviderId }
  | { section: 'asr'; id: ASRProviderId }
  | { section: 'vector'; id: VectorProviderId };

function createCustomServiceProviderId(
  section: ManagedProviderSection,
  name: string,
  existingIds: string[],
): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const baseId = `custom-${section}-${slug || Date.now()}`;
  let nextId = baseId;
  let index = 2;
  while (existingIds.includes(nextId)) {
    nextId = `${baseId}-${index}`;
    index += 1;
  }
  return nextId;
}

export function SettingsDialog({ open, onOpenChange, initialSection }: SettingsDialogProps) {
  const { t } = useI18n();

  // Get settings from store
  const providerId = useSettingsStore((state) => state.providerId);
  const modelId = useSettingsStore((state) => state.modelId);
  const lightweightProviderId = useSettingsStore((state) => state.lightweightProviderId);
  const lightweightModelId = useSettingsStore((state) => state.lightweightModelId);
  const providersConfig = useSettingsStore((state) => state.providersConfig);
  const lightweightProvidersConfig = useSettingsStore((state) => state.lightweightProvidersConfig);
  const pdfProviderId = useSettingsStore((state) => state.pdfProviderId);
  const pdfProvidersConfig = useSettingsStore((state) => state.pdfProvidersConfig);
  const vectorProviderId = useSettingsStore((state) => state.vectorProviderId);
  const vectorProvidersConfig = useSettingsStore((state) => state.vectorProvidersConfig);
  const ttsProviderId = useSettingsStore((state) => state.ttsProviderId);
  const ttsProvidersConfig = useSettingsStore((state) => state.ttsProvidersConfig);
  const asrProviderId = useSettingsStore((state) => state.asrProviderId);
  const asrProvidersConfig = useSettingsStore((state) => state.asrProvidersConfig);

  // Store actions
  const setModel = useSettingsStore((state) => state.setModel);
  const setLightweightModel = useSettingsStore((state) => state.setLightweightModel);
  const setProviderConfig = useSettingsStore((state) => state.setProviderConfig);
  const setProvidersConfig = useSettingsStore((state) => state.setProvidersConfig);
  const setLightweightProviderConfig = useSettingsStore(
    (state) => state.setLightweightProviderConfig,
  );
  const setLightweightProvidersConfig = useSettingsStore(
    (state) => state.setLightweightProvidersConfig,
  );
  const setPDFProvider = useSettingsStore((state) => state.setPDFProvider);
  const setVectorProvider = useSettingsStore((state) => state.setVectorProvider);
  const setTTSProvider = useSettingsStore((state) => state.setTTSProvider);
  const setASRProvider = useSettingsStore((state) => state.setASRProvider);
  const setTTSProviderConfig = useSettingsStore((state) => state.setTTSProviderConfig);
  const setASRProviderConfig = useSettingsStore((state) => state.setASRProviderConfig);
  const setPDFProviderConfig = useSettingsStore((state) => state.setPDFProviderConfig);
  const setVectorProviderConfig = useSettingsStore((state) => state.setVectorProviderConfig);
  const deleteTTSProvider = useSettingsStore((state) => state.deleteTTSProvider);
  const restoreTTSProvider = useSettingsStore((state) => state.restoreTTSProvider);
  const deleteASRProvider = useSettingsStore((state) => state.deleteASRProvider);
  const restoreASRProvider = useSettingsStore((state) => state.restoreASRProvider);
  const deletePDFProvider = useSettingsStore((state) => state.deletePDFProvider);
  const restorePDFProvider = useSettingsStore((state) => state.restorePDFProvider);
  const deleteVectorProvider = useSettingsStore((state) => state.deleteVectorProvider);
  const restoreVectorProvider = useSettingsStore((state) => state.restoreVectorProvider);

  // Navigation
  const [activeSection, setActiveSection] = useState<SettingsSection>('providers');
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>(providerId);
  const [selectedLightweightProviderId, setSelectedLightweightProviderId] =
    useState<ProviderId>(lightweightProviderId);
  const availablePdfProviderIds = Object.keys(PDF_PROVIDERS) as PDFProviderId[];
  const resolvedPdfProviderId: PDFProviderId =
    pdfProviderId &&
    availablePdfProviderIds.includes(pdfProviderId) &&
    pdfProvidersConfig[pdfProviderId]
      ? pdfProviderId
      : ('mineru-local' as PDFProviderId);
  const [selectedPdfProviderId, setSelectedPdfProviderId] =
    useState<PDFProviderId>(resolvedPdfProviderId);
  const [selectedVectorProviderId, setSelectedVectorProviderId] =
    useState<VectorProviderId>(vectorProviderId);
  // Navigate to initialSection when dialog opens
  useEffect(() => {
    if (open && initialSection) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync section from prop when dialog opens
      setActiveSection(initialSection === 'web-search' ? 'providers' : initialSection);
    }
  }, [open, initialSection]);

  useEffect(() => {
    if (!PDF_PROVIDERS[selectedPdfProviderId] || !pdfProvidersConfig[selectedPdfProviderId]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Normalize stale or deleted provider IDs
      setSelectedPdfProviderId('mineru-local' as PDFProviderId);
    }
  }, [pdfProvidersConfig, selectedPdfProviderId]);

  useEffect(() => {
    const normalizedSelectedProviderId = normalizeVectorProviderId(
      selectedVectorProviderId,
    ) as VectorProviderId;
    if (normalizedSelectedProviderId !== selectedVectorProviderId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Normalize stale provider IDs from persisted settings
      setSelectedVectorProviderId(normalizedSelectedProviderId);
      setVectorProvider(normalizedSelectedProviderId);
      return;
    }
    if (!vectorProvidersConfig[selectedVectorProviderId]) {
      setSelectedVectorProviderId(normalizeVectorProviderId(vectorProviderId) as VectorProviderId);
    }
  }, [selectedVectorProviderId, setVectorProvider, vectorProviderId, vectorProvidersConfig]);

  // Model editing state
  const [editingModel, setEditingModel] = useState<EditingModel | null>(null);
  const [showModelDialog, setShowModelDialog] = useState(false);

  // Provider deletion confirmation
  const [providerToDelete, setProviderToDelete] = useState<ProviderDeleteTarget | null>(null);

  // Add provider dialog
  const [showAddProviderDialog, setShowAddProviderDialog] = useState(false);
  const [restoreProviderSection, setRestoreProviderSection] =
    useState<ManagedProviderSection | null>(null);

  // Save status indicator
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  // Resizable column widths
  const [sidebarWidth, setSidebarWidth] = useState(192);
  const [providerListWidth, setProviderListWidth] = useState(192);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{
    target: 'sidebar' | 'providerList';
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, target: 'sidebar' | 'providerList') => {
      e.preventDefault();
      const startWidth = target === 'sidebar' ? sidebarWidth : providerListWidth;
      resizeRef.current = { target, startX: e.clientX, startWidth };
      setIsResizing(true);
    },
    [sidebarWidth, providerListWidth],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { target, startX, startWidth } = resizeRef.current;
      const delta = e.clientX - startX;
      const newWidth = Math.max(120, Math.min(360, startWidth + delta));
      if (target === 'sidebar') {
        setSidebarWidth(newWidth);
      } else {
        setProviderListWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing]);

  const handleSave = () => {
    onOpenChange(false);
  };

  const handleProviderSelect = (pid: ProviderId) => {
    setSelectedProviderId(pid);
  };

  const getFirstLanguageModelId = (pid: ProviderId, config = currentLanguageProvidersConfig) =>
    config[pid]?.serverModels?.[0] || config[pid]?.models?.[0]?.id || '';

  const handleLightweightProviderSelect = (pid: ProviderId) => {
    const isSameProvider = pid === lightweightProviderId;
    setSelectedLightweightProviderId(pid);
    const currentModelExists =
      lightweightProvidersConfig[pid]?.serverModels?.includes(lightweightModelId) ||
      lightweightProvidersConfig[pid]?.models?.some((model) => model.id === lightweightModelId);
    const nextModelId =
      isSameProvider && currentModelExists
        ? lightweightModelId
        : getFirstLanguageModelId(pid, lightweightProvidersConfig);
    setLightweightModel(pid, nextModelId);
  };

  const handleLanguageModelSelect = (pid: ProviderId, selectedModelId: string) => {
    if (activeSection === 'lightweight-providers') {
      setLightweightModel(pid, selectedModelId);
    } else {
      setModel(pid, selectedModelId);
    }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleProviderConfigChange = (
    pid: ProviderId,
    apiKey: string,
    baseUrl: string,
    requiresApiKey: boolean,
  ) => {
    const updateProviderConfig =
      activeSection === 'lightweight-providers' ? setLightweightProviderConfig : setProviderConfig;
    updateProviderConfig(pid, {
      apiKey,
      baseUrl,
      requiresApiKey,
    });
  };

  const handleProviderConfigSave = () => {
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const selectedProvider = providersConfig[selectedProviderId]
    ? {
        id: selectedProviderId,
        name: providersConfig[selectedProviderId].name,
        type: providersConfig[selectedProviderId].type,
        defaultBaseUrl: providersConfig[selectedProviderId].defaultBaseUrl,
        icon: providersConfig[selectedProviderId].icon,
        requiresApiKey: providersConfig[selectedProviderId].requiresApiKey,
        models: providersConfig[selectedProviderId].models,
      }
    : undefined;
  const selectedLightweightProvider = lightweightProvidersConfig[selectedLightweightProviderId]
    ? {
        id: selectedLightweightProviderId,
        name: lightweightProvidersConfig[selectedLightweightProviderId].name,
        type: lightweightProvidersConfig[selectedLightweightProviderId].type,
        defaultBaseUrl: lightweightProvidersConfig[selectedLightweightProviderId].defaultBaseUrl,
        icon: lightweightProvidersConfig[selectedLightweightProviderId].icon,
        requiresApiKey: lightweightProvidersConfig[selectedLightweightProviderId].requiresApiKey,
        models: lightweightProvidersConfig[selectedLightweightProviderId].models,
      }
    : undefined;
  const currentLanguageProvidersConfig =
    activeSection === 'lightweight-providers' ? lightweightProvidersConfig : providersConfig;
  const setCurrentLanguageProviderConfig =
    activeSection === 'lightweight-providers' ? setLightweightProviderConfig : setProviderConfig;
  const setCurrentLanguageProvidersConfig =
    activeSection === 'lightweight-providers' ? setLightweightProvidersConfig : setProvidersConfig;
  const setCurrentSelectedProviderId =
    activeSection === 'lightweight-providers'
      ? setSelectedLightweightProviderId
      : setSelectedProviderId;
  const currentLanguageProviderId =
    activeSection === 'lightweight-providers' ? selectedLightweightProviderId : selectedProviderId;
  const currentLanguageProvider =
    activeSection === 'lightweight-providers' ? selectedLightweightProvider : selectedProvider;

  // Handle model editing
  const handleEditModel = (pid: ProviderId, modelIndex: number) => {
    const allModels = currentLanguageProvidersConfig[pid]?.models || [];
    setEditingModel({
      providerId: pid,
      modelIndex,
      model: { ...allModels[modelIndex] },
    });
    setShowModelDialog(true);
  };

  const handleAddModel = () => {
    setEditingModel({
      providerId: currentLanguageProviderId,
      modelIndex: null,
      model: {
        id: '',
        name: '',
        capabilities: {
          streaming: true,
          tools: true,
          vision: false,
        },
      },
    });
    setShowModelDialog(true);
  };

  const handleDeleteModel = (pid: ProviderId, modelIndex: number) => {
    const currentModels = currentLanguageProvidersConfig[pid]?.models || [];
    const deletedModelId = currentModels[modelIndex]?.id;
    const newModels = currentModels.filter((_, i) => i !== modelIndex);
    setCurrentLanguageProviderConfig(pid, { models: newModels, modelsCustomized: true });

    if (activeSection === 'lightweight-providers') {
      if (lightweightProviderId === pid && lightweightModelId === deletedModelId) {
        setLightweightModel(pid, newModels[0]?.id || '');
      }
      return;
    }

    if (providerId === pid && modelId === deletedModelId) {
      setModel(pid, newModels[0]?.id || '');
    }
  };

  const handleAutoSaveModel = () => {
    if (!editingModel) return;
    const { providerId: pid, modelIndex, model } = editingModel;
    if (!model.id.trim()) return;
    const currentModels = currentLanguageProvidersConfig[pid]?.models || [];
    let newModels: typeof currentModels;
    let newModelIndex = modelIndex;

    if (modelIndex === null) {
      const existingIndex = currentModels.findIndex((m) => m.id === model.id);
      if (existingIndex >= 0) {
        newModels = [...currentModels];
        newModels[existingIndex] = model;
        newModelIndex = existingIndex;
      } else {
        newModels = [...currentModels, model];
        newModelIndex = newModels.length - 1;
      }
      setCurrentLanguageProviderConfig(pid, { models: newModels, modelsCustomized: true });
      setEditingModel({ ...editingModel, modelIndex: newModelIndex });
    } else {
      newModels = [...currentModels];
      newModels[modelIndex] = model;
      setCurrentLanguageProviderConfig(pid, { models: newModels, modelsCustomized: true });
    }
  };

  const handleSaveModel = () => {
    if (!editingModel) return;
    const { providerId: pid, modelIndex, model } = editingModel;
    if (!model.id.trim()) {
      toast.error(t('settings.modelIdRequired'));
      return;
    }
    const currentModels = currentLanguageProvidersConfig[pid]?.models || [];
    let newModels: typeof currentModels;
    if (modelIndex === null) {
      newModels = [...currentModels, model];
    } else {
      newModels = [...currentModels];
      newModels[modelIndex] = model;
    }
    setCurrentLanguageProviderConfig(pid, { models: newModels, modelsCustomized: true });
    setShowModelDialog(false);
    setEditingModel(null);
  };

  const inferProviderTypeFromUrl = (url: string): 'openai' | 'anthropic' | 'google' => {
    const lowerUrl = url.trim().toLowerCase();
    if (lowerUrl.includes('/messages')) return 'anthropic';
    if (lowerUrl.includes(':generatecontent') || lowerUrl.includes(':streamgeneratecontent')) {
      return 'google';
    }
    return 'openai';
  };

  // Handle provider management
  const handleAddProvider = (providerData: NewProviderData) => {
    if (!providerData.name.trim()) {
      toast.error(t('settings.providerNameRequired'));
      return;
    }
    const newProviderId = `custom-${Date.now()}` as ProviderId;
    const baseConfig = currentLanguageProvidersConfig;
    const updatedConfig = {
      ...baseConfig,
      [newProviderId]: {
        apiKey: '',
        baseUrl: '',
        models: [],
        name: providerData.name,
        type: inferProviderTypeFromUrl(providerData.baseUrl),
        defaultBaseUrl: providerData.baseUrl || undefined,
        icon: providerData.icon || undefined,
        requiresApiKey: providerData.requiresApiKey,
        isBuiltIn: false,
      },
    };
    setCurrentLanguageProvidersConfig(updatedConfig);
    setShowAddProviderDialog(false);
    setCurrentSelectedProviderId(newProviderId);
  };

  const handleDeleteProvider = (pid: ProviderId) => {
    setProviderToDelete({
      section: activeSection === 'lightweight-providers' ? 'lightweight-providers' : 'providers',
      id: pid,
    });
  };

  const handleDeleteManagedProvider = <T extends ManagedProviderSection>(
    section: T,
    id: ProviderDeleteTarget['id'],
  ) => {
    setProviderToDelete({ section, id } as ProviderDeleteTarget);
  };

  const confirmDeleteProvider = () => {
    if (!providerToDelete) return;
    if (
      providerToDelete.section !== 'providers' &&
      providerToDelete.section !== 'lightweight-providers'
    ) {
      switch (providerToDelete.section) {
        case 'pdf': {
          const pid = providerToDelete.id;
          const remainingPid = Object.keys(pdfProvidersConfig).find((id) => id !== pid) as
            | PDFProviderId
            | undefined;
          deletePDFProvider(pid);
          if (selectedPdfProviderId === pid) {
            setSelectedPdfProviderId(remainingPid ?? ('' as PDFProviderId));
          }
          if (pdfProviderId === pid) {
            setPDFProvider(remainingPid ?? ('' as PDFProviderId));
          }
          break;
        }
        case 'vector': {
          const pid = normalizeVectorProviderId(providerToDelete.id) as VectorProviderId;
          const remainingPid = normalizedVectorProviderIds.find((id) => id !== pid);
          deleteVectorProvider(pid);
          if (normalizeVectorProviderId(selectedVectorProviderId) === pid) {
            setSelectedVectorProviderId(remainingPid ?? ('' as VectorProviderId));
          }
          if (normalizeVectorProviderId(vectorProviderId) === pid) {
            setVectorProvider(remainingPid ?? ('' as VectorProviderId));
          }
          break;
        }
        case 'tts': {
          const pid = providerToDelete.id;
          const remainingPid = Object.keys(ttsProvidersConfig).find((id) => id !== pid) as
            | TTSProviderId
            | undefined;
          deleteTTSProvider(pid);
          if (ttsProviderId === pid) {
            setTTSProvider(remainingPid ?? ('' as TTSProviderId));
          }
          break;
        }
        case 'asr': {
          const pid = providerToDelete.id;
          const remainingPid = Object.keys(asrProvidersConfig).find((id) => id !== pid) as
            | ASRProviderId
            | undefined;
          deleteASRProvider(pid);
          if (asrProviderId === pid) {
            setASRProvider(remainingPid ?? ('' as ASRProviderId));
          }
          break;
        }
      }
      setProviderToDelete(null);
      return;
    }

    const pid = providerToDelete.id;
    const isLightweightDelete = providerToDelete.section === 'lightweight-providers';
    const sourceConfig = isLightweightDelete ? lightweightProvidersConfig : providersConfig;
    const updatedConfig = { ...sourceConfig };
    delete updatedConfig[pid];
    const firstRemainingPid = Object.keys(updatedConfig)[0] as ProviderId | undefined;
    const firstModel = firstRemainingPid
      ? updatedConfig[firstRemainingPid]?.serverModels?.[0] ||
        updatedConfig[firstRemainingPid]?.models?.[0]?.id
      : undefined;

    if (isLightweightDelete) {
      setLightweightProvidersConfig(updatedConfig);
      if (selectedLightweightProviderId === pid) {
        setSelectedLightweightProviderId(firstRemainingPid || ('' as ProviderId));
      }
      if (lightweightProviderId === pid) {
        if (firstRemainingPid && firstModel) {
          setLightweightModel(firstRemainingPid, firstModel);
        } else {
          setLightweightModel('' as ProviderId, '');
        }
      }
      setProviderToDelete(null);
      return;
    }

    setProvidersConfig(updatedConfig);
    if (selectedProviderId === pid) {
      setSelectedProviderId(firstRemainingPid || 'openai');
    }
    if (providerId === pid) {
      const firstRemainingPid = Object.keys(updatedConfig)[0] as ProviderId | undefined;
      const firstModel = firstRemainingPid
        ? updatedConfig[firstRemainingPid]?.serverModels?.[0] ||
          updatedConfig[firstRemainingPid]?.models?.[0]?.id
        : undefined;
      if (firstRemainingPid && firstModel) {
        setModel(firstRemainingPid, firstModel);
      } else {
        setModel('' as ProviderId, '');
      }
    }
    setProviderToDelete(null);
  };

  const handleResetProvider = (pid: ProviderId) => {
    const provider = PROVIDERS[pid];
    if (!provider) return;
    setCurrentLanguageProviderConfig(pid, {
      models: [...provider.models],
      modelsCustomized: false,
    });
    toast.success(t('settings.resetSuccess'));
  };

  // Get all providers from providersConfig
  const allProviders = Object.entries(providersConfig).map(([id, config]) => ({
    id: id as ProviderId,
    name: config.name,
    type: config.type,
    defaultBaseUrl: config.defaultBaseUrl,
    icon: config.icon,
    requiresApiKey: config.requiresApiKey,
    models: config.models,
    isServerConfigured: config.isServerConfigured,
  }));
  const allLightweightProviders = Object.entries(lightweightProvidersConfig).map(
    ([id, config]) => ({
      id: id as ProviderId,
      name: config.name,
      type: config.type,
      defaultBaseUrl: config.defaultBaseUrl,
      icon: config.icon,
      requiresApiKey: config.requiresApiKey,
      models: config.models,
      isServerConfigured: config.isServerConfigured,
    }),
  );
  const missingLLMProviders = Object.values(PROVIDERS)
    .filter((provider) => !providersConfig[provider.id])
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      icon: provider.icon,
    }));
  const missingLightweightProviders = Object.values(PROVIDERS)
    .filter(
      (provider) =>
        isLightweightProviderAllowed(provider.id) && !lightweightProvidersConfig[provider.id],
    )
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      icon: provider.icon,
    }));

  const getPdfProviderOption = (id: PDFProviderId): ServiceProviderOption => {
    const config = pdfProvidersConfig[id];
    const compatibleProviderId = config?.compatibleProviderId || id;
    const provider = PDF_PROVIDERS[id] || PDF_PROVIDERS[compatibleProviderId];
    return {
      id,
      name: config?.name || provider?.name || id,
      icon: config?.icon || provider?.icon,
    };
  };

  const pdfProviders = availablePdfProviderIds.map((id) =>
    getPdfProviderOption(id as PDFProviderId),
  );
  const missingPdfProviders = Object.values(PDF_PROVIDERS).filter(
    (provider) => !pdfProvidersConfig[provider.id],
  );

  const getVectorProviderOption = (id: VectorProviderId): ServiceProviderOption => {
    const config = vectorProvidersConfig[id];
    const compatibleProviderId = normalizeVectorProviderId(
      (config?.compatibleProviderId || id) as VectorProviderId,
    );
    const provider = VECTOR_PROVIDERS[id] || VECTOR_PROVIDERS[compatibleProviderId];
    const isBuiltInProvider = Boolean(VECTOR_PROVIDERS[id]);
    return {
      id,
      name:
        isBuiltInProvider && provider
          ? getVectorProviderName(provider.id, t)
          : config?.name || (provider ? getVectorProviderName(provider.id, t) : id),
      icon: isBuiltInProvider ? provider?.icon : config?.icon || provider?.icon,
    };
  };

  const normalizedVectorProviderIds = Array.from(
    new Set(
      Object.keys(vectorProvidersConfig).map(
        (id) => normalizeVectorProviderId(id as VectorProviderId) as VectorProviderId,
      ),
    ),
  ).filter((id) => vectorProvidersConfig[id] || VECTOR_PROVIDERS[id]);
  const vectorProviders = normalizedVectorProviderIds.map((id) => getVectorProviderOption(id));
  const missingVectorProviders = Object.values(VECTOR_PROVIDERS)
    .filter((provider) => !normalizedVectorProviderIds.includes(provider.id as VectorProviderId))
    .map((provider) => ({
      id: provider.id,
      name: getVectorProviderName(provider.id, t),
      icon: provider.icon,
    }));

  const getTTSProviderOption = (id: TTSProviderId): ServiceProviderOption => {
    const config = ttsProvidersConfig[id];
    const compatibleProviderId = config?.compatibleProviderId || id;
    const provider = TTS_PROVIDERS[id] || TTS_PROVIDERS[compatibleProviderId];
    return {
      id,
      name: config?.name || (provider ? getTTSProviderName(provider.id, t) : id),
      icon: config?.icon || provider?.icon,
    };
  };

  const ttsProviders = Object.keys(ttsProvidersConfig).map((id) =>
    getTTSProviderOption(id as TTSProviderId),
  );
  const missingTTSProviders = Object.values(TTS_PROVIDERS)
    .filter((provider) => !ttsProvidersConfig[provider.id])
    .map((provider) => ({
      id: provider.id,
      name: getTTSProviderName(provider.id, t),
      icon: provider.icon,
    }));

  const getASRProviderOption = (id: ASRProviderId): ServiceProviderOption => {
    const config = asrProvidersConfig[id];
    const compatibleProviderId = config?.compatibleProviderId || id;
    const provider = ASR_PROVIDERS[id] || ASR_PROVIDERS[compatibleProviderId];
    return {
      id,
      name: config?.name || (provider ? getASRProviderName(provider.id, t) : id),
      icon: config?.icon || provider?.icon,
    };
  };

  const asrProviders = Object.keys(asrProvidersConfig).map((id) =>
    getASRProviderOption(id as ASRProviderId),
  );
  const missingASRProviders = Object.values(ASR_PROVIDERS)
    .filter((provider) => !asrProvidersConfig[provider.id])
    .map((provider) => ({
      id: provider.id,
      name: getASRProviderName(provider.id, t),
      icon: provider.icon,
    }));

  const builtInProviderGroups: Array<{
    section: RestorableProviderSection;
    title: string;
    providers: ServiceProviderOption[];
  }> = [
    { section: 'providers', title: t('settings.providers'), providers: missingLLMProviders },
    {
      section: 'lightweight-providers',
      title: t('settings.lightweightProviders'),
      providers: missingLightweightProviders,
    },
    { section: 'tts', title: '语音合成', providers: missingTTSProviders },
    { section: 'asr', title: '语音识别', providers: missingASRProviders },
    { section: 'pdf', title: 'PDF解析', providers: missingPdfProviders },
    { section: 'vector', title: t('settings.vectorSettings'), providers: missingVectorProviders },
  ];
  const missingBuiltInProviderCount = builtInProviderGroups.reduce(
    (count, group) => count + group.providers.length,
    0,
  );

  const handleRestoreManagedProvider = (section: ManagedProviderSection, id: string) => {
    switch (section) {
      case 'pdf':
        restorePDFProvider(id as PDFProviderId);
        setSelectedPdfProviderId(id as PDFProviderId);
        if (!pdfProviderId) setPDFProvider(id as PDFProviderId);
        break;
      case 'vector':
        restoreVectorProvider(id as VectorProviderId);
        setSelectedVectorProviderId(id as VectorProviderId);
        if (!vectorProviderId) setVectorProvider(id as VectorProviderId);
        break;
      case 'tts':
        restoreTTSProvider(id as TTSProviderId);
        if (!ttsProviderId) setTTSProvider(id as TTSProviderId);
        break;
      case 'asr':
        restoreASRProvider(id as ASRProviderId);
        if (!asrProviderId) setASRProvider(id as ASRProviderId);
        break;
    }
    setRestoreProviderSection(null);
  };

  const handleRestoreLanguageProvider = (section: LanguageProviderSection, id: ProviderId) => {
    const provider = PROVIDERS[id];
    if (!provider) return;
    const isLightweightRestore = section === 'lightweight-providers';
    if (isLightweightRestore && !isLightweightProviderAllowed(id)) return;
    const restoreConfig = {
      apiKey: '',
      baseUrl: '',
      models: [...provider.models],
      name: provider.name,
      type: provider.type,
      defaultBaseUrl: provider.defaultBaseUrl,
      icon: provider.icon,
      requiresApiKey: provider.requiresApiKey,
      isBuiltIn: true,
    };

    if (isLightweightRestore) {
      setLightweightProvidersConfig({
        ...lightweightProvidersConfig,
        [id]: restoreConfig,
      });
      setSelectedLightweightProviderId(id);
      if (lightweightProviderId === id || !lightweightProvidersConfig[lightweightProviderId]) {
        setLightweightModel(id, provider.models[0]?.id || '');
      }
      return;
    }

    setProvidersConfig({
      ...providersConfig,
      [id]: restoreConfig,
    });
    setSelectedProviderId(id);
    if (providerId === id || !providersConfig[providerId]) {
      setModel(id, provider.models[0]?.id || '');
    }
  };

  const handleRestoreBuiltInProvider = (section: RestorableProviderSection, id: string) => {
    if (section === 'providers' || section === 'lightweight-providers') {
      setActiveSection(section);
      handleRestoreLanguageProvider(section, id as ProviderId);
      return;
    }
    handleRestoreManagedProvider(section, id);
  };

  const getCompatibleServiceProviders = (): ServiceProviderOption[] => {
    switch (restoreProviderSection) {
      case 'pdf':
        return Object.values(PDF_PROVIDERS).map((provider) => ({
          id: provider.id,
          name: provider.name,
          icon: provider.icon,
        }));
      case 'vector':
        return Object.values(VECTOR_PROVIDERS).map((provider) => ({
          id: provider.id,
          name: getVectorProviderName(provider.id, t),
          icon: provider.icon,
        }));
      case 'tts':
        return Object.values(TTS_PROVIDERS).map((provider) => ({
          id: provider.id,
          name: getTTSProviderName(provider.id, t),
          icon: provider.icon,
        }));
      case 'asr':
        return Object.values(ASR_PROVIDERS).map((provider) => ({
          id: provider.id,
          name: getASRProviderName(provider.id, t),
          icon: provider.icon,
        }));
      default:
        return [];
    }
  };

  const handleAddCustomManagedProvider = (
    section: ManagedProviderSection,
    providerData: NewServiceProviderData,
  ) => {
    const providerName = providerData.name.trim();
    if (!providerName) {
      toast.error(t('settings.providerNameRequired'));
      return;
    }

    const baseConfig = {
      apiKey: '',
      baseUrl: providerData.baseUrl.trim(),
      defaultBaseUrl: providerData.baseUrl.trim() || undefined,
      enabled: true,
      name: providerName,
      icon: providerData.icon.trim() || undefined,
      requiresApiKey: providerData.requiresApiKey,
      isBuiltIn: false,
    };

    switch (section) {
      case 'pdf': {
        const providerId = createCustomServiceProviderId(
          section,
          providerName,
          Object.keys(pdfProvidersConfig),
        ) as PDFProviderId;
        setPDFProviderConfig(providerId, {
          ...baseConfig,
          compatibleProviderId: providerData.compatibleProviderId as PDFProviderId,
        });
        setSelectedPdfProviderId(providerId);
        setPDFProvider(providerId);
        break;
      }
      case 'vector': {
        const providerId = createCustomServiceProviderId(
          section,
          providerName,
          Object.keys(vectorProvidersConfig),
        ) as VectorProviderId;
        const compatibleProviderId = normalizeVectorProviderId(
          providerData.compatibleProviderId as VectorProviderId,
        );
        setVectorProviderConfig(providerId, {
          ...baseConfig,
          compatibleProviderId,
          modelId: VECTOR_PROVIDERS[compatibleProviderId]?.defaultModelId || undefined,
        });
        setSelectedVectorProviderId(providerId);
        setVectorProvider(providerId);
        break;
      }
      case 'tts': {
        const providerId = createCustomServiceProviderId(
          section,
          providerName,
          Object.keys(ttsProvidersConfig),
        ) as TTSProviderId;
        const compatibleProviderId = providerData.compatibleProviderId as TTSProviderId;
        setTTSProviderConfig(providerId, {
          ...baseConfig,
          compatibleProviderId,
          modelId: TTS_PROVIDERS[compatibleProviderId]?.defaultModelId || undefined,
        });
        setTTSProvider(providerId);
        break;
      }
      case 'asr': {
        const providerId = createCustomServiceProviderId(
          section,
          providerName,
          Object.keys(asrProvidersConfig),
        ) as ASRProviderId;
        const compatibleProviderId = providerData.compatibleProviderId as ASRProviderId;
        setASRProviderConfig(providerId, {
          ...baseConfig,
          compatibleProviderId,
          modelId: ASR_PROVIDERS[compatibleProviderId]?.defaultModelId || undefined,
        });
        setASRProvider(providerId);
        break;
      }
    }

    setRestoreProviderSection(null);
  };

  // Sections that show a provider list column
  const _hasProviderList = [
    'providers',
    'lightweight-providers',
    'pdf',
    'vector',
    'tts',
    'asr',
  ].includes(activeSection);

  const renderBuiltInProvidersPanel = () => (
    <div className="space-y-5 max-w-4xl">
      <div className="rounded-lg border bg-muted/30 p-4">
        <h3 className="text-sm font-medium">已删除的内置提供商</h3>
        <p className="text-xs text-muted-foreground mt-1">
          这里集中显示从各功能中删除的内置提供商，点击恢复即可重新加入对应列表。
        </p>
      </div>

      {missingBuiltInProviderCount === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">
          当前没有已删除的内置提供商。
        </div>
      ) : (
        builtInProviderGroups.map((group) => {
          if (group.providers.length === 0) return null;
          return (
            <section key={group.section} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{group.title}</h3>
                <span className="text-xs text-muted-foreground">{group.providers.length}</span>
              </div>
              <div className="space-y-2">
                {group.providers.map((provider) => (
                  <div
                    key={`${group.section}-${provider.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    {provider.icon ? (
                      <img
                        src={provider.icon}
                        alt={provider.name}
                        className="h-6 w-6 rounded"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Box className="h-6 w-6 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{provider.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{provider.id}</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => handleRestoreBuiltInProvider(group.section, provider.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      恢复
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );

  // Get header content based on section
  const getHeaderContent = () => {
    switch (activeSection) {
      case 'general':
        return <h2 className="text-lg font-semibold">{t('settings.systemSettings')}</h2>;
      case 'built-in-providers':
        return (
          <>
            <RotateCcw className="h-6 w-6 text-muted-foreground" />
            <h2 className="text-lg font-semibold">内置提供商</h2>
          </>
        );
      case 'lightweight-providers':
      case 'providers':
        if (currentLanguageProvider) {
          return (
            <>
              {currentLanguageProvider.icon ? (
                <img
                  src={currentLanguageProvider.icon}
                  alt={currentLanguageProvider.name}
                  className="w-8 h-8 rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <Box className="h-8 w-8 text-muted-foreground" />
              )}
              <div>
                <h2 className="text-lg font-semibold">{currentLanguageProvider.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {getProviderTypeLabel(currentLanguageProvider.type, t)}
                </p>
              </div>
            </>
          );
        }
        return null;
      case 'pdf': {
        if (!pdfProvidersConfig[selectedPdfProviderId]) return null;
        const pdfProvider = getPdfProviderOption(selectedPdfProviderId);
        return (
          <>
            {pdfProvider.icon ? (
              <img
                src={pdfProvider.icon}
                alt={pdfProvider.name}
                className="w-8 h-8 rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Box className="h-8 w-8 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold">{pdfProvider.name}</h2>
          </>
        );
      }
      case 'vector': {
        const normalizedSelectedProviderId = normalizeVectorProviderId(
          selectedVectorProviderId,
        ) as VectorProviderId;
        if (
          !vectorProvidersConfig[normalizedSelectedProviderId] &&
          !VECTOR_PROVIDERS[normalizedSelectedProviderId]
        )
          return null;
        const vectorProvider = getVectorProviderOption(normalizedSelectedProviderId);
        return (
          <>
            {vectorProvider.icon ? (
              <img
                src={vectorProvider.icon}
                alt=""
                className="w-8 h-8 rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Database className="h-6 w-6 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold">{vectorProvider.name}</h2>
          </>
        );
      }
      case 'tts': {
        if (!ttsProvidersConfig[ttsProviderId]) return null;
        const ttsProvider = getTTSProviderOption(ttsProviderId);
        return (
          <>
            {ttsProvider.icon ? (
              <img
                src={ttsProvider.icon}
                alt=""
                className="w-8 h-8 rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Volume2 className="h-6 w-6 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold">{ttsProvider.name}</h2>
          </>
        );
      }
      case 'asr': {
        if (!asrProvidersConfig[asrProviderId]) return null;
        const asrProvider = getASRProviderOption(asrProviderId);
        return (
          <>
            {asrProvider.icon ? (
              <img
                src={asrProvider.icon}
                alt=""
                className="w-8 h-8 rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <Mic className="h-6 w-6 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold">{asrProvider.name}</h2>
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[85vh] p-0 gap-0 block" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('settings.description')}</DialogDescription>
        <div className="flex h-full overflow-hidden">
          {/* Left Sidebar - Navigation */}
          <div className="flex-shrink-0 bg-muted/30 p-3 space-y-1" style={{ width: sidebarWidth }}>
            <button
              onClick={() => setActiveSection('providers')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'providers'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <Box className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('settings.providers')}</span>
            </button>

            <button
              onClick={() => setActiveSection('lightweight-providers')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'lightweight-providers'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <Box className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('settings.lightweightProviders')}</span>
            </button>

            <button
              onClick={() => setActiveSection('built-in-providers')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'built-in-providers'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <RotateCcw className="h-4 w-4 shrink-0" />
              <span className="truncate">内置提供商</span>
              {missingBuiltInProviderCount > 0 && (
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {missingBuiltInProviderCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSection('tts')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'tts'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <Volume2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('settings.ttsSettings')}</span>
            </button>

            <button
              onClick={() => setActiveSection('asr')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'asr'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <Mic className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('settings.asrSettings')}</span>
            </button>

            <button
              onClick={() => setActiveSection('pdf')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'pdf'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('settings.pdfSettings')}</span>
            </button>

            <button
              onClick={() => setActiveSection('vector')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'vector'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <Database className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('settings.vectorSettings')}</span>
            </button>

            <button
              onClick={() => setActiveSection('general')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left min-w-0',
                activeSection === 'general'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted',
              )}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('settings.systemSettings')}</span>
            </button>
          </div>

          {/* Sidebar resize handle */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'sidebar')}
            className="flex-shrink-0 w-[5px] cursor-col-resize group flex justify-center"
          >
            <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
          </div>

          {/* Middle - Provider List (only shown for provider-based sections) */}
          {activeSection === 'providers' && (
            <>
              <ProviderList
                providers={allProviders}
                selectedProviderId={selectedProviderId}
                onSelect={handleProviderSelect}
                onAddProvider={() => setShowAddProviderDialog(true)}
                onDeleteProvider={handleDeleteProvider}
                width={providerListWidth}
              />
              <div
                onMouseDown={(e) => handleResizeStart(e, 'providerList')}
                className="flex-shrink-0 w-[5px] cursor-col-resize group flex justify-center"
              >
                <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </>
          )}

          {activeSection === 'lightweight-providers' && (
            <>
              <ProviderList
                providers={allLightweightProviders}
                selectedProviderId={selectedLightweightProviderId}
                onSelect={handleLightweightProviderSelect}
                onAddProvider={() => setShowAddProviderDialog(true)}
                onDeleteProvider={handleDeleteProvider}
                width={providerListWidth}
              />
              <div
                onMouseDown={(e) => handleResizeStart(e, 'providerList')}
                className="flex-shrink-0 w-[5px] cursor-col-resize group flex justify-center"
              >
                <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </>
          )}

          {activeSection === 'pdf' && (
            <>
              <ProviderListColumn
                providers={pdfProviders}
                configs={pdfProvidersConfig}
                selectedId={selectedPdfProviderId}
                onSelect={setSelectedPdfProviderId}
                width={providerListWidth}
                t={t}
              />
              <div
                onMouseDown={(e) => handleResizeStart(e, 'providerList')}
                className="flex-shrink-0 w-[5px] cursor-col-resize group flex justify-center"
              >
                <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </>
          )}

          {activeSection === 'vector' && (
            <>
              <ProviderListColumn
                providers={vectorProviders}
                configs={vectorProvidersConfig}
                selectedId={normalizeVectorProviderId(selectedVectorProviderId) as VectorProviderId}
                onSelect={(id) => {
                  setSelectedVectorProviderId(id);
                  setVectorProvider(id);
                }}
                onAddProvider={() => setRestoreProviderSection('vector')}
                onDeleteProvider={(id) => handleDeleteManagedProvider('vector', id)}
                canAddProvider
                width={providerListWidth}
                t={t}
              />
              <div
                onMouseDown={(e) => handleResizeStart(e, 'providerList')}
                className="flex-shrink-0 w-[5px] cursor-col-resize group flex justify-center"
              >
                <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </>
          )}

          {activeSection === 'tts' && (
            <>
              <ProviderListColumn
                providers={ttsProviders}
                configs={ttsProvidersConfig}
                selectedId={ttsProviderId}
                onSelect={setTTSProvider}
                onAddProvider={() => setRestoreProviderSection('tts')}
                onDeleteProvider={(id) => handleDeleteManagedProvider('tts', id)}
                canAddProvider
                width={providerListWidth}
                t={t}
              />
              <div
                onMouseDown={(e) => handleResizeStart(e, 'providerList')}
                className="flex-shrink-0 w-[5px] cursor-col-resize group flex justify-center"
              >
                <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </>
          )}

          {activeSection === 'asr' && (
            <>
              <ProviderListColumn
                providers={asrProviders}
                configs={asrProvidersConfig}
                selectedId={asrProviderId}
                onSelect={setASRProvider}
                onAddProvider={() => setRestoreProviderSection('asr')}
                onDeleteProvider={(id) => handleDeleteManagedProvider('asr', id)}
                canAddProvider
                width={providerListWidth}
                t={t}
              />
              <div
                onMouseDown={(e) => handleResizeStart(e, 'providerList')}
                className="flex-shrink-0 w-[5px] cursor-col-resize group flex justify-center"
              >
                <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
              </div>
            </>
          )}

          {/* Right - Configuration Panel */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b">
              <div className="flex items-center gap-3">{getHeaderContent()}</div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeSection === 'general' && <GeneralSettings />}

              {activeSection === 'built-in-providers' && renderBuiltInProvidersPanel()}

              {(activeSection === 'providers' || activeSection === 'lightweight-providers') &&
                currentLanguageProvider && (
                  <ProviderConfigPanel
                    provider={currentLanguageProvider}
                    initialApiKey={
                      currentLanguageProvidersConfig[currentLanguageProviderId]?.apiKey || ''
                    }
                    initialBaseUrl={
                      currentLanguageProvidersConfig[currentLanguageProviderId]?.baseUrl || ''
                    }
                    initialRequiresApiKey={
                      currentLanguageProvidersConfig[currentLanguageProviderId]?.requiresApiKey ??
                      true
                    }
                    providersConfig={currentLanguageProvidersConfig}
                    onConfigChange={(apiKey, baseUrl, requiresApiKey) =>
                      handleProviderConfigChange(
                        currentLanguageProviderId,
                        apiKey,
                        baseUrl,
                        requiresApiKey,
                      )
                    }
                    onSave={handleProviderConfigSave}
                    onEditModel={(index) => handleEditModel(currentLanguageProviderId, index)}
                    onDeleteModel={(index) => handleDeleteModel(currentLanguageProviderId, index)}
                    onAddModel={handleAddModel}
                    onResetToDefault={() => handleResetProvider(currentLanguageProviderId)}
                    isBuiltIn={
                      currentLanguageProvidersConfig[currentLanguageProviderId]?.isBuiltIn ?? true
                    }
                    activeProviderId={
                      activeSection === 'lightweight-providers' ? lightweightProviderId : providerId
                    }
                    activeModelId={
                      activeSection === 'lightweight-providers' ? lightweightModelId : modelId
                    }
                    onSelectModel={(selectedModelId) =>
                      handleLanguageModelSelect(currentLanguageProviderId, selectedModelId)
                    }
                  />
                )}

              {activeSection === 'pdf' && pdfProvidersConfig[selectedPdfProviderId] && (
                <PDFSettings selectedProviderId={selectedPdfProviderId} />
              )}
              {activeSection === 'vector' &&
                (vectorProvidersConfig[
                  normalizeVectorProviderId(selectedVectorProviderId) as VectorProviderId
                ] ||
                  VECTOR_PROVIDERS[
                    normalizeVectorProviderId(selectedVectorProviderId) as VectorProviderId
                  ]) && (
                  <VectorSettings
                    selectedProviderId={
                      normalizeVectorProviderId(selectedVectorProviderId) as VectorProviderId
                    }
                  />
                )}
              {activeSection === 'tts' && ttsProvidersConfig[ttsProviderId] && (
                <TTSSettings selectedProviderId={ttsProviderId} />
              )}
              {activeSection === 'asr' && asrProvidersConfig[asrProviderId] && (
                <ASRSettings selectedProviderId={asrProviderId} />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-3 border-t bg-muted/30">
              {saveStatus === 'saved' && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{t('settings.saveSuccess')}</span>
                </div>
              )}
              {saveStatus === 'error' && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <XCircle className="h-4 w-4" />
                  <span>{t('settings.saveFailed')}</span>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t('settings.close')}
              </Button>
              <Button size="sm" onClick={handleSave}>
                {t('settings.save')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Edit Model Dialog */}
      <ModelEditDialog
        open={showModelDialog}
        onOpenChange={setShowModelDialog}
        editingModel={editingModel}
        setEditingModel={setEditingModel}
        onSave={handleSaveModel}
        onAutoSave={handleAutoSaveModel}
        providerId={currentLanguageProviderId}
        apiKey={currentLanguageProvidersConfig[currentLanguageProviderId]?.apiKey || ''}
        baseUrl={currentLanguageProvidersConfig[currentLanguageProviderId]?.baseUrl}
        providerType={currentLanguageProvidersConfig[currentLanguageProviderId]?.type}
        requiresApiKey={currentLanguageProvidersConfig[currentLanguageProviderId]?.requiresApiKey}
        isServerConfigured={
          currentLanguageProvidersConfig[currentLanguageProviderId]?.isServerConfigured
        }
      />

      {/* Add Provider Dialog */}
      <AddProviderDialog
        open={showAddProviderDialog}
        onOpenChange={setShowAddProviderDialog}
        onAdd={handleAddProvider}
      />

      {/* Add service provider dialog */}
      <AddServiceProviderDialog
        open={restoreProviderSection !== null}
        onOpenChange={(dialogOpen) => !dialogOpen && setRestoreProviderSection(null)}
        compatibleProviders={getCompatibleServiceProviders()}
        onAddCustom={(providerData) => {
          if (restoreProviderSection) {
            handleAddCustomManagedProvider(restoreProviderSection, providerData);
          }
        }}
      />

      {/* Delete Provider Confirmation */}
      <AlertDialog
        open={providerToDelete !== null}
        onOpenChange={(open) => !open && setProviderToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.deleteProvider')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.deleteProviderConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancelEdit')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProvider}>
              {t('settings.deleteProvider')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

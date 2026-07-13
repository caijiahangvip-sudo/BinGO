'use client';

import { useCallback, useRef } from 'react';
import { useStageStore } from '@/lib/store/stage';
import { getModelApiHeaders } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import { db } from '@/lib/utils/database';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import type { ColorThemeId } from '@/lib/theme/color-themes';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import { createAudioBlob, normalizeAudioFormat } from '@/lib/audio/mime';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneGenerator');
const TTS_RETRY_DELAY_MS = 1500;

interface SceneContentResult {
  success: boolean;
  content?: unknown;
  effectiveOutline?: SceneOutline;
  error?: string;
}

interface SceneActionsResult {
  success: boolean;
  scene?: Scene;
  previousSpeeches?: string[];
  error?: string;
}

function getApiHeaders(): HeadersInit {
  return getModelApiHeaders();
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', abort, { once: true });
  });
}

function shouldFailSceneOnTTSFailure(providerId: string): boolean {
  return providerId === 'cosyvoice-tts';
}

function getTTSRuntime() {
  const settings = useSettingsStore.getState();
  const providerId = settings.ttsProviderId;
  const providerConfig = settings.ttsProvidersConfig?.[providerId];
  const compatibleProviderId = providerConfig?.compatibleProviderId || providerId;

  return {
    enabled: settings.ttsEnabled && compatibleProviderId !== 'browser-native-tts',
    providerId,
    compatibleProviderId,
  };
}

export function prepareSceneSpeechForTTS(scene: Scene): Scene {
  const runtime = getTTSRuntime();
  if (!runtime.enabled) return scene;

  const actions = splitLongSpeechActions(scene.actions || [], runtime.compatibleProviderId);
  let changed = actions !== scene.actions;
  const preparedActions = actions.map((action) => {
    if (action.type !== 'speech' || !action.text) return action;

    const audioId = action.audioId || `tts_${action.id}`;
    if (action.audioId === audioId) return action;

    changed = true;
    return {
      ...action,
      audioId,
    };
  });

  return changed ? { ...scene, actions: preparedActions } : scene;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function shouldAbortSceneGeneration(
  isGenerating: boolean,
  fetchAbortController: AbortController | null,
): boolean {
  return isGenerating || fetchAbortController !== null;
}

/** Call POST /api/generate/scene-content (step 1) */
async function fetchSceneContent(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    stageId: string;
    pdfImages?: PdfImage[];
    imageMapping?: ImageMapping;
    stageInfo: {
      name: string;
      description?: string;
      language?: string;
      style?: string;
      visualTheme?: ColorThemeId;
    };
    agents?: AgentInfo[];
    forceClassroomScenes?: boolean;
    visualTheme?: ColorThemeId;
    slideLayoutReviewEnabled?: boolean;
  },
  signal?: AbortSignal,
): Promise<SceneContentResult> {
  const response = await fetch('/api/generate/scene-content', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    return { success: false, error: data.error || `HTTP ${response.status}` };
  }

  return response.json();
}

/** Call POST /api/generate/scene-actions (step 2) */
async function fetchSceneActions(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    content: unknown;
    stageId: string;
    agents?: AgentInfo[];
    previousSpeeches?: string[];
    userProfile?: string;
    visualTheme?: ColorThemeId;
  },
  signal?: AbortSignal,
): Promise<SceneActionsResult> {
  const response = await fetch('/api/generate/scene-actions', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    return { success: false, error: data.error || `HTTP ${response.status}` };
  }

  return response.json();
}

/** Generate TTS for one speech action and store in IndexedDB */
export async function generateAndStoreTTS(
  audioId: string,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const settings = useSettingsStore.getState();
  const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
  const ttsCompatibleProviderId = ttsProviderConfig?.compatibleProviderId || settings.ttsProviderId;
  if (ttsCompatibleProviderId === 'browser-native-tts') return;

  const response = await fetch('/api/generate/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      audioId,
      ttsProviderId: settings.ttsProviderId,
      ttsCompatibleProviderId,
      ttsModelId: ttsProviderConfig?.modelId,
      ttsVoice: settings.ttsVoice,
      ttsSpeed: settings.ttsSpeed,
      ttsApiKey: ttsProviderConfig?.apiKey || undefined,
      ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
      ttsProviderOptions: ttsProviderConfig?.providerOptions,
    }),
    signal,
  });

  const data = await response
    .json()
    .catch(() => ({ success: false, error: response.statusText || 'Invalid TTS response' }));
  if (!response.ok || !data.success || !data.base64 || !data.format) {
    const err = new Error(
      data.details || data.error || `TTS request failed: HTTP ${response.status}`,
    );
    log.warn('TTS failed for', audioId, ':', err);
    throw err;
  }

  const binary = atob(data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const format = normalizeAudioFormat(data.format);
  const blob = createAudioBlob(bytes, format);
  await db.audioFiles.put({
    id: audioId,
    blob,
    format,
    createdAt: Date.now(),
  });
}

/** Generate TTS for all speech actions in a scene. Returns result. */
async function generateTTSForScene(
  scene: Scene,
  signal?: AbortSignal,
): Promise<{ success: boolean; failedCount: number; error?: string }> {
  const { enabled, providerId, compatibleProviderId } = getTTSRuntime();
  if (!enabled) return { success: true, failedCount: 0 };

  const speechActions = (scene.actions || []).filter(
    (a): a is SpeechAction => a.type === 'speech' && !!a.text,
  );
  if (speechActions.length === 0) return { success: true, failedCount: 0 };

  let failedCount = 0;
  let lastError: string | undefined;
  const maxAttempts = shouldFailSceneOnTTSFailure(compatibleProviderId) ? 1 : 2;

  for (const action of speechActions) {
    const audioId = action.audioId || `tts_${action.id}`;
    action.audioId = audioId;
    let generated = false;
    let actionError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await generateAndStoreTTS(audioId, action.text, signal);
        generated = true;
        if (attempt > 1) {
          log.info('TTS retry succeeded:', {
            providerId,
            actionId: action.id,
            attempt,
          });
        }
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
        actionError = error instanceof Error ? error.message : `TTS failed for action ${action.id}`;

        if (attempt < maxAttempts) {
          log.warn('TTS generation failed, retrying once:', {
            providerId,
            actionId: action.id,
            textLength: action.text.length,
            error: actionError,
          });
          await waitForRetry(TTS_RETRY_DELAY_MS, signal);
          continue;
        }

        log.warn('TTS generation failed after retry:', {
          providerId,
          actionId: action.id,
          textLength: action.text.length,
          error: actionError,
        });
      }
    }

    if (!generated) {
      failedCount++;
      lastError = actionError || `TTS failed for action ${action.id}`;
      if (shouldFailSceneOnTTSFailure(compatibleProviderId)) {
        return {
          success: false,
          failedCount,
          error: lastError,
        };
      }
    }
  }

  return {
    success: failedCount === 0,
    failedCount,
    error: lastError,
  };
}

function startBackgroundTTS(scene: Scene, outline: SceneOutline, signal?: AbortSignal): void {
  if (!getTTSRuntime().enabled) return;

  void generateTTSForScene(scene, signal)
    .then((ttsResult) => {
      if (ttsResult.success) return;

      log.warn('Background TTS generation failed for scene; scene remains usable:', {
        outlineId: outline.id,
        title: outline.title,
        failedCount: ttsResult.failedCount,
        error: ttsResult.error,
      });
    })
    .catch((error) => {
      if (isAbortError(error) || signal?.aborted) return;

      log.warn('Background TTS generation crashed for scene; scene remains usable:', {
        outlineId: outline.id,
        title: outline.title,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export interface UseSceneGeneratorOptions {
  onSceneGenerated?: (scene: Scene, index: number) => void;
  onSceneFailed?: (outline: SceneOutline, error: string) => void;
  onPhaseChange?: (phase: 'content' | 'actions', outline: SceneOutline) => void;
  onComplete?: () => void;
}

export interface GenerationParams {
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  stageInfo: {
    name: string;
    description?: string;
    language?: string;
    style?: string;
    visualTheme?: ColorThemeId;
  };
  agents?: AgentInfo[];
  userProfile?: string;
  forceClassroomScenes?: boolean;
  slideLayoutReviewEnabled?: boolean;
}

export function useSceneGenerator(options: UseSceneGeneratorOptions = {}) {
  const abortRef = useRef(false);
  const generatingRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const lastParamsRef = useRef<GenerationParams | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const store = useStageStore;

  const generateRemaining = useCallback(
    async (params: GenerationParams) => {
      lastParamsRef.current = params;
      if (generatingRef.current) return;
      generatingRef.current = true;
      abortRef.current = false;

      // Create a new AbortController for this generation run
      fetchAbortRef.current = new AbortController();
      const signal = fetchAbortRef.current.signal;

      const state = store.getState();
      const { outlines, scenes, stage } = state;
      const startEpoch = state.generationEpoch;
      if (!stage || outlines.length === 0) {
        generatingRef.current = false;
        fetchAbortRef.current = null;
        return;
      }

      const failOutline = (outline: SceneOutline, error: string) => {
        store.getState().addFailedOutline(outline);
        optionsRef.current.onSceneFailed?.(outline, error);
      };

      store.getState().setGenerationStatus('generating');

      // Determine pending outlines
      const completedOrders = new Set(scenes.map((s) => s.order));
      const pending = outlines
        .filter(
          (o) =>
            !completedOrders.has(o.order) &&
            !state.failedOutlines.some((failed) => failed.id === o.id),
        )
        .sort((a, b) => a.order - b.order);
      const unfinished = outlines
        .filter((o) => !completedOrders.has(o.order))
        .sort((a, b) => a.order - b.order);

      if (pending.length === 0) {
        store.getState().setCurrentGeneratingOrder(-1);
        store.getState().setGeneratingOutlines(unfinished);
        if (unfinished.length === 0) {
          store.getState().setGenerationStatus('completed');
          optionsRef.current.onComplete?.();
        } else {
          store.getState().setGenerationStatus('completed');
        }
        generatingRef.current = false;
        fetchAbortRef.current = null;
        return;
      }

      store.getState().setGeneratingOutlines(unfinished);

      // Get previousSpeeches from last completed scene
      let previousSpeeches: string[] = [];
      const sortedScenes = [...scenes].sort((a, b) => a.order - b.order);
      if (sortedScenes.length > 0) {
        const lastScene = sortedScenes[sortedScenes.length - 1];
        previousSpeeches = (lastScene.actions || [])
          .filter((a): a is SpeechAction => a.type === 'speech')
          .map((a) => a.text);
      }

      // Serial generation loop — two-step per outline
      try {
        let pausedByAbort = false;
        for (const outline of pending) {
          if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
            store.getState().setGenerationStatus('paused');
            pausedByAbort = true;
            break;
          }

          const currentState = store.getState();
          if (
            currentState.scenes.some((scene) => scene.order === outline.order) ||
            currentState.failedOutlines.some((failed) => failed.id === outline.id)
          ) {
            continue;
          }

          store.getState().setCurrentGeneratingOrder(outline.order);

          try {
            // Step 1: Generate content
            optionsRef.current.onPhaseChange?.('content', outline);
            const contentResult = await fetchSceneContent(
              {
                outline,
                allOutlines: outlines,
                stageId: stage.id,
                pdfImages: params.pdfImages,
                imageMapping: params.imageMapping,
                stageInfo: params.stageInfo,
                agents: params.agents,
                forceClassroomScenes: params.forceClassroomScenes,
                visualTheme: params.stageInfo.visualTheme,
                slideLayoutReviewEnabled: params.slideLayoutReviewEnabled,
              },
              signal,
            );

            if (!contentResult.success || !contentResult.content) {
              if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
                pausedByAbort = true;
                break;
              }
              failOutline(outline, contentResult.error || 'Content generation failed');
              continue;
            }

            if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
              store.getState().setGenerationStatus('paused');
              pausedByAbort = true;
              break;
            }

            // Step 2: Generate actions + assemble scene
            optionsRef.current.onPhaseChange?.('actions', outline);
            const actionsResult = await fetchSceneActions(
              {
                outline: contentResult.effectiveOutline || outline,
                allOutlines: outlines,
                content: contentResult.content,
                stageId: stage.id,
                agents: params.agents,
                previousSpeeches,
                userProfile: params.userProfile,
                visualTheme: params.stageInfo.visualTheme,
              },
              signal,
            );

            if (!actionsResult.success || !actionsResult.scene) {
              if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
                pausedByAbort = true;
                break;
              }
              failOutline(outline, actionsResult.error || 'Actions generation failed');
              continue;
            }

            if (store.getState().generationEpoch !== startEpoch) {
              pausedByAbort = true;
              break;
            }

            const scene = prepareSceneSpeechForTTS(actionsResult.scene);
            store.getState().addScene(scene);
            optionsRef.current.onSceneGenerated?.(scene, outline.order);
            startBackgroundTTS(scene, outline, signal);
            previousSpeeches = actionsResult.previousSpeeches || [];
          } catch (err: unknown) {
            if (
              isAbortError(err) ||
              abortRef.current ||
              store.getState().generationEpoch !== startEpoch
            ) {
              log.info('Generation aborted');
              store.getState().setGenerationStatus('paused');
              pausedByAbort = true;
              break;
            }

            failOutline(outline, err instanceof Error ? err.message : 'Scene generation failed');
            continue;
          }
        }

        if (
          !abortRef.current &&
          !pausedByAbort &&
          store.getState().generationEpoch === startEpoch
        ) {
          const finalState = store.getState();
          const completedAfter = new Set(finalState.scenes.map((scene) => scene.order));
          const unfinishedAfter = outlines
            .filter((outline) => !completedAfter.has(outline.order))
            .sort((a, b) => a.order - b.order);

          store.getState().setCurrentGeneratingOrder(-1);
          store.getState().setGeneratingOutlines(unfinishedAfter);
          store.getState().setGenerationStatus('completed');
          if (unfinishedAfter.length === 0) {
            optionsRef.current.onComplete?.();
          }
        }
      } catch (err: unknown) {
        // AbortError is expected when stop() is called — don't treat as failure
        if (isAbortError(err)) {
          log.info('Generation aborted');
          store.getState().setGenerationStatus('paused');
        } else {
          log.error('Background generation crashed:', err);
          store.getState().setGenerationStatus('paused');
        }
      } finally {
        generatingRef.current = false;
        fetchAbortRef.current = null;
      }
    },
    [store],
  );

  const generateNextAfterScene = useCallback(
    async (_currentScene: Scene, params: GenerationParams) => {
      await generateRemaining(params);
    },
    [generateRemaining],
  );

  const stop = useCallback(() => {
    if (!shouldAbortSceneGeneration(generatingRef.current, fetchAbortRef.current)) return;

    abortRef.current = true;
    store.getState().bumpGenerationEpoch();
    fetchAbortRef.current?.abort();
  }, [store]);

  const isGenerating = useCallback(() => generatingRef.current, []);

  /** Retry a single failed outline from scratch (content → actions → TTS). */
  const retrySingleOutline = useCallback(
    async (outlineId: string) => {
      const state = store.getState();
      const outline = state.failedOutlines.find((o) => o.id === outlineId);
      const params = lastParamsRef.current;
      if (!outline || !state.stage || !params) return;

      const removeGeneratingOutline = () => {
        const current = store.getState().generatingOutlines;
        if (!current.some((o) => o.id === outlineId)) return;
        store.getState().setGeneratingOutlines(current.filter((o) => o.id !== outlineId));
      };

      // Remove from failed list and mark as generating
      store.getState().retryFailedOutline(outlineId);
      store.getState().setGenerationStatus('generating');
      store.getState().setCurrentGeneratingOrder(outline.order);
      const currentGenerating = store.getState().generatingOutlines;
      if (!currentGenerating.some((o) => o.id === outline.id)) {
        store.getState().setGeneratingOutlines([...currentGenerating, outline]);
      }

      const abortController = new AbortController();
      const signal = abortController.signal;

      try {
        // Step 1: Content
        const contentResult = await fetchSceneContent(
          {
            outline,
            allOutlines: state.outlines,
            stageId: state.stage.id,
            pdfImages: params.pdfImages,
            imageMapping: params.imageMapping,
            stageInfo: params.stageInfo,
            agents: params.agents,
            forceClassroomScenes: params.forceClassroomScenes,
            visualTheme: params.stageInfo.visualTheme,
            slideLayoutReviewEnabled: params.slideLayoutReviewEnabled,
          },
          signal,
        );

        if (!contentResult.success || !contentResult.content) {
          store.getState().addFailedOutline(outline);
          store.getState().setGenerationStatus('paused');
          store.getState().setCurrentGeneratingOrder(-1);
          return;
        }

        // Step 2: Actions
        const sortedScenes = [...store.getState().scenes].sort((a, b) => a.order - b.order);
        const lastScene = sortedScenes[sortedScenes.length - 1];
        const previousSpeeches = lastScene
          ? (lastScene.actions || [])
              .filter((a): a is SpeechAction => a.type === 'speech')
              .map((a) => a.text)
          : [];

        const actionsResult = await fetchSceneActions(
          {
            outline: contentResult.effectiveOutline || outline,
            allOutlines: state.outlines,
            content: contentResult.content,
            stageId: state.stage.id,
            agents: params.agents,
            previousSpeeches,
            userProfile: params.userProfile,
            visualTheme: params.stageInfo.visualTheme,
          },
          signal,
        );

        if (!actionsResult.success || !actionsResult.scene) {
          store.getState().addFailedOutline(outline);
          store.getState().setGenerationStatus('paused');
          store.getState().setCurrentGeneratingOrder(-1);
          return;
        }

        const scene = prepareSceneSpeechForTTS(actionsResult.scene);
        removeGeneratingOutline();
        store.getState().addScene(scene);
        startBackgroundTTS(scene, outline, signal);

        const completedOrders = new Set(store.getState().scenes.map((scene) => scene.order));
        const hasPending = store
          .getState()
          .outlines.some((pendingOutline) => !completedOrders.has(pendingOutline.order));
        if (hasPending) {
          store.getState().setGenerationStatus('idle');
        } else {
          store.getState().setGenerationStatus('completed');
          store.getState().setGeneratingOutlines([]);
          optionsRef.current.onComplete?.();
        }
        store.getState().setCurrentGeneratingOrder(-1);
      } catch (err) {
        store.getState().setCurrentGeneratingOrder(-1);
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          store.getState().addFailedOutline(outline);
          store.getState().setGenerationStatus('paused');
        }
      }
    },
    [store],
  );

  return { generateRemaining, generateNextAfterScene, retrySingleOutline, stop, isGenerating };
}

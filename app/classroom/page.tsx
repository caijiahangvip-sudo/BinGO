'use client';

import { Stage } from '@/components/stage';
import { useStageStore } from '@/lib/store';
import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { completeBookLesson } from '@/lib/utils/book-learning-storage';
import {
  buildSceneGenerationParams,
  consumeAutoStartFirstLecture,
} from '@/lib/utils/classroom-generation-params';
import { useI18n } from '@/lib/hooks/use-i18n';
import { toast } from 'sonner';

const log = createLogger('Classroom');

function ClassroomPageContent() {
  const router = useRouter();
  const { locale } = useI18n();
  const searchParams = useSearchParams();
  const classroomId = searchParams.get('id') || '';

  const { loadFromStorage } = useStageStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoStartInitialLecture, setAutoStartInitialLecture] = useState(false);

  const loadTokenRef = useRef(0);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated');
    },
  });

  const handleFinishBookLesson = useCallback(async () => {
    const stage = useStageStore.getState().stage;
    const context = stage?.bookLessonContext;
    if (!stage?.id || !context) return;

    await useStageStore.getState().saveToStorage();
    await completeBookLesson(context.planId, context.lessonId, { stageId: stage.id });
    sessionStorage.removeItem('generationParams');
    toast.success(locale === 'zh-CN' ? '本节课已完成' : 'Lesson completed');
    router.push('/');
  }, [locale, router]);

  const restoreClassroomMedia = useCallback(async (stageId: string, token: number) => {
    await useMediaGenerationStore.getState().restoreFromDB(stageId, {
      shouldApply: () =>
        loadTokenRef.current === token && useStageStore.getState().stage?.id === stageId,
    });
  }, []);

  const startBackgroundGeneration = useCallback(
    (stageId: string, token: number) => {
      const stage = useStageStore.getState().stage;
      if (!stage || stage.id !== stageId) return;

      void buildSceneGenerationParams(stage)
        .then((generationParams) => {
          if (loadTokenRef.current !== token || useStageStore.getState().stage?.id !== stageId) {
            return;
          }
          return generateRemaining(generationParams);
        })
        .catch((generationError) => {
          log.warn('Failed to start background scene generation:', generationError);
        });
    },
    [generateRemaining],
  );

  const loadClassroom = useCallback(async () => {
    const token = ++loadTokenRef.current;
    let shouldRestoreMedia = false;

    if (!classroomId) {
      setError('Missing classroom id');
      setLoading(false);
      return;
    }

    try {
      await loadFromStorage(classroomId);

      // In web mode, keep a server-storage fallback. Tauri pure-client mode skips it.
      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (useStageStore.getState().stage?.id !== classroomId && !isTauri) {
        log.info('No IndexedDB data, trying server-side storage for:', classroomId);
        try {
          const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.classroom) {
              const { stage, scenes } = json.classroom;
              useStageStore.getState().setStage(stage);
              useStageStore.setState({
                scenes,
                currentSceneId: scenes[0]?.id ?? null,
              });
              log.info('Loaded from server-side storage:', classroomId);

              if (stage.generatedAgentConfigs?.length) {
                const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
                const { useSettingsStore } = await import('@/lib/store/settings');
                const agentIds = await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);
                useSettingsStore.getState().setSelectedAgentIds(agentIds);
                log.info('Hydrated server-generated agents:', agentIds);
              }
            }
          }
        } catch (fetchErr) {
          log.warn('Server-side storage fetch failed:', fetchErr);
        }
      }

      const { loadGeneratedAgentsForStage, useAgentRegistry } =
        await import('@/lib/orchestration/registry/store');
      const generatedAgentIds = await loadGeneratedAgentsForStage(classroomId);
      const { useSettingsStore } = await import('@/lib/store/settings');
      if (generatedAgentIds.length > 0) {
        useSettingsStore.getState().setAgentMode('auto');
        useSettingsStore.getState().setSelectedAgentIds(generatedAgentIds);
      } else {
        const stage = useStageStore.getState().stage;
        const stageAgentIds = stage?.agentIds;
        const registry = useAgentRegistry.getState();
        const cleanIds = stageAgentIds?.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        useSettingsStore.getState().setAgentMode('preset');
        useSettingsStore
          .getState()
          .setSelectedAgentIds(
            cleanIds && cleanIds.length > 0 ? cleanIds : ['default-1', 'default-2', 'default-3'],
          );
      }

      if (useStageStore.getState().stage?.id !== classroomId) {
        throw new Error(locale === 'zh-CN' ? '未找到这个课堂' : 'Classroom not found');
      }

      if (loadTokenRef.current === token && consumeAutoStartFirstLecture(classroomId)) {
        setAutoStartInitialLecture(true);
      }

      shouldRestoreMedia = true;
    } catch (loadError) {
      log.error('Failed to load classroom:', loadError);
      if (loadTokenRef.current === token) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load classroom');
      }
    } finally {
      if (loadTokenRef.current === token) {
        setLoading(false);
      }
    }

    if (shouldRestoreMedia && loadTokenRef.current === token) {
      void restoreClassroomMedia(classroomId, token).catch((mediaError) => {
        log.warn('Failed to restore classroom media:', mediaError);
      });
      startBackgroundGeneration(classroomId, token);
    }
  }, [classroomId, loadFromStorage, locale, restoreClassroomMedia, startBackgroundGeneration]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAutoStartInitialLecture(false);

    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });
    useWhiteboardHistoryStore.getState().clearHistory();

    void loadClassroom();

    return () => {
      loadTokenRef.current += 1;
      stop();
    };
  }, [classroomId, loadClassroom, stop]);

  return (
    <MediaStageProvider value={classroomId}>
      <div className="h-screen flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center text-muted-foreground">
              <p>Loading classroom...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center">
              <p className="text-destructive mb-4">Error: {error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  void loadClassroom();
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <Stage
            onRetryOutline={retrySingleOutline}
            onFinishBookLesson={handleFinishBookLesson}
            autoStartInitialLecture={autoStartInitialLecture}
            onInitialLectureAutoStarted={() => setAutoStartInitialLecture(false)}
          />
        )}
      </div>
    </MediaStageProvider>
  );
}

export default function ClassroomPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center text-muted-foreground">
            <p>Loading classroom...</p>
          </div>
        </div>
      }
    >
      <ClassroomPageContent />
    </Suspense>
  );
}

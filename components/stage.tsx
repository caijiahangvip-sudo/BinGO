'use client';

import { useState, useEffect, useRef, useMemo, useCallback, type CSSProperties } from 'react';
import { useStageStore } from '@/lib/store';
import { PENDING_SCENE_ID } from '@/lib/store/stage';
import { useCanvasStore } from '@/lib/store/canvas';
import { useSettingsStore } from '@/lib/store/settings';
import { TOUR_STEPS, useTourStore, type TourStepDefinition } from '@/lib/store/tour';
import { useI18n } from '@/lib/hooks/use-i18n';
import { SceneSidebar } from './stage/scene-sidebar';
import { Header } from './header';
import { CanvasArea } from '@/components/canvas/canvas-area';
import { Roundtable } from '@/components/roundtable';
import { PlaybackEngine, computePlaybackView } from '@/lib/playback';
import type { EngineMode, TriggerEvent, Effect } from '@/lib/playback';
import { shouldShowTeachingEffects } from '@/lib/playback/effect-visibility';
import { ActionEngine } from '@/lib/action/engine';
import { createAudioPlayer } from '@/lib/utils/audio-player';
import { useDiscussionTTS } from '@/lib/hooks/use-discussion-tts';
import type { AudioIndicatorState } from '@/components/roundtable/audio-indicator';
import type {
  Action,
  DiscussionAction,
  SpeechAction,
  WaitForUserTeachingAction,
} from '@/lib/types/action';
import { cn } from '@/lib/utils';
// Playback state persistence removed — refresh always starts from the beginning
import { ChatArea, type ChatAreaRef } from '@/components/chat/chat-area';
import { agentsToParticipants, useAgentRegistry } from '@/lib/orchestration/registry/store';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { VisuallyHidden } from 'radix-ui';
import { recordTeachBackHintEvidence } from '@/lib/learning/profile-engine';
import { trackEvent } from '@/lib/telemetry';
import type { Scene } from '@/lib/types/stage';

const USER_TEACHING_PROMPT = '请在白板上画出你的思路，并发送你的讲解。';
const USER_REQUESTED_HINT_MESSAGE = '[USER_REQUESTED_HINT]';
const TOUR_TEACHBACK_PROMPT = '现在轮到你当小老师了。请在白板上随意涂鸦，并点击发送讲解。';

type TourTargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function getTourPopoverPosition(
  rect: TourTargetRect | null,
  placement: TourStepDefinition['placement'],
): CSSProperties {
  if (!rect) {
    return {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const margin = 16;
  const maxWidth = 360;
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
  const centeredLeft = Math.min(
    viewportWidth - maxWidth - margin,
    Math.max(margin, rect.left + rect.width / 2 - maxWidth / 2),
  );

  if (placement === 'top') {
    return {
      left: centeredLeft,
      top: Math.max(margin, rect.top - 190),
    };
  }

  if (placement === 'bottom') {
    return {
      left: centeredLeft,
      top: Math.min(viewportHeight - 220, rect.top + rect.height + margin),
    };
  }

  if (placement === 'left') {
    return {
      left: Math.max(margin, rect.left - maxWidth - margin),
      top: Math.min(viewportHeight - 220, Math.max(margin, rect.top + rect.height / 2 - 100)),
    };
  }

  return {
    left: Math.min(viewportWidth - maxWidth - margin, rect.left + rect.width + margin),
    top: Math.min(viewportHeight - 220, Math.max(margin, rect.top + rect.height / 2 - 100)),
  };
}

function TourOverlay({
  step,
  currentStep,
  totalSteps,
  onNext,
  onPrevious,
  onClose,
}: {
  readonly step: TourStepDefinition;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}) {
  const [targetRect, setTargetRect] = useState<TourTargetRect | null>(null);

  useEffect(() => {
    const updateTargetRect = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour-target="${step.targetId}"]`);
      if (!target) {
        setTargetRect(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      const padding = 8;
      setTargetRect({
        top: Math.max(0, rect.top - padding),
        left: Math.max(0, rect.left - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });
    };

    updateTargetRect();
    const interval = window.setInterval(updateTargetRect, 250);
    window.addEventListener('resize', updateTargetRect);
    window.addEventListener('scroll', updateTargetRect, true);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', updateTargetRect);
      window.removeEventListener('scroll', updateTargetRect, true);
    };
  }, [step.targetId]);

  const popoverStyle = getTourPopoverPosition(targetRect, step.placement);
  const isLastStep = currentStep >= totalSteps;
  const top = targetRect?.top ?? 0;
  const left = targetRect?.left ?? 0;
  const width = targetRect?.width ?? 0;
  const height = targetRect?.height ?? 0;
  const right = left + width;
  const bottom = top + height;

  return (
    <div className="fixed inset-0 z-[260] pointer-events-none" aria-live="polite">
      {targetRect ? (
        <>
          <div
            className="absolute left-0 right-0 top-0 bg-gray-950/62 pointer-events-auto"
            style={{ height: top }}
          />
          <div
            className="absolute left-0 bg-gray-950/62 pointer-events-auto"
            style={{ top, width: left, height }}
          />
          <div
            className="absolute bg-gray-950/62 pointer-events-auto"
            style={{ top, left: right, right: 0, height }}
          />
          <div
            className="absolute left-0 right-0 bottom-0 bg-gray-950/62 pointer-events-auto"
            style={{ top: bottom }}
          />
          <div
            className="absolute rounded-lg border-2 border-cyan-300 shadow-[0_0_0_4px_rgba(103,232,249,0.18),0_0_32px_rgba(34,211,238,0.45)] pointer-events-none"
            style={{ top, left, width, height }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-gray-950/62 pointer-events-auto" />
      )}

      <div
        className="absolute w-[min(360px,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-4 shadow-2xl pointer-events-auto dark:border-gray-700 dark:bg-gray-900"
        style={popoverStyle}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-600 dark:text-cyan-300">
              Step {currentStep} / {totalSteps}
            </div>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="关闭导览"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{step.description}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onPrevious}
            disabled={currentStep <= 1}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            上一步
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-cyan-600 px-3 text-sm font-medium text-white transition-colors hover:bg-cyan-700"
          >
            {isLastStep ? '完成' : '下一步'}
            {!isLastStep && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Stage Component
 *
 * The main container for the classroom/course.
 * Combines sidebar (scene navigation) and content area (scene viewer).
 * Supports two modes: autonomous and playback.
 */
export function Stage({
  onRetryOutline,
  onFinishBookLesson,
  autoStartInitialLecture = false,
  onInitialLectureAutoStarted,
  onLectureStart,
}: {
  onRetryOutline?: (outlineId: string) => Promise<void>;
  onFinishBookLesson?: () => Promise<void>;
  autoStartInitialLecture?: boolean;
  onInitialLectureAutoStarted?: () => void;
  onLectureStart?: (scene: Scene) => void;
}) {
  const { t, locale } = useI18n();
  const { mode, getCurrentScene, scenes, currentSceneId, setCurrentSceneId, generatingOutlines } =
    useStageStore();
  const stage = useStageStore((s) => s.stage);
  const failedOutlines = useStageStore.use.failedOutlines();
  const isTourActive = useTourStore.use.isTourActive();
  const currentTourStep = useTourStore.use.currentStep();
  const endTour = useTourStore.use.endTour();
  const nextTourStep = useTourStore.use.nextStep();
  const previousTourStep = useTourStore.use.previousStep();
  const activeTourStep = TOUR_STEPS[currentTourStep - 1] ?? TOUR_STEPS[0];

  const currentScene = getCurrentScene();

  // Layout state from settings store (persisted via localStorage)
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const chatAreaWidth = useSettingsStore((s) => s.chatAreaWidth);
  const setChatAreaWidth = useSettingsStore((s) => s.setChatAreaWidth);
  const chatAreaCollapsed = useSettingsStore((s) => s.chatAreaCollapsed);
  const setChatAreaCollapsed = useSettingsStore((s) => s.setChatAreaCollapsed);
  const setTTSMuted = useSettingsStore((s) => s.setTTSMuted);
  const setTTSVolume = useSettingsStore((s) => s.setTTSVolume);

  // PlaybackEngine state
  const [engineMode, setEngineMode] = useState<EngineMode>('idle');
  const [playbackCompleted, setPlaybackCompleted] = useState(false); // Distinguishes "never played" idle from "finished" idle
  const [lectureSpeech, setLectureSpeech] = useState<string | null>(null); // From PlaybackEngine (lecture)
  const [liveSpeech, setLiveSpeech] = useState<string | null>(null); // From buffer (discussion/QA)
  const [speechProgress, setSpeechProgress] = useState<number | null>(null); // StreamBuffer reveal progress (0–1)
  const [discussionTrigger, setDiscussionTrigger] = useState<TriggerEvent | null>(null);

  // Speaking agent tracking (Issue 2)
  const [speakingAgentId, setSpeakingAgentId] = useState<string | null>(null);

  // Thinking state (Issue 5)
  const [thinkingState, setThinkingState] = useState<{
    stage: string;
    agentId?: string;
  } | null>(null);

  // Cue user state (Issue 7)
  const [isCueUser, setIsCueUser] = useState(false);
  const [cueUserPrompt, setCueUserPrompt] = useState<string | null>(null);

  // End flash state (Issue 3)
  const [showEndFlash, setShowEndFlash] = useState(false);
  const [endFlashSessionType, setEndFlashSessionType] = useState<'qa' | 'discussion'>('discussion');

  // Streaming state for stop button (Issue 1)
  const [chatIsStreaming, setChatIsStreaming] = useState(false);
  const [chatSessionType, setChatSessionType] = useState<string | null>(null);

  // Topic pending state: session is soft-paused, bubble stays visible, waiting for user input
  const [isTopicPending, setIsTopicPending] = useState(false);

  // Active bubble ID for playback highlight in chat area (Issue 8)
  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);

  // Scene switch confirmation dialog state
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPresentationInteractionActive, setIsPresentationInteractionActive] = useState(false);
  const [isFinishingBookLesson, setIsFinishingBookLesson] = useState(false);

  // Whiteboard state (from canvas store so AI tools can open it)
  const whiteboardOpen = useCanvasStore.use.whiteboardOpen();
  const setWhiteboardOpen = useCanvasStore.use.setWhiteboardOpen();
  const studentTeachingEditCount = useCanvasStore.use.studentTeachingEditCount();

  // Selected agents from settings store (Zustand)
  const selectedAgentIds = useSettingsStore((s) => s.selectedAgentIds);
  const ttsMuted = useSettingsStore((s) => s.ttsMuted);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);

  // Generate participants from selected agents
  const participants = useMemo(
    () => agentsToParticipants(selectedAgentIds, t),
    [selectedAgentIds, t],
  );

  // Resolved AgentConfig array for hooks that need full agent objects
  // Subscribe to the agents record so voiceConfig changes trigger re-resolution
  const agentsRecord = useAgentRegistry((s) => s.agents);
  const selectedAgents = useMemo(
    () => selectedAgentIds.map((id) => agentsRecord[id]).filter((a): a is AgentConfig => a != null),
    [agentsRecord, selectedAgentIds],
  );

  // Discussion TTS: audio indicator state
  const [audioIndicatorState, setAudioIndicatorState] = useState<AudioIndicatorState>('idle');
  const [audioAgentId, setAudioAgentId] = useState<string | null>(null);

  const discussionTTS = useDiscussionTTS({
    enabled: ttsEnabled && !ttsMuted,
    agents: selectedAgents,
    onAudioStateChange: (agentId, state) => {
      setAudioAgentId(agentId);
      setAudioIndicatorState(state);
    },
  });

  // Pick a student agent for discussion trigger (prioritize student > non-teacher > fallback)
  const pickStudentAgent = useCallback((): string => {
    const registry = useAgentRegistry.getState();
    const agents = selectedAgentIds
      .map((id) => registry.getAgent(id))
      .filter((a): a is AgentConfig => a != null);
    const students = agents.filter((a) => a.role === 'student');
    if (students.length > 0) {
      return students[Math.floor(Math.random() * students.length)].id;
    }
    const nonTeachers = agents.filter((a) => a.role !== 'teacher');
    if (nonTeachers.length > 0) {
      return nonTeachers[Math.floor(Math.random() * nonTeachers.length)].id;
    }
    return agents[0]?.id || 'default-1';
  }, [selectedAgentIds]);

  const pickTourDebateAgents = useCallback((): { agentAId: string; agentBId: string } => {
    const registry = useAgentRegistry.getState();
    const candidateIds =
      selectedAgentIds.length > 0 ? selectedAgentIds : ['default-1', 'default-2'];
    const candidates = candidateIds
      .map((id) => registry.getAgent(id))
      .filter((agent): agent is AgentConfig => agent != null);
    const agentA = candidates.find((agent) => agent.role === 'teacher')?.id || 'default-1';
    const agentB =
      candidates.find((agent) => agent.id !== agentA && agent.role !== 'teacher')?.id ||
      (agentA === 'default-2' ? 'default-1' : 'default-2');

    return { agentAId: agentA, agentBId: agentB };
  }, [selectedAgentIds]);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const audioPlayerRef = useRef(createAudioPlayer());
  const chatAreaRef = useRef<ChatAreaRef>(null);
  const lectureSessionIdRef = useRef<string | null>(null);
  const lectureActionCounterRef = useRef(0);
  const discussionAbortRef = useRef<AbortController | null>(null);
  const presentationIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingTeachingWaitRef = useRef<{
    resolve: () => void;
    initialEditCount: number;
    hasWhiteboardEdit: boolean;
    hasUserMessage: boolean;
    createdByTour?: boolean;
  } | null>(null);
  const tourTeachingActiveRef = useRef(false);
  const triggeredTourStepsRef = useRef(new Set<number>());
  // Guard to prevent double flash when manual stop triggers onDiscussionEnd
  const manualStopRef = useRef(false);
  // Monotonic counter incremented on each scene switch — used to discard stale SSE callbacks
  const sceneEpochRef = useRef(0);
  // When true, the next engine init will auto-start playback (for auto-play scene advance)
  const autoStartRef = useRef(false);
  const initialAutoStartConsumedRef = useRef(false);
  const lectureStartTriggeredRef = useRef(new Set<string>());
  // Discussion buffer-level pause state (distinct from soft-pause which aborts SSE)
  const [isDiscussionPaused, setIsDiscussionPaused] = useState(false);

  useEffect(() => {
    initialAutoStartConsumedRef.current = false;
    lectureStartTriggeredRef.current.clear();
  }, [stage?.id]);

  const notifyLectureStart = useCallback(
    (scene: Scene | null | undefined) => {
      if (!scene || !scene.actions || scene.actions.length === 0) return;
      if (lectureStartTriggeredRef.current.has(scene.id)) return;

      lectureStartTriggeredRef.current.add(scene.id);
      onLectureStart?.(scene);
    },
    [onLectureStart],
  );

  const startSceneLecture = useCallback(
    async (scene: Scene, playbackStartMode: 'start' | 'continue') => {
      const engine = engineRef.current;
      if (!engine) return;

      if (chatAreaRef.current) {
        const sessionId = await chatAreaRef.current.startLecture(scene.id);
        lectureSessionIdRef.current = sessionId;
      }

      notifyLectureStart(scene);

      if (playbackStartMode === 'start') {
        lectureActionCounterRef.current = 0;
        engine.start();
      } else {
        engine.continuePlayback();
      }
    },
    [notifyLectureStart],
  );

  useEffect(() => {
    if (
      !autoStartInitialLecture ||
      initialAutoStartConsumedRef.current ||
      !currentScene ||
      !engineRef.current
    ) {
      return;
    }

    initialAutoStartConsumedRef.current = true;
    onInitialLectureAutoStarted?.();
    void startSceneLecture(currentScene, 'start');
  }, [autoStartInitialLecture, currentScene, onInitialLectureAutoStarted, startSceneLecture]);

  /**
   * Resume a soft-paused topic: re-call /chat with existing session messages.
   * The director picks the next agent to continue.
   */
  const doResumeTopic = useCallback(async () => {
    // Clear old bubble immediately — no lingering on interrupted text
    setIsTopicPending(false);
    setLiveSpeech(null);
    setSpeakingAgentId(null);
    setThinkingState({ stage: 'director' });
    setChatIsStreaming(true);
    // Transition engine back to live — onInputActivate paused it when soft-pausing,
    // so we must explicitly resume to keep engine mode in sync with the chat loop.
    engineRef.current?.resume();
    // Fire new chat round — SSE events will drive thinking → agent_start → speech
    await chatAreaRef.current?.resumeActiveSession();
  }, []);

  const completeTeachingWaitIfReady = useCallback(() => {
    const pending = pendingTeachingWaitRef.current;
    if (!pending || !pending.hasUserMessage || !pending.hasWhiteboardEdit) return;

    pendingTeachingWaitRef.current = null;
    if (pending.createdByTour) {
      tourTeachingActiveRef.current = false;
      useCanvasStore.getState().setStudentTeachingState(false, null);
    }
    setIsCueUser(false);
    setCueUserPrompt(null);
    pending.resolve();
  }, []);

  const cancelPendingTeachingWait = useCallback(() => {
    const pending = pendingTeachingWaitRef.current;
    if (!pending) return;

    pendingTeachingWaitRef.current = null;
    useCanvasStore.getState().setStudentTeachingState(false, null);
    setIsCueUser(false);
    setCueUserPrompt(null);
    pending.resolve();
  }, []);

  const handleEndTour = useCallback(() => {
    triggeredTourStepsRef.current.clear();
    if (pendingTeachingWaitRef.current?.createdByTour) {
      cancelPendingTeachingWait();
    } else if (tourTeachingActiveRef.current) {
      useCanvasStore.getState().setStudentTeachingState(false, null);
    }
    tourTeachingActiveRef.current = false;
    endTour();
    trackEvent('icap_tour', {
      type: 'tour_closed',
      stageId: useStageStore.getState().stage?.id ?? null,
      step: currentTourStep,
    });
  }, [cancelPendingTeachingWait, currentTourStep, endTour]);

  const handleTourNext = useCallback(() => {
    if (currentTourStep >= TOUR_STEPS.length) {
      handleEndTour();
      return;
    }
    nextTourStep();
  }, [currentTourStep, handleEndTour, nextTourStep]);

  const handleTourPrevious = useCallback(() => {
    previousTourStep();
  }, [previousTourStep]);

  const handleWaitForUserTeaching = useCallback(
    (action: WaitForUserTeachingAction) =>
      new Promise<void>((resolve) => {
        const prompt = action.prompt || USER_TEACHING_PROMPT;
        cancelPendingTeachingWait();
        pendingTeachingWaitRef.current = {
          resolve,
          initialEditCount: useCanvasStore.getState().studentTeachingEditCount,
          hasWhiteboardEdit: false,
          hasUserMessage: false,
        };
        setIsCueUser(true);
        setCueUserPrompt(prompt);
        chatAreaRef.current?.switchToTab('chat');
      }),
    [cancelPendingTeachingWait],
  );

  const handleNeedTeachingHint = useCallback(() => {
    const pending = pendingTeachingWaitRef.current;
    if (!pending) return;

    trackEvent('icap_interaction', {
      type: 'teach_back_need_hint',
      stageId: useStageStore.getState().stage?.id ?? null,
      sceneId: currentSceneId,
      promptLength: (cueUserPrompt || USER_TEACHING_PROMPT).length,
      editCount: studentTeachingEditCount,
    });

    void recordTeachBackHintEvidence({
      stage: useStageStore.getState().stage,
      sceneId: currentSceneId,
      prompt: cueUserPrompt || USER_TEACHING_PROMPT,
    }).catch((error) => {
      console.warn('[TeachBack] Failed to record hint bailout evidence:', error);
    });

    pendingTeachingWaitRef.current = null;
    useCanvasStore.getState().setStudentTeachingState(false, null);
    setIsCueUser(false);
    setCueUserPrompt(null);
    chatAreaRef.current?.switchToTab('chat');
    setChatIsStreaming(true);
    setChatSessionType('qa');
    setThinkingState({ stage: 'director' });

    void chatAreaRef.current
      ?.sendMessage(USER_REQUESTED_HINT_MESSAGE, { hidden: true })
      .catch((error) => {
        console.warn('[TeachBack] Failed to send hidden hint request:', error);
      });

    pending.resolve();
  }, [cueUserPrompt, currentSceneId, studentTeachingEditCount]);

  useEffect(() => {
    const pending = pendingTeachingWaitRef.current;
    if (!pending) return;
    if (studentTeachingEditCount <= pending.initialEditCount) return;
    pending.hasWhiteboardEdit = true;
    completeTeachingWaitIfReady();
  }, [completeTeachingWaitIfReady, studentTeachingEditCount]);

  /** Reset all live/discussion state (shared by doSessionCleanup & onDiscussionEnd) */
  const resetLiveState = useCallback(() => {
    setLiveSpeech(null);
    setSpeakingAgentId(null);
    setSpeechProgress(null);
    setThinkingState(null);
    setIsCueUser(false);
    setCueUserPrompt(null);
    setIsTopicPending(false);
    setChatIsStreaming(false);
    setChatSessionType(null);
    setIsDiscussionPaused(false);
  }, []);

  /** Full scene reset (scene switch) — resetLiveState + lecture/visual state */
  const resetSceneState = useCallback(() => {
    cancelPendingTeachingWait();
    useCanvasStore.getState().clearAllEffects();
    resetLiveState();
    setPlaybackCompleted(false);
    setLectureSpeech(null);
    setSpeechProgress(null);
    setShowEndFlash(false);
    setActiveBubbleId(null);
    setDiscussionTrigger(null);
  }, [cancelPendingTeachingWait, resetLiveState]);

  useEffect(() => {
    if (shouldShowTeachingEffects(engineMode)) return;
    useCanvasStore.getState().clearAllEffects();
  }, [engineMode]);

  /** Request failure should exit live discussion UI without hard-closing the session. */
  const handleLiveSessionError = useCallback(() => {
    engineRef.current?.handleDiscussionError();
    useCanvasStore.getState().clearAllEffects();
    resetLiveState();
    setActiveBubbleId(null);
  }, [resetLiveState]);

  /**
   * Unified session cleanup — called by both roundtable stop button and chat area end button.
   * Handles: engine transition, flash, roundtable state clearing.
   */
  const doSessionCleanup = useCallback(() => {
    const activeType = chatSessionType;

    // Engine cleanup — guard to avoid double flash from onDiscussionEnd
    manualStopRef.current = true;
    engineRef.current?.handleEndDiscussion();
    manualStopRef.current = false;

    // Show end flash with correct session type
    if (activeType === 'qa' || activeType === 'discussion') {
      setEndFlashSessionType(activeType);
      setShowEndFlash(true);
      setTimeout(() => setShowEndFlash(false), 1800);
    }

    // Stop any in-flight discussion TTS audio
    discussionTTS.cleanup();
    useCanvasStore.getState().clearAllEffects();

    resetLiveState();
  }, [chatSessionType, resetLiveState, discussionTTS]);

  // Shared stop-discussion handler (used by both Roundtable and Canvas toolbar)
  const handleStopDiscussion = useCallback(async () => {
    await chatAreaRef.current?.endActiveSession();
    doSessionCleanup();
  }, [doSessionCleanup]);

  useEffect(() => {
    if (!isTourActive || triggeredTourStepsRef.current.has(currentTourStep)) return;

    triggeredTourStepsRef.current.add(currentTourStep);

    if (currentTourStep === 1) {
      useStageStore.getState().setMode('playback');
      setChatAreaCollapsed(false);
      return;
    }

    if (currentTourStep === 2) {
      const { agentAId, agentBId } = pickTourDebateAgents();
      setWhiteboardOpen(true);
      setChatAreaCollapsed(false);
      chatAreaRef.current?.switchToTab('chat');
      setChatIsStreaming(true);
      setChatSessionType('discussion');
      setThinkingState({ stage: 'director' });

      void chatAreaRef.current
        ?.startDiscussion({
          topic: 'BinGo ICAP 互动课堂是否比传统讲授更能促进深度学习？',
          prompt:
            'This is an onboarding tour debate. Agent A must argue the affirmative side and Agent B must argue the opposing side. Keep each turn short and write visible claims on the whiteboard.',
          agentId: agentAId,
          discussionMode: 'debate',
          debateConfig: {
            agentAId,
            agentBId,
            topic: 'BinGo ICAP 互动课堂是否比传统讲授更能促进深度学习？',
            agentAPersona: '支持方：强调 ICAP、多模态白板和实时反馈带来的深度学习价值。',
            agentBPersona: '反方：强调认知负荷、注意力分散和教师引导成本。',
          },
        })
        .catch((error) => {
          setChatIsStreaming(false);
          setChatSessionType(null);
          setThinkingState(null);
          console.warn('[Tour] Failed to start debate flow:', error);
        });
      return;
    }

    if (currentTourStep === 3) {
      void chatAreaRef.current?.endActiveSession();
      doSessionCleanup();
      setWhiteboardOpen(true);
      setChatAreaCollapsed(false);
      chatAreaRef.current?.switchToTab('chat');
      useCanvasStore.getState().setStudentTeachingState(true, TOUR_TEACHBACK_PROMPT);
      tourTeachingActiveRef.current = true;
      pendingTeachingWaitRef.current = {
        resolve: () => undefined,
        initialEditCount: useCanvasStore.getState().studentTeachingEditCount,
        hasWhiteboardEdit: false,
        hasUserMessage: false,
        createdByTour: true,
      };
      setIsCueUser(true);
      setCueUserPrompt(TOUR_TEACHBACK_PROMPT);
      return;
    }

    if (currentTourStep === 4) {
      if (pendingTeachingWaitRef.current?.createdByTour) {
        cancelPendingTeachingWait();
      } else if (tourTeachingActiveRef.current) {
        useCanvasStore.getState().setStudentTeachingState(false, null);
      }
      tourTeachingActiveRef.current = false;
      setWhiteboardOpen(false);
      setChatAreaCollapsed(false);
    }
  }, [
    cancelPendingTeachingWait,
    currentTourStep,
    doSessionCleanup,
    isTourActive,
    pickTourDebateAgents,
    setChatAreaCollapsed,
    setWhiteboardOpen,
  ]);

  const clearPresentationIdleTimer = useCallback(() => {
    if (presentationIdleTimerRef.current) {
      clearTimeout(presentationIdleTimerRef.current);
      presentationIdleTimerRef.current = null;
    }
  }, []);

  const resetPresentationIdleTimer = useCallback(() => {
    setControlsVisible(true);
    clearPresentationIdleTimer();
    if (isPresenting && !isPresentationInteractionActive) {
      presentationIdleTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  }, [clearPresentationIdleTimer, isPresenting, isPresentationInteractionActive]);

  const togglePresentation = useCallback(async () => {
    const stageElement = stageRef.current;
    if (!stageElement) return;

    try {
      if (document.fullscreenElement === stageElement) {
        // Unlock Escape key before exiting fullscreen
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.unlock?.();
        await document.exitFullscreen();
        return;
      }

      setControlsVisible(true);
      await stageElement.requestFullscreen();
      // Lock Escape key so it doesn't auto-exit fullscreen (#255)
      // Escape is handled manually in our keydown handler instead
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (navigator as any).keyboard?.lock?.(['Escape']).catch(() => {});
      setSidebarCollapsed(true);
      setChatAreaCollapsed(true);
    } catch {
      // Firefox may deny fullscreen from certain keyboard events (e.g. F11)
      console.warn('[Presentation] Fullscreen request denied — browser policy');
    }
  }, [setChatAreaCollapsed, setSidebarCollapsed]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === stageRef.current;
      setIsPresenting(active);

      if (!active) {
        // Ensure keyboard unlock on any fullscreen exit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.unlock?.();
        setControlsVisible(true);
        clearPresentationIdleTimer();
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [clearPresentationIdleTimer]);

  useEffect(() => {
    if (!isPresenting) {
      setControlsVisible(true);
      clearPresentationIdleTimer();
      return;
    }

    const handleActivity = () => {
      resetPresentationIdleTimer();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    if (isPresentationInteractionActive) {
      setControlsVisible(true);
      clearPresentationIdleTimer();
    } else {
      resetPresentationIdleTimer();
    }

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      clearPresentationIdleTimer();
    };
  }, [
    clearPresentationIdleTimer,
    isPresenting,
    isPresentationInteractionActive,
    resetPresentationIdleTimer,
  ]);

  // Initialize playback engine when scene changes
  useEffect(() => {
    // Bump epoch so any stale SSE callbacks from the previous scene are discarded
    sceneEpochRef.current++;

    // End any active QA/discussion session — this synchronously aborts the SSE
    // stream inside use-chat-sessions (abortControllerRef.abort()), preventing
    // stale onLiveSpeech callbacks from leaking into the new scene.
    chatAreaRef.current?.endActiveSession();

    // Also abort the engine-level discussion controller
    if (discussionAbortRef.current) {
      discussionAbortRef.current.abort();
      discussionAbortRef.current = null;
    }

    // Stop any in-flight discussion TTS audio on scene switch
    discussionTTS.cleanup();

    // Stop previous engine before any early return so timers/effects do not leak
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }

    // Reset all roundtable/live state so scenes are fully isolated
    resetSceneState();

    if (!currentScene || !currentScene.actions || currentScene.actions.length === 0) {
      setEngineMode('idle');

      return;
    }

    // Create ActionEngine for playback (with audioPlayer for TTS)
    const actionEngine = new ActionEngine(useStageStore, audioPlayerRef.current, {
      onWaitForUserTeaching: handleWaitForUserTeaching,
    });

    // Create new PlaybackEngine
    const engine = new PlaybackEngine([currentScene], actionEngine, audioPlayerRef.current, {
      onModeChange: (mode) => {
        setEngineMode(mode);
      },
      onSceneChange: (_sceneId) => {
        // Scene change handled by engine
      },
      onSpeechStart: (text) => {
        setLectureSpeech(text);
        // Add to lecture session with incrementing index for dedup
        // Chat area pacing is handled by the StreamBuffer (onTextReveal)
        if (lectureSessionIdRef.current) {
          const idx = lectureActionCounterRef.current++;
          const speechId = `speech-${Date.now()}`;
          chatAreaRef.current?.addLectureMessage(
            lectureSessionIdRef.current,
            { id: speechId, type: 'speech', text } as Action,
            idx,
          );
          // Track active bubble for highlight (Issue 8)
          const msgId = chatAreaRef.current?.getLectureMessageId(lectureSessionIdRef.current!);
          if (msgId) setActiveBubbleId(msgId);
        }
      },
      onSpeechEnd: () => {
        // Don't clear lectureSpeech — let it persist until the next
        // onSpeechStart replaces it or the scene transitions.
        // Clearing here causes fallback to idleText (first sentence).
        setActiveBubbleId(null);
      },
      onEffectFire: (effect: Effect) => {
        // Add to lecture session with incrementing index
        if (
          lectureSessionIdRef.current &&
          (effect.kind === 'spotlight' || effect.kind === 'laser')
        ) {
          const idx = lectureActionCounterRef.current++;
          chatAreaRef.current?.addLectureMessage(
            lectureSessionIdRef.current,
            {
              id: `${effect.kind}-${Date.now()}`,
              type: effect.kind,
              elementId: effect.targetId,
            } as Action,
            idx,
          );
        }
      },
      onProactiveShow: (trigger) => {
        if (!trigger.agentId) {
          // Mutate in-place so engine.currentTrigger also gets the agentId
          // (confirmDiscussion reads agentId from the same object reference)
          trigger.agentId = pickStudentAgent();
        }
        setDiscussionTrigger(trigger);
      },
      onProactiveHide: () => {
        setDiscussionTrigger(null);
      },
      onDiscussionConfirmed: (topic, prompt, agentId) => {
        // Start SSE discussion via ChatArea
        handleDiscussionSSE(topic, prompt, agentId);
      },
      onDiscussionEnd: () => {
        // Abort any active SSE
        if (discussionAbortRef.current) {
          discussionAbortRef.current.abort();
          discussionAbortRef.current = null;
        }
        setDiscussionTrigger(null);
        // Stop any in-flight discussion TTS audio
        discussionTTS.cleanup();
        // Clear roundtable state (idempotent — may already be cleared by doSessionCleanup)
        resetLiveState();
        // Only show flash for engine-initiated ends (not manual stop — that's handled by doSessionCleanup)
        if (!manualStopRef.current) {
          setEndFlashSessionType('discussion');
          setShowEndFlash(true);
          setTimeout(() => setShowEndFlash(false), 1800);
        }
        // If all actions are exhausted (discussion was the last action), mark
        // playback as completed so the bubble shows reset instead of play.
        if (engineRef.current?.isExhausted()) {
          setPlaybackCompleted(true);
        }
      },
      onUserInterrupt: (text) => {
        chatAreaRef.current?.sendMessage(text);
      },
      isAgentSelected: (agentId) => {
        const ids = useSettingsStore.getState().selectedAgentIds;
        return ids.includes(agentId);
      },
      getPlaybackSpeed: () => useSettingsStore.getState().playbackSpeed || 1,
      onComplete: () => {
        // lectureSpeech intentionally NOT cleared — last sentence stays visible
        // until scene transition (auto-play) or user restarts. Scene change
        // effect handles the reset.
        setPlaybackCompleted(true);

        // End lecture session on playback complete
        if (lectureSessionIdRef.current) {
          chatAreaRef.current?.endSession(lectureSessionIdRef.current);
          lectureSessionIdRef.current = null;
        }
        // Auto-play: advance to next scene after a short pause
        const { autoPlayLecture } = useSettingsStore.getState();
        if (autoPlayLecture) {
          setTimeout(() => {
            const stageState = useStageStore.getState();
            if (!useSettingsStore.getState().autoPlayLecture) return;
            const allScenes = stageState.scenes;
            const curId = stageState.currentSceneId;
            const idx = allScenes.findIndex((s) => s.id === curId);
            if (idx >= 0 && idx < allScenes.length - 1) {
              const currentScene = allScenes[idx];
              if (
                currentScene.type === 'quiz' ||
                currentScene.type === 'interactive' ||
                currentScene.type === 'pbl'
              ) {
                return;
              }
              autoStartRef.current = true;
              stageState.setCurrentSceneId(allScenes[idx + 1].id);
            } else if (idx === allScenes.length - 1 && stageState.generatingOutlines.length > 0) {
              // Last scene exhausted but next is still generating — go to pending page
              const currentScene = allScenes[idx];
              if (
                currentScene.type === 'quiz' ||
                currentScene.type === 'interactive' ||
                currentScene.type === 'pbl'
              ) {
                return;
              }
              autoStartRef.current = true;
              stageState.setCurrentSceneId(PENDING_SCENE_ID);
            }
          }, 1500);
        }
      },
    });

    engineRef.current = engine;

    const shouldAutoStartInitial = autoStartInitialLecture && !initialAutoStartConsumedRef.current;
    const shouldAutoStart = autoStartRef.current || shouldAutoStartInitial;

    // Auto-start if triggered by auto-play scene advance or fresh classroom entry
    if (shouldAutoStart) {
      autoStartRef.current = false;
      if (shouldAutoStartInitial) {
        initialAutoStartConsumedRef.current = true;
        onInitialLectureAutoStarted?.();
      }
      void startSceneLecture(currentScene, 'start');
    } else {
      // Load saved playback state and restore position (but never auto-play).
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when scene changes, functions are stable refs
  }, [currentScene]);

  // Cleanup on unmount
  useEffect(() => {
    const audioPlayer = audioPlayerRef.current;
    const chatArea = chatAreaRef.current;
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
      audioPlayer.destroy();
      if (discussionAbortRef.current) {
        discussionAbortRef.current.abort();
      }
      discussionTTS.cleanup();
      chatArea?.endActiveSession();
      clearPresentationIdleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup, clearPresentationIdleTimer is stable
  }, []);

  // Sync mute state from settings store to audioPlayer
  useEffect(() => {
    audioPlayerRef.current.setMuted(ttsMuted);
  }, [ttsMuted]);

  // Sync volume from settings store to audioPlayer
  const ttsVolume = useSettingsStore((s) => s.ttsVolume);
  useEffect(() => {
    if (!ttsMuted) {
      audioPlayerRef.current.setVolume(ttsVolume);
    }
  }, [ttsVolume, ttsMuted]);

  // Sync playback speed to audio player (for live-updating current audio)
  const playbackSpeed = useSettingsStore((s) => s.playbackSpeed);
  useEffect(() => {
    audioPlayerRef.current.setPlaybackRate(playbackSpeed);
  }, [playbackSpeed]);

  /**
   * Handle discussion SSE — POST /api/chat and push events to engine
   */
  const handleDiscussionSSE = useCallback(
    async (topic: string, prompt?: string, agentId?: string) => {
      // Start discussion display in ChatArea (lecture speech is preserved independently)
      chatAreaRef.current?.startDiscussion({
        topic,
        prompt,
        agentId: agentId || 'default-1',
      });
      // Auto-switch to chat tab when discussion starts
      chatAreaRef.current?.switchToTab('chat');
      // Immediately mark streaming for synchronized stop button
      setChatIsStreaming(true);
      setChatSessionType('discussion');
      // Optimistic thinking: show thinking dots immediately (same as onMessageSend)
      setThinkingState({ stage: 'director' });
    },
    [],
  );

  const handleRoundtableMessageSend = useCallback(
    async (msg: string) => {
      // Always clear Level-1 pause state 鈥?the closure may hold a stale
      // isDiscussionPaused value (e.g. voice input's onTranscription callback
      // captures onMessageSend before React re-renders with the updated state).
      setIsDiscussionPaused(false);
      // Clear the sticky livePausedRef so the next agent-loop buffer
      // starts unpaused. (pauseActiveLiveBuffer sets a ref that new
      // buffers inherit 鈥?must be cleared before sendMessage creates one.)
      chatAreaRef.current?.resumeActiveLiveBuffer();
      // Flush any buffered / in-flight TTS audio from the previous
      // agent turn so it doesn't leak into the next round.
      discussionTTS.cleanup();
      // Clear soft-paused state 鈥?user is continuing the topic
      if (isTopicPending) {
        setIsTopicPending(false);
        setLiveSpeech(null);
        setSpeakingAgentId(null);
      }
      const pendingTeachingWait = pendingTeachingWaitRef.current;
      const isDebateJudgment =
        !pendingTeachingWait &&
        chatAreaRef.current?.getActiveDiscussionMode() === 'debate' &&
        msg.trim().length > 0;

      if (isDebateJudgment) {
        trackEvent('icap_interaction', {
          type: 'debate_judgment',
          stageId: useStageStore.getState().stage?.id ?? null,
          sceneId: currentSceneId,
          textLength: msg.trim().length,
        });
      }

      if (pendingTeachingWait) {
        pendingTeachingWait.hasUserMessage = true;
        let snapshotUrl: string | null = null;

        try {
          snapshotUrl = await useCanvasStore.getState().getCanvasSnapshot();
        } catch (error) {
          console.warn('[TeachBack] Failed to capture whiteboard snapshot:', error);
        }

        try {
          await chatAreaRef.current?.sendMessage(msg, {
            attachments: snapshotUrl
              ? [
                  {
                    type: 'image',
                    mediaType: 'image/jpeg',
                    url: snapshotUrl,
                    filename: 'whiteboard-teachback.jpg',
                  },
                ]
              : undefined,
          });
        } catch (error) {
          console.warn('[TeachBack] Failed to send teach-back message:', error);
        } finally {
          completeTeachingWaitIfReady();
        }
      } else if (
        // User interrupts during playback — handleUserInterrupt triggers
        // onUserInterrupt callback which already calls sendMessage, so skip
        // the direct sendMessage below to avoid sending twice.
        // Include 'paused' because onInputActivate pauses the engine before
        // the user finishes typing — without this the interrupt position
        // would never be saved and resuming after QA skips to the next sentence.
        engineRef.current &&
        (engineMode === 'playing' || engineMode === 'live' || engineMode === 'paused')
      ) {
        engineRef.current.handleUserInterrupt(msg);
      } else {
        chatAreaRef.current?.sendMessage(msg);
      }
      // Auto-switch to chat tab when user sends a message
      chatAreaRef.current?.switchToTab('chat');
      setIsCueUser(false);
      // Immediately mark streaming for synchronized stop button
      setChatIsStreaming(true);
      setChatSessionType(chatSessionType || 'qa');
      // Optimistic thinking: show thinking dots immediately so there's
      // no blank gap between userMessage expiry and the SSE thinking event.
      // The real SSE event will overwrite this with the same or updated value.
      setThinkingState({ stage: 'director' });
    },
    [
      chatSessionType,
      completeTeachingWaitIfReady,
      currentSceneId,
      discussionTTS,
      engineMode,
      isTopicPending,
    ],
  );

  // First speech text for idle display (extracted here for playbackView)
  const firstSpeechText = useMemo(
    () => currentScene?.actions?.find((a): a is SpeechAction => a.type === 'speech')?.text ?? null,
    [currentScene],
  );

  // Whether the speaking agent is a student (for bubble role derivation)
  const speakingStudentFlag = useMemo(() => {
    if (!speakingAgentId) return false;
    const agent = useAgentRegistry.getState().getAgent(speakingAgentId);
    return agent?.role !== 'teacher';
  }, [speakingAgentId]);

  // Centralised derived playback view
  const playbackView = useMemo(
    () =>
      computePlaybackView({
        engineMode,
        lectureSpeech,
        liveSpeech,
        speakingAgentId,
        thinkingState,
        isCueUser,
        isTopicPending,
        chatIsStreaming,
        discussionTrigger,
        playbackCompleted,
        idleText: firstSpeechText,
        speakingStudent: speakingStudentFlag,
        sessionType: chatSessionType,
      }),
    [
      engineMode,
      lectureSpeech,
      liveSpeech,
      speakingAgentId,
      thinkingState,
      isCueUser,
      isTopicPending,
      chatIsStreaming,
      discussionTrigger,
      playbackCompleted,
      firstSpeechText,
      speakingStudentFlag,
      chatSessionType,
    ],
  );

  const isTopicActive = playbackView.isTopicActive;

  /**
   * Gated scene switch — if a topic is active, show AlertDialog before switching.
   * Returns true if the switch was immediate, false if gated (dialog shown).
   */
  const gatedSceneSwitch = useCallback(
    (targetSceneId: string): boolean => {
      if (targetSceneId === currentSceneId) return false;
      if (isTopicActive) {
        setPendingSceneId(targetSceneId);
        return false;
      }
      setCurrentSceneId(targetSceneId);
      return true;
    },
    [currentSceneId, isTopicActive, setCurrentSceneId],
  );

  /** User confirmed scene switch via AlertDialog */
  const confirmSceneSwitch = useCallback(() => {
    if (!pendingSceneId) return;
    chatAreaRef.current?.endActiveSession();
    doSessionCleanup();
    setCurrentSceneId(pendingSceneId);
    setPendingSceneId(null);
  }, [pendingSceneId, setCurrentSceneId, doSessionCleanup]);

  /** User cancelled scene switch via AlertDialog */
  const cancelSceneSwitch = useCallback(() => {
    setPendingSceneId(null);
  }, []);

  // play/pause toggle
  const handlePlayPause = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    const mode = engine.getMode();
    if (mode === 'playing' || mode === 'live') {
      engine.pause();
      // Pause lecture buffer so text stops immediately
      if (lectureSessionIdRef.current) {
        chatAreaRef.current?.pauseBuffer(lectureSessionIdRef.current);
      }
    } else if (mode === 'paused') {
      engine.resume();
      // Resume lecture buffer
      if (lectureSessionIdRef.current) {
        chatAreaRef.current?.resumeBuffer(lectureSessionIdRef.current);
      }
    } else {
      if (!currentScene) return;
      const wasCompleted = playbackCompleted;
      setPlaybackCompleted(false);
      if (wasCompleted) {
        // Restart from beginning (user clicked restart after completion)
        await startSceneLecture(currentScene, 'start');
      } else {
        // Continue from current position (e.g. after discussion end)
        await startSceneLecture(currentScene, 'continue');
      }
    }
  }, [playbackCompleted, currentScene, startSceneLecture]);

  // get scene information
  const isPendingScene = currentSceneId === PENDING_SCENE_ID;
  const hasNextPending = generatingOutlines.length > 0;

  // previous scene (gated)
  const handlePreviousScene = useCallback(() => {
    if (isPendingScene) {
      // From pending page → go to last real scene
      if (scenes.length > 0) {
        gatedSceneSwitch(scenes[scenes.length - 1].id);
      }
      return;
    }
    const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
    if (currentIndex > 0) {
      gatedSceneSwitch(scenes[currentIndex - 1].id);
    }
  }, [currentSceneId, gatedSceneSwitch, isPendingScene, scenes]);

  // next scene (gated)
  const handleNextScene = useCallback(() => {
    if (isPendingScene) return; // Already on pending, nowhere to go
    const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
    if (currentIndex < scenes.length - 1) {
      gatedSceneSwitch(scenes[currentIndex + 1].id);
    } else if (hasNextPending) {
      // On last real scene → advance to pending page
      setCurrentSceneId(PENDING_SCENE_ID);
    }
  }, [currentSceneId, gatedSceneSwitch, hasNextPending, isPendingScene, scenes, setCurrentSceneId]);

  const currentSceneIndex = isPendingScene
    ? scenes.length
    : scenes.findIndex((s) => s.id === currentSceneId);
  const totalScenesCount = scenes.length + (hasNextPending ? 1 : 0);

  // get action information
  const totalActions = currentScene?.actions?.length || 0;

  // whiteboard toggle
  const handleWhiteboardToggle = () => {
    setWhiteboardOpen(!whiteboardOpen);
  };

  const isPresentationShortcutTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;

    if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
      return true;
    }

    return (
      target.closest(
        ['input', 'textarea', 'select', '[role="slider"]', 'input[type="range"]'].join(', '),
      ) !== null
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Let modifier-key combos (Ctrl+C, Ctrl+S, etc.) pass through to the browser
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        isPresentationShortcutTarget(event.target) ||
        isPresentationShortcutTarget(document.activeElement)
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          if (!isPresenting) return;
          event.preventDefault();
          handlePreviousScene();
          resetPresentationIdleTimer();
          break;
        case 'ArrowRight':
          if (!isPresenting) return;
          event.preventDefault();
          handleNextScene();
          resetPresentationIdleTimer();
          break;
        case ' ':
        case 'Spacebar':
          // During active QA/discussion, Roundtable owns Space for
          // buffer-level pause/resume — don't also fire engine play/pause.
          if (chatSessionType === 'qa' || chatSessionType === 'discussion') break;
          event.preventDefault();
          handlePlayPause();
          break;
        case 'Escape':
          // With keyboard.lock(), Escape no longer auto-exits fullscreen.
          // If panels are open, roundtable handles Escape (close panels).
          // If no panels are open, manually exit fullscreen.
          if (isPresenting && !isPresentationInteractionActive) {
            event.preventDefault();
            togglePresentation();
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          setTTSVolume(ttsVolume + 0.1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          setTTSVolume(ttsVolume - 0.1);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          setTTSMuted(!ttsMuted);
          break;
        case 's':
        case 'S':
          event.preventDefault();
          setSidebarCollapsed(!sidebarCollapsed);
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          setChatAreaCollapsed(!chatAreaCollapsed);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    chatSessionType,
    chatAreaCollapsed,
    handleNextScene,
    handlePlayPause,
    handlePreviousScene,
    isPresenting,
    isPresentationInteractionActive,
    isPresentationShortcutTarget,
    resetPresentationIdleTimer,
    setChatAreaCollapsed,
    setSidebarCollapsed,
    setTTSMuted,
    setTTSVolume,
    sidebarCollapsed,
    togglePresentation,
    ttsMuted,
    ttsVolume,
  ]);

  // Intercept F11 to use our presentation fullscreen instead of browser fullscreen
  // This way ESC can exit fullscreen (browser F11 fullscreen requires F11 to exit)
  useEffect(() => {
    const onF11 = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        togglePresentation();
      }
    };

    window.addEventListener('keydown', onF11);
    return () => window.removeEventListener('keydown', onF11);
  }, [togglePresentation]);

  // Map engine mode to the CanvasArea's expected engine state
  const canvasEngineState = (() => {
    switch (engineMode) {
      case 'playing':
      case 'live':
        return 'playing';
      case 'paused':
        return 'paused';
      default:
        return 'idle';
    }
  })();

  // Build discussion request for Roundtable ProactiveCard from trigger
  const discussionRequest: DiscussionAction | null = discussionTrigger
    ? {
        type: 'discussion',
        id: discussionTrigger.id,
        topic: discussionTrigger.question,
        prompt: discussionTrigger.prompt,
        agentId: discussionTrigger.agentId || 'default-1',
      }
    : null;

  // Calculate scene viewer height (subtract Header's 80px height)
  const sceneViewerHeight = (() => {
    const headerHeight = isPresenting ? 0 : 80; // Header h-20 = 80px
    const roundtableHeight = mode === 'playback' && !isPresenting ? 192 : 0;
    return `calc(100% - ${headerHeight + roundtableHeight}px)`;
  })();

  const finishBookLessonLabel = locale === 'zh-CN' ? '完成本课' : 'Finish lesson';
  const finishBookLessonBusyLabel = locale === 'zh-CN' ? '整理中...' : 'Finalizing...';
  const finishBookLessonErrorLabel =
    locale === 'zh-CN' ? '完成本课失败，请重试' : 'Failed to finish this lesson';
  const canFinishBookLesson =
    !!stage?.bookLessonContext && generatingOutlines.length === 0 && !isFinishingBookLesson;

  const handleFinishBookLesson = useCallback(async () => {
    if (!onFinishBookLesson || !stage?.bookLessonContext || isFinishingBookLesson) return;

    setIsFinishingBookLesson(true);
    try {
      await onFinishBookLesson();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : finishBookLessonErrorLabel,
      );
      setIsFinishingBookLesson(false);
    }
  }, [
    finishBookLessonErrorLabel,
    isFinishingBookLesson,
    onFinishBookLesson,
    stage?.bookLessonContext,
  ]);

  return (
    <div
      ref={stageRef}
      className={cn(
        'flex-1 flex overflow-hidden bg-background text-foreground',
        isPresenting && !controlsVisible && 'cursor-none',
      )}
    >
      {/* Scene Sidebar */}
      <SceneSidebar
        collapsed={sidebarCollapsed}
        onCollapseChange={setSidebarCollapsed}
        onSceneSelect={gatedSceneSwitch}
        onRetryOutline={onRetryOutline}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        {/* Header */}
        {!isPresenting && (
          <Header
            currentSceneTitle={currentScene?.title || ''}
            extraActions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-tour-target="profile-panel"
                  onClick={() =>
                    toast.info('学习画像会汇总 Teach-back、Debate 和课堂问答形成长期证据。')
                  }
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/25 bg-card/80 px-4 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-accent/50"
                  title="学习画像"
                  aria-label="学习画像"
                >
                  <BarChart3 className="size-4" />
                  <span>学习画像</span>
                </button>
                {stage?.bookLessonContext && (
                  <button
                    type="button"
                    onClick={() => void handleFinishBookLesson()}
                    disabled={!canFinishBookLesson}
                    className={cn(
                      'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium shadow-sm transition-colors',
                      canFinishBookLesson
                        ? 'border-primary/25 bg-card/80 text-primary hover:bg-accent/50'
                        : 'border-border bg-muted text-muted-foreground cursor-not-allowed',
                    )}
                    title={
                      isFinishingBookLesson ? finishBookLessonBusyLabel : finishBookLessonLabel
                    }
                  >
                    {isFinishingBookLesson ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    <span>
                      {isFinishingBookLesson ? finishBookLessonBusyLabel : finishBookLessonLabel}
                    </span>
                  </button>
                )}
              </div>
            }
          />
        )}

        {/* Canvas Area */}
        <div
          data-tour-target="debate-whiteboard"
          className="overflow-hidden relative flex-1 min-h-0 isolate"
          style={{
            height: sceneViewerHeight,
          }}
          suppressHydrationWarning
        >
          <CanvasArea
            currentScene={currentScene}
            currentSceneIndex={currentSceneIndex}
            scenesCount={totalScenesCount}
            mode={mode}
            engineState={canvasEngineState}
            showTeachingEffects={shouldShowTeachingEffects(engineMode)}
            isLiveSession={
              chatIsStreaming || isTopicPending || engineMode === 'live' || !!chatSessionType
            }
            whiteboardOpen={whiteboardOpen}
            sidebarCollapsed={sidebarCollapsed}
            chatCollapsed={chatAreaCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            onToggleChat={() => setChatAreaCollapsed(!chatAreaCollapsed)}
            onPrevSlide={handlePreviousScene}
            onNextSlide={handleNextScene}
            onPlayPause={handlePlayPause}
            onWhiteboardClose={handleWhiteboardToggle}
            isPresenting={isPresenting}
            onTogglePresentation={togglePresentation}
            showStopDiscussion={
              engineMode === 'live' ||
              (chatIsStreaming && (chatSessionType === 'qa' || chatSessionType === 'discussion'))
            }
            onStopDiscussion={handleStopDiscussion}
            hideToolbar={mode === 'playback' || (isPresenting && !controlsVisible)}
            isPendingScene={isPendingScene}
            isGenerationFailed={
              isPendingScene && failedOutlines.some((f) => f.id === generatingOutlines[0]?.id)
            }
            onRetryGeneration={
              onRetryOutline && generatingOutlines[0]
                ? () => onRetryOutline(generatingOutlines[0].id)
                : undefined
            }
            onNeedTeachingHint={handleNeedTeachingHint}
          />
          {isTourActive && currentTourStep === 2 && (
            <div className="pointer-events-none absolute inset-0 z-[150] flex items-stretch justify-center p-6">
              <div className="relative h-full w-full rounded-lg border border-cyan-300/70">
                <div className="absolute left-1/2 top-0 h-full w-px bg-cyan-300/80" />
                <div className="absolute left-4 top-4 rounded-md bg-cyan-950/75 px-3 py-1 text-xs font-semibold text-cyan-50">
                  Agent A 正方区
                </div>
                <div className="absolute right-4 top-4 rounded-md bg-cyan-950/75 px-3 py-1 text-xs font-semibold text-cyan-50">
                  Agent B 反方区
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Roundtable Area */}
        {mode === 'playback' && (
          <div
            data-tour-target="playback-controls"
            className={cn(
              'transition-opacity duration-300',
              !isPresenting && 'shrink-0',
              isPresenting && 'absolute inset-x-0 bottom-0 z-20',
            )}
          >
            <Roundtable
              mode={mode}
              initialParticipants={participants}
              playbackView={playbackView}
              currentSpeech={liveSpeech}
              lectureSpeech={lectureSpeech}
              idleText={firstSpeechText}
              playbackCompleted={playbackCompleted}
              discussionRequest={discussionRequest}
              engineMode={engineMode}
              isStreaming={chatIsStreaming}
              audioIndicatorState={audioIndicatorState}
              audioAgentId={audioAgentId}
              sessionType={
                chatSessionType === 'qa'
                  ? 'qa'
                  : chatSessionType === 'discussion'
                    ? 'discussion'
                    : undefined
              }
              speakingAgentId={speakingAgentId}
              speechProgress={speechProgress}
              showEndFlash={showEndFlash}
              endFlashSessionType={endFlashSessionType}
              thinkingState={thinkingState}
              isCueUser={isCueUser}
              cueUserPrompt={cueUserPrompt}
              isTopicPending={isTopicPending}
              onMessageSend={handleRoundtableMessageSend}
              onDiscussionStart={() => {
                // User clicks "Join" on ProactiveCard
                engineRef.current?.confirmDiscussion();
              }}
              onDiscussionSkip={() => {
                // User clicks "Skip" on ProactiveCard
                engineRef.current?.skipDiscussion();
              }}
              onStopDiscussion={handleStopDiscussion}
              onInputActivate={() => {
                // Level-1 pause: freeze buffer tick + TTS audio while SSE keeps buffering.
                // User resumes manually via Space / pause button after closing the input.
                // No isDiscussionPaused guard — always attempt to pause the buffer.
                // The return value ensures UI state stays in sync with buffer state.
                if (chatSessionType === 'qa' || chatSessionType === 'discussion') {
                  const paused = chatAreaRef.current?.pauseActiveLiveBuffer();
                  if (paused) {
                    discussionTTS.pause();
                    setIsDiscussionPaused(true);
                  }
                }
                // Also pause playback engine
                if (engineRef.current && (engineMode === 'playing' || engineMode === 'live')) {
                  engineRef.current.pause();
                }
              }}
              onResumeTopic={doResumeTopic}
              onPlayPause={handlePlayPause}
              isDiscussionPaused={isDiscussionPaused}
              onDiscussionPause={() => {
                const paused = chatAreaRef.current?.pauseActiveLiveBuffer();
                if (paused) {
                  discussionTTS.pause();
                  setIsDiscussionPaused(true);
                }
              }}
              onDiscussionResume={() => {
                chatAreaRef.current?.resumeActiveLiveBuffer();
                discussionTTS.resume();
                setIsDiscussionPaused(false);
              }}
              totalActions={totalActions}
              currentActionIndex={0}
              currentSceneIndex={currentSceneIndex}
              scenesCount={totalScenesCount}
              whiteboardOpen={whiteboardOpen}
              sidebarCollapsed={sidebarCollapsed}
              chatCollapsed={chatAreaCollapsed}
              onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
              onToggleChat={() => setChatAreaCollapsed(!chatAreaCollapsed)}
              onPrevSlide={handlePreviousScene}
              onNextSlide={handleNextScene}
              onWhiteboardClose={handleWhiteboardToggle}
              isPresenting={isPresenting}
              controlsVisible={controlsVisible}
              onTogglePresentation={togglePresentation}
              onPresentationInteractionChange={setIsPresentationInteractionActive}
              fullscreenContainerRef={stageRef}
            />
          </div>
        )}
      </div>

      {/* Chat Area */}
      <ChatArea
        ref={chatAreaRef}
        width={chatAreaWidth}
        onWidthChange={setChatAreaWidth}
        collapsed={chatAreaCollapsed}
        onCollapseChange={setChatAreaCollapsed}
        activeBubbleId={activeBubbleId}
        onActiveBubble={(id) => setActiveBubbleId(id)}
        currentSceneId={currentSceneId}
        onLiveSpeech={(text, agentId) => {
          // Capture epoch at call time — discard if scene has changed since
          const epoch = sceneEpochRef.current;
          // Use queueMicrotask to let any pending scene-switch reset settle first
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return; // stale — scene changed
            setLiveSpeech(text);
            if (agentId !== undefined) {
              setSpeakingAgentId(agentId);
            }
            if (text !== null || agentId) {
              setChatIsStreaming(true);
              setChatSessionType(chatAreaRef.current?.getActiveSessionType?.() ?? null);
              setIsTopicPending(false);
            } else if (text === null && agentId === null) {
              setChatIsStreaming(false);
              // Don't clear chatSessionType here — it's needed by the stop
              // button when director cues user (cue_user → done → liveSpeech null).
              // It gets properly cleared in doSessionCleanup and scene change.
            }
          });
        }}
        onSpeechProgress={(ratio) => {
          const epoch = sceneEpochRef.current;
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return;
            setSpeechProgress(ratio);
          });
        }}
        onThinking={(state) => {
          const epoch = sceneEpochRef.current;
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return;
            setThinkingState(state);
          });
        }}
        onCueUser={(_fromAgentId, prompt) => {
          setIsCueUser(true);
          setCueUserPrompt(prompt ?? null);
        }}
        onWaitForUserTeaching={handleWaitForUserTeaching}
        onLiveSessionError={handleLiveSessionError}
        onStopSession={doSessionCleanup}
        onSegmentSealed={discussionTTS.handleSegmentSealed}
        shouldHoldAfterReveal={discussionTTS.shouldHold}
      />

      {/* Scene switch confirmation dialog */}
      <AlertDialog
        open={!!pendingSceneId}
        onOpenChange={(open) => {
          if (!open) cancelSceneSwitch();
        }}
      >
        <AlertDialogContent
          container={isPresenting ? stageRef.current : undefined}
          className="max-w-sm rounded-2xl p-0 overflow-hidden border-0 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)]"
        >
          <VisuallyHidden.Root>
            <AlertDialogTitle>{t('stage.confirmSwitchTitle')}</AlertDialogTitle>
          </VisuallyHidden.Root>
          {/* Top accent bar */}
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" />

          <div className="px-6 pt-5 pb-2 flex flex-col items-center text-center">
            {/* Icon */}
            <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4 ring-1 ring-amber-200/50 dark:ring-amber-700/30">
              <AlertTriangle className="w-6 h-6 text-amber-500 dark:text-amber-400" />
            </div>
            {/* Title */}
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-1.5">
              {t('stage.confirmSwitchTitle')}
            </h3>
            {/* Description */}
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('stage.confirmSwitchMessage')}
            </p>
          </div>

          <AlertDialogFooter className="px-6 pb-5 pt-3 flex-row gap-3">
            <AlertDialogCancel onClick={cancelSceneSwitch} className="flex-1 rounded-xl">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSceneSwitch}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-md shadow-amber-200/50 dark:shadow-amber-900/30"
            >
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isTourActive && activeTourStep && (
        <TourOverlay
          step={activeTourStep}
          currentStep={currentTourStep}
          totalSteps={TOUR_STEPS.length}
          onNext={handleTourNext}
          onPrevious={handleTourPrevious}
          onClose={handleEndTour}
        />
      )}
    </div>
  );
}

/**
 * ActionEngine — Unified execution layer for all agent actions.
 *
 * Replaces the 28 Vercel AI SDK tools in ai-tools.ts with a single engine
 * that both online (streaming) and offline (playback) paths share.
 *
 * Two execution modes:
 * - Fire-and-forget: spotlight, laser — dispatch and return immediately
 * - Synchronous: speech, whiteboard, discussion — await completion
 */

import type { StageStore } from '@/lib/api/stage-api';
import { createStageAPI } from '@/lib/api/stage-api';
import { getPresentationPalette } from '@/lib/theme/color-themes';
import { useCanvasStore } from '@/lib/store/canvas';
import { pushWhiteboardLedgerRecord } from '@/lib/store/crdt-provider';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { useMediaGenerationStore, isMediaPlaceholder } from '@/lib/store/media-generation';
import { normalizeSpotlightDimness } from '@/lib/playback/spotlight-utils';
import type { AudioPlayer } from '@/lib/utils/audio-player';
import { DEFAULT_REQUEST_CLARIFICATION_MESSAGE } from '@/lib/types/action';
import type {
  WhiteboardActionName,
} from '@/lib/orchestration/director-prompt';
import type {
  Action,
  SpotlightAction,
  LaserAction,
  SpeechAction,
  PlayVideoAction,
  WbDrawTextAction,
  WbDrawShapeAction,
  WbDrawChartAction,
  WbDrawLatexAction,
  WbDrawTableAction,
  WbDeleteAction,
  WbDrawLineAction,
  WaitForUserTeachingAction,
  RequestClarificationAction,
} from '@/lib/types/action';
import type { ChatSession } from '@/lib/types/chat';
import katex from 'katex';
import { createLogger } from '@/lib/logger';
import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';
import { repairMathLatex } from '@/lib/utils/math-display-repair';

const log = createLogger('ActionEngine');
const DEFAULT_USER_TEACHING_PROMPT = '请在白板上画出你的思路，并发送你的讲解。';
const DEBATE_AGENT_A_X_RANGE = { min: 60, max: 430 };
const DEBATE_AGENT_B_X_RANGE = { min: 560, max: 920 };

// ==================== SVG Paths for Shapes ====================

const SHAPE_PATHS: Record<string, string> = {
  rectangle: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
  circle: 'M 500 0 A 500 500 0 1 1 499 0 Z',
  triangle: 'M 500 0 L 1000 1000 L 0 1000 Z',
};

// ==================== Helpers ====================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type RuntimeActionMetadata = {
  name?: string;
  agentId?: string;
  agentName?: string;
  params?: Record<string, unknown>;
};

type ActiveDebateSide = 'agent_a' | 'agent_b';
const CRDT_WHITEBOARD_ACTION_NAMES = new Set<WhiteboardActionName>([
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_clear',
  'wb_delete',
]);

function isCrdtWhiteboardActionName(actionType: string): actionType is WhiteboardActionName {
  return CRDT_WHITEBOARD_ACTION_NAMES.has(actionType as WhiteboardActionName);
}

// ==================== ActionEngine ====================

/** Default duration (ms) before fire-and-forget effects auto-clear */
const EFFECT_AUTO_CLEAR_MS = 5000;

export interface ActionEngineOptions {
  onWaitForUserTeaching?: (action: WaitForUserTeachingAction) => Promise<void> | void;
}

export class ActionEngine {
  private stageStore: StageStore;
  private stageAPI: ReturnType<typeof createStageAPI>;
  private audioPlayer: AudioPlayer | null;
  private options: ActionEngineOptions;
  private effectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    stageStore: StageStore,
    audioPlayer?: AudioPlayer,
    options: ActionEngineOptions = {},
  ) {
    this.stageStore = stageStore;
    this.stageAPI = createStageAPI(stageStore);
    this.audioPlayer = audioPlayer ?? null;
    this.options = options;
  }

  /** Clean up timers when the engine is no longer needed */
  dispose(): void {
    if (this.effectTimer) {
      clearTimeout(this.effectTimer);
      this.effectTimer = null;
    }
  }

  /**
   * Execute a single action.
   * Fire-and-forget actions return immediately.
   * Synchronous actions return a Promise that resolves when the action is complete.
   */
  async execute(action: Action): Promise<void> {
    this.validateAction(action);

    // Auto-open whiteboard if a draw/clear/delete action is attempted while it's closed
    if (action.type.startsWith('wb_') && action.type !== 'wb_open' && action.type !== 'wb_close') {
      await this.ensureWhiteboardOpen();
    }

    switch (action.type) {
      // Fire-and-forget
      case 'spotlight':
        this.executeSpotlight(action);
        return;
      case 'laser':
        this.executeLaser(action);
        return;
      // Synchronous — Video
      case 'play_video':
        return this.executePlayVideo(action as PlayVideoAction);

      // Synchronous
      case 'speech':
        return this.executeSpeech(action);
      case 'wb_open':
        return this.executeWbOpen();
      case 'wb_draw_text':
        await this.executeWbDrawText(action);
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_draw_shape':
        await this.executeWbDrawShape(action);
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_draw_chart':
        await this.executeWbDrawChart(action);
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_draw_latex':
        await this.executeWbDrawLatex(action);
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_draw_table':
        await this.executeWbDrawTable(action);
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_draw_line':
        await this.executeWbDrawLine(action as WbDrawLineAction);
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_clear':
        await this.executeWbClear();
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_delete':
        await this.executeWbDelete(action as WbDeleteAction);
        this.recordWhiteboardActionToCrdt(action);
        return;
      case 'wb_close':
        return this.executeWbClose();
      case 'discussion':
        // Discussion lifecycle is managed externally via engine callbacks
        return;
      case 'wait_for_user_teaching':
        return this.executeWaitForUserTeaching(action);
      case 'request_clarification':
        return this.executeRequestClarification(action);
    }
  }

  /** Clear all active visual effects */
  clearEffects(): void {
    if (this.effectTimer) {
      clearTimeout(this.effectTimer);
      this.effectTimer = null;
    }
    useCanvasStore.getState().clearAllEffects();
  }

  /** Validate and normalize actions before any execution side effects. */
  private validateAction(action: Action): void {
    const runtimeAction = action as Action & RuntimeActionMetadata;
    const actionRecord = action as unknown as Record<string, unknown>;
    const actionName =
      typeof actionRecord.type === 'string'
        ? actionRecord.type
        : typeof actionRecord.name === 'string'
          ? actionRecord.name
          : null;
    if (actionName !== 'wb_draw_text') return;

    const debateSide = this.getActiveDebateSide(runtimeAction.agentId);
    if (!debateSide) return;

    const flattenedX = (action as Partial<WbDrawTextAction>).x;
    const paramX = runtimeAction.params?.x;
    const currentX =
      typeof flattenedX === 'number' ? flattenedX : typeof paramX === 'number' ? paramX : null;
    if (currentX === null || !Number.isFinite(currentX)) return;

    const range = debateSide === 'agent_a' ? DEBATE_AGENT_A_X_RANGE : DEBATE_AGENT_B_X_RANGE;
    const clampedX = clamp(currentX, range.min, range.max);
    if (clampedX === currentX) return;

    (action as WbDrawTextAction).x = clampedX;
    if (runtimeAction.params) {
      runtimeAction.params.x = clampedX;
    }

    log.warn(
      `[ActionValidator] Clamped debate wb_draw_text x from ${currentX} to ${clampedX} for ${debateSide}`,
    );
  }

  private getActiveDebateSide(agentId?: string): ActiveDebateSide | null {
    const state = this.stageStore.getState() as ReturnType<StageStore['getState']> & {
      chats?: ChatSession[];
    };
    const activeDebateSession = state.chats?.find(
      (session) =>
        session.type === 'discussion' &&
        session.status === 'active' &&
        session.config.discussionMode === 'debate' &&
        !!session.config.debateConfig,
    );
    const debateConfig = activeDebateSession?.config.debateConfig;
    if (!activeDebateSession || !debateConfig) return null;

    const debateState = activeDebateSession.directorState?.debateState;
    const agentAId = debateState?.agentAId ?? debateConfig.agentAId;
    const agentBId = debateState?.agentBId ?? debateConfig.agentBId;

    if (agentId) {
      if (agentId === agentAId) return 'agent_a';
      if (agentId === agentBId) return 'agent_b';
      return null;
    }

    if (debateState?.phase === 'agent_a' || debateState?.phase === 'agent_b') {
      return debateState.phase;
    }

    return null;
  }

  private recordWhiteboardActionToCrdt(action: Action): void {
    const canvasState = useCanvasStore.getState();
    if (!canvasState.crdtConnected) return;
    if (!isCrdtWhiteboardActionName(action.type)) return;

    const runtimeAction = action as Action & RuntimeActionMetadata;
    const params = runtimeAction.params ?? this.extractWhiteboardActionParams(action);

    try {
      pushWhiteboardLedgerRecord({
        actionName: action.type,
        actorType: 'agent',
        agentId: runtimeAction.agentId,
        agentName: runtimeAction.agentName ?? runtimeAction.agentId,
        params,
      });
    } catch (error) {
      log.warn('[CRDT] Failed to record agent whiteboard action:', error);
    }
  }

  private extractWhiteboardActionParams(action: Action): Record<string, unknown> {
    const record = action as unknown as Record<string, unknown>;
    const params: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (
        key === 'id' ||
        key === 'type' ||
        key === 'title' ||
        key === 'description' ||
        key === 'params' ||
        key === 'agentId' ||
        key === 'agentName'
      ) {
        continue;
      }
      params[key] = value;
    }

    return params;
  }

  /** Schedule auto-clear for fire-and-forget effects */
  private scheduleEffectClear(): void {
    if (this.effectTimer) {
      clearTimeout(this.effectTimer);
    }
    this.effectTimer = setTimeout(() => {
      useCanvasStore.getState().clearAllEffects();
      this.effectTimer = null;
    }, EFFECT_AUTO_CLEAR_MS);
  }

  // ==================== Fire-and-forget ====================

  private executeSpotlight(action: SpotlightAction): void {
    useCanvasStore.getState().setSpotlight(action.elementId, {
      dimness: normalizeSpotlightDimness(action.dimOpacity),
    });
    this.scheduleEffectClear();
  }

  private executeLaser(action: LaserAction): void {
    log.info(`Ignoring disabled laser action for element: ${action.elementId}`);
    useCanvasStore.getState().clearLaser();
  }

  // ==================== Synchronous — Speech ====================

  private async executeSpeech(action: SpeechAction): Promise<void> {
    if (!this.audioPlayer) return;

    return new Promise<void>((resolve) => {
      this.audioPlayer!.onEnded(() => resolve());
      this.audioPlayer!.play(action.audioId || '', action.audioUrl)
        .then((audioStarted) => {
          if (!audioStarted) resolve();
        })
        .catch(() => resolve());
    });
  }

  // ==================== Synchronous — Video ====================

  private async executePlayVideo(action: PlayVideoAction): Promise<void> {
    // Resolve the video element's src to a media placeholder ID (e.g. gen_vid_1).
    // action.elementId is the slide element ID (e.g. video_abc123), but the media
    // store is keyed by placeholder IDs, so we need to bridge the two.
    const placeholderId = this.resolveMediaPlaceholderId(action.elementId);

    if (placeholderId) {
      const task = useMediaGenerationStore.getState().getTask(placeholderId);
      if (task && task.status !== 'done') {
        // Wait for media to be ready (or fail)
        await new Promise<void>((resolve) => {
          const unsubscribe = useMediaGenerationStore.subscribe((state) => {
            const t = state.tasks[placeholderId];
            if (!t || t.status === 'done' || t.status === 'failed') {
              unsubscribe();
              resolve();
            }
          });
          // Check again in case it resolved between getState and subscribe
          const current = useMediaGenerationStore.getState().tasks[placeholderId];
          if (!current || current.status === 'done' || current.status === 'failed') {
            unsubscribe();
            resolve();
          }
        });

        // If failed, skip playback
        if (useMediaGenerationStore.getState().tasks[placeholderId]?.status === 'failed') {
          return;
        }
      }
    }

    useCanvasStore.getState().playVideo(action.elementId);

    // Wait until the video finishes playing, with a safety timeout to prevent
    // the playback engine from hanging indefinitely if the video element is
    // invalid or the state change is missed.
    return new Promise<void>((resolve) => {
      const MAX_VIDEO_WAIT_MS = 5 * 60 * 1000; // 5 minutes
      const timeout = setTimeout(() => {
        unsubscribe();
        log.warn(`[playVideo] Timeout waiting for video ${action.elementId} to finish`);
        resolve();
      }, MAX_VIDEO_WAIT_MS);
      const unsubscribe = useCanvasStore.subscribe((state) => {
        if (state.playingVideoElementId !== action.elementId) {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
      if (useCanvasStore.getState().playingVideoElementId !== action.elementId) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  }

  // ==================== Helpers — Media Resolution ====================

  /**
   * Look up a video/image element's src in the current stage's scenes.
   * Returns the src if it's a media placeholder ID (gen_vid_*, gen_img_*), null otherwise.
   */
  private resolveMediaPlaceholderId(elementId: string): string | null {
    const { scenes, currentSceneId } = this.stageStore.getState();

    // Search current scene first for efficiency, then remaining scenes
    const orderedScenes = currentSceneId
      ? [
          scenes.find((s) => s.id === currentSceneId),
          ...scenes.filter((s) => s.id !== currentSceneId),
        ]
      : scenes;

    for (const scene of orderedScenes) {
      if (!scene || scene.type !== 'slide') continue;
      const elements = (
        scene.content as {
          canvas?: { elements?: Array<{ id: string; src?: string }> };
        }
      )?.canvas?.elements;
      if (!Array.isArray(elements)) continue;
      const el = elements.find((e: { id: string }) => e.id === elementId);
      if (el && 'src' in el && typeof el.src === 'string' && isMediaPlaceholder(el.src)) {
        return el.src;
      }
    }
    return null;
  }

  // ==================== Synchronous — Whiteboard ====================

  /** Auto-open the whiteboard if it's not already open */
  private async ensureWhiteboardOpen(): Promise<void> {
    if (!useCanvasStore.getState().whiteboardOpen) {
      await this.executeWbOpen();
    }
  }

  private async executeWbOpen(): Promise<void> {
    // Ensure a whiteboard exists
    this.stageAPI.whiteboard.get();
    useCanvasStore.getState().setWhiteboardOpen(true);
    // Wait for open animation to complete (slow spring: stiffness 120, damping 18, mass 1.2)
    await delay(2000);
  }

  private async executeWbDrawText(action: WbDrawTextAction): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    const fontSize = action.fontSize ?? 18;
    let htmlContent = action.content ?? '';
    if (!htmlContent) return; // nothing to draw
    if (!htmlContent.startsWith('<')) {
      htmlContent = `<p style="font-size: ${fontSize}px;">${htmlContent}</p>`;
    }

    this.stageAPI.whiteboard.addElement(
      {
        id: action.elementId || '',
        type: 'text',
        content: htmlContent,
        left: action.x,
        top: action.y,
        width: action.width ?? 400,
        height: action.height ?? 100,
        rotate: 0,
        defaultFontName: DEFAULT_SCREEN_FONT_NAME,
        defaultColor: action.color ?? '#333333',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );

    // Wait for element fade-in animation
    await delay(800);
  }

  private async executeWbDrawShape(action: WbDrawShapeAction): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    this.stageAPI.whiteboard.addElement(
      {
        id: action.elementId || '',
        type: 'shape',
        viewBox: [1000, 1000] as [number, number],
        path: SHAPE_PATHS[action.shape] ?? SHAPE_PATHS.rectangle,
        left: action.x,
        top: action.y,
        width: action.width,
        height: action.height,
        rotate: 0,
        fill: action.fillColor ?? '#5b9bd5',
        fixedRatio: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );

    // Wait for element fade-in animation
    await delay(800);
  }

  private async executeWbDrawChart(action: WbDrawChartAction): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    this.stageAPI.whiteboard.addElement(
      {
        id: action.elementId || '',
        type: 'chart',
        left: action.x,
        top: action.y,
        width: action.width,
        height: action.height,
        rotate: 0,
        chartType: action.chartType,
        data: action.data,
        themeColors: action.themeColors ?? [...getPresentationPalette().chartColors],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );

    await delay(800);
  }

  private async executeWbDrawLatex(action: WbDrawLatexAction): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    try {
      const latex = repairMathLatex(action.latex);
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
      });

      this.stageAPI.whiteboard.addElement(
        {
          id: action.elementId || '',
          type: 'latex',
          left: action.x,
          top: action.y,
          width: action.width ?? 400,
          height: action.height ?? 80,
          rotate: 0,
          latex,
          html,
          color: action.color ?? '#000000',
          fixedRatio: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        wb.data.id,
      );
    } catch (err) {
      log.warn(`Failed to render latex "${action.latex}":`, err);
      return;
    }

    await delay(800);
  }

  private async executeWbDrawTable(action: WbDrawTableAction): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    const rows = action.data.length;
    const cols = rows > 0 ? action.data[0].length : 0;
    if (rows === 0 || cols === 0) return;

    // Build colWidths: equal distribution
    const colWidths = Array(cols).fill(1 / cols);

    // Build TableCell[][] from string[][]
    let cellId = 0;
    const tableData = action.data.map((row) =>
      row.map((text) => ({
        id: `cell_${cellId++}`,
        colspan: 1,
        rowspan: 1,
        text,
      })),
    );

    this.stageAPI.whiteboard.addElement(
      {
        id: action.elementId || '',
        type: 'table',
        left: action.x,
        top: action.y,
        width: action.width,
        height: action.height,
        rotate: 0,
        colWidths,
        cellMinHeight: 36,
        data: tableData,
        outline: action.outline ?? {
          width: 2,
          style: 'solid',
          color: '#eeece1',
        },
        theme: action.theme
          ? {
              color: action.theme.color,
              rowHeader: true,
              rowFooter: false,
              colHeader: false,
              colFooter: false,
            }
          : undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );

    await delay(800);
  }

  private async executeWbDrawLine(action: WbDrawLineAction): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    // Calculate bounding box — left/top is the minimum of start/end coordinates
    const left = Math.min(action.startX, action.endX);
    const top = Math.min(action.startY, action.endY);

    // Convert absolute coordinates to relative coordinates (relative to left/top)
    const start: [number, number] = [action.startX - left, action.startY - top];
    const end: [number, number] = [action.endX - left, action.endY - top];

    this.stageAPI.whiteboard.addElement(
      {
        id: action.elementId || '',
        type: 'line',
        left,
        top,
        width: action.width ?? 2,
        start,
        end,
        style: action.style ?? 'solid',
        color: action.color ?? '#333333',
        points: action.points ?? ['', ''],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );

    // Wait for element fade-in animation
    await delay(800);
  }

  private async executeWbDelete(action: WbDeleteAction): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    this.stageAPI.whiteboard.deleteElement(action.elementId, wb.data.id);
    await delay(300);
  }

  private async executeWbClear(): Promise<void> {
    const wb = this.stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    const elementCount = wb.data.elements?.length || 0;
    if (elementCount === 0) return;

    // Save snapshot before AI clear (mirrors UI handleClear in index.tsx)
    useWhiteboardHistoryStore.getState().pushSnapshot(wb.data.elements!);

    // Trigger cascade exit animation
    useCanvasStore.getState().setWhiteboardClearing(true);

    // Wait for cascade: base 380ms + 55ms per element, capped at 1400ms
    const animMs = Math.min(380 + elementCount * 55, 1400);
    await delay(animMs);

    // Actually remove elements
    this.stageAPI.whiteboard.update({ elements: [] }, wb.data.id);
    useCanvasStore.getState().setWhiteboardClearing(false);
  }

  private async executeWbClose(): Promise<void> {
    useCanvasStore.getState().setWhiteboardOpen(false);
    // Wait for close animation (500ms ease-out tween)
    await delay(700);
  }

  private async executeWaitForUserTeaching(action: WaitForUserTeachingAction): Promise<void> {
    await this.ensureWhiteboardOpen();

    const prompt = action.prompt || DEFAULT_USER_TEACHING_PROMPT;
    useCanvasStore.getState().setStudentTeachingState(true, prompt);

    if (!this.options.onWaitForUserTeaching) {
      log.warn('[wait_for_user_teaching] No wait handler registered; action will not block.');
      return;
    }

    try {
      await this.options.onWaitForUserTeaching({ ...action, prompt });
    } catch (error) {
      log.warn('[wait_for_user_teaching] Wait handler failed; continuing playback:', error);
    } finally {
      useCanvasStore.getState().setStudentTeachingState(false, null);
    }
  }

  private executeRequestClarification(action: RequestClarificationAction): void {
    const message = action.message?.trim() || DEFAULT_REQUEST_CLARIFICATION_MESSAGE;
    log.warn('[VisionFallback] request_clarification action executed:', {
      visionConfidence: action.visionConfidence,
      reason: action.reason,
      message,
    });
  }
}

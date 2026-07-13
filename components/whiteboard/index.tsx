'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUpRight,
  Eraser,
  History,
  Lightbulb,
  Minimize2,
  PencilLine,
  RotateCcw,
  Square,
  Type,
} from 'lucide-react';
import { WhiteboardCanvas } from './whiteboard-canvas';
import type { WhiteboardCanvasHandle, WhiteboardEditorTrace } from './whiteboard-canvas';
import { WhiteboardHistory } from './whiteboard-history';
import type { PPTElement } from '@/lib/types/slides';
import { useStageStore } from '@/lib/store';
import { useCanvasStore, type StudentWhiteboardActionTrace } from '@/lib/store/canvas';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createStageAPI } from '@/lib/api/stage-api';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';
import { getCrdtClientId } from '@/lib/store/crdt-provider';

interface WhiteboardProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNeedHint?: () => void;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getStringParam(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function getArrayParam(params: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = params[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function getNumberParam(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getLinePointsParam(
  params: Record<string, unknown>,
): ['', 'arrow'] | ['arrow', ''] | ['arrow', 'arrow'] | ['', ''] {
  const value = params.points;
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    (value[0] === '' || value[0] === 'arrow') &&
    (value[1] === '' || value[1] === 'arrow')
  ) {
    return [value[0], value[1]];
  }
  return ['', 'arrow'];
}

function normalizeEditorTraceAction(
  trace: WhiteboardEditorTrace,
): {
  actionName: StudentWhiteboardActionTrace['actionName'];
  params: Record<string, unknown>;
} | null {
  if (trace.actionName) {
    return { actionName: trace.actionName, params: trace.params };
  }

  const params = trace.params;
  const elementId = getStringParam(params, ['elementId', 'id', 'targetId']);
  const elementType = getStringParam(params, ['elementType', 'type', 'shapeType']);

  if (trace.eventName === 'path:created') {
    return {
      actionName: 'wb_draw_line',
      params: {
        ...params,
        elementId,
        sourceEvent: 'path:created',
      },
    };
  }

  if (trace.eventName === 'selection:deleted') {
    const deletedIds = getArrayParam(params, ['deletedIds', 'elementIds', 'ids']);
    if (deletedIds.length > 1 || params.cleared === true) {
      return {
        actionName: 'wb_clear',
        params: {
          ...params,
          deletedCount: deletedIds.length || params.deletedCount,
          sourceEvent: 'selection:deleted',
        },
      };
    }

    return {
      actionName: 'wb_delete',
      params: {
        ...params,
        elementId: elementId || String(deletedIds[0] || ''),
        sourceEvent: 'selection:deleted',
      },
    };
  }

  if (trace.eventName === 'object:modified') {
    if (elementType === 'line' || params.startX != null || params.endX != null) {
      return { actionName: 'wb_draw_line', params: { ...params, elementId } };
    }
    if (elementType === 'text' || params.content != null || params.text != null) {
      return { actionName: 'wb_draw_text', params: { ...params, elementId } };
    }
    return { actionName: 'wb_draw_shape', params: { ...params, elementId } };
  }

  return null;
}

/**
 * Whiteboard component
 */
export function Whiteboard({ isOpen, onClose, onNeedHint }: WhiteboardProps) {
  const { t } = useI18n();
  const stage = useStageStore.use.stage();
  const isClearing = useCanvasStore.use.whiteboardClearing();
  const studentTeachingEnabled = useCanvasStore.use.studentTeachingEnabled();
  const studentTeachingPrompt = useCanvasStore.use.studentTeachingPrompt();
  const clearingRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewModified, setViewModified] = useState(false);
  const [studentText, setStudentText] = useState('');
  const canvasRef = useRef<WhiteboardCanvasHandle>(null);
  const snapshotCount = useWhiteboardHistoryStore((s) => s.snapshots.length);

  // Get element count for indicator
  const whiteboard = stage?.whiteboard?.[0];
  const elementCount = whiteboard?.elements?.length || 0;

  const stageAPI = useMemo(() => createStageAPI(useStageStore), []);
  const localCrdtClientIdRef = useRef<string | null>(null);
  const appliedRemoteRecordIdsRef = useRef(new Set<string>());

  const getActiveWhiteboardId = useCallback((): string | null => {
    const wb = stageAPI.whiteboard.get();
    return wb.success && wb.data ? wb.data.id : null;
  }, [stageAPI.whiteboard]);

  const addRemoteWhiteboardRecord = useCallback(
    (record: StudentWhiteboardActionTrace) => {
      if (!record.recordId || appliedRemoteRecordIdsRef.current.has(record.recordId)) {
        return;
      }

      if (record.clientId && record.clientId === localCrdtClientIdRef.current) {
        appliedRemoteRecordIdsRef.current.add(record.recordId);
        return;
      }

      const whiteboardId = getActiveWhiteboardId();
      if (!whiteboardId) return;

      const params = record.params ?? {};
      const elementId =
        typeof params.elementId === 'string' && params.elementId
          ? params.elementId
          : `${record.actionName}_${record.recordId}`;
      const existing = stageAPI.whiteboard.getElement(elementId, whiteboardId);
      if (existing.success && existing.data) {
        appliedRemoteRecordIdsRef.current.add(record.recordId);
        return;
      }

      if (record.actionName === 'wb_clear') {
        const wb = stageAPI.whiteboard.get();
        if (wb.success && wb.data) {
          useWhiteboardHistoryStore.getState().pushSnapshot(wb.data.elements);
          stageAPI.whiteboard.update({ elements: [] }, whiteboardId);
        }
        appliedRemoteRecordIdsRef.current.add(record.recordId);
        return;
      }

      if (record.actionName === 'wb_delete') {
        if (typeof params.elementId === 'string' && params.elementId) {
          stageAPI.whiteboard.deleteElement(params.elementId, whiteboardId);
        }
        appliedRemoteRecordIdsRef.current.add(record.recordId);
        return;
      }

      let element: PPTElement | null = null;

      if (record.actionName === 'wb_draw_text') {
        const fontSize = getNumberParam(params, 'fontSize', 20);
        const content = String(params.content ?? params.text ?? '');
        if (!content) return;
        element = {
          id: elementId,
          type: 'text',
          content: content.startsWith('<')
            ? content
            : `<p style="font-size: ${fontSize}px;">${escapeHtml(content)}</p>`,
          left: getNumberParam(params, 'x', 80),
          top: getNumberParam(params, 'y', 80),
          width: getNumberParam(params, 'width', 360),
          height: getNumberParam(params, 'height', 72),
          rotate: 0,
          defaultFontName: DEFAULT_SCREEN_FONT_NAME,
          defaultColor: String(params.color ?? '#111827'),
        };
      }

      if (record.actionName === 'wb_draw_shape') {
        element = {
          id: elementId,
          type: 'shape',
          viewBox: [1000, 1000],
          path: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
          left: getNumberParam(params, 'x', 80),
          top: getNumberParam(params, 'y', 80),
          width: getNumberParam(params, 'width', 160),
          height: getNumberParam(params, 'height', 90),
          rotate: 0,
          fill: String(params.fillColor ?? '#bfdbfe'),
          fixedRatio: false,
        };
      }

      if (record.actionName === 'wb_draw_line') {
        const startX = getNumberParam(params, 'startX', 80);
        const startY = getNumberParam(params, 'startY', 120);
        const endX = getNumberParam(params, 'endX', startX + 220);
        const endY = getNumberParam(params, 'endY', startY);
        const left = Math.min(startX, endX);
        const top = Math.min(startY, endY);
        element = {
          id: elementId,
          type: 'line',
          left,
          top,
          width: getNumberParam(params, 'width', 3),
          start: [startX - left, startY - top],
          end: [endX - left, endY - top],
          style: params.style === 'dashed' ? 'dashed' : 'solid',
          color: String(params.color ?? '#2563eb'),
          points: getLinePointsParam(params),
        };
      }

      if (element) {
        stageAPI.whiteboard.addElement(element, whiteboardId);
        appliedRemoteRecordIdsRef.current.add(record.recordId);
        return;
      }

      console.warn('[Whiteboard] Unsupported remote CRDT whiteboard record:', record);
      appliedRemoteRecordIdsRef.current.add(record.recordId);
    },
    [getActiveWhiteboardId, stageAPI.whiteboard],
  );

  useEffect(() => {
    if (!isOpen || !stage?.id) return;

    localCrdtClientIdRef.current = getCrdtClientId();
    void useCanvasStore.getState().bindWhiteboardLedgerToCrdt(stage.id);

    return () => {
      useCanvasStore.getState().unbindWhiteboardLedgerFromCrdt();
    };
  }, [isOpen, stage?.id]);

  useEffect(() => {
    if (!isOpen) return;

    const applyPendingRemoteRecords = (records: StudentWhiteboardActionTrace[]) => {
      for (const record of records) {
        addRemoteWhiteboardRecord(record);
      }
    };

    applyPendingRemoteRecords(useCanvasStore.getState().studentWhiteboardActions);
    return useCanvasStore.subscribe((state) => {
      applyPendingRemoteRecords(state.studentWhiteboardActions);
    });
  }, [addRemoteWhiteboardRecord, isOpen]);

  const recordStudentEditorTrace = useCallback(
    (
      actionName: StudentWhiteboardActionTrace['actionName'],
      params: Record<string, unknown>,
      editorEvent?: WhiteboardEditorTrace['eventName'],
    ) => {
      if (!studentTeachingEnabled) return;

      useCanvasStore.getState().recordStudentWhiteboardAction({
        actionName,
        params: editorEvent ? { ...params, editorEvent } : params,
      });
    },
    [studentTeachingEnabled],
  );

  const handleEditorTrace = useCallback(
    (trace: WhiteboardEditorTrace) => {
      const normalized = normalizeEditorTraceAction(trace);
      if (!normalized) {
        console.warn('[Whiteboard] Ignored unsupported editor trace:', trace);
        return;
      }

      recordStudentEditorTrace(normalized.actionName, normalized.params, trace.eventName);
    },
    [recordStudentEditorTrace],
  );

  const getNextStudentPosition = () => {
    const count = whiteboard?.elements?.length || 0;
    return {
      x: 80 + (count % 4) * 220,
      y: 80 + Math.floor(count / 4) * 95,
    };
  };

  const handleAddStudentText = () => {
    const text = studentText.trim();
    if (!text) return;
    const wb = stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;

    const { x, y } = getNextStudentPosition();
    const params = {
      elementId: `student_text_${Date.now()}`,
      content: text,
      x,
      y,
      width: 360,
      height: 72,
      fontSize: 20,
      color: '#111827',
    };

    stageAPI.whiteboard.addElement(
      {
        id: params.elementId,
        type: 'text',
        content: `<p style="font-size: ${params.fontSize}px;">${escapeHtml(text)}</p>`,
        left: params.x,
        top: params.y,
        width: params.width,
        height: params.height,
        rotate: 0,
        defaultFontName: DEFAULT_SCREEN_FONT_NAME,
        defaultColor: params.color,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );
    recordStudentEditorTrace('wb_draw_text', params, 'object:modified');
    setStudentText('');
  };

  const handleAddStudentShape = () => {
    const wb = stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;
    const { x, y } = getNextStudentPosition();
    const params = {
      elementId: `student_shape_${Date.now()}`,
      shape: 'rectangle',
      x,
      y,
      width: 160,
      height: 90,
      fillColor: '#bfdbfe',
    };

    stageAPI.whiteboard.addElement(
      {
        id: params.elementId,
        type: 'shape',
        viewBox: [1000, 1000] as [number, number],
        path: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
        left: params.x,
        top: params.y,
        width: params.width,
        height: params.height,
        rotate: 0,
        fill: params.fillColor,
        fixedRatio: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );
    recordStudentEditorTrace('wb_draw_shape', params, 'object:modified');
  };

  const handleAddStudentLine = () => {
    const wb = stageAPI.whiteboard.get();
    if (!wb.success || !wb.data) return;
    const { x, y } = getNextStudentPosition();
    const params = {
      elementId: `student_line_${Date.now()}`,
      startX: x,
      startY: y + 40,
      endX: x + 220,
      endY: y + 40,
      color: '#2563eb',
      width: 3,
      style: 'solid',
      points: ['', 'arrow'],
    };

    stageAPI.whiteboard.addElement(
      {
        id: params.elementId,
        type: 'line',
        left: params.startX,
        top: params.startY,
        width: params.width,
        start: [0, 0],
        end: [params.endX - params.startX, params.endY - params.startY],
        style: params.style,
        color: params.color,
        points: params.points,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      wb.data.id,
    );
    recordStudentEditorTrace('wb_draw_line', params, 'path:created');
  };

  const handleClear = async () => {
    if (!whiteboard || elementCount === 0 || clearingRef.current) return;
    clearingRef.current = true;

    // Save snapshot before clearing
    if (whiteboard.elements && whiteboard.elements.length > 0) {
      useWhiteboardHistoryStore.getState().pushSnapshot(whiteboard.elements);
    }

    // Trigger cascade exit animation
    useCanvasStore.getState().setWhiteboardClearing(true);

    // Wait for cascade: base 380ms + 55ms per element, capped at 1400ms
    const animMs = Math.min(380 + elementCount * 55, 1400);
    await new Promise((resolve) => setTimeout(resolve, animMs));

    // Actually remove elements
    const result = stageAPI.whiteboard.delete(whiteboard.id);
    useCanvasStore.getState().setWhiteboardClearing(false);
    clearingRef.current = false;

    if (result.success) {
      if (studentTeachingEnabled) {
        recordStudentEditorTrace(
          'wb_clear',
          {
            deletedCount: elementCount,
          },
          'selection:deleted',
        );
      }
      toast.success(t('whiteboard.clearSuccess'));
    } else {
      toast.error(t('whiteboard.clearError') + result.error);
    }
  };

  return (
    <>
      {/* Main Whiteboard Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              transition: {
                type: 'spring',
                stiffness: 120,
                damping: 18,
                mass: 1.2,
              },
            }}
            exit={{
              opacity: 0,
              scale: 0.95,
              y: 16,
              transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
            }}
            className="absolute inset-4 pointer-events-auto bg-white/95 dark:bg-gray-800/95 backdrop-blur-2xl rounded-3xl shadow-[0_32px_80px_-20px_rgba(0,0,0,0.25)] border-2 border-purple-200/60 dark:border-purple-700/60 flex flex-col overflow-hidden z-[120] ring-4 ring-purple-100/40 dark:ring-purple-800/40"
          >
            {/* Header */}
            <div className="h-14 px-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0 bg-white/50 dark:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <PencilLine className="w-4 h-4" />
                </div>
                <span className="font-bold text-gray-800 dark:text-gray-200 tracking-tight">
                  {t('whiteboard.title')}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <AnimatePresence>
                  {viewModified && (
                    <motion.button
                      type="button"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => canvasRef.current?.resetView()}
                      whileTap={{ scale: 0.9 }}
                      className="p-2 text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors"
                      title={t('whiteboard.resetView')}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </motion.button>
                  )}
                </AnimatePresence>
                <motion.button
                  type="button"
                  onClick={handleClear}
                  disabled={isClearing || elementCount === 0}
                  whileTap={{ scale: 0.9 }}
                  className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  title={t('whiteboard.clear')}
                >
                  <motion.div
                    animate={isClearing ? { rotate: [0, -15, 15, -10, 10, 0] } : { rotate: 0 }}
                    transition={
                      isClearing ? { duration: 0.5, ease: 'easeInOut' } : { duration: 0.2 }
                    }
                  >
                    <Eraser className="w-4 h-4" />
                  </motion.div>
                </motion.button>
                {/* History button + popover wrapper */}
                <div className="relative">
                  <motion.button
                    type="button"
                    onClick={() => setHistoryOpen(!historyOpen)}
                    whileTap={{ scale: 0.9 }}
                    className="relative p-2 text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors"
                    title={t('whiteboard.history')}
                  >
                    <History className="w-4 h-4" />
                    {snapshotCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {snapshotCount}
                      </span>
                    )}
                  </motion.button>
                  <WhiteboardHistory isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
                </div>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title={t('whiteboard.minimize')}
                >
                  <Minimize2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Whiteboard Content Area */}
            <div className="flex-1 relative bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#374151_1px,transparent_1px)] [background-size:24px_24px] overflow-hidden">
              <AnimatePresence>
                {studentTeachingEnabled && (
                  <motion.div
                    data-tour-target="teachback-toolbar"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute left-4 right-4 top-4 z-10 rounded-lg border border-blue-200 bg-white/95 p-3 shadow-lg dark:border-blue-800 dark:bg-gray-900/95"
                  >
                    <div className="mb-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                      {studentTeachingPrompt || '请在白板上画出你的思路，并发送你的讲解。'}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={studentText}
                        onChange={(event) => setStudentText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleAddStudentText();
                        }}
                        placeholder="写下关键步骤或解释"
                        className="h-8 min-w-[220px] flex-1 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        onClick={handleAddStudentText}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        <Type className="h-3.5 w-3.5" />
                        文本
                      </button>
                      <button
                        type="button"
                        onClick={handleAddStudentShape}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <Square className="h-3.5 w-3.5" />
                        方框
                      </button>
                      <button
                        type="button"
                        onClick={handleAddStudentLine}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        箭头
                      </button>
                      <button
                        type="button"
                        onClick={onNeedHint}
                        disabled={!onNeedHint}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30"
                        title="Need Hint"
                      >
                        <Lightbulb className="h-3.5 w-3.5" />
                        Need Hint
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <WhiteboardCanvas
                ref={canvasRef}
                onViewModifiedChange={setViewModified}
                onEditorTrace={handleEditorTrace}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

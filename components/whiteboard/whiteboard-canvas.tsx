'use client';

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import type { CanvasSnapshotOptions, StudentWhiteboardActionTrace } from '@/lib/store/canvas';
import { ScreenElement } from '@/components/slide-renderer/Editor/ScreenElement';
import type { PPTElement } from '@/lib/types/slides';
import { useI18n } from '@/lib/hooks/use-i18n';

export type WhiteboardCanvasHandle = {
  resetView: () => void;
  getCanvasSnapshot: (options?: CanvasSnapshotOptions) => Promise<string | null>;
};

type InteractiveWhiteboardCanvasHandle = Pick<WhiteboardCanvasHandle, 'resetView'>;

export type WhiteboardEditorEventName = 'object:modified' | 'path:created' | 'selection:deleted';

export interface WhiteboardEditorTrace {
  eventName: WhiteboardEditorEventName;
  actionName?: StudentWhiteboardActionTrace['actionName'];
  params: Record<string, unknown>;
}

export function dispatchWhiteboardEditorTrace(
  target: EventTarget | null | undefined,
  trace: WhiteboardEditorTrace,
): void {
  target?.dispatchEvent(new CustomEvent(trace.eventName, { detail: trace }));
}

type InteractiveWhiteboardCanvasProps = {
  canvasHeight: number;
  canvasWidth: number;
  containerWidth: number;
  containerHeight: number;
  containerScale: number;
  elements: PPTElement[];
  isClearing: boolean;
  onViewModifiedChange?: (modified: boolean) => void;
  onEditorTrace?: (trace: WhiteboardEditorTrace) => void;
  readyHintText: string;
  readyText: string;
};

const SNAPSHOT_MEDIA_TYPE = 'image/jpeg';
const SNAPSHOT_JPEG_QUALITY = 0.8;

const EDITOR_TRACE_EVENTS: readonly WhiteboardEditorEventName[] = [
  'object:modified',
  'path:created',
  'selection:deleted',
];

const STUDENT_WHITEBOARD_ACTION_NAMES = new Set<StudentWhiteboardActionTrace['actionName']>([
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_line',
  'wb_clear',
  'wb_delete',
]);

function isStudentWhiteboardActionName(
  value: unknown,
): value is StudentWhiteboardActionTrace['actionName'] {
  return (
    typeof value === 'string' &&
    STUDENT_WHITEBOARD_ACTION_NAMES.has(value as StudentWhiteboardActionTrace['actionName'])
  );
}

function getRecordValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.textContent || '').trim();
}

function parseFontSize(html: string, fallback: number): number {
  const match = html.match(/font-size\s*:\s*([0-9.]+)px/i);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseColor(html: string, fallback: string): string {
  const match = html.match(/(?:^|[;"\s])color\s*:\s*([^;"']+)/i);
  return match?.[1]?.trim() || fallback;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];

  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const units = words.length > 1 ? words : Array.from(paragraph);
    let line = '';

    for (const unit of units) {
      const separator = words.length > 1 && line ? ' ' : '';
      const candidate = `${line}${separator}${unit}`;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = unit;
      } else {
        line = candidate;
      }
    }

    if (line) lines.push(line);
  }

  return lines;
}

function withElementTransform(
  ctx: CanvasRenderingContext2D,
  element: Extract<PPTElement, { left: number; top: number; width: number }>,
  draw: () => void,
) {
  const height = 'height' in element && typeof element.height === 'number' ? element.height : 0;
  const rotate = 'rotate' in element && typeof element.rotate === 'number' ? element.rotate : 0;

  ctx.save();
  ctx.translate(element.left + element.width / 2, element.top + height / 2);
  if (rotate) {
    ctx.rotate((rotate * Math.PI) / 180);
  }
  ctx.translate(-element.width / 2, -height / 2);
  draw();
  ctx.restore();
}

function drawTextElement(
  ctx: CanvasRenderingContext2D,
  element: Extract<PPTElement, { type: 'text' }>,
) {
  const fontSize = parseFontSize(element.content, 20);
  const color = parseColor(element.content, element.defaultColor || '#111827');
  const lineHeight = fontSize * (element.lineHeight || 1.35);
  const text = htmlToPlainText(element.content);
  const padding = 4;

  withElementTransform(ctx, element, () => {
    if (element.fill) {
      ctx.fillStyle = element.fill;
      ctx.fillRect(0, 0, element.width, element.height);
    }
    ctx.fillStyle = color;
    ctx.font = `${fontSize}px ${element.defaultFontName || 'sans-serif'}`;
    ctx.textBaseline = 'top';

    const lines = wrapText(ctx, text, Math.max(1, element.width - padding * 2));
    const maxLines = Math.max(1, Math.floor((element.height - padding * 2) / lineHeight));
    for (const [index, line] of lines.slice(0, maxLines).entries()) {
      ctx.fillText(line, padding, padding + index * lineHeight);
    }
  });
}

function drawShapeElement(
  ctx: CanvasRenderingContext2D,
  element: Extract<PPTElement, { type: 'shape' }>,
) {
  withElementTransform(ctx, element, () => {
    ctx.fillStyle = element.fill || '#bfdbfe';
    ctx.strokeStyle = element.outline?.color || 'rgba(37, 99, 235, 0.55)';
    ctx.lineWidth = element.outline?.width || 1.5;

    try {
      const path = new Path2D(element.path);
      const [viewBoxWidth, viewBoxHeight] = element.viewBox;
      ctx.save();
      ctx.scale(element.width / viewBoxWidth, element.height / viewBoxHeight);
      ctx.fill(path);
      if (element.outline) ctx.stroke(path);
      ctx.restore();
    } catch {
      ctx.fillRect(0, 0, element.width, element.height);
      if (element.outline) ctx.strokeRect(0, 0, element.width, element.height);
    }

    if (element.text?.content) {
      const fontSize = 18;
      ctx.fillStyle = element.text.defaultColor || '#111827';
      ctx.font = `${fontSize}px ${element.text.defaultFontName || 'sans-serif'}`;
      ctx.textBaseline = 'middle';
      const text = htmlToPlainText(element.text.content);
      ctx.fillText(text, 8, element.height / 2);
    }
  });
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const size = 12;

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - size * Math.cos(angle - Math.PI / 6),
    toY - size * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    toX - size * Math.cos(angle + Math.PI / 6),
    toY - size * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawLineElement(
  ctx: CanvasRenderingContext2D,
  element: Extract<PPTElement, { type: 'line' }>,
) {
  const [startX, startY] = element.start;
  const [endX, endY] = element.end;
  const x1 = element.left + startX;
  const y1 = element.top + startY;
  const x2 = element.left + endX;
  const y2 = element.top + endY;

  ctx.save();
  ctx.strokeStyle = element.color || '#2563eb';
  ctx.fillStyle = element.color || '#2563eb';
  ctx.lineWidth = Math.max(1, element.width || 3);
  ctx.lineCap = 'round';
  if (element.style === 'dashed') ctx.setLineDash([10, 8]);
  if (element.style === 'dotted') ctx.setLineDash([2, 8]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  if (element.points?.[1] === 'arrow') {
    drawArrowHead(ctx, x1, y1, x2, y2);
  }
  if (element.points?.[0] === 'arrow') {
    drawArrowHead(ctx, x2, y2, x1, y1);
  }
  ctx.restore();
}

async function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: Extract<PPTElement, { type: 'image' }>,
) {
  if (!element.src || typeof Image === 'undefined') return;

  await new Promise<void>((resolve) => {
    const image = new Image();
    if (!element.src.startsWith('data:')) {
      image.crossOrigin = 'anonymous';
    }
    image.onload = () => {
      withElementTransform(ctx, element, () => {
        ctx.drawImage(image, 0, 0, element.width, element.height);
      });
      resolve();
    };
    image.onerror = () => resolve();
    image.src = element.src;
  });
}

function drawFallbackElement(
  ctx: CanvasRenderingContext2D,
  element: Extract<PPTElement, { left: number; top: number; width: number; height: number }>,
  label: string,
) {
  withElementTransform(ctx, element, () => {
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.fillRect(0, 0, element.width, element.height);
    ctx.strokeRect(0, 0, element.width, element.height);
    ctx.fillStyle = '#475569';
    ctx.font = '18px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 10, element.height / 2);
  });
}

async function drawElement(ctx: CanvasRenderingContext2D, element: PPTElement) {
  switch (element.type) {
    case 'text':
      drawTextElement(ctx, element);
      break;
    case 'shape':
      drawShapeElement(ctx, element);
      break;
    case 'line':
      drawLineElement(ctx, element);
      break;
    case 'image':
      await drawImageElement(ctx, element);
      break;
    case 'latex':
      drawFallbackElement(ctx, element, element.latex || 'Formula');
      break;
    case 'chart':
      drawFallbackElement(ctx, element, `${element.chartType || 'chart'} chart`);
      break;
    case 'table':
      drawFallbackElement(
        ctx,
        element,
        `${element.data.length}x${element.data[0]?.length || 0} table`,
      );
      break;
    default:
      break;
  }
}

async function exportWhiteboardSnapshot(
  elements: PPTElement[],
  canvasWidth: number,
  canvasHeight: number,
  quality = SNAPSHOT_JPEG_QUALITY,
): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  const width = Math.round(canvasWidth);
  const height = Math.round(canvasHeight);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  for (const element of elements) {
    await drawElement(ctx, element);
  }

  try {
    return canvas.toDataURL(SNAPSHOT_MEDIA_TYPE, quality);
  } catch (error) {
    console.warn('[WhiteboardCanvas] Failed to serialize snapshot:', error);
    return null;
  }
}

function AnimatedElement({
  element,
  index,
  isClearing,
  totalElements,
}: {
  element: PPTElement;
  index: number;
  isClearing: boolean;
  totalElements: number;
}) {
  const clearDelay = isClearing ? (totalElements - 1 - index) * 0.055 : 0;
  const clearRotate = isClearing ? (index % 2 === 0 ? 1 : -1) * (2 + index * 0.4) : 0;

  return (
    <motion.div
      layout={false}
      initial={{ opacity: 0, scale: 0.92, y: 8, filter: 'blur(4px)' }}
      animate={
        isClearing
          ? {
              opacity: 0,
              scale: 0.35,
              y: -35,
              rotate: clearRotate,
              filter: 'blur(8px)',
              transition: {
                duration: 0.38,
                delay: clearDelay,
                ease: [0.5, 0, 1, 0.6],
              },
            }
          : {
              opacity: 1,
              scale: 1,
              y: 0,
              rotate: 0,
              filter: 'blur(0px)',
              transition: {
                duration: 0.45,
                ease: [0.16, 1, 0.3, 1],
                delay: index * 0.05,
              },
            }
      }
      exit={{
        opacity: 0,
        scale: 0.85,
        transition: { duration: 0.2 },
      }}
      className="absolute inset-0"
      style={{ pointerEvents: isClearing ? 'none' : undefined }}
    >
      <div style={{ pointerEvents: 'auto' }}>
        <ScreenElement elementInfo={element} elementIndex={index} animate />
      </div>
    </motion.div>
  );
}

const InteractiveWhiteboardCanvas = forwardRef<
  InteractiveWhiteboardCanvasHandle,
  InteractiveWhiteboardCanvasProps
>(function InteractiveWhiteboardCanvas(
  {
    canvasHeight,
    canvasWidth,
    containerWidth,
    containerHeight,
    containerScale,
    elements,
    isClearing,
    onViewModifiedChange,
    onEditorTrace,
    readyHintText,
    readyText,
  },
  ref,
) {
  const [viewZoom, setViewZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const prevElementsLengthRef = useRef(elements.length);
  const resetTimerRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const isViewModified = viewZoom !== 1 || panX !== 0 || panY !== 0;

  // Zoom-aware pan boundary: ensure at least an edge of the canvas stays visible
  const clampPan = useCallback(
    (x: number, y: number, zoom: number) => {
      const totalScale = containerScale * zoom;
      const maxPanX = canvasWidth / 2 + containerWidth / (2 * totalScale);
      const maxPanY = canvasHeight / 2 + containerHeight / (2 * totalScale);
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, x)),
        y: Math.max(-maxPanY, Math.min(maxPanY, y)),
      };
    },
    [canvasWidth, canvasHeight, containerWidth, containerHeight, containerScale],
  );

  const resetView = useCallback((animate: boolean) => {
    setIsPanning(false);
    setIsResetting(animate);
    setViewZoom(1);
    setPanX(0);
    setPanY(0);

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    if (!animate) {
      return;
    }

    resetTimerRef.current = window.setTimeout(() => {
      setIsResetting(false);
      resetTimerRef.current = null;
    }, 250);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      resetView: () => resetView(true),
    }),
    [resetView],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !onEditorTrace) {
      return;
    }

    const handleEditorEvent = (event: Event) => {
      const rawDetail =
        event instanceof CustomEvent && typeof event.detail === 'object' && event.detail !== null
          ? (event.detail as Record<string, unknown>)
          : {};
      const params =
        typeof rawDetail.params === 'object' && rawDetail.params !== null
          ? (rawDetail.params as Record<string, unknown>)
          : rawDetail;

      onEditorTrace({
        eventName: event.type as WhiteboardEditorEventName,
        actionName: isStudentWhiteboardActionName(rawDetail.actionName)
          ? rawDetail.actionName
          : undefined,
        params: {
          ...params,
          elementId: getRecordValue(rawDetail, 'elementId') ?? getRecordValue(params, 'elementId'),
        },
      });
    };

    for (const eventName of EDITOR_TRACE_EVENTS) {
      el.addEventListener(eventName, handleEditorEvent);
    }

    return () => {
      for (const eventName of EDITOR_TRACE_EVENTS) {
        el.removeEventListener(eventName, handleEditorEvent);
      }
    };
  }, [onEditorTrace]);

  // Notify parent when view modified state changes
  useEffect(() => {
    onViewModifiedChange?.(isViewModified);
  }, [isViewModified, onViewModifiedChange]);

  // Always-on drag/pan — no toggle needed
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) {
        return;
      }

      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [panX, panY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning) {
        return;
      }

      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      // Convert screen-space drag to canvas-space (accounts for both container scale and zoom)
      const effectiveScale = Math.max(containerScale * viewZoom, 0.001);

      const newPanX = panStartRef.current.panX + dx / effectiveScale;
      const newPanY = panStartRef.current.panY + dy / effectiveScale;
      const clamped = clampPan(newPanX, newPanY, viewZoom);
      setPanX(clamped.x);
      setPanY(clamped.y);
    },
    [containerScale, viewZoom, isPanning, clampPan],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }

    setIsPanning(false);
  }, []);

  // Zoom toward cursor
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (elements.length === 0) {
        return;
      }

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

      setViewZoom((prevZoom) => {
        const newZoom = Math.min(5, Math.max(0.2, prevZoom * zoomFactor));

        // Adjust pan to keep the point under the cursor stationary
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const oldScale = containerScale * prevZoom;
        const newScale = containerScale * newZoom;
        const scaleDiff = 1 / newScale - 1 / oldScale;

        setPanX((prevPanX) => {
          const newPanX = prevPanX + (cursorX - containerWidth / 2) * scaleDiff;
          const maxPX = canvasWidth / 2 + containerWidth / (2 * newScale);
          return Math.max(-maxPX, Math.min(maxPX, newPanX));
        });

        setPanY((prevPanY) => {
          const newPanY = prevPanY + (cursorY - containerHeight / 2) * scaleDiff;
          const maxPY = canvasHeight / 2 + containerHeight / (2 * newScale);
          return Math.max(-maxPY, Math.min(maxPY, newPanY));
        });

        return newZoom;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [elements.length, containerScale, containerWidth, containerHeight, canvasWidth, canvasHeight]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const prevLength = prevElementsLengthRef.current;
    const nextLength = elements.length;
    prevElementsLengthRef.current = nextLength;

    const clearedBoard = prevLength > 0 && nextLength === 0;
    const firstContentLoaded = prevLength === 0 && nextLength > 0;
    if (!clearedBoard && !firstContentLoaded) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        resetView(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [elements.length, resetView]);

  const handleDoubleClick = useCallback(
    (e?: React.MouseEvent) => {
      e?.preventDefault();
      resetView(true);
    },
    [resetView],
  );

  // Canvas position: centered in workspace, offset by pan, scaled by containerScale * viewZoom
  const totalScale = containerScale * viewZoom;
  const canvasScreenX = (containerWidth - canvasWidth * totalScale) / 2 + panX * totalScale;
  const canvasScreenY = (containerHeight - canvasHeight * totalScale) / 2 + panY * totalScale;
  const canvasTransform = `translate(${canvasScreenX}px, ${canvasScreenY}px) scale(${totalScale})`;

  return (
    /* Viewport — fills workspace, handles pointer events, no clipping */
    <div
      ref={viewportRef}
      className="w-full h-full relative select-none"
      style={{
        cursor: isPanning ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* Bounded canvas — white background, positioned and scaled. No overflow-hidden so elements can spill into transparent space. */}
      <div
        className="absolute bg-white shadow-2xl rounded-lg border border-gray-200 dark:border-gray-600"
        style={{
          width: canvasWidth,
          height: canvasHeight,
          left: 0,
          top: 0,
          transform: canvasTransform,
          transformOrigin: '0 0',
          transition: isResetting ? 'transform 0.25s ease-out' : undefined,
        }}
      >
        {/* Empty state placeholder */}
        <AnimatePresence>
          {elements.length === 0 && !isClearing && (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { delay: 0.25, duration: 0.4 },
              }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="text-center text-gray-400">
                <p className="text-lg font-medium">{readyText}</p>
                <p className="text-sm mt-1">{readyHintText}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content layer — elements rendered at their raw coordinates */}
        <div className="absolute inset-0">
          <AnimatePresence mode="popLayout">
            {elements.map((element, index) => (
              <AnimatedElement
                key={element.id}
                element={element}
                index={index}
                isClearing={isClearing}
                totalElements={elements.length}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
});

/**
 * Whiteboard canvas with pan, zoom, auto-fit, and bounded viewport.
 */
export type WhiteboardCanvasProps = {
  onViewModifiedChange?: (modified: boolean) => void;
  onEditorTrace?: (trace: WhiteboardEditorTrace) => void;
};

export const WhiteboardCanvas = forwardRef<WhiteboardCanvasHandle, WhiteboardCanvasProps>(
  function WhiteboardCanvas({ onViewModifiedChange, onEditorTrace }, ref) {
    const { t } = useI18n();
    const stage = useStageStore.use.stage();
    const isClearing = useCanvasStore.use.whiteboardClearing();
    const containerRef = useRef<HTMLDivElement>(null);
    const interactiveCanvasRef = useRef<InteractiveWhiteboardCanvasHandle>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    const whiteboard = stage?.whiteboard?.[0];
    const rawElements = whiteboard?.elements;
    const elements = useMemo(() => rawElements ?? [], [rawElements]);

    const canvasWidth = 1000;
    const canvasHeight = 562.5;

    const getCanvasSnapshot = useCallback(
      (options?: CanvasSnapshotOptions) => {
        const currentElements =
          useStageStore.getState().stage?.whiteboard?.[0]?.elements ?? elements;
        return exportWhiteboardSnapshot(
          currentElements,
          canvasWidth,
          canvasHeight,
          options?.quality,
        );
      },
      [elements, canvasWidth, canvasHeight],
    );

    useImperativeHandle(
      ref,
      () => ({
        resetView: () => interactiveCanvasRef.current?.resetView(),
        getCanvasSnapshot,
      }),
      [getCanvasSnapshot],
    );

    useEffect(() => {
      useCanvasStore.getState().setCanvasSnapshotGetter(getCanvasSnapshot);

      return () => {
        if (useCanvasStore.getState().canvasSnapshotGetter === getCanvasSnapshot) {
          useCanvasStore.getState().setCanvasSnapshotGetter(null);
        }
      };
    }, [getCanvasSnapshot]);

    const containerScale = useMemo(() => {
      if (containerSize.width === 0 || containerSize.height === 0) return 1;
      return Math.min(containerSize.width / canvasWidth, containerSize.height / canvasHeight);
    }, [containerSize.width, containerSize.height, canvasWidth, canvasHeight]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });
      observer.observe(container);

      // Initial measurement
      setContainerSize({ width: container.clientWidth, height: container.clientHeight });

      return () => observer.disconnect();
    }, []);

    return (
      <div ref={containerRef} className="w-full h-full overflow-hidden">
        <InteractiveWhiteboardCanvas
          ref={interactiveCanvasRef}
          canvasHeight={canvasHeight}
          canvasWidth={canvasWidth}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          containerScale={containerScale}
          elements={elements}
          isClearing={isClearing}
          onViewModifiedChange={onViewModifiedChange}
          onEditorTrace={onEditorTrace}
          readyHintText={t('whiteboard.readyHint')}
          readyText={t('whiteboard.ready')}
        />
      </div>
    );
  },
);

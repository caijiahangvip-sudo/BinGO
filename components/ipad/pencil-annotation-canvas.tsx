'use client';

import { useCallback, useEffect, useRef } from 'react';

export interface PencilPoint {
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
}

export interface PencilStroke {
  id: string;
  color: string;
  width: number;
  tool: 'pen' | 'highlighter' | 'eraser';
  points: PencilPoint[];
}

export function normalizePencilPoint(
  event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pressure' | 'timeStamp'>,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): PencilPoint {
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    pressure: event.pressure > 0 ? event.pressure : 0.5,
    timestamp: event.timeStamp,
  };
}

export function PencilAnnotationCanvas({
  strokes,
  color = '#ef4444',
  width = 4,
  tool = 'pen',
  onStroke,
  className,
}: {
  strokes: readonly PencilStroke[];
  color?: string;
  width?: number;
  tool?: PencilStroke['tool'];
  onStroke: (stroke: PencilStroke) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeRef = useRef<PencilStroke | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, bounds.width, bounds.height);
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      context.save();
      context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      context.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
      context.strokeStyle = stroke.color;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * bounds.width;
        const y = point.y * bounds.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.lineWidth = stroke.width;
      context.stroke();
      context.restore();
    }
  }, [strokes]);

  useEffect(() => {
    redraw();
    const observer = new ResizeObserver(redraw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [redraw]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'pen' && event.pointerType !== 'touch') return;
        event.currentTarget.setPointerCapture(event.pointerId);
        activeStrokeRef.current = {
          id: crypto.randomUUID(),
          color,
          width,
          tool,
          points: [normalizePencilPoint(event.nativeEvent, event.currentTarget.getBoundingClientRect())],
        };
      }}
      onPointerMove={(event) => {
        const stroke = activeStrokeRef.current;
        if (!stroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        stroke.points.push(
          normalizePencilPoint(event.nativeEvent, event.currentTarget.getBoundingClientRect()),
        );
      }}
      onPointerUp={(event) => {
        const stroke = activeStrokeRef.current;
        activeStrokeRef.current = null;
        if (stroke?.points.length) onStroke(stroke);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        activeStrokeRef.current = null;
      }}
    />
  );
}

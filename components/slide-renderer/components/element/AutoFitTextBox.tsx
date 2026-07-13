'use client';

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

interface AutoFitTextBoxProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly style?: CSSProperties;
  readonly contentStyle?: CSSProperties;
  readonly enabled?: boolean;
  readonly minScale?: number;
  readonly verticalAlign?: 'top' | 'middle' | 'bottom';
  readonly onMouseDown?: (e: React.MouseEvent) => void;
}

const DEFAULT_MIN_SCALE = 0.55;

export function AutoFitTextBox({
  children,
  className,
  contentClassName,
  style,
  contentStyle,
  enabled = true,
  minScale = DEFAULT_MIN_SCALE,
  verticalAlign = 'top',
  onMouseDown,
}: AutoFitTextBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, offsetY: 0 });

  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || !enabled) {
      setFit((prev) => (prev.scale === 1 && prev.offsetY === 0 ? prev : { scale: 1, offsetY: 0 }));
      return;
    }

    const availableWidth = box.clientWidth;
    const availableHeight = box.clientHeight;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const contentWidth = Math.max(content.scrollWidth, content.offsetWidth);
    const contentHeight = Math.max(content.scrollHeight, content.offsetHeight);

    const widthScale = contentWidth > availableWidth ? availableWidth / contentWidth : 1;
    const heightScale = contentHeight > availableHeight ? availableHeight / contentHeight : 1;
    const nextScale = Math.max(Math.min(widthScale, heightScale, 1), minScale);
    const renderedHeight = contentHeight * nextScale;
    const offsetY =
      verticalAlign === 'middle'
        ? Math.max(0, (availableHeight - renderedHeight) / 2)
        : verticalAlign === 'bottom'
          ? Math.max(0, availableHeight - renderedHeight)
          : 0;

    setFit((prev) =>
      Math.abs(prev.scale - nextScale) < 0.005 && Math.abs(prev.offsetY - offsetY) < 0.5
        ? prev
        : { scale: nextScale, offsetY },
    );
  }, [enabled, minScale, verticalAlign]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [children, measure, style, contentStyle]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={boxRef}
      className={cn('relative h-full w-full overflow-hidden', className)}
      style={style}
      onMouseDown={onMouseDown}
    >
      <div
        ref={contentRef}
        className={cn('origin-top-left', contentClassName)}
        style={{
          ...contentStyle,
          position: 'relative',
          top: fit.offsetY ? `${fit.offsetY}px` : undefined,
          width: '100%',
          transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

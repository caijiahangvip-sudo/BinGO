'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PPTLineElement } from '@/lib/types/slides';
import { getLineRenderGeometry } from '@/lib/utils/line-geometry';
import { useElementShadow } from '../hooks/useElementShadow';
import { LinePointMarker } from './LinePointMarker';

export interface BaseLineElementProps {
  elementInfo: PPTLineElement;
  animate?: boolean;
}

/** Duration of the stroke-drawing animation in ms */
const DRAW_ANIMATION_MS = 600;

function safeSvgIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Base line element for read-only/playback mode.
 * When animate=true, plays a stroke-drawing animation on mount.
 */
export function BaseLineElement({ elementInfo, animate }: BaseLineElementProps) {
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const pathRef = useRef<SVGPathElement>(null);
  const [drawComplete, setDrawComplete] = useState(!animate);
  const reactId = useId();

  const markerId = useMemo(
    () => `${safeSvgIdSegment(elementInfo.id)}-${safeSvgIdSegment(reactId)}`,
    [elementInfo.id, reactId],
  );

  const lineDashArray = useMemo(() => {
    const size = elementInfo.width;
    if (elementInfo.style === 'dashed')
      return size <= 8 ? `${size * 5} ${size * 2.5}` : `${size * 5} ${size * 1.5}`;
    if (elementInfo.style === 'dotted')
      return size <= 8 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`;
    return '0 0';
  }, [elementInfo.width, elementInfo.style]);

  const geometry = useMemo(() => getLineRenderGeometry(elementInfo), [elementInfo]);

  // Stroke-drawing animation on mount (whiteboard only)
  useEffect(() => {
    if (!animate) return;
    const pathEl = pathRef.current;
    if (!pathEl) return;

    const length = pathEl.getTotalLength();
    if (length === 0) {
      // Zero-length path — skip animation, reveal markers on next tick
      const t = setTimeout(() => setDrawComplete(true), 0);
      return () => clearTimeout(t);
    }

    // Initial state: line fully hidden via dash offset
    pathEl.style.strokeDasharray = `${length}`;
    pathEl.style.strokeDashoffset = `${length}`;
    pathEl.style.transition = 'none';

    // Force reflow so the browser registers the initial state
    pathEl.getBoundingClientRect();

    // Animate: draw the line from start to end
    pathEl.style.transition = `stroke-dashoffset ${DRAW_ANIMATION_MS}ms ease-out`;
    pathEl.style.strokeDashoffset = '0';

    // After animation, restore the original dash style (for dashed/dotted lines)
    // and show endpoint markers
    const timer = setTimeout(() => {
      pathEl.style.transition = 'none';
      pathEl.style.strokeDasharray = '';
      pathEl.style.strokeDashoffset = '';
      setDrawComplete(true);
    }, DRAW_ANIMATION_MS + 50);

    return () => clearTimeout(timer);
  }, [animate]);

  return (
    <div
      className="base-element-line absolute"
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
      }}
    >
      <div
        className="element-content relative w-full h-full"
        style={{ filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '' }}
      >
        <svg
          overflow="visible"
          width={geometry.width}
          height={geometry.height}
          viewBox={geometry.viewBox}
          className="absolute transform-origin-[0_0] overflow-visible"
          style={{
            left: `${geometry.left}px`,
            top: `${geometry.top}px`,
          }}
        >
          <defs>
            {elementInfo.points[0] && (
              <LinePointMarker
                id={markerId}
                position="start"
                type={elementInfo.points[0]}
                color={elementInfo.color}
                baseSize={elementInfo.width}
              />
            )}
            {elementInfo.points[1] && (
              <LinePointMarker
                id={markerId}
                position="end"
                type={elementInfo.points[1]}
                color={elementInfo.color}
                baseSize={elementInfo.width}
              />
            )}
          </defs>
          <path
            ref={pathRef}
            d={geometry.path}
            stroke={elementInfo.color}
            strokeWidth={elementInfo.width}
            strokeDasharray={lineDashArray}
            fill="none"
            markerStart={
              drawComplete && elementInfo.points[0]
                ? `url(#${markerId}-${elementInfo.points[0]}-start)`
                : ''
            }
            markerEnd={
              drawComplete && elementInfo.points[1]
                ? `url(#${markerId}-${elementInfo.points[1]}-end)`
                : ''
            }
          />
        </svg>
      </div>
    </div>
  );
}

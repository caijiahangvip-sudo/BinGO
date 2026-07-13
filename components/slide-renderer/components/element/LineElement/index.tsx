'use client';

import { useId, useMemo } from 'react';
import type { PPTLineElement } from '@/lib/types/slides';
import { getLineRenderGeometry } from '@/lib/utils/line-geometry';
import { useElementShadow } from '../hooks/useElementShadow';
import { LinePointMarker } from './LinePointMarker';

export { BaseLineElement } from './BaseLineElement';

export interface LineElementProps {
  elementInfo: PPTLineElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTLineElement) => void;
}

function safeSvgIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Line element component
 * Renders SVG lines with optional arrow/dot endpoints
 */
export function LineElement({ elementInfo, selectElement }: LineElementProps) {
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const reactId = useId();
  const markerId = useMemo(
    () => `${safeSvgIdSegment(elementInfo.id)}-${safeSvgIdSegment(reactId)}`,
    [elementInfo.id, reactId],
  );

  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  // Calculate line dash array for dashed/dotted styles
  const lineDashArray = useMemo(() => {
    const size = elementInfo.width;
    if (elementInfo.style === 'dashed') {
      return size <= 8 ? `${size * 5} ${size * 2.5}` : `${size * 5} ${size * 1.5}`;
    }
    if (elementInfo.style === 'dotted') {
      return size <= 8 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`;
    }
    return '0 0';
  }, [elementInfo.width, elementInfo.style]);

  const geometry = useMemo(() => getLineRenderGeometry(elementInfo), [elementInfo]);

  return (
    <div
      className={`editable-element-line absolute pointer-events-none ${elementInfo.lock ? 'lock' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
      }}
    >
      <div
        className="element-content relative w-full h-full"
        style={{
          filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
        }}
        onMouseDown={handleSelectElement}
        onTouchStart={handleSelectElement}
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
          {/* Visible line */}
          <path
            className={`line-point pointer-events-auto ${elementInfo.lock ? 'cursor-default' : 'cursor-move'}`}
            d={geometry.path}
            stroke={elementInfo.color}
            strokeWidth={elementInfo.width}
            strokeDasharray={lineDashArray}
            fill="none"
            markerStart={
              elementInfo.points[0] ? `url(#${markerId}-${elementInfo.points[0]}-start)` : ''
            }
            markerEnd={
              elementInfo.points[1] ? `url(#${markerId}-${elementInfo.points[1]}-end)` : ''
            }
          />
          {/* Invisible wider path for easier clicking */}
          <path
            className={`line-path pointer-events-auto ${elementInfo.lock ? 'cursor-default' : 'cursor-move'}`}
            d={geometry.path}
            stroke="transparent"
            strokeWidth="20"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}

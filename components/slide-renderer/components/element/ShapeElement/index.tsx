'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { PPTShapeElement, ShapeText } from '@/lib/types/slides';
import { DEFAULT_SCREEN_FONT_NAME, resolveScreenFontFamily } from '@/lib/constants/fonts';
import {
  hasCenteredTextAlign,
  hasExplicitTextAlign,
  shouldAutoCenterBoxText,
} from '@/lib/utils/text-box-alignment';
import { useCanvasStore } from '@/lib/store';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { useElementShadow } from '../hooks/useElementShadow';
import { useElementFlip } from '../hooks/useElementFlip';
import { useElementFill } from '../hooks/useElementFill';
import { useElementOutline } from '../hooks/useElementOutline';
import { GradientDefs } from './GradientDefs';
import { PatternDefs } from './PatternDefs';
import { ProsemirrorEditor } from '../ProsemirrorEditor';
import { AutoFitTextBox } from '../AutoFitTextBox';
import { normalizeShapeViewBox } from '@/lib/utils/shape-view-box';

export { BaseShapeElement } from './BaseShapeElement';

export interface ShapeElementProps {
  elementInfo: PPTShapeElement;
  selectElement?: (
    e: React.MouseEvent | React.TouchEvent,
    element: PPTShapeElement,
    canMove?: boolean,
  ) => void;
}

/**
 * Shape element component with text editing support
 * Supports gradients, patterns, and rich text content
 */
export function ShapeElement({ elementInfo, selectElement }: ShapeElementProps) {
  const handleElementId = useCanvasStore.use.handleElementId();
  const { updateElement, removeElementProps } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();

  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const { flipStyle } = useElementFlip(elementInfo.flipH, elementInfo.flipV);
  const { fill } = useElementFill(elementInfo, 'editable');
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(elementInfo.outline);

  const [editable, setEditable] = useState(false);

  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent, canMove = true) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo, canMove);
  };

  // Stop editing when element is no longer active
  useEffect(() => {
    if (handleElementId !== elementInfo.id && editable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync editable state with active element
      setEditable(false);
    }
  }, [handleElementId, elementInfo.id, editable]);

  // Default text configuration
  const text = useMemo<ShapeText>(() => {
    const defaultText: ShapeText = {
      content: '',
      align: 'middle',
      defaultFontName: DEFAULT_SCREEN_FONT_NAME,
      defaultColor: '#000000',
    };
    if (!elementInfo.text) return defaultText;
    return elementInfo.text;
  }, [elementInfo.text]);
  const canAutoCenterText =
    !hasExplicitTextAlign(text.content) || hasCenteredTextAlign(text.content);
  const shouldForceCenterText =
    canAutoCenterText &&
    text.align === 'middle' &&
    shouldAutoCenterBoxText({
      html: text.content,
      boxWidth: elementInfo.width,
      boxHeight: elementInfo.height,
    });
  const [viewBoxWidth, viewBoxHeight] = normalizeShapeViewBox(
    elementInfo.viewBox,
    elementInfo.width,
    elementInfo.height,
  );

  // Update text content
  const updateText = useCallback(
    (content: string, ignore = false) => {
      const _text = { ...text, content };
      updateElement({
        id: elementInfo.id,
        props: { text: _text },
      });

      if (!ignore) addHistorySnapshot();
    },
    [elementInfo.id, text, updateElement, addHistorySnapshot],
  );

  // Check and remove empty text
  const checkEmptyText = useCallback(() => {
    if (!elementInfo.text) return;

    const pureText = elementInfo.text.content.replace(/<[^>]+>/g, '');
    if (!pureText) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 'text' is specific to PPTShapeElement, not in keyof PPTElement union
      removeElementProps({ id: elementInfo.id, propName: 'text' as any });
      addHistorySnapshot();
    }
  }, [elementInfo.id, elementInfo.text, removeElementProps, addHistorySnapshot]);

  // Start editing on double click
  const startEdit = () => {
    setEditable(true);
  };

  return (
    <div
      className={`editable-element-shape absolute pointer-events-none ${elementInfo.lock ? 'lock' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          className={`element-content relative w-full h-full ${elementInfo.lock ? '' : 'cursor-move'}`}
          style={{
            opacity: elementInfo.opacity,
            filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
            transform: flipStyle,
            color: text.defaultColor,
            fontFamily: resolveScreenFontFamily(text.defaultFontName),
          }}
          onMouseDown={(e) => handleSelectElement(e)}
          onTouchStart={(e) => handleSelectElement(e)}
          onDoubleClick={startEdit}
        >
          <svg
            overflow="visible"
            width={elementInfo.width}
            height={elementInfo.height}
            className="transform-origin-[0_0] block"
          >
            <defs>
              {elementInfo.pattern && (
                <PatternDefs id={`editable-pattern-${elementInfo.id}`} src={elementInfo.pattern} />
              )}
              {elementInfo.gradient && !elementInfo.pattern && (
                <GradientDefs
                  id={`editable-gradient-${elementInfo.id}`}
                  type={elementInfo.gradient.type}
                  colors={elementInfo.gradient.colors}
                  rotate={elementInfo.gradient.rotate}
                />
              )}
            </defs>
            <g
              transform={`scale(${elementInfo.width / viewBoxWidth}, ${
                elementInfo.height / viewBoxHeight
              }) translate(0,0) matrix(1,0,0,1,0,0)`}
            >
              <path
                className="shape-path pointer-events-auto"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="butt"
                strokeMiterlimit="8"
                d={elementInfo.path}
                fill={fill}
                stroke={outlineColor}
                strokeWidth={outlineWidth}
                strokeDasharray={strokeDashArray}
              />
            </g>
          </svg>

          <AutoFitTextBox
            enabled={!editable}
            className={`shape-text absolute inset-0 p-[10px] leading-[1.5] break-words pointer-events-none ${
              editable || text.content ? 'pointer-events-auto' : ''
            }`}
            contentClassName="[&_p]:m-0 [&_p+_p]:mt-[var(--paragraphSpace)] [&_ol]:my-0 [&_ul]:my-0 [&_li]:my-0"
            verticalAlign={text.align}
            style={{
              lineHeight: text.lineHeight,
              letterSpacing: `${text.wordSpace || 0}px`,
              textAlign: shouldForceCenterText ? 'center' : undefined,
              // @ts-expect-error - CSS custom property
              '--paragraphSpace': `${text.paragraphSpace === undefined ? 5 : text.paragraphSpace}px`,
            }}
          >
            {(editable || text.content) && (
              <ProsemirrorEditor
                elementId={elementInfo.id}
                defaultColor={text.defaultColor}
                defaultFontName={text.defaultFontName}
                editable={!elementInfo.lock && editable}
                value={text.content}
                onUpdate={({ value, ignore }) => updateText(value, ignore)}
                onBlur={checkEmptyText}
                onMouseDown={(e) => handleSelectElement(e as React.MouseEvent, false)}
              />
            )}
          </AutoFitTextBox>
        </div>
      </div>
    </div>
  );
}

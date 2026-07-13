'use client';

import type { PPTShapeElement, ShapeText } from '@/lib/types/slides';
import { DEFAULT_SCREEN_FONT_NAME, resolveScreenFontFamily } from '@/lib/constants/fonts';
import {
  ensureCenteredParagraphText,
  hasCenteredTextAlign,
  hasExplicitTextAlign,
  shouldAutoCenterBoxText,
} from '@/lib/utils/text-box-alignment';
import { useElementOutline } from '../hooks/useElementOutline';
import { useElementShadow } from '../hooks/useElementShadow';
import { useElementFlip } from '../hooks/useElementFlip';
import { useElementFill } from '../hooks/useElementFill';
import { GradientDefs } from './GradientDefs';
import { PatternDefs } from './PatternDefs';
import { AutoFitTextBox } from '../AutoFitTextBox';
import { repairMathDisplayText } from '@/lib/utils/math-display-repair';
import { normalizeShapeViewBox } from '@/lib/utils/shape-view-box';

export interface BaseShapeElementProps {
  elementInfo: PPTShapeElement;
}

/**
 * Base shape element for read-only/playback mode
 */
export function BaseShapeElement({ elementInfo }: BaseShapeElementProps) {
  const { fill } = useElementFill(elementInfo, 'base');
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(elementInfo.outline);
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const { flipStyle } = useElementFlip(elementInfo.flipH, elementInfo.flipV);

  const text: ShapeText = elementInfo.text || {
    content: '',
    align: 'middle',
    defaultFontName: DEFAULT_SCREEN_FONT_NAME,
    defaultColor: '#333333',
  };
  const repairedContent = repairMathDisplayText(text.content);
  const canAutoCenterText =
    !hasExplicitTextAlign(repairedContent) || hasCenteredTextAlign(repairedContent);
  const shouldForceCenterText =
    canAutoCenterText &&
    text.align === 'middle' &&
    shouldAutoCenterBoxText({
      html: repairedContent,
      boxWidth: elementInfo.width,
      boxHeight: elementInfo.height,
    });
  const renderedTextHtml = shouldForceCenterText
    ? ensureCenteredParagraphText(repairedContent)
    : repairedContent;
  const [viewBoxWidth, viewBoxHeight] = normalizeShapeViewBox(
    elementInfo.viewBox,
    elementInfo.width,
    elementInfo.height,
  );

  return (
    <div
      className="base-element-shape absolute"
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
          className="element-content relative w-full h-full"
          style={{
            opacity: elementInfo.opacity,
            filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
            transform: flipStyle,
            color: text.defaultColor,
            fontFamily: resolveScreenFontFamily(text.defaultFontName),
          }}
        >
          <svg
            overflow="visible"
            width={elementInfo.width}
            height={elementInfo.height}
            className="transform-origin-[0_0] overflow-visible block"
          >
            <defs>
              {elementInfo.pattern && (
                <PatternDefs id={`base-pattern-${elementInfo.id}`} src={elementInfo.pattern} />
              )}
              {elementInfo.gradient && (
                <GradientDefs
                  id={`base-gradient-${elementInfo.id}`}
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
            className="shape-text absolute inset-0 px-2.5 py-2.5 leading-relaxed break-words"
            contentClassName="ProseMirror-static [&_p]:m-0 [&_p+_p]:mt-[var(--paragraphSpace)] [&_ol]:my-0 [&_ul]:my-0 [&_li]:my-0"
            verticalAlign={text.align}
            style={{
              lineHeight: text.lineHeight,
              letterSpacing: `${text.wordSpace || 0}px`,
              textAlign: shouldForceCenterText ? 'center' : undefined,
              // @ts-expect-error CSS custom properties
              '--paragraphSpace': `${text.paragraphSpace === undefined ? 5 : text.paragraphSpace}px`,
            }}
          >
            <div dangerouslySetInnerHTML={{ __html: renderedTextHtml }} />
          </AutoFitTextBox>
        </div>
      </div>
    </div>
  );
}

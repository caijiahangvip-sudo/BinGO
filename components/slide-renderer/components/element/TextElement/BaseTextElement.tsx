'use client';

import type { PPTTextElement } from '@/lib/types/slides';
import { resolveScreenFontFamily } from '@/lib/constants/fonts';
import { useElementShadow } from '../hooks/useElementShadow';
import { ElementOutline } from '../ElementOutline';
import { AutoFitTextBox } from '../AutoFitTextBox';
import { repairMathDisplayText } from '@/lib/utils/math-display-repair';
import {
  ensureCenteredParagraphText,
  hasCenteredTextAlign,
  hasExplicitTextAlign,
  hasVisibleTextBoxFill,
  shouldAutoCenterBoxText,
} from '@/lib/utils/text-box-alignment';

export interface BaseTextElementProps {
  elementInfo: PPTTextElement;
  target?: string;
}

/**
 * Base text element component (read-only)
 * Renders static text content with styling
 */
export function BaseTextElement({ elementInfo, target }: BaseTextElementProps) {
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const hasFilledBackground = hasVisibleTextBoxFill(elementInfo.fill);
  const repairedContent = repairMathDisplayText(elementInfo.content);
  const canAutoCenterText =
    !hasExplicitTextAlign(repairedContent) || hasCenteredTextAlign(repairedContent);
  const isCenterableShortText = shouldAutoCenterBoxText({
    html: repairedContent,
    boxWidth: elementInfo.width,
    boxHeight: elementInfo.height,
  });
  const shouldForceCenterText =
    canAutoCenterText &&
    (hasFilledBackground || hasCenteredTextAlign(repairedContent)) &&
    isCenterableShortText;
  const renderedTextHtml = shouldForceCenterText
    ? ensureCenteredParagraphText(repairedContent)
    : repairedContent;

  return (
    <div
      className="base-element-text absolute"
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
          className="element-content relative h-full w-full overflow-hidden p-[10px] leading-[1.5] break-words"
          style={{
            backgroundColor: elementInfo.fill,
            borderRadius: hasFilledBackground ? '6px' : undefined,
            opacity: elementInfo.opacity,
            textShadow: shadowStyle,
            lineHeight: elementInfo.lineHeight,
            letterSpacing: `${elementInfo.wordSpace || 0}px`,
            color: elementInfo.defaultColor,
            fontFamily: resolveScreenFontFamily(elementInfo.defaultFontName),
            writingMode: elementInfo.vertical ? 'vertical-rl' : 'horizontal-tb',
            // @ts-expect-error - CSS custom property
            '--paragraphSpace': `${elementInfo.paragraphSpace === undefined ? 5 : elementInfo.paragraphSpace}px`,
          }}
        >
          <ElementOutline
            width={elementInfo.width}
            height={elementInfo.height}
            outline={elementInfo.outline}
          />
          <AutoFitTextBox
            className={`text ${target === 'thumbnail' ? 'pointer-events-none' : ''}`}
            contentClassName="ProseMirror-static relative [&_p]:m-0 [&_p+_p]:mt-[var(--paragraphSpace)] [&_ol]:my-0 [&_ul]:my-0 [&_li]:my-0"
            verticalAlign={shouldForceCenterText ? 'middle' : 'top'}
            style={{
              textAlign: shouldForceCenterText ? 'center' : undefined,
            }}
          >
            <div dangerouslySetInnerHTML={{ __html: renderedTextHtml }} />
          </AutoFitTextBox>
        </div>
      </div>
    </div>
  );
}

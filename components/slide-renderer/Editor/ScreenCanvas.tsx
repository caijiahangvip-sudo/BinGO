'use client';

import { ScreenElement } from './ScreenElement';
import { HighlightOverlay } from './HighlightOverlay';
import { SpotlightOverlay } from './SpotlightOverlay';
import { useSlideBackgroundStyle } from '@/lib/hooks/use-slide-background-style';
import { useCanvasStore } from '@/lib/store';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import { repairSlideElementLayout } from '@/lib/utils/slide-element-layout';
import { repairGeometryDiagramLayering } from '@/lib/utils/slide-element-order';
import { findElementGeometry } from '@/lib/utils/geometry';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement, SlideBackground } from '@/lib/types/slides';
import type { PercentageGeometry } from '@/lib/types/action';
import { useRef, useMemo, useLayoutEffect, useState } from 'react';

export function ScreenCanvas({ showTeachingEffects = false }: { showTeachingEffects?: boolean }) {
  const viewportSize = useCanvasStore.use.viewportSize();
  const viewportRatio = useCanvasStore.use.viewportRatio();
  const elements = useSceneSelector<SlideContent, PPTElement[]>(
    (content) => content.canvas.elements,
  );
  const orderedElements = useMemo(
    () => repairGeometryDiagramLayering(repairSlideElementLayout(elements)),
    [elements],
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0, left: 0, top: 0, scale: 1 });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateFrame = () => {
      const { width: canvasWidth, height: canvasHeight } = canvas.getBoundingClientRect();
      if (canvasWidth <= 0 || canvasHeight <= 0) return;

      const viewportHeight = viewportSize * viewportRatio;
      const scale = Math.min(canvasWidth / viewportSize, canvasHeight / viewportHeight);
      const width = viewportSize * scale;
      const height = viewportHeight * scale;
      const left = (canvasWidth - width) / 2;
      const top = (canvasHeight - height) / 2;

      setFrame((prev) => {
        const next = {
          width: Math.round(width * 100) / 100,
          height: Math.round(height * 100) / 100,
          left: Math.round(left * 100) / 100,
          top: Math.round(top * 100) / 100,
          scale,
        };
        if (
          prev.width === next.width &&
          prev.height === next.height &&
          prev.left === next.left &&
          prev.top === next.top &&
          Math.abs(prev.scale - next.scale) < 0.0001
        ) {
          return prev;
        }
        return next;
      });
    };

    updateFrame();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateFrame);
      return () => window.removeEventListener('resize', updateFrame);
    }

    const observer = new ResizeObserver(updateFrame);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [viewportRatio, viewportSize]);

  // Get background style
  const background = useSceneSelector<SlideContent, SlideBackground | undefined>(
    (content) => content.canvas.background,
  );
  const { backgroundStyle } = useSlideBackgroundStyle(background);

  // Get visual effect state
  const zoomTarget = useCanvasStore.use.zoomTarget();

  // Compute zoom target geometry
  const zoomGeometry = useMemo<PercentageGeometry | null>(() => {
    if (!zoomTarget) return null;
    const element = orderedElements.find((el) => el.id === zoomTarget.elementId);
    if (!element) return null;
    return findElementGeometry(
      { type: 'slide', content: { canvas: { elements: orderedElements } } } as Record<
        string,
        unknown
      >,
      zoomTarget.elementId,
    );
  }, [zoomTarget, orderedElements]);

  return (
    <div className="relative h-full w-full overflow-hidden select-none" ref={canvasRef}>
      <div
        className="absolute shadow-[0_0_0_1px_rgba(0,0,0,0.01),0_0_12px_0_rgba(0,0,0,0.1)] rounded-lg overflow-hidden transition-transform duration-700"
        style={{
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          left: `${frame.left}px`,
          top: `${frame.top}px`,
          ...(zoomTarget && zoomGeometry
            ? {
                transform: `scale(${zoomTarget.scale})`,
                transformOrigin: `${zoomGeometry.centerX}% ${zoomGeometry.centerY}%`,
              }
            : {}),
        }}
      >
        {/* Background layer */}
        <div
          className="w-full h-full bg-position-center rounded-lg"
          style={{ ...backgroundStyle }}
        ></div>

        {/* Content layer - scaled */}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: `${viewportSize}px`,
            height: `${viewportSize * viewportRatio}px`,
            transform: `scale(${frame.scale})`,
          }}
        >
          {orderedElements.map((element, index) => (
            <ScreenElement key={element.id} elementInfo={element} elementIndex={index + 1} />
          ))}

          {/* Highlight overlay - stacked above elements */}
          {showTeachingEffects && <HighlightOverlay />}
        </div>

        {/* Spotlight overlay - covers the entire slide, positioned via DOM measurement */}
        {showTeachingEffects && <SpotlightOverlay />}
      </div>
    </div>
  );
}

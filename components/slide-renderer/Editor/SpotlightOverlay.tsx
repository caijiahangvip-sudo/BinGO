'use client';

import { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import { useCanvasStore } from '@/lib/store/canvas';
import {
  buildSpotlightOverlayPath,
  normalizeSpotlightDimness,
  normalizeSpotlightRect,
  type SpotlightRect,
} from '@/lib/playback/spotlight-utils';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement } from '@/lib/types/slides';

/**
 * Spotlight overlay component
 *
 * Uses DOM measurement (getBoundingClientRect) to compute spotlight position,
 * avoiding alignment offsets from percentage coordinate conversion.
 */
export function SpotlightOverlay() {
  const spotlightElementId = useCanvasStore.use.spotlightElementId();
  const spotlightOptions = useCanvasStore.use.spotlightOptions();
  const spotlightMode = useCanvasStore.use.spotlightMode();
  const spotlightPercentageGeometry = useCanvasStore.use.spotlightPercentageGeometry();
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const elements = useSceneSelector<SlideContent, PPTElement[]>(
    (content) => content.canvas.elements,
  );

  const updateRect = useCallback((nextRect: SpotlightRect | null) => {
    setRect((prevRect) => {
      if (
        prevRect === nextRect ||
        (prevRect &&
          nextRect &&
          prevRect.x === nextRect.x &&
          prevRect.y === nextRect.y &&
          prevRect.w === nextRect.w &&
          prevRect.h === nextRect.h)
      ) {
        return prevRect;
      }
      return nextRect;
    });
  }, []);

  // Compute target element position in SVG coordinate system via DOM measurement
  const measure = useCallback(() => {
    if (spotlightMode === 'percentage' && spotlightPercentageGeometry) {
      updateRect(
        normalizeSpotlightRect({
          x: spotlightPercentageGeometry.x,
          y: spotlightPercentageGeometry.y,
          w: spotlightPercentageGeometry.w,
          h: spotlightPercentageGeometry.h,
        }),
      );
      return;
    }

    if (!spotlightElementId || !containerRef.current) {
      updateRect(null);
      return;
    }

    const domElement = document.getElementById(`screen-element-${spotlightElementId}`);
    if (!domElement) {
      updateRect(null);
      return;
    }

    // Prefer measuring .element-content (the actual rendered area for auto-height)
    const contentEl = domElement.querySelector('.element-content');
    const targetEl = contentEl ?? domElement;

    const containerRect = containerRef.current.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    if (containerRect.width === 0 || containerRect.height === 0) {
      updateRect(null);
      return;
    }

    // Convert to SVG viewBox 0-100 coordinates
    updateRect(
      normalizeSpotlightRect({
        x: ((targetRect.left - containerRect.left) / containerRect.width) * 100,
        y: ((targetRect.top - containerRect.top) / containerRect.height) * 100,
        w: (targetRect.width / containerRect.width) * 100,
        h: (targetRect.height / containerRect.height) * 100,
      }),
    );
  }, [spotlightElementId, spotlightMode, spotlightPercentageGeometry, updateRect]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement requires effect
    measure();
  }, [measure, elements]);

  useLayoutEffect(() => {
    if (!spotlightElementId || !containerRef.current) return;

    const targetElement = document.getElementById(`screen-element-${spotlightElementId}`);
    const contentElement = targetElement?.querySelector('.element-content');
    const observedElements = [containerRef.current, targetElement, contentElement].filter(
      (el): el is Element => !!el,
    );

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observedElements.forEach((el) => observer.observe(el));
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, spotlightElementId]);

  const active = !!spotlightElementId && !!spotlightOptions && !!rect;
  const dimness = normalizeSpotlightDimness(spotlightOptions?.dimness);
  const overlayPath = rect ? buildSpotlightOverlayPath(rect) : '';

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[100] pointer-events-none overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {active && rect && (
          <motion.div
            key={`spotlight-${spotlightElementId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0"
            >
              <path
                d={overlayPath}
                fill={`rgba(0,0,0,${dimness})`}
                fillRule="evenodd"
                clipRule="evenodd"
              />

              <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                fill="none"
                stroke="rgba(255,255,255,0.78)"
                strokeWidth="1.4"
                rx="1.2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { SceneRenderer } from '@/components/stage/scene-renderer';
import { SceneProvider } from '@/lib/contexts/scene-context';
import { CanvasToolbar } from '@/components/canvas/canvas-toolbar';
import type { CanvasToolbarProps } from '@/components/canvas/canvas-toolbar';
import type { Scene, StageMode } from '@/lib/types/stage';
import { useI18n } from '@/lib/hooks/use-i18n';

interface CanvasAreaProps extends CanvasToolbarProps {
  readonly currentScene: Scene | null;
  readonly mode: StageMode;
  readonly showTeachingEffects?: boolean;
  readonly hideToolbar?: boolean;
  readonly isPendingScene?: boolean;
  readonly isGenerationFailed?: boolean;
  readonly onRetryGeneration?: () => void;
  readonly onNeedTeachingHint?: () => void;
}

type LazyWhiteboardProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNeedHint?: () => void;
};

function WhiteboardLoadingSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/90">
      <div className="h-[82%] w-[86%] max-w-[920px] rounded-lg border border-border bg-card shadow-xl">
        <div className="flex h-12 items-center gap-2 border-b border-border/70 px-4">
          <div className="h-7 w-7 rounded-md bg-muted" />
          <div className="h-7 w-7 rounded-md bg-muted" />
          <div className="h-7 w-7 rounded-md bg-muted" />
          <div className="ml-auto h-7 w-20 rounded-md bg-muted" />
        </div>
        <div className="flex h-[calc(100%-3rem)] items-center justify-center p-5">
          <div className="h-full w-full rounded-lg border border-dashed border-border bg-background">
            <div className="h-full w-full animate-pulse bg-[linear-gradient(110deg,transparent,rgba(148,163,184,0.16),transparent)] bg-[length:220%_100%]" />
          </div>
        </div>
      </div>
    </div>
  );
}

const Whiteboard = dynamic<LazyWhiteboardProps>(
  () => import('@/components/whiteboard').then((mod) => mod.Whiteboard),
  {
    ssr: false,
    loading: () => <WhiteboardLoadingSkeleton />,
  },
);

export function CanvasArea({
  currentScene,
  currentSceneIndex,
  scenesCount,
  mode,
  engineState,
  showTeachingEffects = false,
  isLiveSession,
  whiteboardOpen,
  sidebarCollapsed,
  chatCollapsed,
  onToggleSidebar,
  onToggleChat,
  onPrevSlide,
  onNextSlide,
  onPlayPause,
  onWhiteboardClose,
  isPresenting,
  onTogglePresentation,
  showStopDiscussion,
  onStopDiscussion,
  hideToolbar,
  isPendingScene,
  isGenerationFailed,
  onRetryGeneration,
  onNeedTeachingHint,
}: CanvasAreaProps) {
  const { t } = useI18n();
  const showControls = mode === 'playback' && !whiteboardOpen;
  const frameHostRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const host = frameHostRef.current;
    if (!host) return;

    const updateFrameSize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const ratio = 16 / 9;
      const nextWidth = Math.min(width, height * ratio);
      const nextHeight = nextWidth / ratio;

      setFrameSize((prev) => {
        const roundedWidth = Math.round(nextWidth);
        const roundedHeight = Math.round(nextHeight);
        if (prev.width === roundedWidth && prev.height === roundedHeight) return prev;
        return { width: roundedWidth, height: roundedHeight };
      });
    };

    updateFrameSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateFrameSize);
      return () => window.removeEventListener('resize', updateFrameSize);
    }

    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const handleSlideClick = useCallback(
    (e: React.MouseEvent) => {
      if (!showControls || isLiveSession || currentScene?.type !== 'slide') return;
      // Don't trigger page play/pause when clicking inside a video element's visual area.
      // Video elements may be visually covered by other slide elements (e.g. text),
      // so we check click coordinates against all video element bounding rects.
      const container = e.currentTarget as HTMLElement;
      const videoEls = container.querySelectorAll('[data-video-element]');
      for (const el of videoEls) {
        const rect = el.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          return;
        }
      }
      onPlayPause();
    },
    [showControls, isLiveSession, onPlayPause, currentScene?.type],
  );

  return (
    <div className="w-full h-full flex flex-col bg-background group/canvas">
      {/* Slide area — takes remaining space */}
      <div
        className={cn(
          'flex-1 min-h-0 relative overflow-hidden flex items-center justify-center p-2 transition-colors duration-500',
          currentScene?.type === 'interactive' ? 'bg-secondary/40' : 'bg-background/60',
        )}
      >
        <div ref={frameHostRef} className="relative flex h-full w-full items-center justify-center">
          <div
            className={cn(
              'bg-card shadow-2xl rounded-lg overflow-hidden relative transition-all duration-700',
              showControls && !isLiveSession && currentScene?.type === 'slide' && 'cursor-pointer',
              currentScene?.type === 'interactive'
                ? 'shadow-[0_22px_60px_rgba(var(--app-shadow-rgb),0.18)] ring-1 ring-primary/10'
                : 'shadow-[0_22px_60px_rgba(var(--app-shadow-rgb),0.16)] ring-1 ring-border/70',
            )}
            style={{
              width: frameSize.width ? `${frameSize.width}px` : '100%',
              height: frameSize.height ? `${frameSize.height}px` : '100%',
            }}
            onClick={handleSlideClick}
          >
            {/* Whiteboard Layer */}
            {whiteboardOpen && (
              <div className="absolute inset-0 z-[110] pointer-events-none">
                <SceneProvider>
                  <Whiteboard
                    isOpen={whiteboardOpen}
                    onClose={onWhiteboardClose}
                    onNeedHint={onNeedTeachingHint}
                  />
                </SceneProvider>
              </div>
            )}

            {/* Scene Content */}
            {currentScene && !whiteboardOpen && (
              <div className="absolute inset-0">
                <SceneProvider>
                  <SceneRenderer
                    scene={currentScene}
                    mode={mode}
                    showTeachingEffects={showTeachingEffects}
                  />
                </SceneProvider>
              </div>
            )}

            {/* Pending Scene Loading Overlay */}
            <AnimatePresence>
              {isPendingScene && !currentScene && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  className="absolute inset-0 z-[105] flex flex-col items-center justify-center bg-card"
                >
                  {isGenerationFailed ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                        <svg
                          className="w-6 h-6 text-red-400 dark:text-red-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                          />
                        </svg>
                      </div>
                      <span className="text-sm text-red-500 dark:text-red-400 font-medium">
                        {t('stage.generationFailed')}
                      </span>
                      {onRetryGeneration && (
                        <button
                          onClick={onRetryGeneration}
                          className="mt-1 px-4 py-1.5 text-xs font-medium rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors active:scale-95"
                        >
                          {t('generation.retryScene')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4">
                      {/* Spinner */}
                      <div className="relative w-12 h-12">
                        <div className="absolute inset-0 rounded-full border-2 border-muted" />
                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                      </div>
                      {/* Text */}
                      <motion.span
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.3 }}
                        className="text-sm text-muted-foreground font-medium"
                      >
                        {t('stage.generatingNextPage')}
                      </motion.span>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scene Number Badge */}
            {currentScene && (
              <div className="absolute top-4 right-4 text-muted-foreground/25 font-black text-4xl opacity-50 pointer-events-none select-none mix-blend-multiply dark:mix-blend-screen">
                {(currentSceneIndex + 1).toString().padStart(2, '0')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Canvas Toolbar — in document flow, only when not merged into roundtable ── */}
      {!hideToolbar && (
        <CanvasToolbar
          className={cn(
            'shrink-0 h-9 px-2',
            'bg-card/80 backdrop-blur-xl',
            'border-t border-border/60',
          )}
          currentSceneIndex={currentSceneIndex}
          scenesCount={scenesCount}
          engineState={engineState}
          isLiveSession={isLiveSession}
          whiteboardOpen={whiteboardOpen}
          sidebarCollapsed={sidebarCollapsed}
          chatCollapsed={chatCollapsed}
          onToggleSidebar={onToggleSidebar}
          onToggleChat={onToggleChat}
          onPrevSlide={onPrevSlide}
          onNextSlide={onNextSlide}
          onPlayPause={onPlayPause}
          onWhiteboardClose={onWhiteboardClose}
          isPresenting={isPresenting}
          onTogglePresentation={onTogglePresentation}
          showStopDiscussion={showStopDiscussion}
          onStopDiscussion={onStopDiscussion}
        />
      )}
    </div>
  );
}

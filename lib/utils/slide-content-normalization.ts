import type { ColorThemeId } from '@/lib/theme/color-themes';
import { createSlideTheme } from '@/lib/theme/presentation-theme';
import type { Slide } from '@/lib/types/slides';
import type { SlideContent } from '@/lib/types/stage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeSlideContent(
  content: unknown,
  visualTheme?: ColorThemeId,
): { content: SlideContent; changed: boolean } {
  const contentRecord = isRecord(content) ? content : {};
  const nestedCanvas = contentRecord.canvas;
  const hasCanvas = isRecord(nestedCanvas);
  const canvasRecord: Record<string, unknown> = hasCanvas ? nestedCanvas : contentRecord;
  const elements = Array.isArray(canvasRecord.elements) ? canvasRecord.elements : [];
  const hasCompleteCanvas =
    hasCanvas &&
    typeof canvasRecord.id === 'string' &&
    typeof canvasRecord.viewportSize === 'number' &&
    typeof canvasRecord.viewportRatio === 'number' &&
    isRecord(canvasRecord.theme) &&
    Array.isArray(canvasRecord.elements);

  if (contentRecord.type === 'slide' && hasCompleteCanvas) {
    return { content: content as SlideContent, changed: false };
  }

  const canvas: Slide = {
    id: typeof canvasRecord.id === 'string' ? canvasRecord.id : `slide-${crypto.randomUUID()}`,
    viewportSize: typeof canvasRecord.viewportSize === 'number' ? canvasRecord.viewportSize : 1000,
    viewportRatio:
      typeof canvasRecord.viewportRatio === 'number' ? canvasRecord.viewportRatio : 0.5625,
    theme: isRecord(canvasRecord.theme)
      ? (canvasRecord.theme as unknown as Slide['theme'])
      : createSlideTheme(visualTheme),
    elements: elements as Slide['elements'],
    ...(isRecord(canvasRecord.background)
      ? { background: canvasRecord.background as unknown as Slide['background'] }
      : {}),
  };

  return {
    content: {
      type: 'slide',
      canvas,
    },
    changed: true,
  };
}

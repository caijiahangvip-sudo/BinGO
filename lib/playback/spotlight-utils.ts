export interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_SPOTLIGHT_DIMNESS = 0.24;
export const MAX_SPOTLIGHT_DIMNESS = 0.42;
export const MIN_SPOTLIGHT_CUTOUT_WIDTH = 5.5;
export const MIN_SPOTLIGHT_CUTOUT_HEIGHT = 5.5;
export const MAX_SPOTLIGHT_CUTOUT_WIDTH = 62;
export const MAX_SPOTLIGHT_CUTOUT_HEIGHT = 56;

const VIEWBOX_SIZE = 100;
const DEFAULT_CUTOUT_PADDING = 1.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readFiniteNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function roundPathNumber(value: number): number {
  return Number(value.toFixed(3));
}

export function normalizeSpotlightDimness(value?: unknown): number {
  const parsed = readFiniteNumber(value);
  if (parsed === null) return DEFAULT_SPOTLIGHT_DIMNESS;
  return clamp(parsed, 0, MAX_SPOTLIGHT_DIMNESS);
}

export function normalizeSpotlightRect(
  rect: SpotlightRect | null | undefined,
  padding = DEFAULT_CUTOUT_PADDING,
): SpotlightRect | null {
  if (!rect) return null;

  const x = readFiniteNumber(rect.x);
  const y = readFiniteNumber(rect.y);
  const w = readFiniteNumber(rect.w);
  const h = readFiniteNumber(rect.h);

  if (x === null || y === null || w === null || h === null) return null;
  if (w < 0 || h < 0) return null;
  if (w === 0 && h === 0) return null;
  if (x + w <= 0 || x >= VIEWBOX_SIZE || y + h <= 0 || y >= VIEWBOX_SIZE) return null;
  if (w > MAX_SPOTLIGHT_CUTOUT_WIDTH || h > MAX_SPOTLIGHT_CUTOUT_HEIGHT) return null;

  const centerX = clamp(x + w / 2, 0, VIEWBOX_SIZE);
  const centerY = clamp(y + h / 2, 0, VIEWBOX_SIZE);
  const safePadding = Math.max(0, padding);
  const width = Math.min(
    MAX_SPOTLIGHT_CUTOUT_WIDTH,
    Math.max(w + safePadding * 2, MIN_SPOTLIGHT_CUTOUT_WIDTH),
  );
  const height = Math.min(
    MAX_SPOTLIGHT_CUTOUT_HEIGHT,
    Math.max(h + safePadding * 2, MIN_SPOTLIGHT_CUTOUT_HEIGHT),
  );

  return {
    x: roundPathNumber(clamp(centerX - width / 2, 0, VIEWBOX_SIZE - width)),
    y: roundPathNumber(clamp(centerY - height / 2, 0, VIEWBOX_SIZE - height)),
    w: roundPathNumber(width),
    h: roundPathNumber(height),
  };
}

export function buildSpotlightOverlayPath(rect: SpotlightRect): string {
  const x1 = roundPathNumber(rect.x);
  const y1 = roundPathNumber(rect.y);
  const x2 = roundPathNumber(rect.x + rect.w);
  const y2 = roundPathNumber(rect.y + rect.h);

  return `M0 0H100V100H0Z M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
}

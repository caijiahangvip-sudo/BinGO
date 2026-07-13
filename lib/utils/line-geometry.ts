import type { PPTLineElement } from '@/lib/types/slides';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface LineBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface LineRenderGeometry {
  readonly path: string;
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

const MIN_LINE_RENDER_SIZE = 24;

function pointFromTuple(tuple: [number, number] | undefined, fallback: Point): Point {
  if (!Array.isArray(tuple)) return fallback;
  const [x, y] = tuple;
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
  };
}

function pointToPath(point: Point): string {
  return `${point.x},${point.y}`;
}

function offsetPoint(point: Point, offset: Point): Point {
  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
  };
}

function getBroken2PathPoints(start: Point, end: Point, broken2: Point): Point[] {
  const horizontalSpan = Math.abs(end.x - start.x);
  const verticalSpan = Math.abs(end.y - start.y);

  if (horizontalSpan >= verticalSpan) {
    return [start, { x: broken2.x, y: start.y }, { x: broken2.x, y: end.y }, end];
  }

  return [start, { x: start.x, y: broken2.y }, { x: end.x, y: broken2.y }, end];
}

export function getLineElementLocalPoints(element: PPTLineElement): Point[] {
  const start = pointFromTuple(element.start, { x: 0, y: 0 });
  const end = pointFromTuple(element.end, { x: 100, y: 100 });

  if (element.broken) {
    return [start, pointFromTuple(element.broken, start), end];
  }

  if (element.broken2) {
    return getBroken2PathPoints(start, end, pointFromTuple(element.broken2, start));
  }

  if (element.curve) {
    return [start, pointFromTuple(element.curve, start), end];
  }

  if (element.cubic) {
    const [first, second] = element.cubic;
    return [start, pointFromTuple(first, start), pointFromTuple(second, end), end];
  }

  return [start, end];
}

export function getLineElementLocalBounds(element: PPTLineElement): LineBounds {
  const points = getLineElementLocalPoints(element);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function getLineElementPath(element: PPTLineElement, offset: Point = { x: 0, y: 0 }) {
  const rawStart = pointFromTuple(element.start, { x: 0, y: 0 });
  const rawEnd = pointFromTuple(element.end, { x: 100, y: 100 });
  const start = offsetPoint(rawStart, offset);
  const end = offsetPoint(rawEnd, offset);

  if (element.broken) {
    const broken = offsetPoint(pointFromTuple(element.broken, rawStart), offset);
    return `M${pointToPath(start)} L${pointToPath(broken)} L${pointToPath(end)}`;
  }

  if (element.broken2) {
    const broken2 = pointFromTuple(element.broken2, rawStart);
    const points = getBroken2PathPoints(start, end, offsetPoint(broken2, offset));
    return `M${pointToPath(points[0])} L${pointToPath(points[1])} L${pointToPath(
      points[2],
    )} L${pointToPath(points[3])}`;
  }

  if (element.curve) {
    const curve = offsetPoint(pointFromTuple(element.curve, rawStart), offset);
    return `M${pointToPath(start)} Q${pointToPath(curve)} ${pointToPath(end)}`;
  }

  if (element.cubic) {
    const [first, second] = element.cubic;
    const c1 = offsetPoint(pointFromTuple(first, rawStart), offset);
    const c2 = offsetPoint(pointFromTuple(second, rawEnd), offset);
    return `M${pointToPath(start)} C${pointToPath(c1)} ${pointToPath(c2)} ${pointToPath(end)}`;
  }

  return `M${pointToPath(start)} L${pointToPath(end)}`;
}

export function getLineMarkerPadding(element: PPTLineElement): number {
  const strokeWidth = Math.max(1, Number.isFinite(element.width) ? element.width : 1);
  const hasMarker = element.points?.some(Boolean);
  const markerPadding = hasMarker ? Math.max(strokeWidth * 4 + 8, 18) : strokeWidth * 2 + 4;
  const shadowPadding = element.shadow
    ? Math.abs(element.shadow.h) + Math.abs(element.shadow.v) + Math.max(0, element.shadow.blur)
    : 0;

  return Math.ceil(markerPadding + shadowPadding);
}

export function getLineRenderGeometry(element: PPTLineElement): LineRenderGeometry {
  const bounds = getLineElementLocalBounds(element);
  const padding = getLineMarkerPadding(element);
  const left = bounds.minX - padding;
  const top = bounds.minY - padding;
  const width = Math.max(MIN_LINE_RENDER_SIZE, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(MIN_LINE_RENDER_SIZE, bounds.maxY - bounds.minY + padding * 2);
  const offset = { x: -left, y: -top };

  return {
    path: getLineElementPath(element, offset),
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    left,
    top,
  };
}

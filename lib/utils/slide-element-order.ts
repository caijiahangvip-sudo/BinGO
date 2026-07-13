type SlideLayerElement = {
  type: string;
};

type ElementRecord = {
  [key: string]: unknown;
};

interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Segment {
  sourceIndex: number;
  start: Point;
  end: Point;
}

const MIN_OCCLUDING_SHAPE_WIDTH = 36;
const MIN_OCCLUDING_SHAPE_HEIGHT = 28;
const MIN_OCCLUDING_SHAPE_AREA = 1600;
const MIN_LINE_SHAPE_SPAN = 80;
const MAX_LINE_SHAPE_THICKNESS = 10;
const MIN_VISIBLE_OPACITY = 0.35;
const EPSILON = 0.001;

function asRecord(element: SlideLayerElement): ElementRecord {
  return element as ElementRecord;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pointFromUnknown(value: unknown): Point | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = asFiniteNumber(value[0]);
  const y = asFiniteNumber(value[1]);
  if (x === null || y === null) return null;
  return { x, y };
}

function offsetPoint(point: Point, left: number, top: number): Point {
  return { x: left + point.x, y: top + point.y };
}

function rectFromElement(element: SlideLayerElement): Rect | null {
  const record = asRecord(element);
  const left = asFiniteNumber(record.left);
  const top = asFiniteNumber(record.top);
  const width = asFiniteNumber(record.width);
  const height = asFiniteNumber(record.height);

  if (left === null || top === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
}

function hasVisibleOpacity(element: SlideLayerElement): boolean {
  const opacity = asFiniteNumber(asRecord(element).opacity);
  return opacity === null || opacity >= MIN_VISIBLE_OPACITY;
}

function hasVisibleFill(element: SlideLayerElement): boolean {
  const record = asRecord(element);

  if (record.gradient || record.pattern) return true;
  if (typeof record.fill !== 'string') return false;

  const fill = record.fill.trim().toLowerCase();
  if (!fill || fill === 'none' || fill === 'transparent') return false;

  const rgbaMatch = fill.match(/rgba?\(([^)]+)\)/);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((part) => part.trim());
    if (parts.length >= 4) {
      const alpha = Number(parts[3].replace('%', ''));
      if (Number.isFinite(alpha)) {
        return parts[3].includes('%') ? alpha > 0 : alpha > 0;
      }
    }
  }

  if (/^#[0-9a-f]{4}$/i.test(fill)) {
    return Number.parseInt(fill[4], 16) > 0;
  }
  if (/^#[0-9a-f]{8}$/i.test(fill)) {
    return Number.parseInt(fill.slice(7, 9), 16) > 0;
  }

  return true;
}

function hasShapeText(element: SlideLayerElement): boolean {
  const text = asRecord(element).text;
  if (text === null || text === undefined) return false;
  if (typeof text === 'string') return text.trim().length > 0;
  if (typeof text === 'object') {
    const content = (text as ElementRecord).content;
    return typeof content !== 'string' || content.trim().length > 0;
  }
  return true;
}

function isOccludingShape(element: SlideLayerElement): boolean {
  if (element.type !== 'shape') return false;
  if (hasShapeText(element)) return false;
  if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return false;

  const rect = rectFromElement(element);
  if (!rect) return false;

  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;

  return (
    width >= MIN_OCCLUDING_SHAPE_WIDTH &&
    height >= MIN_OCCLUDING_SHAPE_HEIGHT &&
    width * height >= MIN_OCCLUDING_SHAPE_AREA
  );
}

function lineSegmentsFromLine(element: SlideLayerElement, sourceIndex: number): Segment[] {
  const record = asRecord(element);
  const left = asFiniteNumber(record.left) ?? 0;
  const top = asFiniteNumber(record.top) ?? 0;
  const start = pointFromUnknown(record.start);
  const end = pointFromUnknown(record.end);
  if (!start || !end) return [];

  const relativePoints = [start];
  const broken = pointFromUnknown(record.broken);
  const broken2 = pointFromUnknown(record.broken2);

  if (broken) {
    relativePoints.push(broken);
  } else if (broken2) {
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (dx >= dy) {
      relativePoints.push({ x: broken2.x, y: start.y }, { x: broken2.x, y: end.y });
    } else {
      relativePoints.push({ x: start.x, y: broken2.y }, { x: end.x, y: broken2.y });
    }
  } else if (pointFromUnknown(record.curve) || Array.isArray(record.cubic)) {
    // Curves are approximated by their chord for layering repair.
    relativePoints.push(end);
  }

  if (relativePoints[relativePoints.length - 1] !== end) {
    relativePoints.push(end);
  }

  return relativePoints.slice(0, -1).map((point, index) => ({
    sourceIndex,
    start: offsetPoint(point, left, top),
    end: offsetPoint(relativePoints[index + 1], left, top),
  }));
}

function lineSegmentFromThinShape(element: SlideLayerElement, sourceIndex: number): Segment | null {
  if (element.type !== 'shape') return null;
  if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return null;

  const rect = rectFromElement(element);
  if (!rect) return null;

  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;

  if (width >= MIN_LINE_SHAPE_SPAN && height <= MAX_LINE_SHAPE_THICKNESS) {
    const y = rect.top + height / 2;
    return {
      sourceIndex,
      start: { x: rect.left, y },
      end: { x: rect.right, y },
    };
  }

  if (height >= MIN_LINE_SHAPE_SPAN && width <= MAX_LINE_SHAPE_THICKNESS) {
    const x = rect.left + width / 2;
    return {
      sourceIndex,
      start: { x, y: rect.top },
      end: { x, y: rect.bottom },
    };
  }

  return null;
}

function collectLineSegments(elements: readonly SlideLayerElement[]): Segment[] {
  return elements.flatMap((element, index) => {
    if (element.type === 'line') return lineSegmentsFromLine(element, index);

    const segment = lineSegmentFromThinShape(element, index);
    return segment ? [segment] : [];
  });
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left - EPSILON &&
    point.x <= rect.right + EPSILON &&
    point.y >= rect.top - EPSILON &&
    point.y <= rect.bottom + EPSILON
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) <= EPSILON) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) + EPSILON &&
    b.x >= Math.min(a.x, c.x) - EPSILON &&
    b.y <= Math.max(a.y, c.y) + EPSILON &&
    b.y >= Math.min(a.y, c.y) - EPSILON
  );
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(a1, b1, a2)) return true;
  if (o2 === 0 && pointOnSegment(a1, b2, a2)) return true;
  if (o3 === 0 && pointOnSegment(b1, a1, b2)) return true;
  if (o4 === 0 && pointOnSegment(b1, a2, b2)) return true;

  return false;
}

function segmentIntersectsRect(segment: Segment, rect: Rect): boolean {
  if (pointInRect(segment.start, rect) || pointInRect(segment.end, rect)) return true;

  const topLeft = { x: rect.left, y: rect.top };
  const topRight = { x: rect.right, y: rect.top };
  const bottomRight = { x: rect.right, y: rect.bottom };
  const bottomLeft = { x: rect.left, y: rect.bottom };

  return (
    segmentsIntersect(segment.start, segment.end, topLeft, topRight) ||
    segmentsIntersect(segment.start, segment.end, topRight, bottomRight) ||
    segmentsIntersect(segment.start, segment.end, bottomRight, bottomLeft) ||
    segmentsIntersect(segment.start, segment.end, bottomLeft, topLeft)
  );
}

function findOccludingShapeMoves(elements: readonly SlideLayerElement[]): Map<number, number> {
  const segments = collectLineSegments(elements);
  const moves = new Map<number, number>();

  elements.forEach((element, index) => {
    if (!isOccludingShape(element)) return;

    const rect = rectFromElement(element);
    if (!rect) return;

    const intersectedSourceIndexes = [
      ...new Set(
        segments
          .filter(
            (segment) =>
              segment.sourceIndex !== index &&
              segmentIntersectsRect(segment, rect),
          )
          .map((segment) => segment.sourceIndex),
      ),
    ];

    if (intersectedSourceIndexes.length < 2) return;

    const earliestSourceIndex = Math.min(...intersectedSourceIndexes);
    if (earliestSourceIndex < index) {
      moves.set(index, earliestSourceIndex);
    }
  });

  return moves;
}

/**
 * Moves filled background/highlight rectangles behind geometry lines when an AI-generated
 * slide places them above the diagram and visually breaks the linework.
 */
export function repairGeometryDiagramLayering<T extends SlideLayerElement>(
  elements: readonly T[],
): T[] {
  const moves = findOccludingShapeMoves(elements);
  if (moves.size === 0) return [...elements];

  const ordered = elements.map((element, originalIndex) => ({ element, originalIndex }));
  const sortedMoves = [...moves.entries()].sort((a, b) => a[0] - b[0]);

  for (const [originalIndex, targetOriginalIndex] of sortedMoves) {
    const currentIndex = ordered.findIndex((item) => item.originalIndex === originalIndex);
    const targetIndex = ordered.findIndex((item) => item.originalIndex === targetOriginalIndex);

    if (currentIndex === -1 || targetIndex === -1 || currentIndex <= targetIndex) continue;

    const [item] = ordered.splice(currentIndex, 1);
    ordered.splice(targetIndex, 0, item);
  }

  return ordered.map((item) => item.element);
}

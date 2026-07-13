import {
  ensureCenteredParagraphText,
  hasCenteredTextAlign,
  hasExplicitTextAlign,
  shouldAutoCenterBoxText,
} from './text-box-alignment';

type SlideLayoutElement = {
  type: string;
};

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Point {
  x: number;
  y: number;
}

interface LayoutRepairOptions {
  readonly canvasWidth?: number;
  readonly canvasHeight?: number;
  readonly safeMargin?: number;
  readonly padding?: number;
  readonly gap?: number;
}

export type CriticalSlideLayoutIssueType =
  | 'element-out-of-bounds'
  | 'connector-out-of-bounds'
  | 'table-text-overlay'
  | 'text-text-overlap'
  | 'connector-obstructs-text'
  | 'connector-obstructs-content'
  | 'foreground-block-overlap'
  | 'numbered-badge-text-overlap'
  | 'low-density-three-card-layout'
  | 'legacy-task-grid-layout'
  | 'text-overflows-box'
  | 'text-outside-container'
  | 'box-text-not-centered';

export interface CriticalSlideLayoutIssue {
  readonly type: CriticalSlideLayoutIssueType;
  readonly elementIndexes: readonly number[];
  readonly message: string;
}

const DEFAULT_CANVAS_WIDTH = 1000;
const DEFAULT_CANVAS_HEIGHT = 562.5;
const DEFAULT_SAFE_MARGIN = 12;
const DEFAULT_CONTAINER_PADDING = 18;
const DEFAULT_GROUP_GAP = 12;
const EDGE_TOLERANCE = 6;
const HORIZONTAL_TOLERANCE = 32;
const MIN_CONTAINER_WIDTH = 140;
const MIN_CONTAINER_HEIGHT = 18;
const MIN_CONTAINER_AREA = 2200;
const MIN_BADGE_DIAMETER = 32;
const MAX_BADGE_DIAMETER = 72;
const OVERLAP_TOLERANCE = 1;
const MAX_OVERLAP_REPAIR_PASSES = 10;
const TRIAD_NODE_MIN_WIDTH = 112;
const TRIAD_NODE_MAX_WIDTH = 176;
const TRIAD_NODE_MIN_HEIGHT = 54;
const TRIAD_NODE_MAX_HEIGHT = 82;
const TRIAD_LINE_TOUCH_PADDING = 72;
const TIMELINE_MIN_NODE_COUNT = 3;
const TIMELINE_LINE_CLEARANCE = 24;
const TIMELINE_NODE_LABEL_MAX_UNITS = 10;
const TIMELINE_NODE_LABEL_X_TOLERANCE = 130;
const TIMELINE_NODE_LABEL_Y_TOLERANCE = 130;
const CARD_TEXT_OVERLAY_MIN_WIDTH = 72;
const CARD_TEXT_OVERLAY_MIN_HEIGHT = 28;
const CARD_TEXT_OVERLAY_MAX_HEIGHT = 240;
const CARD_TEXT_OVERLAY_MAX_WIDTH_RATIO = 0.96;
const CARD_TEXT_OVERLAY_MIN_TEXT_OVERLAP_RATIO = 0.45;
const CARD_TEXT_OVERLAY_CENTER_TOLERANCE = 14;
const BACKDROP_PANEL_MIN_WIDTH = 240;
const BACKDROP_PANEL_MIN_HEIGHT = 120;
const BACKDROP_PANEL_MIN_AREA_RATIO = 0.08;
const BACKDROP_PANEL_CHILD_PADDING = 16;
const INTRUSIVE_DARK_PANEL_MIN_AREA_RATIO = 0.18;
const INTRUSIVE_DARK_PANEL_MIN_WIDTH_RATIO = 0.42;
const INTRUSIVE_DARK_PANEL_MIN_HEIGHT_RATIO = 0.22;
const INTRUSIVE_DARK_PANEL_MAX_LUMINANCE = 48;
const POST_THEME_DARK_BODY_PANEL_MAX_LUMINANCE = 112;
const POST_THEME_BODY_PANEL_MIN_AREA_RATIO = 0.14;
const POST_THEME_BODY_PANEL_MIN_WIDTH_RATIO = 0.38;
const POST_THEME_BODY_PANEL_MIN_HEIGHT_RATIO = 0.2;
const TITLE_PROTECTION_MAX_TOP_RATIO = 0.3;
const TITLE_PROTECTION_MIN_WIDTH_RATIO = 0.22;
const TITLE_PROTECTION_MIN_FONT_SIZE = 24;
const TITLE_PROTECTION_GAP = 18;
const HEADER_DARK_PANEL_MAX_TOP_RATIO = 0.2;
const HEADER_DARK_PANEL_MAX_HEIGHT_RATIO = 0.18;
const CONNECTOR_NODE_MAX_WIDTH_RATIO = 0.48;
const CONNECTOR_NODE_MAX_HEIGHT_RATIO = 0.46;
const CONNECTOR_NODE_MAX_AREA_RATIO = 0.16;
const CONNECTOR_ENDPOINT_TOLERANCE = 36;
const CONNECTOR_MIN_LENGTH = 36;
const ARROW_MIN_RENDER_LENGTH = 44;
const CONNECTOR_MAX_STROKE_WIDTH = 10;
const CONNECTOR_MIN_ENDPOINT_GAP = 4;
const CONNECTOR_ARROW_MIN_CLEARANCE = 8;
const CONNECTOR_ROUTE_CLEARANCE = 24;
const CONNECTOR_ROUTE_EDGE_MARGIN = 32;
const CONNECTOR_ROUTE_BEND_PENALTY = 48;
const LINE_MIN_STROKE_WIDTH = 1;
const LINE_MAX_SAFE_STROKE_WIDTH = 6;
const TABLE_CAPTION_MIN_WIDTH = 220;
const TABLE_CAPTION_MIN_HEIGHT = 90;
const TABLE_CAPTION_TEXT_OVERLAP_RATIO = 0.35;
const TABLE_CAPTION_GAP = 10;
const CRITICAL_LAYOUT_MAX_ISSUES = 12;
const CRITICAL_BOUNDS_TOLERANCE = 10;
const CRITICAL_TEXT_OVERLAP_MIN_AREA = 900;
const CRITICAL_TEXT_OVERLAP_MIN_RATIO = 0.48;
const CRITICAL_TABLE_TEXT_OVERLAP_MIN_AREA = 600;
const CRITICAL_TABLE_TEXT_OVERLAP_MIN_RATIO = 0.42;
const CRITICAL_CONNECTOR_INTERIOR_PADDING = 8;
const CRITICAL_CONNECTOR_ENDPOINT_TOLERANCE = 20;
const CRITICAL_CONNECTOR_TEXT_PADDING = 4;
const CRITICAL_FOREGROUND_OVERLAP_MIN_AREA = 1800;
const CRITICAL_FOREGROUND_OVERLAP_MIN_RATIO = 0.08;
const CRITICAL_TEXT_OVERFLOW_TOLERANCE = 8;
const CRITICAL_BOX_TEXT_CENTER_TOLERANCE = 14;
const CRITICAL_BOX_TEXT_MAX_CENTER_OFFSET_RATIO = 0.08;
const CRITICAL_CARD_TEXT_MAX_GAP = 24;
const CRITICAL_CARD_TEXT_MIN_VERTICAL_OVERLAP_RATIO = 0.35;
const LOW_DENSITY_THREE_CARD_MIN_COUNT = 3;
const LOW_DENSITY_THREE_CARD_MIN_WIDTH = 220;
const LOW_DENSITY_THREE_CARD_MAX_WIDTH = 360;
const LOW_DENSITY_THREE_CARD_MIN_HEIGHT = 260;
const LOW_DENSITY_THREE_CARD_MAX_HEIGHT = 390;
const LOW_DENSITY_THREE_CARD_TOP_MAX_SPREAD = 28;
const LOW_DENSITY_THREE_CARD_TEXT_TOP_GAP_RATIO = 0.3;
const LOW_DENSITY_THREE_CARD_TEXT_HEIGHT_RATIO = 0.62;
const LEGACY_TASK_GRID_MIN_CARD_COUNT = 4;
const LEGACY_TASK_GRID_MIN_CARD_WIDTH = 300;
const LEGACY_TASK_GRID_MAX_CARD_WIDTH = 470;
const LEGACY_TASK_GRID_MIN_CARD_HEIGHT = 86;
const LEGACY_TASK_GRID_MAX_CARD_HEIGHT = 185;
const LEGACY_TASK_GRID_ROW_TOP_TOLERANCE = 36;
const LEGACY_TASK_GRID_COLUMN_CENTER_TOLERANCE = 72;
const LEGACY_TASK_GRID_MIN_ROW_GAP = -36;
const LEGACY_TASK_GRID_MIN_COLUMN_GAP = 24;
const LEGACY_TASK_GRID_MAX_TEXT_UNITS = 46;
const LEGACY_TASK_GRID_MAX_TEXT_HEIGHT_RATIO = 0.92;
const LEGACY_TASK_GRID_DOT_MIN_SIDE = 8;
const LEGACY_TASK_GRID_DOT_MAX_SIDE = 26;
const LEGACY_TASK_GRID_FOOTER_TOP_RATIO = 0.72;
const LEGACY_TASK_GRID_FOOTER_MIN_WIDTH_RATIO = 0.68;
const LEGACY_TASK_GRID_FOOTER_MAX_HEIGHT = 84;
const LEGACY_TASK_GRID_LABEL_MAX_HEIGHT = 66;
const STEP_FLOW_MIN_BADGE_COUNT = 2;
const STEP_FLOW_BADGE_CARD_MAX_DISTANCE = 260;
const STEP_FLOW_STRIP_MIN_WIDTH = 220;
const STEP_FLOW_STRIP_MAX_HEIGHT = 96;
const STEP_FLOW_CARD_MIN_WIDTH = 120;
const STEP_FLOW_CARD_MIN_HEIGHT = 76;
const STEP_FLOW_CARD_MAX_WIDTH_RATIO = 0.46;
const STEP_FLOW_CARD_MAX_HEIGHT_RATIO = 0.48;
const STEP_FLOW_CLEARANCE = 14;
const STEP_FLOW_BADGE_TEXT_GAP = 14;
const STEP_FLOW_CARD_TEXT_SIDE_PADDING = 16;
const STEP_FLOW_CARD_TEXT_MIN_WIDTH = 84;
const SHORT_LABEL_BOX_MAX_HEIGHT = 112;
const SHORT_LABEL_BOX_MIN_WIDTH = 120;

type LayoutGroupRole = 'footer' | 'title' | 'text' | 'content';

interface LayoutGroup {
  readonly indexes: number[];
  readonly rect: Rect;
  readonly role: LayoutGroupRole;
  readonly priority: number;
}

interface StraightLineSegment {
  readonly index: number;
  readonly start: Point;
  readonly end: Point;
}

interface ConnectorPathSegment {
  readonly index: number;
  readonly start: Point;
  readonly end: Point;
}

interface ConnectorNode {
  readonly index: number;
  readonly rect: Rect;
}

interface ConnectorObstacle {
  readonly index: number;
  readonly rect: Rect;
}

interface ConnectorRoute {
  readonly start: Point;
  readonly end: Point;
  readonly broken?: Point;
  readonly score: number;
}

interface ConnectorRouteNodes {
  readonly startNode: ConnectorNode | null;
  readonly endNode: ConnectorNode | null;
}

interface TextualElementGroup {
  readonly indexes: number[];
  readonly primaryIndex: number;
  readonly rect: Rect;
  readonly text: string;
}

interface NumberedBadgeGroup {
  readonly indexes: number[];
  readonly primaryIndex: number;
  readonly number: number;
  readonly rect: Rect;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(element: SlideLayoutElement): Record<string, unknown> {
  return element as unknown as Record<string, unknown>;
}

function rectFromElement(element: SlideLayoutElement): Rect | null {
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

function rectWidth(rect: Rect): number {
  return rect.right - rect.left;
}

function rectHeight(rect: Rect): number {
  return rect.bottom - rect.top;
}

function rectToProps(rect: Rect): { left: number; top: number; width: number; height: number } {
  return {
    left: roundToTenth(rect.left),
    top: roundToTenth(rect.top),
    width: roundToTenth(rectWidth(rect)),
    height: roundToTenth(rectHeight(rect)),
  };
}

function rectArea(rect: Rect): number {
  return rectWidth(rect) * rectHeight(rect);
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function overlapArea(a: Rect, b: Rect): number {
  return (
    overlapLength(a.left, a.right, b.left, b.right) *
    overlapLength(a.top, a.bottom, b.top, b.bottom)
  );
}

function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return !(
    a.right <= b.left + gap ||
    a.left >= b.right - gap ||
    a.bottom <= b.top + gap ||
    a.top >= b.bottom - gap
  );
}

function unionRects(rects: readonly Rect[]): Rect {
  return rects.reduce(
    (union, rect) => ({
      left: Math.min(union.left, rect.left),
      top: Math.min(union.top, rect.top),
      right: Math.max(union.right, rect.right),
      bottom: Math.max(union.bottom, rect.bottom),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
}

function shiftRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
  };
}

function hasVisibleOpacity(element: SlideLayoutElement): boolean {
  const opacity = asFiniteNumber(asRecord(element).opacity);
  return opacity === null || opacity > 0;
}

function hasVisibleFill(element: SlideLayoutElement): boolean {
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

  if (/^#[0-9a-f]{4}$/i.test(fill)) return Number.parseInt(fill[4], 16) > 0;
  if (/^#[0-9a-f]{8}$/i.test(fill)) return Number.parseInt(fill.slice(7, 9), 16) > 0;

  return true;
}

function parseHexColor(fill: string): { r: number; g: number; b: number; a: number } | null {
  const value = fill.trim().toLowerCase();
  if (!value.startsWith('#')) return null;

  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return {
      r: Number.parseInt(value[1] + value[1], 16),
      g: Number.parseInt(value[2] + value[2], 16),
      b: Number.parseInt(value[3] + value[3], 16),
      a: 1,
    };
  }

  if (/^#[0-9a-f]{4}$/i.test(value)) {
    return {
      r: Number.parseInt(value[1] + value[1], 16),
      g: Number.parseInt(value[2] + value[2], 16),
      b: Number.parseInt(value[3] + value[3], 16),
      a: Number.parseInt(value[4] + value[4], 16) / 255,
    };
  }

  if (/^#[0-9a-f]{6}$/i.test(value) || /^#[0-9a-f]{8}$/i.test(value)) {
    return {
      r: Number.parseInt(value.slice(1, 3), 16),
      g: Number.parseInt(value.slice(3, 5), 16),
      b: Number.parseInt(value.slice(5, 7), 16),
      a: value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1,
    };
  }

  return null;
}

function parseRgbColor(fill: string): { r: number; g: number; b: number; a: number } | null {
  const match = fill.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;

  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return null;

  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  if (![r, g, b].every((value) => Number.isFinite(value))) return null;

  const rawAlpha = parts[3];
  const alpha =
    rawAlpha === undefined
      ? 1
      : rawAlpha.endsWith('%')
        ? Number.parseFloat(rawAlpha) / 100
        : Number.parseFloat(rawAlpha);

  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255),
    a: Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1,
  };
}

function getFillColor(
  element: SlideLayoutElement,
): { r: number; g: number; b: number; a: number } | null {
  const fill = asRecord(element).fill;
  if (typeof fill !== 'string') return null;
  return parseHexColor(fill) ?? parseRgbColor(fill);
}

function colorLuminance(color: { r: number; g: number; b: number }): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function isDarkFill(element: SlideLayoutElement): boolean {
  const color = getFillColor(element);
  return !!color && color.a > 0.35 && colorLuminance(color) <= INTRUSIVE_DARK_PANEL_MAX_LUMINANCE;
}

function hasElementText(element: SlideLayoutElement): boolean {
  const text = asRecord(element).text;
  if (text === null || text === undefined) return false;
  if (typeof text === 'string') return text.trim().length > 0;
  if (typeof text === 'object') {
    const content = (text as Record<string, unknown>).content;
    return typeof content !== 'string' || content.trim().length > 0;
  }
  return true;
}

function stripHtmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getElementContent(element: SlideLayoutElement): string {
  const content = asRecord(element).content;
  return typeof content === 'string' ? content : '';
}

function getElementText(element: SlideLayoutElement): string {
  const record = asRecord(element);
  const content = typeof record.content === 'string' ? record.content : '';
  const shapeText = record.text;
  const shapeTextContent =
    typeof shapeText === 'object' && shapeText !== null
      ? (shapeText as Record<string, unknown>).content
      : '';
  return `${stripHtmlToText(content)} ${typeof shapeTextContent === 'string' ? stripHtmlToText(shapeTextContent) : ''}`.trim();
}

function getLargestFontSizeFromHtml(html: string, fallback = 18): number {
  const sizes = Array.from(html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi))
    .map((match) => Number.parseFloat(match[1]))
    .filter((size) => Number.isFinite(size) && size > 0);
  return sizes.length > 0 ? Math.max(...sizes) : fallback;
}

function getLargestFontSize(element: SlideLayoutElement): number {
  const record = asRecord(element);
  const content = typeof record.content === 'string' ? record.content : '';
  const shapeText = record.text;
  const shapeTextContent =
    typeof shapeText === 'object' && shapeText !== null
      ? (shapeText as Record<string, unknown>).content
      : '';
  const html = `${content} ${typeof shapeTextContent === 'string' ? shapeTextContent : ''}`;
  return getLargestFontSizeFromHtml(html, 0);
}

function isNumericBadgeText(element: SlideLayoutElement): boolean {
  if (element.type !== 'text') return false;
  return /^\d{1,2}$/.test(stripHtmlToText(getElementContent(element)));
}

function isCircleLikeShape(element: SlideLayoutElement, rect: Rect): boolean {
  if (element.type !== 'shape') return false;
  if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return false;

  const record = asRecord(element);
  const path = typeof record.path === 'string' ? record.path : '';
  if (!/\bA\b/i.test(path) && !/ellipse|circle/i.test(String(record.pptxShapeType || ''))) {
    return false;
  }

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  const maxSide = Math.max(width, height);
  const minSide = Math.min(width, height);
  if (maxSide < MIN_BADGE_DIAMETER || maxSide > 120 || minSide < 18) return false;

  return maxSide / minSide <= 2.4;
}

function rectCenter(rect: Rect): { x: number; y: number } {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0) return distance(point, start);

  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  const t = clamp(rawT, 0, 1);
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function pointInExpandedRect(point: Point, rect: Rect, padding: number): boolean {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

function visualTextLength(value: string): number {
  return Array.from(value).reduce((total, char) => {
    if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(char)) return total + 1;
    if (/\s/u.test(char)) return total;
    return total + 0.58;
  }, 0);
}

function isTextNearBadge(badge: Rect, text: Rect): boolean {
  const badgeCenter = rectCenter(badge);
  const textCenter = rectCenter(text);
  const tolerance = Math.max(rectWidth(badge), rectHeight(badge)) * 0.62 + 10;
  return (
    Math.abs(badgeCenter.x - textCenter.x) <= tolerance &&
    Math.abs(badgeCenter.y - textCenter.y) <= tolerance
  );
}

export function repairBadgeCircleLayout<T extends SlideLayoutElement>(elements: readonly T[]): T[] {
  let repaired: T[] | null = null;

  elements.forEach((element, shapeIndex) => {
    const shapeRect = rectFromElement(element);
    if (!shapeRect || !isCircleLikeShape(element, shapeRect)) return;

    const textIndex = elements.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === shapeIndex) return false;
      if (!isNumericBadgeText(candidate)) return false;
      const textRect = rectFromElement(candidate);
      return !!textRect && isTextNearBadge(shapeRect, textRect);
    });
    if (textIndex < 0) return;

    const center = rectCenter(shapeRect);
    const currentWidth = rectWidth(shapeRect);
    const currentHeight = rectHeight(shapeRect);
    const diameter = Math.min(
      MAX_BADGE_DIAMETER,
      Math.max(MIN_BADGE_DIAMETER, Math.round((currentWidth + currentHeight) / 2)),
    );
    const left = Math.round(center.x - diameter / 2);
    const top = Math.round(center.y - diameter / 2);

    if (!repaired) repaired = elements.map((item) => ({ ...item }));

    repaired[shapeIndex] = {
      ...repaired[shapeIndex],
      left,
      top,
      width: diameter,
      height: diameter,
      fixedRatio: true,
    };

    const textRecord = asRecord(repaired[textIndex]);
    const content = typeof textRecord.content === 'string' ? textRecord.content : '';
    repaired[textIndex] = {
      ...repaired[textIndex],
      left,
      top,
      width: diameter,
      height: diameter,
      content: content ? ensureCenteredParagraphText(content) : content,
    };
  });

  return repaired ?? [...elements];
}

function isContainerShape(element: SlideLayoutElement, rect: Rect, canvasHeight: number): boolean {
  if (element.type !== 'shape') return false;
  if (hasElementText(element)) return false;
  if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return false;

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  return (
    width >= MIN_CONTAINER_WIDTH &&
    height >= MIN_CONTAINER_HEIGHT &&
    height < canvasHeight * 0.72 &&
    width * height >= MIN_CONTAINER_AREA
  );
}

function isContainerChild(parent: Rect, child: Rect): boolean {
  const childWidth = rectWidth(child);
  const childHeight = rectHeight(child);
  if (childWidth <= 0 || childHeight <= 0) return false;

  const childCenter = rectCenter(child);
  const centerInsideParent =
    childCenter.x >= parent.left - EDGE_TOLERANCE &&
    childCenter.x <= parent.right + EDGE_TOLERANCE &&
    childCenter.y >= parent.top - EDGE_TOLERANCE &&
    childCenter.y <= parent.bottom + EDGE_TOLERANCE;
  if (!centerInsideParent) return false;

  const horizontalOverlap = overlapLength(parent.left, parent.right, child.left, child.right);
  const horizontalRatio = horizontalOverlap / childWidth;
  const horizontallyInside =
    child.left >= parent.left - HORIZONTAL_TOLERANCE &&
    child.right <= parent.right + HORIZONTAL_TOLERANCE;

  if (!horizontallyInside && horizontalRatio < 0.72) return false;

  const verticalOverlap = overlapLength(parent.top, parent.bottom, child.top, child.bottom);

  return verticalOverlap / childHeight >= 0.2;
}

function containsRect(parent: Rect, child: Rect, tolerance = 8): boolean {
  return (
    child.left >= parent.left - tolerance &&
    child.top >= parent.top - tolerance &&
    child.right <= parent.right + tolerance &&
    child.bottom <= parent.bottom + tolerance
  );
}

function isDecorativeLine(element: SlideLayoutElement): boolean {
  if (element.type !== 'line') return false;
  const rect = rectFromElement(element);
  if (!rect) return false;
  return rectWidth(rect) <= 8 || rectHeight(rect) <= 8;
}

function isCanvasBackground(rect: Rect, options: Required<LayoutRepairOptions>): boolean {
  return (
    rect.left <= options.safeMargin &&
    rect.top <= options.safeMargin &&
    rectWidth(rect) >= options.canvasWidth - options.safeMargin * 2 &&
    rectHeight(rect) >= options.canvasHeight - options.safeMargin * 2
  );
}

function isVisibleLayoutElement(
  element: SlideLayoutElement,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  if (isCanvasBackground(rect, options)) return false;
  if (isDecorativeLine(element)) return false;
  if (!hasVisibleOpacity(element)) return false;
  if (element.type === 'shape') return hasVisibleFill(element) || hasElementText(element);
  if (element.type === 'text') return getElementText(element).length > 0 || hasVisibleFill(element);
  return element.type !== 'line';
}

function isBasicForegroundElement(element: SlideLayoutElement): boolean {
  if (isDecorativeLine(element)) return false;
  if (!hasVisibleOpacity(element)) return false;
  if (element.type === 'shape') return hasVisibleFill(element) || hasElementText(element);
  if (element.type === 'text') return getElementText(element).length > 0 || hasVisibleFill(element);
  return element.type !== 'line';
}

function isLikelyBackdropPanel<T extends SlideLayoutElement>(
  elements: readonly T[],
  index: number,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  const element = elements[index];
  if (element.type !== 'shape') return false;
  if (hasElementText(element) || !hasVisibleFill(element) || !hasVisibleOpacity(element)) {
    return false;
  }
  if (isCanvasBackground(rect, options)) return true;

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  const canvasArea = options.canvasWidth * options.canvasHeight;
  if (
    width < BACKDROP_PANEL_MIN_WIDTH ||
    height < BACKDROP_PANEL_MIN_HEIGHT ||
    rectArea(rect) < canvasArea * BACKDROP_PANEL_MIN_AREA_RATIO
  ) {
    return false;
  }

  const containedForegroundCount = elements.filter((candidate, candidateIndex) => {
    if (candidateIndex === index) return false;
    const candidateRect = rectFromElement(candidate);
    if (!candidateRect || !isBasicForegroundElement(candidate)) return false;
    if (rectArea(candidateRect) >= rectArea(rect) * 0.72) return false;
    return (
      containsRect(rect, candidateRect, BACKDROP_PANEL_CHILD_PADDING) ||
      isContainerChild(rect, candidateRect)
    );
  }).length;

  return containedForegroundCount >= 2;
}

function buildBackdropPanelIndexSet<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): Set<number> {
  const indexes = new Set<number>();

  elements.forEach((element, index) => {
    const rect = rectFromElement(element);
    if (!rect) return;
    if (isLikelyBackdropPanel(elements, index, rect, options)) indexes.add(index);
  });

  return indexes;
}

function isHeaderDarkPanel(rect: Rect, options: Required<LayoutRepairOptions>): boolean {
  return (
    rect.top <= options.canvasHeight * HEADER_DARK_PANEL_MAX_TOP_RATIO &&
    rectHeight(rect) <= options.canvasHeight * HEADER_DARK_PANEL_MAX_HEIGHT_RATIO &&
    rectWidth(rect) >= options.canvasWidth * 0.45
  );
}

function isIntrusiveDarkPanel(
  element: SlideLayoutElement,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  if (element.type !== 'shape') return false;
  if (hasElementText(element) || !hasVisibleFill(element) || !hasVisibleOpacity(element)) {
    return false;
  }
  if (!isDarkFill(element)) return false;
  if (isCanvasBackground(rect, options) || isHeaderDarkPanel(rect, options)) return false;

  const canvasArea = options.canvasWidth * options.canvasHeight;
  return (
    rectArea(rect) >= canvasArea * INTRUSIVE_DARK_PANEL_MIN_AREA_RATIO &&
    rectWidth(rect) >= options.canvasWidth * INTRUSIVE_DARK_PANEL_MIN_WIDTH_RATIO &&
    rectHeight(rect) >= options.canvasHeight * INTRUSIVE_DARK_PANEL_MIN_HEIGHT_RATIO
  );
}

function repairIntrusiveDarkPanels<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };

  const intrusiveIndexes = new Set<number>();
  const repairedElements = elements.map((element, index) => {
    const rect = rectFromElement(element);
    if (!rect || !isIntrusiveDarkPanel(element, rect, options)) return element;

    intrusiveIndexes.add(index);
    return {
      ...element,
      fill: '#f8fafc',
      opacity: 1,
    };
  });

  if (intrusiveIndexes.size === 0) return elements as T[];

  return repairedElements
    .map((element, index) => ({
      element,
      index,
      priority: intrusiveIndexes.has(index) ? 5 : 30,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.element);
}

interface SlideVisualQualityRepairOptions extends LayoutRepairOptions {
  readonly bodyPanelFill?: string;
  readonly darkBodyPanelMaxLuminance?: number;
}

function isLikelyTitleElement(
  element: SlideLayoutElement,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  if (element.type !== 'text') return false;
  if (!getElementText(element)) return false;

  const record = asRecord(element);
  if (record.textType === 'title') return true;

  return (
    rect.top <= options.canvasHeight * TITLE_PROTECTION_MAX_TOP_RATIO &&
    rectWidth(rect) >= options.canvasWidth * TITLE_PROTECTION_MIN_WIDTH_RATIO &&
    getLargestFontSize(element) >= TITLE_PROTECTION_MIN_FONT_SIZE
  );
}

function isLargeBodyPanel(
  element: SlideLayoutElement,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  if (element.type !== 'shape') return false;
  if (hasElementText(element) || !hasVisibleFill(element) || !hasVisibleOpacity(element)) {
    return false;
  }
  if (isCanvasBackground(rect, options) || isHeaderDarkPanel(rect, options)) return false;

  const canvasArea = options.canvasWidth * options.canvasHeight;
  return (
    rectArea(rect) >= canvasArea * POST_THEME_BODY_PANEL_MIN_AREA_RATIO &&
    rectWidth(rect) >= options.canvasWidth * POST_THEME_BODY_PANEL_MIN_WIDTH_RATIO &&
    rectHeight(rect) >= options.canvasHeight * POST_THEME_BODY_PANEL_MIN_HEIGHT_RATIO
  );
}

function isPostThemeDarkBodyPanel(element: SlideLayoutElement, maxLuminance: number): boolean {
  const color = getFillColor(element);
  return !!color && color.a > 0.35 && colorLuminance(color) <= maxLuminance;
}

function titleSafeBottom(
  elements: readonly SlideLayoutElement[],
  options: Required<LayoutRepairOptions>,
): number | null {
  const titleRects = elements
    .map((element) => {
      const rect = rectFromElement(element);
      return rect && isLikelyTitleElement(element, rect, options) ? rect : null;
    })
    .filter((rect): rect is Rect => !!rect);

  if (titleRects.length === 0) return null;
  return Math.min(
    options.canvasHeight - options.safeMargin - MIN_CONTAINER_HEIGHT,
    Math.max(...titleRects.map((rect) => rect.bottom)) + TITLE_PROTECTION_GAP,
  );
}

function repairBodyPanelTitleIntrusion<T extends SlideLayoutElement>(
  element: T,
  rect: Rect,
  safeBottom: number | null,
): T {
  if (safeBottom === null || rect.top >= safeBottom || rect.bottom <= safeBottom) return element;

  const nextHeight = rect.bottom - safeBottom;
  if (nextHeight < MIN_CONTAINER_HEIGHT) return element;

  return {
    ...element,
    top: roundToTenth(safeBottom),
    height: roundToTenth(nextHeight),
  };
}

/**
 * Repairs visual-quality failures that can appear only after theme colors are applied.
 *
 * This is intentionally gentler than critical-layout fallback: it keeps the AI page,
 * but removes large dark body panels and protects the title region from backdrop shapes.
 */
export function repairSlideVisualQuality<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: SlideVisualQualityRepairOptions = {},
): T[] {
  const options = resolveLayoutOptions(repairOptions);
  const safeBottom = titleSafeBottom(elements, options);
  const bodyPanelFill = repairOptions.bodyPanelFill || '#f8fafc';
  const maxLuminance =
    repairOptions.darkBodyPanelMaxLuminance ?? POST_THEME_DARK_BODY_PANEL_MAX_LUMINANCE;
  const repairedPanelIndexes = new Set<number>();
  let changed = false;

  const repairedElements = elements.map((element, index) => {
    const rect = rectFromElement(element);
    if (!rect || !isLargeBodyPanel(element, rect, options)) return element;

    let next = element;

    if (isPostThemeDarkBodyPanel(element, maxLuminance)) {
      next = {
        ...next,
        fill: bodyPanelFill,
        opacity: 1,
      };
      changed = true;
      repairedPanelIndexes.add(index);
    }

    const moved = repairBodyPanelTitleIntrusion(next, rect, safeBottom);
    if (moved !== next) {
      next = moved;
      changed = true;
      repairedPanelIndexes.add(index);
    }

    return next;
  });

  if (!changed) return elements as T[];

  return repairedElements
    .map((element, index) => ({
      element,
      index,
      priority: repairedPanelIndexes.has(index) ? 5 : 30,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.element);
}

function distancePointToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
}

function getStraightLineSegment(
  element: SlideLayoutElement,
  index: number,
): StraightLineSegment | null {
  if (element.type !== 'line') return null;

  const record = asRecord(element);
  if (record.broken || record.broken2 || record.curve || record.cubic) return null;

  const strokeWidth = getConnectorStrokeWidth(element);
  if (strokeWidth === null) return null;

  const start = pointFromArray(record.start);
  const end = pointFromArray(record.end);
  if (!start || !end) return null;

  const left = asFiniteNumber(record.left) ?? 0;
  const top = asFiniteNumber(record.top) ?? 0;
  const absoluteStart = { x: left + start.x, y: top + start.y };
  const absoluteEnd = { x: left + end.x, y: top + end.y };
  if (distance(absoluteStart, absoluteEnd) < CONNECTOR_MIN_LENGTH) return null;

  return {
    index,
    start: absoluteStart,
    end: absoluteEnd,
  };
}

function getConnectorStrokeWidth(element: SlideLayoutElement): number | null {
  if (element.type !== 'line') return null;
  const strokeWidth = asFiniteNumber(asRecord(element).width) ?? 0;
  if (strokeWidth <= 0 || strokeWidth > CONNECTOR_MAX_STROKE_WIDTH) return null;
  return strokeWidth;
}

function getLinePointInCanvas(
  record: Record<string, unknown>,
  key: string,
  left: number,
  top: number,
): Point | null {
  const point = pointFromArray(record[key]);
  return point ? { x: left + point.x, y: top + point.y } : null;
}

function getBroken2AbsolutePoints(start: Point, end: Point, broken2: Point): Point[] {
  const horizontalSpan = Math.abs(end.x - start.x);
  const verticalSpan = Math.abs(end.y - start.y);
  if (horizontalSpan >= verticalSpan) {
    return [start, { x: broken2.x, y: start.y }, { x: broken2.x, y: end.y }, end];
  }
  return [start, { x: start.x, y: broken2.y }, { x: end.x, y: broken2.y }, end];
}

function interpolateQuadratic(start: Point, control: Point, end: Point, t: number): Point {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y,
  };
}

function interpolateCubic(start: Point, first: Point, second: Point, end: Point, t: number): Point {
  const oneMinusT = 1 - t;
  return {
    x:
      oneMinusT * oneMinusT * oneMinusT * start.x +
      3 * oneMinusT * oneMinusT * t * first.x +
      3 * oneMinusT * t * t * second.x +
      t * t * t * end.x,
    y:
      oneMinusT * oneMinusT * oneMinusT * start.y +
      3 * oneMinusT * oneMinusT * t * first.y +
      3 * oneMinusT * t * t * second.y +
      t * t * t * end.y,
  };
}

function sampleCurvePoints(
  start: Point,
  end: Point,
  controls: readonly Point[],
  sampleCount = 8,
): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    if (controls.length === 1) {
      points.push(interpolateQuadratic(start, controls[0], end, t));
    } else if (controls.length === 2) {
      points.push(interpolateCubic(start, controls[0], controls[1], end, t));
    }
  }
  return points;
}

function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

function getLineAbsolutePathPoints(element: SlideLayoutElement): Point[] | null {
  if (element.type !== 'line') return null;
  if (getConnectorStrokeWidth(element) === null) return null;

  const record = asRecord(element);
  const left = asFiniteNumber(record.left) ?? 0;
  const top = asFiniteNumber(record.top) ?? 0;
  const start = getLinePointInCanvas(record, 'start', left, top);
  const end = getLinePointInCanvas(record, 'end', left, top);
  if (!start || !end) return null;

  let points: Point[];
  if (record.broken) {
    const broken = getLinePointInCanvas(record, 'broken', left, top);
    points = broken ? [start, broken, end] : [start, end];
  } else if (record.broken2) {
    const broken2 = getLinePointInCanvas(record, 'broken2', left, top);
    points = broken2 ? getBroken2AbsolutePoints(start, end, broken2) : [start, end];
  } else if (record.curve) {
    const curve = getLinePointInCanvas(record, 'curve', left, top);
    points = curve ? sampleCurvePoints(start, end, [curve]) : [start, end];
  } else if (Array.isArray(record.cubic)) {
    const controls = record.cubic
      .map((point) => {
        const parsed = pointFromArray(point);
        return parsed ? { x: left + parsed.x, y: top + parsed.y } : null;
      })
      .filter((point): point is Point => !!point);
    points = controls.length === 2 ? sampleCurvePoints(start, end, controls) : [start, end];
  } else {
    points = [start, end];
  }

  if (polylineLength(points) < CONNECTOR_MIN_LENGTH) return null;
  return points;
}

function getLinePathSegments(element: SlideLayoutElement, index: number): ConnectorPathSegment[] {
  const points = getLineAbsolutePathPoints(element);
  if (!points) return [];

  const segments: ConnectorPathSegment[] = [];
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    if (distance(start, end) < 0.5) continue;
    segments.push({ index, start, end });
  }
  return segments;
}

function isConnectorNode<T extends SlideLayoutElement>(
  elements: readonly T[],
  index: number,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  const element = elements[index];
  if (element.type !== 'shape' && element.type !== 'text') return false;
  if (!isBasicForegroundElement(element)) return false;
  if (isCanvasBackground(rect, options)) return false;
  if (isLikelyBackdropPanel(elements, index, rect, options)) return false;

  return (
    rectWidth(rect) <= options.canvasWidth * CONNECTOR_NODE_MAX_WIDTH_RATIO &&
    rectHeight(rect) <= options.canvasHeight * CONNECTOR_NODE_MAX_HEIGHT_RATIO &&
    rectArea(rect) <= options.canvasWidth * options.canvasHeight * CONNECTOR_NODE_MAX_AREA_RATIO
  );
}

function collectConnectorNodes<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): ConnectorNode[] {
  return elements
    .map((element, index) => {
      const rect = rectFromElement(element);
      if (!rect || !isConnectorNode(elements, index, rect, options)) return null;
      return { index, rect };
    })
    .filter((node): node is ConnectorNode => !!node);
}

function findConnectorEndpointNode(
  nodes: readonly ConnectorNode[],
  point: Point,
  excludedIndex?: number,
): ConnectorNode | null {
  return (
    nodes
      .filter((node) => node.index !== excludedIndex)
      .map((node) => {
        const distanceToRect = distancePointToRect(point, node.rect);
        const centerDistance = distance(point, rectCenter(node.rect));
        return { node, distanceToRect, score: distanceToRect * 4 + centerDistance * 0.02 };
      })
      .filter(
        (item) =>
          item.distanceToRect <= CONNECTOR_ENDPOINT_TOLERANCE ||
          pointInExpandedRect(point, item.node.rect, CONNECTOR_ENDPOINT_TOLERANCE),
      )
      .sort((a, b) => a.score - b.score)[0]?.node ?? null
  );
}

function clampPointToCanvas(point: Point, options: Required<LayoutRepairOptions>): Point {
  return {
    x: clamp(point.x, options.safeMargin, options.canvasWidth - options.safeMargin),
    y: clamp(point.y, options.safeMargin, options.canvasHeight - options.safeMargin),
  };
}

function samePoint(first: Point, second: Point): boolean {
  return Math.abs(first.x - second.x) < 0.1 && Math.abs(first.y - second.y) < 0.1;
}

function getConnectorEndpointClearance(
  element: SlideLayoutElement,
  position: 'start' | 'end',
): number {
  const strokeWidth = getConnectorStrokeWidth(element) ?? 3;
  const points = asRecord(element).points;
  const marker =
    Array.isArray(points) && typeof points[position === 'start' ? 0 : 1] === 'string'
      ? String(points[position === 'start' ? 0 : 1])
      : '';

  if (/arrow/i.test(marker)) {
    return Math.max(strokeWidth + 4, CONNECTOR_ARROW_MIN_CLEARANCE);
  }
  if (marker) return Math.max(strokeWidth + 4, CONNECTOR_ARROW_MIN_CLEARANCE);
  return Math.max(strokeWidth / 2 + 2, CONNECTOR_MIN_ENDPOINT_GAP);
}

function movePointToward(point: Point, target: Point, distanceValue: number): Point {
  const dx = target.x - point.x;
  const dy = target.y - point.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001 || distanceValue <= 0) return point;
  return {
    x: point.x + (dx / length) * distanceValue,
    y: point.y + (dy / length) * distanceValue,
  };
}

function fitEndpointClearances(
  start: Point,
  end: Point,
  startClearance: number,
  endClearance: number,
): { startClearance: number; endClearance: number } {
  const available = Math.max(0, distance(start, end) - CONNECTOR_MIN_LENGTH);
  const total = startClearance + endClearance;
  if (total <= available || total <= 0) return { startClearance, endClearance };

  const scale = available / total;
  return {
    startClearance: startClearance * scale,
    endClearance: endClearance * scale,
  };
}

function repairConnectorLineLayout<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };
  const nodes = collectConnectorNodes(elements, options);

  let next: T[] | null = null;
  const lineLayerPriorities = new Map<number, number>();

  elements.forEach((element, index) => {
    const segment = getStraightLineSegment(element, index);
    if (!segment) return;

    const startNode = nodes.length >= 2 ? findConnectorEndpointNode(nodes, segment.start) : null;
    const endNode =
      nodes.length >= 2 ? findConnectorEndpointNode(nodes, segment.end, startNode?.index) : null;
    let start = clampPointToCanvas(segment.start, options);
    let end = clampPointToCanvas(segment.end, options);

    if (startNode && endNode && startNode.index !== endNode.index) {
      const startCenter = rectCenter(startNode.rect);
      const endCenter = rectCenter(endNode.rect);
      const startAnchor = rectAnchorToward(startNode.rect, endCenter);
      const endAnchor = rectAnchorToward(endNode.rect, startCenter);
      const clearances = fitEndpointClearances(
        startAnchor,
        endAnchor,
        getConnectorEndpointClearance(element, 'start'),
        getConnectorEndpointClearance(element, 'end'),
      );
      start = movePointToward(startAnchor, endCenter, clearances.startClearance);
      end = movePointToward(endAnchor, startCenter, clearances.endClearance);
      start = clampPointToCanvas(start, options);
      end = clampPointToCanvas(end, options);
      lineLayerPriorities.set(index, Math.min(startNode.index, endNode.index) - 0.5);
    }

    if (samePoint(start, segment.start) && samePoint(end, segment.end)) return;
    if (!next) next = elements.map((item) => ({ ...item }));
    next[index] = updateLineElement(next[index], start, end);
  });

  const repaired = next ?? elements;
  if (lineLayerPriorities.size === 0) return repaired as T[];

  return repaired
    .map((element, index) => ({
      element,
      index,
      priority: lineLayerPriorities.get(index) ?? index,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.element);
}

function getElementRole(
  element: SlideLayoutElement,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): LayoutGroupRole {
  const text = getElementText(element);
  const fontSize = getLargestFontSize(element);
  const bottomZoneTop = options.canvasHeight * 0.78;
  const isWideBottomStrip =
    rect.top >= bottomZoneTop &&
    rectWidth(rect) >= options.canvasWidth * 0.5 &&
    rectHeight(rect) <= 80;
  if (
    text.includes('课堂互动') ||
    text.toLowerCase().includes('interaction') ||
    isWideBottomStrip
  ) {
    return 'footer';
  }
  if (
    element.type === 'text' &&
    (fontSize >= 34 || rect.top <= options.canvasHeight * 0.24) &&
    text.length > 0 &&
    text.length <= 35
  ) {
    return 'title';
  }
  if (element.type === 'text') return 'text';
  return 'content';
}

function rolePriority(role: LayoutGroupRole): number {
  if (role === 'footer') return 100;
  if (role === 'title') return 90;
  if (role === 'text') return 50;
  return 20;
}

function shouldGroupElements(
  parent: SlideLayoutElement,
  parentRect: Rect,
  child: SlideLayoutElement,
  childRect: Rect,
): boolean {
  if (parent.type === 'shape' && child.type === 'text') {
    return containsRect(parentRect, childRect, 10) || isContainerChild(parentRect, childRect);
  }
  if (isCircleLikeShape(parent, parentRect) && isNumericBadgeText(child)) {
    return isTextNearBadge(parentRect, childRect);
  }
  return false;
}

function buildShapeTextParentMap<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  ignoredShapeIndexes: ReadonlySet<number> = new Set(),
): Map<number, number> {
  const parentByTextIndex = new Map<number, number>();

  elements.forEach((element, textIndex) => {
    if (element.type !== 'text') return;
    const textRect = rectFromElement(element);
    if (!textRect || !isVisibleLayoutElement(element, textRect, options)) return;

    const parent = elements
      .map((candidate, candidateIndex) => {
        if (candidate.type !== 'shape') return null;
        if (ignoredShapeIndexes.has(candidateIndex)) return null;
        const candidateRect = rectFromElement(candidate);
        if (!candidateRect || !isVisibleLayoutElement(candidate, candidateRect, options)) {
          return null;
        }
        if (!shouldGroupElements(candidate, candidateRect, element, textRect)) return null;
        return {
          index: candidateIndex,
          area: rectArea(candidateRect),
        };
      })
      .filter((candidate): candidate is { index: number; area: number } => !!candidate)
      .sort((a, b) => a.area - b.area || b.index - a.index)[0];

    if (parent) {
      parentByTextIndex.set(textIndex, parent.index);
    }
  });

  return parentByTextIndex;
}

function buildLayoutGroups<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  ignoredIndexes: ReadonlySet<number> = new Set(),
): LayoutGroup[] {
  const consumed = new Set<number>();
  const groups: LayoutGroup[] = [];
  const textParentMap = buildShapeTextParentMap(elements, options, ignoredIndexes);

  elements.forEach((element, index) => {
    if (ignoredIndexes.has(index)) return;
    if (consumed.has(index)) return;
    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return;

    const indexes = [index];
    const rects = [rect];
    consumed.add(index);

    elements.forEach((candidate, candidateIndex) => {
      if (ignoredIndexes.has(candidateIndex)) return;
      if (candidateIndex === index || consumed.has(candidateIndex)) return;
      const candidateRect = rectFromElement(candidate);
      if (!candidateRect || !isVisibleLayoutElement(candidate, candidateRect, options)) return;
      if (candidate.type === 'text') {
        if (textParentMap.get(candidateIndex) !== index) return;
      } else if (!shouldGroupElements(element, rect, candidate, candidateRect)) {
        return;
      }

      indexes.push(candidateIndex);
      rects.push(candidateRect);
      consumed.add(candidateIndex);
    });

    const groupRect = unionRects(rects);
    const role = indexes
      .map((itemIndex) =>
        getElementRole(
          elements[itemIndex],
          rectFromElement(elements[itemIndex]) || groupRect,
          options,
        ),
      )
      .sort((a, b) => rolePriority(b) - rolePriority(a))[0];

    groups.push({
      indexes,
      rect: groupRect,
      role,
      priority: rolePriority(role),
    });
  });

  return groups;
}

function clampDeltaToCanvas(
  rect: Rect,
  dx: number,
  dy: number,
  options: Required<LayoutRepairOptions>,
) {
  let nextDx = dx;
  let nextDy = dy;
  if (rect.left + nextDx < options.safeMargin) nextDx = options.safeMargin - rect.left;
  if (rect.right + nextDx > options.canvasWidth - options.safeMargin) {
    nextDx = options.canvasWidth - options.safeMargin - rect.right;
  }
  if (rect.top + nextDy < options.safeMargin) nextDy = options.safeMargin - rect.top;
  if (rect.bottom + nextDy > options.canvasHeight - options.safeMargin) {
    nextDy = options.canvasHeight - options.safeMargin - rect.bottom;
  }
  return { dx: nextDx, dy: nextDy };
}

function getCandidateDeltas(moving: Rect, anchor: Rect, gap: number) {
  return [
    { dx: anchor.right + gap - moving.left, dy: 0 },
    { dx: anchor.left - gap - moving.right, dy: 0 },
    { dx: 0, dy: anchor.bottom + gap - moving.top },
    { dx: 0, dy: anchor.top - gap - moving.bottom },
  ];
}

function totalOverlap(
  rect: Rect,
  groups: readonly LayoutGroup[],
  skipIndexes: readonly number[],
): number {
  const skip = new Set(skipIndexes);
  return groups.reduce((total, group, index) => {
    if (skip.has(index)) return total;
    return total + overlapArea(rect, group.rect);
  }, 0);
}

function chooseMove(
  moving: LayoutGroup,
  anchor: LayoutGroup,
  groups: readonly LayoutGroup[],
  movingIndex: number,
  anchorIndex: number,
  options: Required<LayoutRepairOptions>,
): { dx: number; dy: number } | null {
  const currentOverlap = totalOverlap(moving.rect, groups, [movingIndex]);
  const candidates = getCandidateDeltas(moving.rect, anchor.rect, options.gap)
    .map((delta) => clampDeltaToCanvas(moving.rect, delta.dx, delta.dy, options))
    .filter(
      (delta) => Math.abs(delta.dx) > OVERLAP_TOLERANCE || Math.abs(delta.dy) > OVERLAP_TOLERANCE,
    )
    .map((delta) => {
      const rect = shiftRect(moving.rect, delta.dx, delta.dy);
      const overlap = totalOverlap(rect, groups, [movingIndex]);
      const distance = Math.abs(delta.dx) + Math.abs(delta.dy);
      return { ...delta, overlap, distance };
    })
    .sort((a, b) => a.overlap - b.overlap || a.distance - b.distance);

  const best = candidates[0];
  if (!best) return null;
  if (best.overlap >= currentOverlap - OVERLAP_TOLERANCE) return null;
  return { dx: best.dx, dy: best.dy };
}

function applyMove<T extends SlideLayoutElement>(
  elements: readonly T[],
  repaired: T[] | null,
  group: LayoutGroup,
  dx: number,
  dy: number,
): T[] {
  const next = repaired ?? elements.map((item) => ({ ...item }));
  group.indexes.forEach((index) => {
    const record = asRecord(next[index]);
    const left = asFiniteNumber(record.left);
    const top = asFiniteNumber(record.top);
    if (left === null || top === null) return;
    next[index] = {
      ...next[index],
      left: Math.round((left + dx) * 10) / 10,
      top: Math.round((top + dy) * 10) / 10,
    };
  });
  return next;
}

function applyShrinkAwayFromAnchor<T extends SlideLayoutElement>(
  elements: readonly T[],
  repaired: T[] | null,
  group: LayoutGroup,
  anchor: LayoutGroup,
  options: Required<LayoutRepairOptions>,
): T[] | null {
  const next = repaired ?? elements.map((item) => ({ ...item }));
  let changed = false;

  group.indexes.forEach((index) => {
    const element = next[index];
    if (element.type !== 'shape') return;
    const rect = rectFromElement(element);
    if (!rect || !rectsOverlap(rect, anchor.rect)) return;
    const record = asRecord(element);
    const width = asFiniteNumber(record.width);
    const height = asFiniteNumber(record.height);
    if (width === null || height === null) return;

    let nextProps: Partial<Record<'left' | 'top' | 'width' | 'height', number>> | null = null;
    const canTrimRight = rect.left < anchor.rect.left && rect.right > anchor.rect.left;
    const canTrimBottom = rect.top < anchor.rect.top && rect.bottom > anchor.rect.top;
    const canTrimLeft = rect.right > anchor.rect.right && rect.left < anchor.rect.right;
    const canTrimTop = rect.bottom > anchor.rect.bottom && rect.top < anchor.rect.bottom;

    if (canTrimRight) {
      const nextWidth = anchor.rect.left - options.gap - rect.left;
      if (nextWidth >= MIN_CONTAINER_WIDTH) nextProps = { width: nextWidth };
    } else if (canTrimBottom) {
      const nextHeight = anchor.rect.top - options.gap - rect.top;
      if (nextHeight >= MIN_CONTAINER_HEIGHT) nextProps = { height: nextHeight };
    } else if (canTrimLeft) {
      const nextLeft = anchor.rect.right + options.gap;
      const nextWidth = rect.right - nextLeft;
      if (nextWidth >= MIN_CONTAINER_WIDTH) nextProps = { left: nextLeft, width: nextWidth };
    } else if (canTrimTop) {
      const nextTop = anchor.rect.bottom + options.gap;
      const nextHeight = rect.bottom - nextTop;
      if (nextHeight >= MIN_CONTAINER_HEIGHT) nextProps = { top: nextTop, height: nextHeight };
    }

    if (!nextProps) return;
    next[index] = {
      ...element,
      ...Object.fromEntries(
        Object.entries(nextProps).map(([key, value]) => [key, Math.round(value * 10) / 10]),
      ),
    };
    changed = true;
  });

  return changed ? next : null;
}

function findWorstOverlap(groups: readonly LayoutGroup[]) {
  let worst: {
    firstIndex: number;
    secondIndex: number;
    area: number;
  } | null = null;

  for (let firstIndex = 0; firstIndex < groups.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < groups.length; secondIndex += 1) {
      const first = groups[firstIndex];
      const second = groups[secondIndex];
      if (!rectsOverlap(first.rect, second.rect)) continue;
      const area = overlapArea(first.rect, second.rect);
      if (area <= OVERLAP_TOLERANCE) continue;
      if (!worst || area > worst.area) {
        worst = { firstIndex, secondIndex, area };
      }
    }
  }

  return worst;
}

function buildExpandedRect(
  parent: Rect,
  children: readonly Rect[],
  options: Required<LayoutRepairOptions>,
): Rect {
  const childUnion = children.reduce(
    (union, child) => ({
      left: Math.min(union.left, child.left),
      top: Math.min(union.top, child.top),
      right: Math.max(union.right, child.right),
      bottom: Math.max(union.bottom, child.bottom),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );

  const padded = {
    left: childUnion.left - options.padding,
    top: childUnion.top - options.padding,
    right: childUnion.right + options.padding,
    bottom: childUnion.bottom + options.padding,
  };

  return {
    left: Math.max(options.safeMargin, Math.min(parent.left, padded.left)),
    top: Math.max(options.safeMargin, Math.min(parent.top, padded.top)),
    right: Math.min(options.canvasWidth - options.safeMargin, Math.max(parent.right, padded.right)),
    bottom: Math.min(
      options.canvasHeight - options.safeMargin,
      Math.max(parent.bottom, padded.bottom),
    ),
  };
}

function needsExpansion(parent: Rect, expanded: Rect): boolean {
  return (
    expanded.left < parent.left - EDGE_TOLERANCE ||
    expanded.top < parent.top - EDGE_TOLERANCE ||
    expanded.right > parent.right + EDGE_TOLERANCE ||
    expanded.bottom > parent.bottom + EDGE_TOLERANCE
  );
}

/**
 * Expands filled background strips/panels that should visually contain child cards.
 * AI-generated layouts often create a pale container first, then place colored cards
 * on top with heights that exceed the container. This repairs that relationship while
 * leaving normal text/card content alone.
 */
export function repairContainedShapeBounds<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };

  const badgeRepairedElements = repairBadgeCircleLayout(elements);
  let repaired: T[] | null = badgeRepairedElements.some((item, index) => item !== elements[index])
    ? badgeRepairedElements
    : null;
  const sourceElements = repaired ?? elements;

  sourceElements.forEach((element, index) => {
    const parentRect = rectFromElement(element);
    if (!parentRect || !isContainerShape(element, parentRect, options.canvasHeight)) return;

    const childRects = sourceElements
      .slice(index + 1)
      .map((child) => rectFromElement(child))
      .filter((rect): rect is Rect => !!rect)
      .filter((rect) => isContainerChild(parentRect, rect));

    if (childRects.length < 2) return;

    const expandedRect = buildExpandedRect(parentRect, childRects, options);
    if (!needsExpansion(parentRect, expandedRect)) return;

    if (!repaired) repaired = sourceElements.map((item) => ({ ...item }));

    repaired[index] = {
      ...repaired[index],
      left: expandedRect.left,
      top: expandedRect.top,
      width: rectWidth(expandedRect),
      height: rectHeight(expandedRect),
    };
  });

  return repaired ?? [...elements];
}

/**
 * Moves top-level generated layout groups apart when AI places large cards,
 * headings, or footer prompts on top of each other. Legitimate overlays such
 * as text centered inside a shape are grouped and moved together.
 */
export function repairTopLevelSlideOverlaps<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };

  let sourceElements: readonly T[] = elements;
  let repaired: T[] | null = null;

  for (let pass = 0; pass < MAX_OVERLAP_REPAIR_PASSES; pass += 1) {
    const ignoredIndexes = buildBackdropPanelIndexSet(sourceElements, options);
    const groups = buildLayoutGroups(sourceElements, options, ignoredIndexes);
    const overlap = findWorstOverlap(groups);
    if (!overlap) break;

    const first = groups[overlap.firstIndex];
    const second = groups[overlap.secondIndex];
    const movingIndex =
      first.priority < second.priority
        ? overlap.firstIndex
        : second.priority < first.priority
          ? overlap.secondIndex
          : rectArea(first.rect) >= rectArea(second.rect)
            ? overlap.firstIndex
            : overlap.secondIndex;
    const anchorIndex =
      movingIndex === overlap.firstIndex ? overlap.secondIndex : overlap.firstIndex;
    const moving = groups[movingIndex];
    const anchor = groups[anchorIndex];
    const move = chooseMove(moving, anchor, groups, movingIndex, anchorIndex, options);
    if (!move) {
      const shrink: T[] | null = applyShrinkAwayFromAnchor(
        sourceElements,
        repaired,
        moving,
        anchor,
        options,
      );
      if (!shrink) break;
      repaired = shrink;
      sourceElements = shrink;
      continue;
    }

    repaired = applyMove(sourceElements, repaired, moving, move.dx, move.dy);
    sourceElements = repaired;
  }

  return repaired ?? [...elements];
}

function numericTextValue(element: SlideLayoutElement): number | null {
  const text = getElementText(element);
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 9 ? value : null;
}

function isSmallFilledNumericText(element: SlideLayoutElement, rect: Rect): boolean {
  if (element.type !== 'text') return false;
  if (numericTextValue(element) === null) return false;
  if (!hasVisibleFill(element)) return false;
  return (
    rectWidth(rect) <= MAX_BADGE_DIAMETER * 1.4 && rectHeight(rect) <= MAX_BADGE_DIAMETER * 1.4
  );
}

function collectNumberedBadgeGroups<T extends SlideLayoutElement>(
  elements: readonly T[],
): NumberedBadgeGroup[] {
  const groups: NumberedBadgeGroup[] = [];
  const consumedTextIndexes = new Set<number>();

  elements.forEach((element, shapeIndex) => {
    const rect = rectFromElement(element);
    if (!rect || !isCircleLikeShape(element, rect)) return;

    const shapeNumber = numericTextValue(element);
    if (shapeNumber !== null) {
      groups.push({ indexes: [shapeIndex], primaryIndex: shapeIndex, number: shapeNumber, rect });
      return;
    }

    const textMatch = elements
      .map((candidate, candidateIndex) => {
        if (consumedTextIndexes.has(candidateIndex)) return null;
        if (!isNumericBadgeText(candidate)) return null;
        const textRect = rectFromElement(candidate);
        if (!textRect || !isTextNearBadge(rect, textRect)) return null;
        const number = numericTextValue(candidate);
        if (number === null) return null;
        return { candidateIndex, number, textRect };
      })
      .filter(
        (
          item,
        ): item is {
          candidateIndex: number;
          number: number;
          textRect: Rect;
        } => !!item,
      )
      .sort((a, b) => rectArea(a.textRect) - rectArea(b.textRect))[0];

    if (!textMatch) return;
    consumedTextIndexes.add(textMatch.candidateIndex);
    groups.push({
      indexes: [shapeIndex, textMatch.candidateIndex],
      primaryIndex: shapeIndex,
      number: textMatch.number,
      rect: unionRects([rect, textMatch.textRect]),
    });
  });

  elements.forEach((element, index) => {
    if (consumedTextIndexes.has(index)) return;
    const rect = rectFromElement(element);
    if (!rect || !isSmallFilledNumericText(element, rect)) return;
    const number = numericTextValue(element);
    if (number === null) return;
    groups.push({ indexes: [index], primaryIndex: index, number, rect });
  });

  return groups.sort((a, b) => a.number - b.number || a.primaryIndex - b.primaryIndex);
}

function collectTextualForegroundGroups<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): TextualElementGroup[] {
  const groups: TextualElementGroup[] = [];
  const consumedTextIndexes = new Set<number>();

  elements.forEach((element, index) => {
    if (element.type !== 'shape') return;
    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return;
    if (isCircleLikeShape(element, rect)) return;
    if (isCanvasBackground(rect, options)) return;
    if (isLikelyBackdropPanel(elements, index, rect, options)) return;

    const textChildren = elements
      .map((candidate, candidateIndex) => {
        if (candidateIndex === index || candidate.type !== 'text') return null;
        const candidateRect = rectFromElement(candidate);
        if (!candidateRect || !containsRect(rect, candidateRect, 12)) return null;
        const text = getElementText(candidate);
        if (!text) return null;
        return { index: candidateIndex, rect: candidateRect, text };
      })
      .filter((item): item is { index: number; rect: Rect; text: string } => !!item);

    textChildren.forEach((child) => consumedTextIndexes.add(child.index));
    const ownText = getElementText(element);
    const text = [ownText, ...textChildren.map((child) => child.text)].filter(Boolean).join(' ');
    const rects = [rect, ...textChildren.map((child) => child.rect)];
    groups.push({
      indexes: [index, ...textChildren.map((child) => child.index)],
      primaryIndex: index,
      rect: unionRects(rects),
      text,
    });
  });

  elements.forEach((element, index) => {
    if (consumedTextIndexes.has(index)) return;
    if (element.type !== 'text') return;
    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return;
    const text = getElementText(element);
    if (!text && !hasVisibleFill(element)) return;
    groups.push({ indexes: [index], primaryIndex: index, rect, text });
  });

  return groups;
}

function isStepFlowCardGroup<T extends SlideLayoutElement>(
  group: TextualElementGroup,
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): boolean {
  const element = elements[group.primaryIndex];
  if (!element || element.type !== 'shape') return false;
  const rect = rectFromElement(element);
  if (!rect || isCircleLikeShape(element, rect)) return false;
  if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return false;
  if (isCanvasBackground(rect, options)) return false;
  if (isLikelyBackdropPanel(elements, group.primaryIndex, rect, options)) return false;

  return (
    rectWidth(rect) >= STEP_FLOW_CARD_MIN_WIDTH &&
    rectHeight(rect) >= STEP_FLOW_CARD_MIN_HEIGHT &&
    rectWidth(rect) <= options.canvasWidth * STEP_FLOW_CARD_MAX_WIDTH_RATIO &&
    rectHeight(rect) <= options.canvasHeight * STEP_FLOW_CARD_MAX_HEIGHT_RATIO
  );
}

function isStepFlowCaptionStrip(
  group: TextualElementGroup,
  options: Required<LayoutRepairOptions>,
): boolean {
  const text = group.text.trim();
  if (!text) return false;
  if (text.includes('课堂互动') || text.includes('教师提问') || text.includes('学生互动')) {
    return false;
  }
  const units = visualTextLength(text);
  return (
    units >= 5 &&
    units <= 44 &&
    rectWidth(group.rect) >= STEP_FLOW_STRIP_MIN_WIDTH &&
    rectWidth(group.rect) <= options.canvasWidth * 0.68 &&
    rectHeight(group.rect) <= STEP_FLOW_STRIP_MAX_HEIGHT &&
    group.rect.top >= options.canvasHeight * 0.18 &&
    group.rect.bottom <= options.canvasHeight * 0.82
  );
}

function moveIndexes<T extends SlideLayoutElement>(
  elements: readonly T[],
  repaired: T[] | null,
  indexes: readonly number[],
  dx: number,
  dy: number,
): T[] {
  const next = repaired ?? elements.map((item) => ({ ...item }));
  indexes.forEach((index) => {
    const rect = rectFromElement(next[index]);
    if (!rect) return;
    next[index] = {
      ...next[index],
      left: roundToTenth(rect.left + dx),
      top: roundToTenth(rect.top + dy),
    };
  });
  return next;
}

function applyRectToElement<T extends SlideLayoutElement>(element: T, rect: Rect): T {
  const content = getElementContent(element);
  const next = {
    ...element,
    ...rectToProps(rect),
  };

  if (element.type === 'text' && content) {
    return {
      ...next,
      content: ensureCenteredParagraphText(content),
    } as T;
  }

  const shapeText = getShapeTextContent(element);
  if (element.type === 'shape' && shapeText) {
    return setElementTextContent(next as T, ensureCenteredParagraphText(shapeText));
  }

  return next as T;
}

function repairStepFlowCaptionStrips<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): T[] | null {
  const groups = collectTextualForegroundGroups(elements, options);
  const cards = groups.filter((group) => isStepFlowCardGroup(group, elements, options));
  if (cards.length < 2) return null;

  let repaired: T[] | null = null;

  groups
    .filter((group) => isStepFlowCaptionStrip(group, options))
    .forEach((strip) => {
      const currentElements = repaired ?? elements;
      const currentStripRect =
        strip.indexes.map((index) => rectFromElement(currentElements[index])).filter(Boolean)[0] ||
        strip.rect;
      const overlappedCards = cards.filter((card) => {
        if (strip.indexes.some((index) => card.indexes.includes(index))) return false;
        const cardRect =
          card.indexes
            .map((index) => rectFromElement(currentElements[index]))
            .filter((rect): rect is Rect => !!rect)[0] ?? card.rect;
        const overlap = overlapArea(currentStripRect as Rect, cardRect);
        return (
          overlap >= 900 &&
          overlap / Math.max(1, Math.min(rectArea(currentStripRect as Rect), rectArea(cardRect))) >=
            0.08
        );
      });
      if (overlappedCards.length === 0) return;

      const cardUnion = unionRects(overlappedCards.map((card) => card.rect));
      const stripHeight = rectHeight(strip.rect);
      const aboveTop = cardUnion.top - stripHeight - STEP_FLOW_CLEARANCE;
      const belowTop = cardUnion.bottom + STEP_FLOW_CLEARANCE;
      const nextTop =
        aboveTop >= options.safeMargin
          ? aboveTop
          : belowTop + stripHeight <= options.canvasHeight - options.safeMargin
            ? belowTop
            : null;
      if (nextTop === null) return;

      const dy = roundToTenth(nextTop - strip.rect.top);
      if (Math.abs(dy) <= OVERLAP_TOLERANCE) return;
      repaired = moveIndexes(elements, repaired, strip.indexes, 0, dy);
    });

  return repaired;
}

function findStepBadgeCard(
  badge: NumberedBadgeGroup,
  cards: readonly TextualElementGroup[],
): TextualElementGroup | null {
  const badgeCenter = rectCenter(badge.rect);
  return (
    cards
      .map((card) => {
        const cardCenter = rectCenter(card.rect);
        const expandedCard = {
          left: card.rect.left - 90,
          top: card.rect.top - 120,
          right: card.rect.right + 90,
          bottom: card.rect.bottom + 120,
        };
        const nearCard = pointInExpandedRect(badgeCenter, card.rect, 120);
        const inSearchArea = pointInsideRect(badgeCenter, expandedCard);
        if (!nearCard && !inSearchArea) return null;

        const xPenalty = Math.max(
          0,
          Math.abs(badgeCenter.x - cardCenter.x) - rectWidth(card.rect) / 2,
        );
        const yPenalty = Math.max(
          0,
          Math.abs(badgeCenter.y - cardCenter.y) - rectHeight(card.rect) / 2,
        );
        const score = xPenalty * 1.4 + yPenalty + distance(badgeCenter, cardCenter) * 0.08;
        return { card, score };
      })
      .filter((item): item is { card: TextualElementGroup; score: number } => !!item)
      .filter((item) => item.score <= STEP_FLOW_BADGE_CARD_MAX_DISTANCE)
      .sort((a, b) => a.score - b.score)[0]?.card ?? null
  );
}

function badgeNeedsCardTextReservation(badgeRect: Rect, cardRect: Rect): boolean {
  const center = rectCenter(badgeRect);
  const reservedWidth =
    badgeRect.right - cardRect.left + STEP_FLOW_BADGE_TEXT_GAP + STEP_FLOW_CARD_TEXT_SIDE_PADDING;
  return (
    center.x <= cardRect.left + rectWidth(cardRect) * 0.52 &&
    center.y <= cardRect.top + rectHeight(cardRect) * 0.62 &&
    rectWidth(cardRect) - reservedWidth >= STEP_FLOW_CARD_TEXT_MIN_WIDTH
  );
}

function getBadgeReservedTextLeft(badgeRect: Rect, cardRect: Rect): number {
  return clamp(
    Math.ceil(badgeRect.right - cardRect.left + STEP_FLOW_BADGE_TEXT_GAP),
    STEP_FLOW_CARD_TEXT_SIDE_PADDING,
    Math.max(STEP_FLOW_CARD_TEXT_SIDE_PADDING, rectWidth(cardRect) - STEP_FLOW_CARD_TEXT_MIN_WIDTH),
  );
}

function mergeCssDeclarations(
  style: string,
  declarations: Record<string, string | number>,
): string {
  const overwrittenNames = new Set(Object.keys(declarations).map((name) => name.toLowerCase()));
  const existingDeclarations = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const name = declaration.split(':')[0]?.trim().toLowerCase();
      return !!name && !overwrittenNames.has(name);
    });

  return [
    ...existingDeclarations,
    ...Object.entries(declarations).map(([name, value]) => `${name}: ${value}`),
  ].join('; ');
}

function upsertStyleAttribute(tag: string, declarations: Record<string, string | number>): string {
  const styleMatch = tag.match(/\sstyle=(["'])(.*?)\1/i);
  if (!styleMatch) {
    return tag.replace(/>$/, ` style="${mergeCssDeclarations('', declarations)}">`);
  }

  const nextStyle = mergeCssDeclarations(styleMatch[2] || '', declarations);
  return tag.replace(styleMatch[0], ` style="${nextStyle}"`);
}

function applyHtmlTextStyles(html: string, declarations: Record<string, string | number>): string {
  if (/<p\b/i.test(html)) {
    return html.replace(/<p\b[^>]*>/gi, (tag) => upsertStyleAttribute(tag, declarations));
  }

  return `<p style="${mergeCssDeclarations('', declarations)}">${html}</p>`;
}

function reserveBadgeSpaceInHtml(html: string, reservedLeft: number): string {
  return applyHtmlTextStyles(html, {
    'text-align': 'left',
    'padding-left': `${roundToTenth(reservedLeft)}px`,
    'padding-right': '8px',
    'box-sizing': 'border-box',
    '--bingo-badge-reserved': `${roundToTenth(reservedLeft)}px`,
  });
}

function leftAlignHtmlText(html: string): string {
  return applyHtmlTextStyles(html, {
    'text-align': 'left',
    'box-sizing': 'border-box',
  });
}

function htmlHasBadgeTextReservation(html: string): boolean {
  return /--bingo-badge-reserved\s*:/i.test(html);
}

function rectsOverlapWithPadding(first: Rect, second: Rect, padding: number): boolean {
  return rectsOverlap(
    {
      left: first.left - padding,
      top: first.top - padding,
      right: first.right + padding,
      bottom: first.bottom + padding,
    },
    second,
  );
}

function repairStepFlowCardTextAroundBadge<T extends SlideLayoutElement>(
  elements: readonly T[],
  repaired: T[] | null,
  card: TextualElementGroup,
  badgeRect: Rect,
): T[] | null {
  const source = repaired ?? elements;
  const primaryElement = source[card.primaryIndex];
  const primaryRect = primaryElement ? rectFromElement(primaryElement) : null;
  if (!primaryElement || !primaryRect || !badgeNeedsCardTextReservation(badgeRect, primaryRect)) {
    return repaired;
  }

  const reservedLeft = getBadgeReservedTextLeft(badgeRect, primaryRect);
  let next = repaired;
  const ensureNext = () => {
    next ??= source.map((item) => ({ ...item }));
    return next;
  };

  const primaryHtml =
    primaryElement.type === 'shape'
      ? getShapeTextContent(primaryElement)
      : primaryElement.type === 'text'
        ? getElementContent(primaryElement)
        : '';
  if (primaryHtml && !htmlHasBadgeTextReservation(primaryHtml)) {
    const mutable = ensureNext();
    mutable[card.primaryIndex] = setElementTextContent(
      mutable[card.primaryIndex],
      reserveBadgeSpaceInHtml(primaryHtml, reservedLeft),
    );
  }

  const targetLeft = roundToTenth(primaryRect.left + reservedLeft);
  const targetRight = roundToTenth(primaryRect.right - STEP_FLOW_CARD_TEXT_SIDE_PADDING);
  const targetWidth = roundToTenth(targetRight - targetLeft);
  if (targetWidth < STEP_FLOW_CARD_TEXT_MIN_WIDTH) return next;

  card.indexes.forEach((index) => {
    if (index === card.primaryIndex) return;
    const textElement = (next ?? source)[index];
    if (!textElement || textElement.type !== 'text') return;
    const textRect = rectFromElement(textElement);
    if (!textRect || !containsRect(primaryRect, textRect, 24)) return;

    const verticalOverlap =
      overlapLength(textRect.top, textRect.bottom, badgeRect.top, badgeRect.bottom) > 0;
    const conflictsWithBadge =
      textRect.left < targetLeft - OVERLAP_TOLERANCE ||
      (verticalOverlap && rectsOverlapWithPadding(badgeRect, textRect, STEP_FLOW_BADGE_TEXT_GAP));
    if (!conflictsWithBadge) return;

    const mutable = ensureNext();
    mutable[index] = {
      ...mutable[index],
      left: targetLeft,
      width: targetWidth,
      content: leftAlignHtmlText(getElementContent(mutable[index])),
    };
  });

  return next;
}

function repairStepFlowBadges<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): T[] | null {
  const groups = collectTextualForegroundGroups(elements, options);
  const cards = groups.filter((group) => isStepFlowCardGroup(group, elements, options));
  const badges = collectNumberedBadgeGroups(elements).filter((badge) => badge.number <= 4);
  if (badges.length < STEP_FLOW_MIN_BADGE_COUNT || cards.length < STEP_FLOW_MIN_BADGE_COUNT) {
    return null;
  }

  const associations = badges
    .map((badge) => ({ badge, card: findStepBadgeCard(badge, cards) }))
    .filter(
      (item): item is { badge: NumberedBadgeGroup; card: TextualElementGroup } => !!item.card,
    );
  if (associations.length < STEP_FLOW_MIN_BADGE_COUNT) return null;

  let repaired: T[] | null = null;
  associations.forEach(({ badge, card }) => {
    const diameter = clamp(
      Math.round((rectWidth(badge.rect) + rectHeight(badge.rect)) / 2),
      42,
      70,
    );
    const nextRect = containsRect(card.rect, badge.rect, 4)
      ? badge.rect
      : (() => {
          const left = clamp(
            card.rect.left + Math.min(24, rectWidth(card.rect) * 0.12),
            card.rect.left + 8,
            card.rect.right - diameter - 8,
          );
          const top = clamp(
            card.rect.top + Math.min(24, rectHeight(card.rect) * 0.12),
            card.rect.top + 8,
            card.rect.bottom - diameter - 8,
          );
          return { left, top, right: left + diameter, bottom: top + diameter };
        })();

    if (!containsRect(card.rect, badge.rect, 4)) {
      const next = repaired ?? elements.map((item) => ({ ...item }));

      badge.indexes.forEach((index) => {
        next[index] = applyRectToElement(next[index], nextRect);
      });

      repaired = next;
    }

    repaired = repairStepFlowCardTextAroundBadge(elements, repaired, card, nextRect);
  });

  return repaired;
}

export function repairStepFlowDiagramLayout<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = resolveLayoutOptions(repairOptions);
  const stripRepairedElements = repairStepFlowCaptionStrips(elements, options) ?? elements;
  const badgeRepairedElements =
    repairStepFlowBadges(stripRepairedElements, options) ?? stripRepairedElements;
  return [...badgeRepairedElements];
}

function resolveLayoutOptions(
  repairOptions: LayoutRepairOptions = {},
): Required<LayoutRepairOptions> {
  return {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };
}

function isRectOutsideCanvas(
  rect: Rect,
  options: Required<LayoutRepairOptions>,
  tolerance = CRITICAL_BOUNDS_TOLERANCE,
): boolean {
  return (
    rect.left < -tolerance ||
    rect.top < -tolerance ||
    rect.right > options.canvasWidth + tolerance ||
    rect.bottom > options.canvasHeight + tolerance
  );
}

function isPointOutsideCanvas(
  point: Point,
  options: Required<LayoutRepairOptions>,
  tolerance = CRITICAL_BOUNDS_TOLERANCE,
): boolean {
  return (
    point.x < -tolerance ||
    point.y < -tolerance ||
    point.x > options.canvasWidth + tolerance ||
    point.y > options.canvasHeight + tolerance
  );
}

function getLineAbsoluteEndpoints(
  element: SlideLayoutElement,
): { start: Point; end: Point } | null {
  if (element.type !== 'line') return null;
  const record = asRecord(element);
  const start = pointFromArray(record.start);
  const end = pointFromArray(record.end);
  if (!start || !end) return null;

  const left = asFiniteNumber(record.left) ?? 0;
  const top = asFiniteNumber(record.top) ?? 0;
  return {
    start: { x: left + start.x, y: top + start.y },
    end: { x: left + end.x, y: top + end.y },
  };
}

function getElementLabel(element: SlideLayoutElement, index: number): string {
  const id = asRecord(element).id;
  return typeof id === 'string' && id.trim() ? id : `${element.type}#${index}`;
}

function isArrowConnector(element: SlideLayoutElement): boolean {
  if (element.type !== 'line') return false;
  const record = asRecord(element);
  const points = record.points;
  if (
    Array.isArray(points) &&
    points.some((point) => typeof point === 'string' && /arrow/i.test(point))
  ) {
    return true;
  }

  return /arrow/i.test(
    `${String(record.markerStart ?? '')} ${String(record.markerEnd ?? '')} ${String(
      record.startArrowType ?? '',
    )} ${String(record.endArrowType ?? '')}`,
  );
}

function insetRect(rect: Rect, padding: number): Rect | null {
  if (rectWidth(rect) <= padding * 2 || rectHeight(rect) <= padding * 2) return null;
  return {
    left: rect.left + padding,
    top: rect.top + padding,
    right: rect.right - padding,
    bottom: rect.bottom - padding,
  };
}

function pointInsideRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) + 0.0001 &&
    b.x >= Math.min(a.x, c.x) - 0.0001 &&
    b.y <= Math.max(a.y, c.y) + 0.0001 &&
    b.y >= Math.min(a.y, c.y) - 0.0001
  );
}

function segmentsIntersect(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const o1 = orientation(firstStart, firstEnd, secondStart);
  const o2 = orientation(firstStart, firstEnd, secondEnd);
  const o3 = orientation(secondStart, secondEnd, firstStart);
  const o4 = orientation(secondStart, secondEnd, firstEnd);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(firstStart, secondStart, firstEnd)) return true;
  if (o2 === 0 && pointOnSegment(firstStart, secondEnd, firstEnd)) return true;
  if (o3 === 0 && pointOnSegment(secondStart, firstStart, secondEnd)) return true;
  return o4 === 0 && pointOnSegment(secondStart, firstEnd, secondEnd);
}

function segmentIntersectsRect(start: Point, end: Point, rect: Rect): boolean {
  if (pointInsideRect(start, rect) || pointInsideRect(end, rect)) return true;

  const topLeft = { x: rect.left, y: rect.top };
  const topRight = { x: rect.right, y: rect.top };
  const bottomRight = { x: rect.right, y: rect.bottom };
  const bottomLeft = { x: rect.left, y: rect.bottom };

  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function pushCriticalIssue(
  issues: CriticalSlideLayoutIssue[],
  issue: CriticalSlideLayoutIssue,
): void {
  if (issues.length >= CRITICAL_LAYOUT_MAX_ISSUES) return;
  issues.push(issue);
}

function collectCriticalBoundsIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  elements.forEach((element, index) => {
    if (element.type === 'line') {
      const endpoints = getLineAbsoluteEndpoints(element);
      if (
        endpoints &&
        (isPointOutsideCanvas(endpoints.start, options) ||
          isPointOutsideCanvas(endpoints.end, options))
      ) {
        pushCriticalIssue(issues, {
          type: 'connector-out-of-bounds',
          elementIndexes: [index],
          message: `Connector ${getElementLabel(element, index)} is outside the canvas`,
        });
      }
      return;
    }

    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return;
    if (!isRectOutsideCanvas(rect, options)) return;

    pushCriticalIssue(issues, {
      type: 'element-out-of-bounds',
      elementIndexes: [index],
      message: `Element ${getElementLabel(element, index)} is outside the canvas`,
    });
  });
}

function collectCriticalTableOverlayIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const tables = elements
    .map((element, index) => {
      if (element.type !== 'table') return null;
      const rect = rectFromElement(element);
      if (!rect) return null;
      if (
        rectWidth(rect) < TABLE_CAPTION_MIN_WIDTH ||
        rectHeight(rect) < TABLE_CAPTION_MIN_HEIGHT
      ) {
        return null;
      }
      return { index, element, rect };
    })
    .filter((item): item is { index: number; element: T; rect: Rect } => !!item);

  if (tables.length === 0) return;

  elements.forEach((element, textIndex) => {
    if (element.type !== 'text') return;
    const textRect = rectFromElement(element);
    if (!textRect || !isVisibleLayoutElement(element, textRect, options)) return;
    const text = getElementText(element);
    if (!text) return;
    if (text.includes('课堂互动') || text.includes('教师提问') || text.includes('学生互动')) {
      return;
    }

    const textArea = rectArea(textRect);
    if (textArea <= 0) return;

    const table = tables.find((candidate) => {
      const overlap = overlapArea(textRect, candidate.rect);
      return (
        overlap >= CRITICAL_TABLE_TEXT_OVERLAP_MIN_AREA &&
        overlap / textArea >= CRITICAL_TABLE_TEXT_OVERLAP_MIN_RATIO &&
        pointInExpandedRect(rectCenter(textRect), candidate.rect, 4)
      );
    });

    if (!table) return;

    pushCriticalIssue(issues, {
      type: 'table-text-overlay',
      elementIndexes: [table.index, textIndex],
      message: `Text ${getElementLabel(element, textIndex)} overlaps table ${getElementLabel(
        table.element,
        table.index,
      )}`,
    });
  });
}

function collectCriticalTextOverlapIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const texts = elements
    .map((element, index) => {
      if (element.type !== 'text') return null;
      const rect = rectFromElement(element);
      if (!rect || !isVisibleLayoutElement(element, rect, options)) return null;
      if (!getElementText(element)) return null;
      return { index, element, rect };
    })
    .filter((item): item is { index: number; element: T; rect: Rect } => !!item);

  for (let firstIndex = 0; firstIndex < texts.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < texts.length; secondIndex += 1) {
      const first = texts[firstIndex];
      const second = texts[secondIndex];
      const overlap = overlapArea(first.rect, second.rect);
      if (overlap < CRITICAL_TEXT_OVERLAP_MIN_AREA) continue;

      const ratio = overlap / Math.min(rectArea(first.rect), rectArea(second.rect));
      if (ratio < CRITICAL_TEXT_OVERLAP_MIN_RATIO) continue;

      pushCriticalIssue(issues, {
        type: 'text-text-overlap',
        elementIndexes: [first.index, second.index],
        message: `Text ${getElementLabel(first.element, first.index)} overlaps text ${getElementLabel(
          second.element,
          second.index,
        )}`,
      });
    }
  }
}

function getElementTextHtml(element: SlideLayoutElement): string {
  return element.type === 'shape' ? getShapeTextContent(element) : getElementContent(element);
}

function extractTextLineHtmlSegments(html: string): Array<{ html: string; text: string }> {
  const paragraphMatches = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi));
  const rawSegments =
    paragraphMatches.length > 0
      ? paragraphMatches.map((match) => match[0])
      : html.replace(/<br\s*\/?>/gi, '\n').split('\n');

  return rawSegments
    .map((segment) => ({ html: segment, text: stripHtmlToText(segment) }))
    .filter((segment) => segment.text.length > 0);
}

function estimateRequiredTextHeight(element: SlideLayoutElement, rect: Rect): number | null {
  if (element.type !== 'text' && element.type !== 'shape') return null;

  const html = getElementTextHtml(element);
  if (!html || !getElementText(element)) return null;

  const lines = extractTextLineHtmlSegments(html);
  if (lines.length === 0) return null;

  const record = asRecord(element);
  const width = rectWidth(rect);
  if (!Number.isFinite(width) || width <= 20) return null;

  const lineHeightRatio = asFiniteNumber(record.lineHeight) ?? 1.45;
  const paragraphSpace = asFiniteNumber(record.paragraphSpace) ?? 5;
  const fallbackFontSize = getLargestFontSize(element) || 18;

  const totalHeight = lines.reduce((total, line) => {
    const fontSize = clamp(getLargestFontSizeFromHtml(line.html, fallbackFontSize), 10, 56);
    const charsPerLine = Math.max(1, (width - 20) / fontSize);
    const wrappedLineCount = Math.max(1, Math.ceil(visualTextLength(line.text) / charsPerLine));
    return total + wrappedLineCount * fontSize * lineHeightRatio;
  }, 0);

  return Math.ceil(totalHeight + 20 + Math.max(0, lines.length - 1) * paragraphSpace);
}

function collectCriticalTextOverflowIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  elements.forEach((element, index) => {
    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return;

    const requiredHeight = estimateRequiredTextHeight(element, rect);
    if (requiredHeight === null) return;
    if (requiredHeight <= rectHeight(rect) + CRITICAL_TEXT_OVERFLOW_TOLERANCE) return;

    pushCriticalIssue(issues, {
      type: 'text-overflows-box',
      elementIndexes: [index],
      message: `Text ${getElementLabel(element, index)} needs ${requiredHeight}px height but box is ${Math.round(
        rectHeight(rect),
      )}px`,
    });
  });
}

function textShouldBeCenteredInShape(
  shapeRect: Rect,
  textElement: SlideLayoutElement,
  textRect: Rect,
): boolean {
  const html = getElementContent(textElement);
  if (!html || htmlHasBadgeTextReservation(html)) return false;
  if (hasExplicitTextAlign(html) && !hasCenteredTextAlign(html)) return false;
  if (!containsRect(shapeRect, textRect, 24)) return false;

  return shouldAutoCenterBoxText({
    html,
    boxWidth: rectWidth(shapeRect),
    boxHeight: rectHeight(shapeRect),
    textWidth: rectWidth(textRect),
    textHeight: rectHeight(textRect),
  });
}

function findShortLabelBackingShape<T extends SlideLayoutElement>(
  elements: readonly T[],
  textIndex: number,
  textRect: Rect,
  options: Required<LayoutRepairOptions>,
): { index: number; rect: Rect } | null {
  const candidates: Array<{ index: number; rect: Rect; area: number }> = [];

  elements.forEach((candidate, candidateIndex) => {
    if (candidateIndex === textIndex || candidate.type !== 'shape') return;
    const candidateRect = rectFromElement(candidate);
    if (!candidateRect) return;
    const canUseBackingShape =
      isShortLabelBox(candidate, candidateRect) ||
      isSingleShortLabelCardBackingShape(
        elements,
        candidateIndex,
        candidateRect,
        textIndex,
        textRect,
        options,
      );
    if (!canUseBackingShape) return;
    if (isCanvasBackground(candidateRect, options)) return;
    if (isLikelyBackdropPanel(elements, candidateIndex, candidateRect, options)) return;
    if (!textShouldBeCenteredInShape(candidateRect, elements[textIndex], textRect)) return;

    const area = rectArea(candidateRect);
    candidates.push({ index: candidateIndex, rect: candidateRect, area });
  });

  const best = candidates.sort((a, b) => a.area - b.area)[0];
  return best ? { index: best.index, rect: best.rect } : null;
}

function isSingleShortLabelCardBackingShape<T extends SlideLayoutElement>(
  elements: readonly T[],
  candidateIndex: number,
  candidateRect: Rect,
  textIndex: number,
  _textRect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  const candidate = elements[candidateIndex];
  if (!isLikelyCardBackingShape(candidate, candidateRect, options)) return false;

  const centerableTextItems = collectContainedTextItems(elements, candidateIndex, candidateRect)
    .filter((item) => {
      const textElement = elements[item.index];
      return textShouldBeCenteredInShape(candidateRect, textElement, item.rect);
    });

  return centerableTextItems.length === 1 && centerableTextItems[0].index === textIndex;
}

function collectCriticalBoxTextCenteringIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const coveredTextIndexes = new Set<number>();

  elements.forEach((shape, shapeIndex) => {
    const shapeRect = rectFromElement(shape);
    if (!shapeRect || shape.type !== 'shape' || !isShortLabelBox(shape, shapeRect)) return;
    if (isCanvasBackground(shapeRect, options)) return;

    const shapeHtml = getShapeTextContent(shape);
    const shapeText = asRecord(shape).text;
    const shapeTextAlign =
      typeof shapeText === 'object' && shapeText !== null
        ? (shapeText as Record<string, unknown>).align
        : undefined;
    if (shapeHtml && (!hasCenteredTextAlign(shapeHtml) || shapeTextAlign !== 'middle')) {
      pushCriticalIssue(issues, {
        type: 'box-text-not-centered',
        elementIndexes: [shapeIndex],
        message: `Shape text ${getElementLabel(shape, shapeIndex)} is not centered`,
      });
      return;
    }

    elements.forEach((textElement, textIndex) => {
      if (textIndex === shapeIndex || textElement.type !== 'text') return;
      const textRect = rectFromElement(textElement);
      if (!textRect || !textShouldBeCenteredInShape(shapeRect, textElement, textRect)) return;

      coveredTextIndexes.add(textIndex);
      const shapeCenter = rectCenter(shapeRect);
      const textCenter = rectCenter(textRect);
      const maxOffsetX = Math.max(
        CRITICAL_BOX_TEXT_CENTER_TOLERANCE,
        rectWidth(shapeRect) * CRITICAL_BOX_TEXT_MAX_CENTER_OFFSET_RATIO,
      );
      const maxOffsetY = Math.max(
        CRITICAL_BOX_TEXT_CENTER_TOLERANCE,
        rectHeight(shapeRect) * CRITICAL_BOX_TEXT_MAX_CENTER_OFFSET_RATIO,
      );
      if (
        Math.abs(shapeCenter.x - textCenter.x) <= maxOffsetX &&
        Math.abs(shapeCenter.y - textCenter.y) <= maxOffsetY &&
        hasCenteredTextAlign(getElementContent(textElement))
      ) {
        return;
      }

      pushCriticalIssue(issues, {
        type: 'box-text-not-centered',
        elementIndexes: [shapeIndex, textIndex],
        message: `Text ${getElementLabel(
          textElement,
          textIndex,
        )} is not centered inside ${getElementLabel(shape, shapeIndex)}`,
      });
    });
  });

  elements.forEach((textElement, textIndex) => {
    if (coveredTextIndexes.has(textIndex) || textElement.type !== 'text') return;
    const textRect = rectFromElement(textElement);
    if (!textRect) return;

    const backingShape = findShortLabelBackingShape(elements, textIndex, textRect, options);
    if (!backingShape) return;

    const shapeCenter = rectCenter(backingShape.rect);
    const textCenter = rectCenter(textRect);
    const maxOffsetX = Math.max(
      CRITICAL_BOX_TEXT_CENTER_TOLERANCE,
      rectWidth(backingShape.rect) * CRITICAL_BOX_TEXT_MAX_CENTER_OFFSET_RATIO,
    );
    const maxOffsetY = Math.max(
      CRITICAL_BOX_TEXT_CENTER_TOLERANCE,
      rectHeight(backingShape.rect) * CRITICAL_BOX_TEXT_MAX_CENTER_OFFSET_RATIO,
    );
    const html = getElementContent(textElement);
    if (
      Math.abs(shapeCenter.x - textCenter.x) <= maxOffsetX &&
      Math.abs(shapeCenter.y - textCenter.y) <= maxOffsetY &&
      hasCenteredTextAlign(html)
    ) {
      return;
    }

    pushCriticalIssue(issues, {
      type: 'box-text-not-centered',
      elementIndexes: [backingShape.index, textIndex],
      message: `Text ${getElementLabel(
        textElement,
        textIndex,
      )} is not centered inside ${getElementLabel(elements[backingShape.index], backingShape.index)}`,
    });
  });
}

function isLikelyCardBackingShape(
  element: SlideLayoutElement,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  if (element.type !== 'shape') return false;
  if (hasElementText(element) || !hasVisibleFill(element) || !hasVisibleOpacity(element)) {
    return false;
  }
  if (isCanvasBackground(rect, options) || isLikelyBackdropPanel([element], 0, rect, options)) {
    return false;
  }
  return rectWidth(rect) >= 96 && rectHeight(rect) >= 44 && rectHeight(rect) <= 220;
}

function isLikelyCardOverlayText(element: SlideLayoutElement, rect: Rect): boolean {
  if (element.type !== 'text') return false;
  const html = getElementContent(element);
  const text = getElementText(element);
  if (!html || !text || htmlHasBadgeTextReservation(html)) return false;
  if (rectWidth(rect) > 520 || rectHeight(rect) > 140) return false;
  if (visualTextLength(text) > 80) return false;
  return getLargestFontSize(element) <= 34;
}

function collectCriticalTextOutsideContainerIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  elements.forEach((textElement, textIndex) => {
    const textRect = rectFromElement(textElement);
    if (!textRect || !isLikelyCardOverlayText(textElement, textRect)) return;

    const hasContainingShape = elements.some((candidate, candidateIndex) => {
      if (candidateIndex === textIndex || candidate.type !== 'shape') return false;
      const candidateRect = rectFromElement(candidate);
      if (!candidateRect || !isLikelyCardBackingShape(candidate, candidateRect, options)) {
        return false;
      }
      return containsRect(candidateRect, textRect, 18);
    });
    if (hasContainingShape) return;

    const adjacentShape = elements.find((candidate, candidateIndex) => {
      if (candidateIndex === textIndex || candidate.type !== 'shape') return false;
      const candidateRect = rectFromElement(candidate);
      if (!candidateRect || !isLikelyCardBackingShape(candidate, candidateRect, options)) {
        return false;
      }

      const verticalOverlap = overlapLength(
        candidateRect.top,
        candidateRect.bottom,
        textRect.top,
        textRect.bottom,
      );
      const verticalOverlapRatio =
        verticalOverlap / Math.max(1, Math.min(rectHeight(candidateRect), rectHeight(textRect)));
      if (verticalOverlapRatio < CRITICAL_CARD_TEXT_MIN_VERTICAL_OVERLAP_RATIO) return false;

      const horizontalGap = Math.max(
        0,
        Math.max(candidateRect.left, textRect.left) - Math.min(candidateRect.right, textRect.right),
      );
      return horizontalGap <= CRITICAL_CARD_TEXT_MAX_GAP;
    });
    if (!adjacentShape) return;

    const adjacentIndex = elements.indexOf(adjacentShape);
    pushCriticalIssue(issues, {
      type: 'text-outside-container',
      elementIndexes: adjacentIndex >= 0 ? [adjacentIndex, textIndex] : [textIndex],
      message: `Text ${getElementLabel(textElement, textIndex)} is visually detached from its card`,
    });
  });
}

function groupsShareIndex(first: TextualElementGroup, second: TextualElementGroup): boolean {
  return first.indexes.some((index) => second.indexes.includes(index));
}

function isNumericBadgeLikeGroup(
  group: TextualElementGroup,
  elements: readonly SlideLayoutElement[],
) {
  const element = elements[group.primaryIndex];
  if (!element) return false;
  const rect = rectFromElement(element);
  if (!rect) return false;
  if (isCircleLikeShape(element, rect) && numericTextValue(element) !== null) return true;
  return isSmallFilledNumericText(element, rect);
}

function shouldIgnoreForegroundBlockOverlap<T extends SlideLayoutElement>(
  first: TextualElementGroup,
  second: TextualElementGroup,
  elements: readonly T[],
): boolean {
  if (groupsShareIndex(first, second)) return true;
  if (
    isNumericBadgeLikeGroup(first, elements) &&
    pointInExpandedRect(rectCenter(first.rect), second.rect, 6)
  ) {
    return true;
  }
  if (
    isNumericBadgeLikeGroup(second, elements) &&
    pointInExpandedRect(rectCenter(second.rect), first.rect, 6)
  ) {
    return true;
  }
  if (containsRect(first.rect, second.rect, 8) || containsRect(second.rect, first.rect, 8)) {
    return true;
  }
  return false;
}

function collectCriticalForegroundBlockOverlapIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const groups = collectTextualForegroundGroups(elements, options).filter((group) => {
    const element = elements[group.primaryIndex];
    if (!element) return false;
    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return false;
    if (isCanvasBackground(rect, options)) return false;
    if (isLikelyBackdropPanel(elements, group.primaryIndex, rect, options)) return false;
    if (rectArea(group.rect) < 1800) return false;
    return element.type === 'shape' || (element.type === 'text' && hasVisibleFill(element));
  });

  for (let firstIndex = 0; firstIndex < groups.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < groups.length; secondIndex += 1) {
      const first = groups[firstIndex];
      const second = groups[secondIndex];
      if (shouldIgnoreForegroundBlockOverlap(first, second, elements)) continue;

      const overlap = overlapArea(first.rect, second.rect);
      if (overlap < CRITICAL_FOREGROUND_OVERLAP_MIN_AREA) continue;

      const ratio = overlap / Math.max(1, Math.min(rectArea(first.rect), rectArea(second.rect)));
      if (ratio < CRITICAL_FOREGROUND_OVERLAP_MIN_RATIO) continue;

      pushCriticalIssue(issues, {
        type: 'foreground-block-overlap',
        elementIndexes: [first.primaryIndex, second.primaryIndex],
        message: `Foreground block ${getElementLabel(
          elements[first.primaryIndex],
          first.primaryIndex,
        )} overlaps block ${getElementLabel(elements[second.primaryIndex], second.primaryIndex)}`,
      });
    }
  }
}

function collectCriticalNumberedBadgeTextOverlapIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const groups = collectTextualForegroundGroups(elements, options);
  const cards = groups.filter((group) => isStepFlowCardGroup(group, elements, options));
  const badges = collectNumberedBadgeGroups(elements).filter((badge) => badge.number <= 4);
  if (badges.length < STEP_FLOW_MIN_BADGE_COUNT || cards.length < STEP_FLOW_MIN_BADGE_COUNT) {
    return;
  }

  badges.forEach((badge) => {
    const card = findStepBadgeCard(badge, cards);
    if (!card) return;
    const cardElement = elements[card.primaryIndex];
    const cardRect = cardElement ? rectFromElement(cardElement) : null;
    if (!cardElement || !cardRect || !badgeNeedsCardTextReservation(badge.rect, cardRect)) return;

    const reservedLeft = cardRect.left + getBadgeReservedTextLeft(badge.rect, cardRect);
    const shapeText = cardElement.type === 'shape' ? getShapeTextContent(cardElement) : '';
    const estimatedTextRect =
      shapeText && !htmlHasBadgeTextReservation(shapeText)
        ? estimateCenteredTextRect(cardElement, cardRect)
        : null;
    if (
      estimatedTextRect &&
      rectsOverlapWithPadding(badge.rect, estimatedTextRect, STEP_FLOW_BADGE_TEXT_GAP)
    ) {
      pushCriticalIssue(issues, {
        type: 'numbered-badge-text-overlap',
        elementIndexes: [badge.primaryIndex, card.primaryIndex],
        message: `Numbered badge ${getElementLabel(
          elements[badge.primaryIndex],
          badge.primaryIndex,
        )} overlaps text in ${getElementLabel(cardElement, card.primaryIndex)}`,
      });
      return;
    }

    const badTextIndex = card.indexes.find((index) => {
      if (index === card.primaryIndex) return false;
      const element = elements[index];
      if (!element || element.type !== 'text') return false;
      const textRect = rectFromElement(element);
      if (!textRect || !containsRect(cardRect, textRect, 24)) return false;
      const verticalOverlap =
        overlapLength(textRect.top, textRect.bottom, badge.rect.top, badge.rect.bottom) > 0;
      return (
        textRect.left < reservedLeft - OVERLAP_TOLERANCE ||
        (verticalOverlap && rectsOverlapWithPadding(badge.rect, textRect, STEP_FLOW_BADGE_TEXT_GAP))
      );
    });

    if (badTextIndex === undefined) return;
    pushCriticalIssue(issues, {
      type: 'numbered-badge-text-overlap',
      elementIndexes: [badge.primaryIndex, badTextIndex],
      message: `Numbered badge ${getElementLabel(
        elements[badge.primaryIndex],
        badge.primaryIndex,
      )} overlaps text ${getElementLabel(elements[badTextIndex], badTextIndex)}`,
    });
  });
}

function splitTextLinesFromHtml(value: string): string[] {
  const normalized = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .split('\n')
    .map(stripHtmlToText)
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [stripHtmlToText(value)].filter(Boolean);
}

function estimateCenteredTextRect(element: SlideLayoutElement, rect: Rect): Rect | null {
  const rawHtml =
    element.type === 'shape' ? getShapeTextContent(element) : getElementContent(element);
  const lines = splitTextLinesFromHtml(rawHtml);
  if (lines.length === 0) return null;

  const fontSize = clamp(getLargestFontSize(element) || 22, 14, 40);
  const maxLineUnits = Math.max(...lines.map(visualTextLength));
  const estimatedWidth = clamp(maxLineUnits * fontSize * 1.08 + 16, 32, rectWidth(rect));
  const estimatedHeight = clamp(lines.length * fontSize * 1.45 + 12, 24, rectHeight(rect));
  const center = rectCenter(rect);

  return {
    left: center.x - estimatedWidth / 2,
    top: center.y - estimatedHeight / 2,
    right: center.x + estimatedWidth / 2,
    bottom: center.y + estimatedHeight / 2,
  };
}

function getVisibleTextObstructionRect(element: SlideLayoutElement, rect: Rect): Rect | null {
  if (!getElementText(element)) return null;
  if (element.type === 'text') {
    const estimated = estimateCenteredTextRect(element, rect);
    if (!estimated) return rect;

    const textUnits = visualTextLength(getElementText(element));
    if (
      textUnits <= 40 &&
      (rectArea(rect) >= rectArea(estimated) * 1.8 ||
        rectHeight(rect) >= rectHeight(estimated) * 1.6)
    ) {
      return estimated;
    }
    return rect;
  }
  if (element.type === 'shape' && hasElementText(element)) {
    return estimateCenteredTextRect(element, rect);
  }
  return null;
}

function collectCriticalConnectorTextObstructionIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  elements.forEach((element, lineIndex) => {
    if (!isArrowConnector(element)) return;
    const segments = getLinePathSegments(element, lineIndex);
    if (segments.length === 0) return;

    elements.forEach((candidate, candidateIndex) => {
      if (candidateIndex === lineIndex || candidate.type === 'line') return;

      const candidateRect = rectFromElement(candidate);
      if (!candidateRect || !isVisibleLayoutElement(candidate, candidateRect, options)) return;

      const textRect = getVisibleTextObstructionRect(candidate, candidateRect);
      if (!textRect || rectWidth(textRect) < 24 || rectHeight(textRect) < 18) return;

      const interior = insetRect(textRect, CRITICAL_CONNECTOR_TEXT_PADDING) ?? textRect;
      const obstructingSegment = segments.find((segment) =>
        segmentIntersectsRect(segment.start, segment.end, interior),
      );
      if (!obstructingSegment) return;
      if (
        pointInsideRect(obstructingSegment.start, interior) ||
        pointInsideRect(obstructingSegment.end, interior)
      ) {
        return;
      }

      pushCriticalIssue(issues, {
        type: 'connector-obstructs-text',
        elementIndexes: [lineIndex, candidateIndex],
        message: `Connector ${getElementLabel(
          element,
          lineIndex,
        )} crosses text ${getElementLabel(candidate, candidateIndex)}`,
      });
    });
  });
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  };
}

function isRectInsideConnectedNode(
  rect: Rect,
  startNode: ConnectorNode | null,
  endNode: ConnectorNode | null,
): boolean {
  return (
    (!!startNode && containsRect(startNode.rect, rect, 6)) ||
    (!!endNode && containsRect(endNode.rect, rect, 6))
  );
}

function getConnectorRouteNodes(
  nodes: readonly ConnectorNode[],
  endpoints: { start: Point; end: Point },
): ConnectorRouteNodes {
  let startNode = nodes.length >= 1 ? findConnectorEndpointNode(nodes, endpoints.start) : null;
  let endNode =
    nodes.length >= 2 ? findConnectorEndpointNode(nodes, endpoints.end, startNode?.index) : null;

  if (startNode && !endNode && pointInsideRect(endpoints.end, startNode.rect)) {
    startNode = null;
  }
  if (endNode && !startNode && pointInsideRect(endpoints.start, endNode.rect)) {
    endNode = null;
  }

  return { startNode, endNode };
}

function collectConnectorObstacles<T extends SlideLayoutElement>(
  elements: readonly T[],
  lineIndex: number,
  startNode: ConnectorNode | null,
  endNode: ConnectorNode | null,
  options: Required<LayoutRepairOptions>,
): ConnectorObstacle[] {
  const canvasArea = options.canvasWidth * options.canvasHeight;
  const connectedIndexes = new Set(
    [startNode?.index, endNode?.index].filter((index): index is number => index !== undefined),
  );

  return elements
    .map((candidate, candidateIndex) => {
      if (candidateIndex === lineIndex || candidate.type === 'line') return null;
      if (connectedIndexes.has(candidateIndex)) return null;

      const rect = rectFromElement(candidate);
      if (!rect || !isVisibleLayoutElement(candidate, rect, options)) return null;
      if (isCanvasBackground(rect, options)) return null;
      if (isLikelyBackdropPanel(elements, candidateIndex, rect, options)) return null;
      if (isRectInsideConnectedNode(rect, startNode, endNode)) return null;
      if (rectArea(rect) >= canvasArea * 0.35 && !hasElementText(candidate)) return null;
      if (rectWidth(rect) < 24 || rectHeight(rect) < 18) return null;

      const textRect = getVisibleTextObstructionRect(candidate, rect);
      const obstacleRect =
        textRect && rectWidth(textRect) >= 24 && rectHeight(textRect) >= 18 ? textRect : rect;
      return {
        index: candidateIndex,
        rect: expandRect(obstacleRect, CONNECTOR_ROUTE_CLEARANCE / 2),
      };
    })
    .filter((obstacle): obstacle is ConnectorObstacle => !!obstacle);
}

function connectorRouteSegments(route: ConnectorRoute): ConnectorPathSegment[] {
  const points = route.broken ? [route.start, route.broken, route.end] : [route.start, route.end];
  const segments: ConnectorPathSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    if (distance(points[index - 1], points[index]) < 0.5) continue;
    segments.push({ index: -1, start: points[index - 1], end: points[index] });
  }
  return segments;
}

function routeIntersectsObstacle(route: ConnectorRoute, obstacle: ConnectorObstacle): boolean {
  return connectorRouteSegments(route).some((segment) =>
    segmentIntersectsRect(segment.start, segment.end, obstacle.rect),
  );
}

function isConnectorRouteClear(
  route: ConnectorRoute,
  obstacles: readonly ConnectorObstacle[],
): boolean {
  return !obstacles.some((obstacle) => routeIntersectsObstacle(route, obstacle));
}

function getConnectorRouteLength(route: ConnectorRoute): number {
  return connectorRouteSegments(route).reduce(
    (total, segment) => total + distance(segment.start, segment.end),
    0,
  );
}

function buildConnectorRoute(start: Point, end: Point, broken?: Point): ConnectorRoute {
  const route = { start, end, broken, score: 0 };
  return {
    ...route,
    score: getConnectorRouteLength(route) + (broken ? CONNECTOR_ROUTE_BEND_PENALTY : 0),
  };
}

function addUniqueRoute(
  routes: ConnectorRoute[],
  route: ConnectorRoute,
  options: Required<LayoutRepairOptions>,
): void {
  const points = route.broken ? [route.start, route.broken, route.end] : [route.start, route.end];
  if (
    points.some(
      (point) =>
        point.x < options.safeMargin ||
        point.x > options.canvasWidth - options.safeMargin ||
        point.y < options.safeMargin ||
        point.y > options.canvasHeight - options.safeMargin,
    )
  ) {
    return;
  }

  const key = points.map((point) => `${roundToTenth(point.x)},${roundToTenth(point.y)}`).join('|');
  const exists = routes.some((candidate) => {
    const candidatePoints = candidate.broken
      ? [candidate.start, candidate.broken, candidate.end]
      : [candidate.start, candidate.end];
    const candidateKey = candidatePoints
      .map((point) => `${roundToTenth(point.x)},${roundToTenth(point.y)}`)
      .join('|');
    return candidateKey === key;
  });
  if (!exists) routes.push(route);
}

function getRelevantRouteObstacles(
  start: Point,
  end: Point,
  obstacles: readonly ConnectorObstacle[],
): ConnectorObstacle[] {
  const routeBounds = expandRect(
    {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y),
    },
    CONNECTOR_ROUTE_CLEARANCE * 3,
  );

  return obstacles.filter((obstacle) => rectsOverlap(routeBounds, obstacle.rect));
}

function getLaneCandidates(
  relevantObstacles: readonly ConnectorObstacle[],
  options: Required<LayoutRepairOptions>,
  orientation: 'horizontal' | 'vertical',
): number[] {
  const safeMin = options.safeMargin + CONNECTOR_ROUTE_EDGE_MARGIN;
  const safeMax =
    orientation === 'horizontal'
      ? options.canvasHeight - options.safeMargin - CONNECTOR_ROUTE_EDGE_MARGIN
      : options.canvasWidth - options.safeMargin - CONNECTOR_ROUTE_EDGE_MARGIN;

  const lanes = [safeMin, safeMax];
  if (relevantObstacles.length > 0) {
    if (orientation === 'horizontal') {
      lanes.push(
        Math.min(...relevantObstacles.map((obstacle) => obstacle.rect.top)) -
          CONNECTOR_ROUTE_CLEARANCE,
      );
      lanes.push(
        Math.max(...relevantObstacles.map((obstacle) => obstacle.rect.bottom)) +
          CONNECTOR_ROUTE_CLEARANCE,
      );
    } else {
      lanes.push(
        Math.min(...relevantObstacles.map((obstacle) => obstacle.rect.left)) -
          CONNECTOR_ROUTE_CLEARANCE,
      );
      lanes.push(
        Math.max(...relevantObstacles.map((obstacle) => obstacle.rect.right)) +
          CONNECTOR_ROUTE_CLEARANCE,
      );
    }
  }

  return Array.from(new Set(lanes.map((lane) => roundToTenth(clamp(lane, safeMin, safeMax)))));
}

function buildClearedConnectorEndpoints(
  element: SlideLayoutElement,
  start: Point,
  end: Point,
  startNode: ConnectorNode | null,
  endNode: ConnectorNode | null,
  options: Required<LayoutRepairOptions>,
): { start: Point; end: Point } {
  let nextStart = clampPointToCanvas(start, options);
  let nextEnd = clampPointToCanvas(end, options);

  if (startNode && endNode && startNode.index !== endNode.index) {
    const startCenter = rectCenter(startNode.rect);
    const endCenter = rectCenter(endNode.rect);
    const startAnchor = rectAnchorToward(startNode.rect, endCenter);
    const endAnchor = rectAnchorToward(endNode.rect, startCenter);
    const clearances = fitEndpointClearances(
      startAnchor,
      endAnchor,
      getConnectorEndpointClearance(element, 'start'),
      getConnectorEndpointClearance(element, 'end'),
    );
    nextStart = movePointToward(startAnchor, endCenter, clearances.startClearance);
    nextEnd = movePointToward(endAnchor, startCenter, clearances.endClearance);
  } else if (startNode) {
    const target = nextEnd;
    const anchor = rectAnchorToward(startNode.rect, target);
    nextStart = movePointToward(anchor, target, getConnectorEndpointClearance(element, 'start'));
  } else if (endNode) {
    const target = nextStart;
    const anchor = rectAnchorToward(endNode.rect, target);
    nextEnd = movePointToward(anchor, target, getConnectorEndpointClearance(element, 'end'));
  }

  return {
    start: clampPointToCanvas(nextStart, options),
    end: clampPointToCanvas(nextEnd, options),
  };
}

function buildConnectorRouteCandidates(
  start: Point,
  end: Point,
  obstacles: readonly ConnectorObstacle[],
  options: Required<LayoutRepairOptions>,
): ConnectorRoute[] {
  const routes: ConnectorRoute[] = [];
  addUniqueRoute(routes, buildConnectorRoute(start, end), options);

  const relevantObstacles = getRelevantRouteObstacles(start, end, obstacles);
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };

  addUniqueRoute(routes, buildConnectorRoute(start, end, { x: start.x, y: end.y }), options);
  addUniqueRoute(routes, buildConnectorRoute(start, end, { x: end.x, y: start.y }), options);

  if (horizontal) {
    getLaneCandidates(relevantObstacles, options, 'horizontal').forEach((laneY) => {
      addUniqueRoute(routes, buildConnectorRoute(start, end, { x: midpoint.x, y: laneY }), options);
    });
  } else {
    getLaneCandidates(relevantObstacles, options, 'vertical').forEach((laneX) => {
      addUniqueRoute(routes, buildConnectorRoute(start, end, { x: laneX, y: midpoint.y }), options);
    });
  }

  return routes;
}

function chooseConnectorRoute(
  element: SlideLayoutElement,
  endpoints: { start: Point; end: Point },
  nodes: readonly ConnectorNode[],
  obstacles: readonly ConnectorObstacle[],
  options: Required<LayoutRepairOptions>,
): ConnectorRoute | null {
  const { startNode, endNode } = getConnectorRouteNodes(nodes, endpoints);
  const cleared = buildClearedConnectorEndpoints(
    element,
    endpoints.start,
    endpoints.end,
    startNode,
    endNode,
    options,
  );
  const candidates = buildConnectorRouteCandidates(cleared.start, cleared.end, obstacles, options);
  return (
    candidates
      .filter((route) => isConnectorRouteClear(route, obstacles))
      .sort((a, b) => a.score - b.score)[0] ?? null
  );
}

export function repairConnectorTextObstructions<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = resolveLayoutOptions(repairOptions);
  const issues: CriticalSlideLayoutIssue[] = [];
  collectCriticalConnectorTextObstructionIssues(elements, options, issues);
  collectCriticalConnectorObstructionIssues(elements, options, issues);
  const lineIndexesToRepair = new Set(
    issues
      .filter(
        (issue) =>
          issue.type === 'connector-obstructs-text' || issue.type === 'connector-obstructs-content',
      )
      .map((issue) => issue.elementIndexes[0]),
  );

  if (lineIndexesToRepair.size === 0) return elements as T[];

  const nodes = collectConnectorNodes(elements, options);
  let next: T[] | null = null;

  lineIndexesToRepair.forEach((lineIndex) => {
    const element = elements[lineIndex];
    if (!element || !isArrowConnector(element)) return;
    const endpoints = getLineAbsoluteEndpoints(element);
    if (!endpoints) return;

    const { startNode, endNode } = getConnectorRouteNodes(nodes, endpoints);
    const obstacles = collectConnectorObstacles(elements, lineIndex, startNode, endNode, options);
    const route = chooseConnectorRoute(element, endpoints, nodes, obstacles, options);
    if (!route) return;

    if (!next) next = elements.map((item) => ({ ...item }));
    next[lineIndex] = updateLineElementWithRoute(next[lineIndex], route);
  });

  return next ?? (elements as T[]);
}

function absolutePointFromLineRecord(
  record: Record<string, unknown>,
  key: string,
  left: number,
  top: number,
): Point | null {
  const point = pointFromArray(record[key]);
  return point ? { x: left + point.x, y: top + point.y } : null;
}

function relativePoint(point: Point, left: number, top: number): [number, number] {
  return [roundToTenth(point.x - left), roundToTenth(point.y - top)];
}

function hasLineControlPoints(record: Record<string, unknown>): boolean {
  return !!(record.broken || record.broken2 || record.curve || record.cubic);
}

function expandShortArrowLineEndpoints(
  element: SlideLayoutElement,
  start: Point,
  end: Point,
  record: Record<string, unknown>,
): { start: Point; end: Point } {
  if (!isArrowConnector(element) || hasLineControlPoints(record)) {
    return { start, end };
  }

  const length = distance(start, end);
  if (length >= ARROW_MIN_RENDER_LENGTH || length < 0.001) {
    return { start, end };
  }

  const halfExtra = (ARROW_MIN_RENDER_LENGTH - length) / 2;
  const unitX = (end.x - start.x) / length;
  const unitY = (end.y - start.y) / length;

  return {
    start: {
      x: start.x - unitX * halfExtra,
      y: start.y - unitY * halfExtra,
    },
    end: {
      x: end.x + unitX * halfExtra,
      y: end.y + unitY * halfExtra,
    },
  };
}

function repairSingleLineGeometry<T extends SlideLayoutElement>(element: T): T {
  if (element.type !== 'line') return element;

  const record = asRecord(element);
  const left = asFiniteNumber(record.left) ?? 0;
  const top = asFiniteNumber(record.top) ?? 0;
  let start = absolutePointFromLineRecord(record, 'start', left, top);
  let end = absolutePointFromLineRecord(record, 'end', left, top);
  if (!start || !end) return element;

  const controlPoints = [
    absolutePointFromLineRecord(record, 'broken', left, top),
    absolutePointFromLineRecord(record, 'broken2', left, top),
    absolutePointFromLineRecord(record, 'curve', left, top),
    ...(Array.isArray(record.cubic)
      ? record.cubic
          .map((point) => {
            const parsed = pointFromArray(point);
            return parsed ? { x: left + parsed.x, y: top + parsed.y } : null;
          })
          .filter((point): point is Point => !!point)
      : []),
  ].filter((point): point is Point => !!point);
  const expandedEndpoints = expandShortArrowLineEndpoints(element, start, end, record);
  start = expandedEndpoints.start;
  end = expandedEndpoints.end;

  const allPoints = [start, end, ...controlPoints];
  const nextLeft = Math.min(...allPoints.map((point) => point.x));
  const nextTop = Math.min(...allPoints.map((point) => point.y));
  const rawStrokeWidth = asFiniteNumber(record.width) ?? 3;
  const nextStrokeWidth = clamp(rawStrokeWidth, LINE_MIN_STROKE_WIDTH, LINE_MAX_SAFE_STROKE_WIDTH);

  const next = {
    ...element,
    left: roundToTenth(nextLeft),
    top: roundToTenth(nextTop),
    width: roundToTenth(nextStrokeWidth),
    start: relativePoint(start, nextLeft, nextTop),
    end: relativePoint(end, nextLeft, nextTop),
  } as T;

  if (record.broken) {
    const broken = absolutePointFromLineRecord(record, 'broken', left, top);
    if (broken) (next as Record<string, unknown>).broken = relativePoint(broken, nextLeft, nextTop);
  }
  if (record.broken2) {
    const broken2 = absolutePointFromLineRecord(record, 'broken2', left, top);
    if (broken2) {
      (next as Record<string, unknown>).broken2 = relativePoint(broken2, nextLeft, nextTop);
    }
  }
  if (record.curve) {
    const curve = absolutePointFromLineRecord(record, 'curve', left, top);
    if (curve) (next as Record<string, unknown>).curve = relativePoint(curve, nextLeft, nextTop);
  }
  if (Array.isArray(record.cubic)) {
    const cubic = record.cubic
      .map((point) => {
        const parsed = pointFromArray(point);
        return parsed
          ? relativePoint({ x: left + parsed.x, y: top + parsed.y }, nextLeft, nextTop)
          : null;
      })
      .filter((point): point is [number, number] => !!point);
    if (cubic.length === 2) (next as Record<string, unknown>).cubic = cubic;
  }

  return next;
}

export function repairLineElementGeometry<T extends SlideLayoutElement>(
  elements: readonly T[],
): T[] {
  let changed = false;
  const repaired = elements.map((element) => {
    const next = repairSingleLineGeometry(element);
    if (next !== element) {
      changed = true;
    }
    return next;
  });

  return changed ? repaired : [...elements];
}

function collectCriticalConnectorObstructionIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const canvasArea = options.canvasWidth * options.canvasHeight;

  elements.forEach((element, lineIndex) => {
    if (!isArrowConnector(element)) return;
    const segments = getLinePathSegments(element, lineIndex);
    if (segments.length === 0) return;
    const endpoints = getLineAbsoluteEndpoints(element);

    elements.forEach((candidate, candidateIndex) => {
      if (candidateIndex === lineIndex || candidate.type === 'line') return;

      const rect = rectFromElement(candidate);
      if (!rect || !isVisibleLayoutElement(candidate, rect, options)) return;
      if (isCanvasBackground(rect, options)) return;
      if (isLikelyBackdropPanel(elements, candidateIndex, rect, options)) return;
      if (rectArea(rect) >= canvasArea * 0.35 && !hasElementText(candidate)) return;
      if (rectWidth(rect) < 40 || rectHeight(rect) < 24) return;
      if (
        endpoints &&
        (distancePointToRect(endpoints.start, rect) <= CRITICAL_CONNECTOR_ENDPOINT_TOLERANCE ||
          distancePointToRect(endpoints.end, rect) <= CRITICAL_CONNECTOR_ENDPOINT_TOLERANCE)
      ) {
        return;
      }

      const interior = insetRect(rect, CRITICAL_CONNECTOR_INTERIOR_PADDING);
      if (
        !interior ||
        !segments.some((segment) => segmentIntersectsRect(segment.start, segment.end, interior))
      ) {
        return;
      }

      pushCriticalIssue(issues, {
        type: 'connector-obstructs-content',
        elementIndexes: [lineIndex, candidateIndex],
        message: `Connector ${getElementLabel(
          element,
          lineIndex,
        )} crosses content ${getElementLabel(candidate, candidateIndex)}`,
      });
    });
  });
}

interface LowDensityCardCandidate {
  readonly index: number;
  readonly rect: Rect;
  readonly textRect: Rect | null;
}

interface ContainedTextItem {
  readonly index: number;
  readonly rect: Rect;
  readonly text: string;
}

function collectContainedTextRects<T extends SlideLayoutElement>(
  elements: readonly T[],
  cardIndex: number,
  cardRect: Rect,
): Rect[] {
  return collectContainedTextItems(elements, cardIndex, cardRect).map((item) => item.rect);
}

function collectContainedTextItems<T extends SlideLayoutElement>(
  elements: readonly T[],
  cardIndex: number,
  cardRect: Rect,
): ContainedTextItem[] {
  return elements
    .map((candidate, candidateIndex) => {
      if (candidateIndex === cardIndex || candidate.type !== 'text') return null;
      const text = getElementText(candidate);
      if (!text) return null;
      const candidateRect = rectFromElement(candidate);
      if (!candidateRect) return null;
      return containsRect(cardRect, candidateRect, 12)
        ? { index: candidateIndex, rect: candidateRect, text }
        : null;
    })
    .filter((item): item is ContainedTextItem => !!item);
}

function isLowDensityCardCandidate<T extends SlideLayoutElement>(
  elements: readonly T[],
  index: number,
  options: Required<LayoutRepairOptions>,
): LowDensityCardCandidate | null {
  const element = elements[index];
  if (!element || element.type !== 'shape') return null;
  const rect = rectFromElement(element);
  if (!rect) return null;
  if (hasElementText(element) || !hasVisibleFill(element) || !hasVisibleOpacity(element)) {
    return null;
  }
  if (isCanvasBackground(rect, options)) return null;

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  if (
    width < LOW_DENSITY_THREE_CARD_MIN_WIDTH ||
    width > LOW_DENSITY_THREE_CARD_MAX_WIDTH ||
    height < LOW_DENSITY_THREE_CARD_MIN_HEIGHT ||
    height > LOW_DENSITY_THREE_CARD_MAX_HEIGHT
  ) {
    return null;
  }

  const textRects = collectContainedTextRects(elements, index, rect);
  const textRect = textRects.length > 0 ? unionRects(textRects) : null;
  return { index, rect, textRect };
}

function cardHasLowInformationDensity(candidate: LowDensityCardCandidate): boolean {
  if (!candidate.textRect) return true;

  const cardHeight = rectHeight(candidate.rect);
  const textTopGap = candidate.textRect.top - candidate.rect.top;
  const textHeight = rectHeight(candidate.textRect);

  return (
    textTopGap >= cardHeight * LOW_DENSITY_THREE_CARD_TEXT_TOP_GAP_RATIO &&
    textHeight <= cardHeight * LOW_DENSITY_THREE_CARD_TEXT_HEIGHT_RATIO
  );
}

function collectCriticalLowDensityThreeCardIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const candidates = elements
    .map((_, index) => isLowDensityCardCandidate(elements, index, options))
    .filter((candidate): candidate is LowDensityCardCandidate => !!candidate)
    .sort((a, b) => a.rect.left - b.rect.left);

  if (candidates.length < LOW_DENSITY_THREE_CARD_MIN_COUNT) return;

  for (let start = 0; start <= candidates.length - LOW_DENSITY_THREE_CARD_MIN_COUNT; start += 1) {
    const group = candidates.slice(start, start + LOW_DENSITY_THREE_CARD_MIN_COUNT);
    const tops = group.map((candidate) => candidate.rect.top);
    const topSpread = Math.max(...tops) - Math.min(...tops);
    if (topSpread > LOW_DENSITY_THREE_CARD_TOP_MAX_SPREAD) continue;
    if (!group.every(cardHasLowInformationDensity)) continue;

    pushCriticalIssue(issues, {
      type: 'low-density-three-card-layout',
      elementIndexes: group.map((candidate) => candidate.index),
      message: 'Three-card layout uses oversized cards with sparse, bottom-heavy content',
    });
    return;
  }
}

interface LegacyTaskGridCardCandidate {
  readonly index: number;
  readonly rect: Rect;
  readonly textRect: Rect;
  readonly textUnits: number;
}

function isLegacyTaskGridCardCandidate<T extends SlideLayoutElement>(
  elements: readonly T[],
  index: number,
  options: Required<LayoutRepairOptions>,
): LegacyTaskGridCardCandidate | null {
  const element = elements[index];
  if (!element || element.type !== 'shape') return null;
  const rect = rectFromElement(element);
  if (!rect) return null;
  if (hasElementText(element) || !hasVisibleFill(element) || !hasVisibleOpacity(element)) {
    return null;
  }
  if (isCanvasBackground(rect, options) || isLikelyBackdropPanel(elements, index, rect, options)) {
    return null;
  }

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  if (
    width < LEGACY_TASK_GRID_MIN_CARD_WIDTH ||
    width > LEGACY_TASK_GRID_MAX_CARD_WIDTH ||
    height < LEGACY_TASK_GRID_MIN_CARD_HEIGHT ||
    height > LEGACY_TASK_GRID_MAX_CARD_HEIGHT
  ) {
    return null;
  }

  const textItems = collectContainedTextItems(elements, index, rect);
  if (textItems.length === 0) return null;

  const textRect = unionRects(textItems.map((item) => item.rect));
  const textUnits = textItems.reduce((total, item) => total + visualTextLength(item.text), 0);
  if (textUnits > LEGACY_TASK_GRID_MAX_TEXT_UNITS) return null;
  if (rectHeight(textRect) > height * LEGACY_TASK_GRID_MAX_TEXT_HEIGHT_RATIO) return null;

  return { index, rect, textRect, textUnits };
}

function findLegacyTaskGridGroup(
  candidates: readonly LegacyTaskGridCardCandidate[],
): LegacyTaskGridCardCandidate[] | null {
  if (candidates.length < LEGACY_TASK_GRID_MIN_CARD_COUNT) return null;

  const rows: LegacyTaskGridCardCandidate[][] = [];
  candidates
    .slice()
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    .forEach((candidate) => {
      const row = rows.find(
        (existing) =>
          Math.abs(existing[0].rect.top - candidate.rect.top) <=
          LEGACY_TASK_GRID_ROW_TOP_TOLERANCE,
      );
      if (row) {
        row.push(candidate);
      } else {
        rows.push([candidate]);
      }
    });

  for (let firstRowIndex = 0; firstRowIndex < rows.length; firstRowIndex += 1) {
    for (let secondRowIndex = firstRowIndex + 1; secondRowIndex < rows.length; secondRowIndex += 1) {
      const firstRow = rows[firstRowIndex].slice().sort((a, b) => a.rect.left - b.rect.left);
      const secondRow = rows[secondRowIndex].slice().sort((a, b) => a.rect.left - b.rect.left);
      if (firstRow.length !== 2 || secondRow.length !== 2) continue;

      const firstRowBottom = Math.max(...firstRow.map((candidate) => candidate.rect.bottom));
      const secondRowTop = Math.min(...secondRow.map((candidate) => candidate.rect.top));
      if (secondRowTop - firstRowBottom < LEGACY_TASK_GRID_MIN_ROW_GAP) continue;

      const firstGap = firstRow[1].rect.left - firstRow[0].rect.right;
      const secondGap = secondRow[1].rect.left - secondRow[0].rect.right;
      if (
        firstGap < LEGACY_TASK_GRID_MIN_COLUMN_GAP ||
        secondGap < LEGACY_TASK_GRID_MIN_COLUMN_GAP
      ) {
        continue;
      }

      const columnsAlign =
        Math.abs(rectCenter(firstRow[0].rect).x - rectCenter(secondRow[0].rect).x) <=
          LEGACY_TASK_GRID_COLUMN_CENTER_TOLERANCE &&
        Math.abs(rectCenter(firstRow[1].rect).x - rectCenter(secondRow[1].rect).x) <=
          LEGACY_TASK_GRID_COLUMN_CENTER_TOLERANCE;
      if (!columnsAlign) continue;

      return [...firstRow, ...secondRow];
    }
  }

  return null;
}

function isLegacyTaskGridDecorativeDot<T extends SlideLayoutElement>(
  element: T,
  rect: Rect,
  gridRects: readonly Rect[],
  options: Required<LayoutRepairOptions>,
): boolean {
  if (element.type !== 'shape') return false;
  if (hasElementText(element) || !hasVisibleFill(element) || !hasVisibleOpacity(element)) {
    return false;
  }
  if (isCanvasBackground(rect, options)) return false;

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  const maxSide = Math.max(width, height);
  const minSide = Math.min(width, height);
  if (
    minSide < LEGACY_TASK_GRID_DOT_MIN_SIDE ||
    maxSide > LEGACY_TASK_GRID_DOT_MAX_SIDE ||
    maxSide / Math.max(1, minSide) > 1.8
  ) {
    return false;
  }

  return !gridRects.some((cardRect) => containsRect(cardRect, rect, 4));
}

function hasLegacyTaskGridFooter<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): boolean {
  return elements.some((element) => {
    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return false;
    if (rect.top < options.canvasHeight * LEGACY_TASK_GRID_FOOTER_TOP_RATIO) return false;
    if (rectWidth(rect) < options.canvasWidth * LEGACY_TASK_GRID_FOOTER_MIN_WIDTH_RATIO) {
      return false;
    }
    return rectHeight(rect) <= LEGACY_TASK_GRID_FOOTER_MAX_HEIGHT;
  });
}

function hasLegacyTaskGridDetachedLabel<T extends SlideLayoutElement>(
  elements: readonly T[],
  gridRect: Rect,
  gridIndexes: ReadonlySet<number>,
  options: Required<LayoutRepairOptions>,
): boolean {
  return elements.some((element, index) => {
    if (gridIndexes.has(index)) return false;
    const rect = rectFromElement(element);
    if (!rect || !isVisibleLayoutElement(element, rect, options)) return false;
    if (rect.bottom < gridRect.top - 72 || rect.top > gridRect.top + 8) return false;
    if (rect.left < gridRect.left - 24 || rect.right > gridRect.right + 24) return false;
    if (rectHeight(rect) > LEGACY_TASK_GRID_LABEL_MAX_HEIGHT) return false;
    return rectWidth(rect) >= 100 && rectWidth(rect) <= rectWidth(gridRect) * 0.45;
  });
}

function collectCriticalLegacyTaskGridIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
  issues: CriticalSlideLayoutIssue[],
): void {
  const candidates = elements
    .map((_, index) => isLegacyTaskGridCardCandidate(elements, index, options))
    .filter((candidate): candidate is LegacyTaskGridCardCandidate => !!candidate);
  const gridGroup = findLegacyTaskGridGroup(candidates);
  if (!gridGroup) return;

  const gridRects = gridGroup.map((candidate) => candidate.rect);
  const gridRect = unionRects(gridRects);
  const gridIndexes = new Set(gridGroup.map((candidate) => candidate.index));
  const decorativeDotCount = elements.filter((element, index) => {
    if (gridIndexes.has(index)) return false;
    const rect = rectFromElement(element);
    return !!rect && isLegacyTaskGridDecorativeDot(element, rect, gridRects, options);
  }).length;
  const hasFooter = hasLegacyTaskGridFooter(elements, options);
  const hasDetachedLabel = hasLegacyTaskGridDetachedLabel(elements, gridRect, gridIndexes, options);

  if (decorativeDotCount < 2 && !hasFooter && !hasDetachedLabel) return;

  pushCriticalIssue(issues, {
    type: 'legacy-task-grid-layout',
    elementIndexes: gridGroup.map((candidate) => candidate.index),
    message:
      'Slide uses a legacy four-card task grid with sparse content and template decoration',
  });
}

export function detectCriticalSlideLayoutIssues<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): CriticalSlideLayoutIssue[] {
  const options = resolveLayoutOptions(repairOptions);
  const issues: CriticalSlideLayoutIssue[] = [];

  collectCriticalBoundsIssues(elements, options, issues);
  collectCriticalTableOverlayIssues(elements, options, issues);
  collectCriticalLegacyTaskGridIssues(elements, options, issues);
  collectCriticalLowDensityThreeCardIssues(elements, options, issues);
  collectCriticalTextOverflowIssues(elements, options, issues);
  collectCriticalTextOverlapIssues(elements, options, issues);
  collectCriticalTextOutsideContainerIssues(elements, options, issues);
  collectCriticalBoxTextCenteringIssues(elements, options, issues);
  collectCriticalForegroundBlockOverlapIssues(elements, options, issues);
  collectCriticalNumberedBadgeTextOverlapIssues(elements, options, issues);
  collectCriticalConnectorTextObstructionIssues(elements, options, issues);
  collectCriticalConnectorObstructionIssues(elements, options, issues);

  return issues;
}

export function repairSlideElementLayout<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const lineGeometryRepairedElements = repairLineElementGeometry(elements);
  const tableCaptionRepairedElements = repairTableCaptionOverlayLayout(
    lineGeometryRepairedElements,
    repairOptions,
  );
  const containedShapeRepairedElements = repairContainedShapeBounds(
    tableCaptionRepairedElements,
    repairOptions,
  );
  const darkPanelRepairedElements = repairIntrusiveDarkPanels(
    containedShapeRepairedElements,
    repairOptions,
  );
  const overlapRepairedElements = repairTopLevelSlideOverlaps(
    darkPanelRepairedElements,
    repairOptions,
  );
  const cardTextRepairedElements = repairCardTextOverlayLayout(
    overlapRepairedElements,
    repairOptions,
  );
  const shortLabelRepairedElements = repairShortLabelBoxAlignment(
    cardTextRepairedElements,
    repairOptions,
  );
  const stepFlowRepairedElements = repairStepFlowDiagramLayout(
    shortLabelRepairedElements,
    repairOptions,
  );
  const timelineRepairedElements = repairTimelineDiagramLayout(
    stepFlowRepairedElements,
    repairOptions,
  );
  const connectorLineRepairedElements = repairConnectorLineLayout(
    timelineRepairedElements,
    repairOptions,
  );
  return repairConnectorTextObstructions(connectorLineRepairedElements, repairOptions);
}

interface TriadNode {
  readonly indexes: number[];
  readonly primaryIndex: number;
  readonly rect: Rect;
  readonly text: string;
}

interface TriadNodes {
  readonly top: TriadNode;
  readonly left: TriadNode;
  readonly right: TriadNode;
}

interface TriadLine {
  readonly index: number;
  readonly start: Point;
  readonly end: Point;
  readonly midpoint: Point;
  readonly length: number;
  readonly touchCount: number;
}

type TriadPair = 'leftTop' | 'topRight' | 'leftRight';

function getShapeTextContent(element: SlideLayoutElement): string {
  const text = asRecord(element).text;
  if (text === null || text === undefined) return '';
  if (typeof text === 'string') return text;
  if (typeof text !== 'object') return '';
  const content = (text as Record<string, unknown>).content;
  return typeof content === 'string' ? content : '';
}

function getNormalizedElementText(element: SlideLayoutElement): string {
  return getElementText(element).replace(/\s+/g, '').trim();
}

function getComparableText(value: string): string {
  return stripHtmlToText(value)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function hasCjkText(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}

function isMeaningfulContainedDuplicate(shorter: string, longer: string): boolean {
  if (!longer.includes(shorter)) return false;
  if (hasCjkText(shorter)) return visualTextLength(shorter) >= 2 && visualTextLength(longer) <= 18;
  return shorter.length >= 3 && visualTextLength(longer) <= 36;
}

function looksLikeDuplicateCardText(shapeText: string, overlayText: string): boolean {
  const normalizedShapeText = getComparableText(shapeText);
  const normalizedOverlayText = getComparableText(overlayText);
  if (!normalizedShapeText || !normalizedOverlayText) return false;
  if (normalizedShapeText === normalizedOverlayText) return true;

  const [shorter, longer] =
    normalizedShapeText.length <= normalizedOverlayText.length
      ? [normalizedShapeText, normalizedOverlayText]
      : [normalizedOverlayText, normalizedShapeText];
  return isMeaningfulContainedDuplicate(shorter, longer);
}

function isTextOverlayShape(
  element: SlideLayoutElement,
  rect: Rect,
  options: Required<LayoutRepairOptions>,
): boolean {
  if (element.type !== 'shape') return false;
  if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return false;
  if (isCanvasBackground(rect, options)) return false;

  const width = rectWidth(rect);
  const height = rectHeight(rect);
  return (
    width >= CARD_TEXT_OVERLAY_MIN_WIDTH &&
    height >= CARD_TEXT_OVERLAY_MIN_HEIGHT &&
    width <= options.canvasWidth * CARD_TEXT_OVERLAY_MAX_WIDTH_RATIO &&
    height <= Math.min(CARD_TEXT_OVERLAY_MAX_HEIGHT, options.canvasHeight * 0.48)
  );
}

function isContainedOverlayText(shapeRect: Rect, textRect: Rect): boolean {
  const textCenter = rectCenter(textRect);
  if (!pointInExpandedRect(textCenter, shapeRect, CARD_TEXT_OVERLAY_CENTER_TOLERANCE)) {
    return false;
  }

  const textArea = rectArea(textRect);
  if (textArea <= 0) return false;

  return overlapArea(shapeRect, textRect) / textArea >= CARD_TEXT_OVERLAY_MIN_TEXT_OVERLAP_RATIO;
}

/**
 * Removes duplicated card text when a filled shape renders `shape.text` and a
 * separate centered TextElement for the same label. Keeping the TextElement
 * preserves action references while preventing the visual label from drawing
 * twice on old and newly generated pages.
 */
export function repairCardTextOverlayLayout<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };

  let next: T[] | null = null;

  elements.forEach((element, shapeIndex) => {
    const shapeRect = rectFromElement(element);
    if (!shapeRect || !isTextOverlayShape(element, shapeRect, options)) return;

    const shapeText = stripHtmlToText(getShapeTextContent(element));
    if (!shapeText) return;

    const hasDuplicateOverlayText = elements.some((candidate, candidateIndex) => {
      if (candidateIndex === shapeIndex || candidate.type !== 'text') return false;

      const textRect = rectFromElement(candidate);
      if (!textRect || !isContainedOverlayText(shapeRect, textRect)) return false;

      const overlayText = stripHtmlToText(getElementContent(candidate));
      return looksLikeDuplicateCardText(shapeText, overlayText);
    });

    if (!hasDuplicateOverlayText) return;
    if (!next) next = elements.map((item) => ({ ...item }));

    const updated = { ...next[shapeIndex] } as T;
    delete (updated as Record<string, unknown>).text;
    next[shapeIndex] = updated;
  });

  return next ?? (elements as T[]);
}

function isShortLabelBox(element: SlideLayoutElement, rect: Rect): boolean {
  if (element.type !== 'shape' && element.type !== 'text') return false;
  if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return false;
  if (isDarkFill(element)) return false;
  if (
    rectWidth(rect) < SHORT_LABEL_BOX_MIN_WIDTH ||
    rectHeight(rect) > SHORT_LABEL_BOX_MAX_HEIGHT
  ) {
    return false;
  }

  const html = element.type === 'shape' ? getShapeTextContent(element) : getElementContent(element);
  if (!html) return true;
  if (htmlHasBadgeTextReservation(html)) return false;

  return shouldAutoCenterBoxText({
    html,
    boxWidth: rectWidth(rect),
    boxHeight: rectHeight(rect),
  });
}

function centeredShapeText<T extends SlideLayoutElement>(element: T, html: string): T {
  const next = setElementTextContent(element, ensureCenteredParagraphText(html));
  const record = asRecord(next);
  const shapeText = typeof record.text === 'object' && record.text !== null ? record.text : {};

  return {
    ...next,
    text: {
      ...shapeText,
      align: 'middle',
    },
  } as T;
}

function isShortLabelOverlayText(
  shapeRect: Rect,
  textElement: SlideLayoutElement,
  textRect: Rect,
): boolean {
  const html = getElementContent(textElement);
  if (!html || htmlHasBadgeTextReservation(html)) return false;
  if (hasExplicitTextAlign(html) && !hasCenteredTextAlign(html)) return false;
  if (!isContainedOverlayText(shapeRect, textRect) && !containsRect(shapeRect, textRect, 18)) {
    return false;
  }

  return shouldAutoCenterBoxText({
    html,
    boxWidth: rectWidth(shapeRect),
    boxHeight: rectHeight(shapeRect),
    textWidth: rectWidth(textRect),
    textHeight: rectHeight(textRect),
  });
}

export function repairShortLabelBoxAlignment<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = resolveLayoutOptions(repairOptions);
  let next: T[] | null = null;
  const repairedTextIndexes = new Set<number>();

  elements.forEach((element, index) => {
    const rect = rectFromElement(element);
    if (!rect || isCanvasBackground(rect, options)) return;

    if (element.type === 'shape' && isShortLabelBox(element, rect)) {
      const html = getShapeTextContent(element);
      const textRecord = asRecord(element).text;
      const textAlign =
        typeof textRecord === 'object' && textRecord !== null
          ? (textRecord as Record<string, unknown>).align
          : undefined;
      if (html && (!hasCenteredTextAlign(html) || textAlign !== 'middle')) {
        next ??= elements.map((item) => ({ ...item }));
        next[index] = centeredShapeText(next[index], html);
      }
    }

    if (element.type === 'text' && isShortLabelBox(element, rect)) {
      const html = getElementContent(element);
      if (html && !hasCenteredTextAlign(html)) {
        next ??= elements.map((item) => ({ ...item }));
        next[index] = setElementTextContent(next[index], ensureCenteredParagraphText(html));
        repairedTextIndexes.add(index);
      }
    }
  });

  elements.forEach((shape, shapeIndex) => {
    const shapeRect = rectFromElement(shape);
    if (!shapeRect || shape.type !== 'shape' || !isShortLabelBox(shape, shapeRect)) return;

    elements.forEach((textElement, textIndex) => {
      if (textIndex === shapeIndex || textElement.type !== 'text') return;
      const textRect = rectFromElement(textElement);
      if (!textRect || !isShortLabelOverlayText(shapeRect, textElement, textRect)) return;

      next ??= elements.map((item) => ({ ...item }));
      const html = getElementContent(next[textIndex]);
      next[textIndex] = {
        ...next[textIndex],
        ...rectToProps(shapeRect),
        content: ensureCenteredParagraphText(html),
      };
      repairedTextIndexes.add(textIndex);
    });
  });

  elements.forEach((textElement, textIndex) => {
    if (repairedTextIndexes.has(textIndex) || textElement.type !== 'text') return;
    const textRect = rectFromElement(textElement);
    if (!textRect) return;

    const backingShape = findShortLabelBackingShape(elements, textIndex, textRect, options);
    if (!backingShape) return;

    next ??= elements.map((item) => ({ ...item }));
    const html = getElementContent(next[textIndex]);
    const shouldFillBackingShape = isShortLabelBox(elements[backingShape.index], backingShape.rect);
    const nextRect = shouldFillBackingShape
      ? backingShape.rect
      : {
          left: backingShape.rect.left + (rectWidth(backingShape.rect) - rectWidth(textRect)) / 2,
          top: backingShape.rect.top + (rectHeight(backingShape.rect) - rectHeight(textRect)) / 2,
          right:
            backingShape.rect.left +
            (rectWidth(backingShape.rect) + rectWidth(textRect)) / 2,
          bottom:
            backingShape.rect.top +
            (rectHeight(backingShape.rect) + rectHeight(textRect)) / 2,
        };
    next[textIndex] = {
      ...next[textIndex],
      ...rectToProps(nextRect),
      content: ensureCenteredParagraphText(html),
    };
  });

  return next ?? (elements as T[]);
}

export function normalizeVisibleSlideLayout<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  return repairShortLabelBoxAlignment(elements, repairOptions);
}

function isShortTriadLabelText(text: string): boolean {
  if (!text || visualTextLength(text) > 6) return false;
  if (/^[\d.]+$/.test(text)) return false;
  if (/[，,。；;：:！？!?、]/.test(text)) return false;
  return /[\p{L}\u3400-\u9fff]/u.test(text);
}

function findBackingShapeIndex<T extends SlideLayoutElement>(
  elements: readonly T[],
  textIndex: number,
  textRect: Rect,
): number | null {
  const textCenter = rectCenter(textRect);

  let bestIndex: number | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  elements.forEach((candidate, index) => {
    if (index === textIndex || candidate.type !== 'shape') return;
    if (hasElementText(candidate) || !hasVisibleFill(candidate) || !hasVisibleOpacity(candidate)) {
      return;
    }

    const rect = rectFromElement(candidate);
    if (!rect) return;
    if (rectWidth(rect) > 280 || rectHeight(rect) > 140) return;
    if (!pointInExpandedRect(textCenter, rect, 10)) return;

    const area = rectArea(rect);
    if (area < bestArea) {
      bestIndex = index;
      bestArea = area;
    }
  });

  return bestIndex;
}

function collectTriadNodeCandidates<T extends SlideLayoutElement>(
  elements: readonly T[],
): TriadNode[] {
  const candidates: TriadNode[] = [];

  elements.forEach((element, index) => {
    if (element.type !== 'shape' && element.type !== 'text') return;

    const rect = rectFromElement(element);
    if (!rect) return;
    if (rectWidth(rect) > 280 || rectHeight(rect) > 150) return;

    const text = getNormalizedElementText(element);
    if (!isShortTriadLabelText(text)) return;

    if (element.type === 'shape') {
      if (!hasElementText(element) || !hasVisibleFill(element)) return;
      candidates.push({
        indexes: [index],
        primaryIndex: index,
        rect,
        text,
      });
      return;
    }

    const backingShapeIndex = findBackingShapeIndex(elements, index, rect);
    const indexes = backingShapeIndex === null ? [index] : [backingShapeIndex, index].sort();
    const groupRects = indexes.map((groupIndex) => rectFromElement(elements[groupIndex]));
    const groupRect = unionRects(groupRects.filter((item): item is Rect => !!item));
    candidates.push({
      indexes,
      primaryIndex: index,
      rect: groupRect,
      text,
    });
  });

  return candidates;
}

function nodesOverlap(first: TriadNode, second: TriadNode): boolean {
  return first.indexes.some((index) => second.indexes.includes(index));
}

function scoreTriadNodes(nodes: readonly [TriadNode, TriadNode, TriadNode]): number | null {
  const sortedByY = [...nodes].sort((a, b) => rectCenter(a.rect).y - rectCenter(b.rect).y);
  const top = sortedByY[0];
  const bottom = sortedByY.slice(1).sort((a, b) => rectCenter(a.rect).x - rectCenter(b.rect).x);
  const left = bottom[0];
  const right = bottom[1];

  const topCenter = rectCenter(top.rect);
  const leftCenter = rectCenter(left.rect);
  const rightCenter = rectCenter(right.rect);
  const bottomMidX = (leftCenter.x + rightCenter.x) / 2;
  const bottomMidY = (leftCenter.y + rightCenter.y) / 2;
  const xSpan = rightCenter.x - leftCenter.x;
  const ySpan = bottomMidY - topCenter.y;
  const bottomYDiff = Math.abs(leftCenter.y - rightCenter.y);
  const topOffset = Math.abs(topCenter.x - bottomMidX);

  if (xSpan < 250 || ySpan < 130 || bottomYDiff > 150 || topOffset > 230) return null;

  return xSpan * 0.8 + ySpan * 1.2 - bottomYDiff * 1.5 - topOffset * 0.55;
}

function chooseTriadNodes(candidates: readonly TriadNode[]): TriadNodes | null {
  let best: { nodes: [TriadNode, TriadNode, TriadNode]; score: number } | null = null;

  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      for (let third = second + 1; third < candidates.length; third += 1) {
        const nodes: [TriadNode, TriadNode, TriadNode] = [
          candidates[first],
          candidates[second],
          candidates[third],
        ];
        if (
          nodesOverlap(nodes[0], nodes[1]) ||
          nodesOverlap(nodes[0], nodes[2]) ||
          nodesOverlap(nodes[1], nodes[2])
        ) {
          continue;
        }

        const score = scoreTriadNodes(nodes);
        if (score === null) continue;
        if (!best || score > best.score) best = { nodes, score };
      }
    }
  }

  if (!best || best.score < 260) return null;

  const sortedByY = [...best.nodes].sort((a, b) => rectCenter(a.rect).y - rectCenter(b.rect).y);
  const bottom = sortedByY.slice(1).sort((a, b) => rectCenter(a.rect).x - rectCenter(b.rect).x);
  return {
    top: sortedByY[0],
    left: bottom[0],
    right: bottom[1],
  };
}

function pointFromArray(value: unknown): Point | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = asFiniteNumber(value[0]);
  const y = asFiniteNumber(value[1]);
  if (x === null || y === null) return null;
  return { x, y };
}

function getAbsoluteLineSegment(
  element: SlideLayoutElement,
  index: number,
): Omit<TriadLine, 'touchCount'> | null {
  if (element.type !== 'line') return null;

  const record = asRecord(element);
  if (record.broken || record.broken2 || record.curve || record.cubic) return null;

  const left = asFiniteNumber(record.left) ?? 0;
  const top = asFiniteNumber(record.top) ?? 0;
  const start = pointFromArray(record.start);
  const end = pointFromArray(record.end);
  if (!start || !end) return null;

  const absoluteStart = { x: left + start.x, y: top + start.y };
  const absoluteEnd = { x: left + end.x, y: top + end.y };
  const length = distance(absoluteStart, absoluteEnd);
  if (length < 150) return null;

  return {
    index,
    start: absoluteStart,
    end: absoluteEnd,
    midpoint: {
      x: (absoluteStart.x + absoluteEnd.x) / 2,
      y: (absoluteStart.y + absoluteEnd.y) / 2,
    },
    length,
  };
}

interface TimelineNode {
  readonly index: number;
  readonly rect: Rect;
  readonly center: Point;
  readonly radius: number;
}

interface TimelineTextCandidate {
  readonly index: number;
  readonly rect: Rect;
  readonly text: string;
}

interface TimelineCandidate {
  readonly line: Omit<TriadLine, 'touchCount'>;
  readonly nodes: TimelineNode[];
}

function isHorizontalTimelineLine(
  line: Omit<TriadLine, 'touchCount'>,
  options: Required<LayoutRepairOptions>,
): boolean {
  const dy = Math.abs(line.start.y - line.end.y);
  if (line.length < options.canvasWidth * 0.35) return false;
  if (dy > Math.max(5, line.length * 0.025)) return false;
  return line.midpoint.y >= options.safeMargin && line.midpoint.y <= options.canvasHeight;
}

function collectTimelineNodes<T extends SlideLayoutElement>(
  elements: readonly T[],
  line: Omit<TriadLine, 'touchCount'>,
): TimelineNode[] {
  const lineLeft = Math.min(line.start.x, line.end.x);
  const lineRight = Math.max(line.start.x, line.end.x);
  const lineY = line.midpoint.y;

  return elements
    .map((element, index) => {
      const rect = rectFromElement(element);
      if (!rect || !isCircleLikeShape(element, rect)) return null;

      const center = rectCenter(rect);
      if (center.x < lineLeft - 28 || center.x > lineRight + 28) return null;
      const radius = Math.max(rectWidth(rect), rectHeight(rect)) / 2;
      if (Math.abs(center.y - lineY) > Math.max(22, radius + 12)) return null;

      return {
        index,
        rect,
        center,
        radius,
      };
    })
    .filter((node): node is TimelineNode => !!node)
    .sort((a, b) => a.center.x - b.center.x);
}

function findTimelineCandidate<T extends SlideLayoutElement>(
  elements: readonly T[],
  options: Required<LayoutRepairOptions>,
): TimelineCandidate | null {
  return elements
    .map((element, index) => getAbsoluteLineSegment(element, index))
    .filter((line): line is Omit<TriadLine, 'touchCount'> => !!line)
    .filter((line) => isHorizontalTimelineLine(line, options))
    .map((line) => ({
      line,
      nodes: collectTimelineNodes(elements, line),
    }))
    .filter((candidate) => candidate.nodes.length >= TIMELINE_MIN_NODE_COUNT)
    .sort((a, b) => b.nodes.length - a.nodes.length || b.line.length - a.line.length)[0];
}

function isTimelineNodeLabelText(text: string): boolean {
  if (!text) return false;
  if (visualTextLength(text) > TIMELINE_NODE_LABEL_MAX_UNITS) return false;
  if (/[，,。；;：:！？!?、]/u.test(text)) return false;
  if (/^\d+$/u.test(text)) return false;
  return /[\p{L}\u3400-\u9fff]/u.test(text);
}

function collectTimelineTextCandidates<T extends SlideLayoutElement>(
  elements: readonly T[],
  line: Omit<TriadLine, 'touchCount'>,
  options: Required<LayoutRepairOptions>,
): TimelineTextCandidate[] {
  const lineLeft = Math.min(line.start.x, line.end.x);
  const lineRight = Math.max(line.start.x, line.end.x);

  return elements
    .map((element, index) => {
      if (element.type !== 'text' && element.type !== 'shape') return null;

      const rect = rectFromElement(element);
      if (!rect) return null;
      if (rectWidth(rect) > options.canvasWidth * 0.58) return null;
      if (rectHeight(rect) > 96) return null;
      if (rect.right < lineLeft - 80 || rect.left > lineRight + 80) return null;
      if (Math.abs(rectCenter(rect).y - line.midpoint.y) > TIMELINE_NODE_LABEL_Y_TOLERANCE) {
        return null;
      }

      const text = getNormalizedElementText(element);
      if (!text || text.includes('课堂互动') || text.toLowerCase().includes('interaction')) {
        return null;
      }

      return { index, rect, text };
    })
    .filter((candidate): candidate is TimelineTextCandidate => !!candidate);
}

function textCrossesTimelineLine(rect: Rect, line: Omit<TriadLine, 'touchCount'>): boolean {
  const lineLeft = Math.min(line.start.x, line.end.x);
  const lineRight = Math.max(line.start.x, line.end.x);
  const horizontalOverlap = overlapLength(rect.left, rect.right, lineLeft, lineRight);
  if (horizontalOverlap < Math.min(28, rectWidth(rect) * 0.3)) return false;
  return rect.top < line.midpoint.y + 5 && rect.bottom > line.midpoint.y - 5;
}

function centerTextElement<T extends SlideLayoutElement>(element: T): T {
  if (element.type === 'text') {
    const content = getElementContent(element);
    return content ? setElementTextContent(element, ensureCenteredParagraphText(content)) : element;
  }

  const content = getShapeTextContent(element);
  return content ? setElementTextContent(element, ensureCenteredParagraphText(content)) : element;
}

function assignTimelineNodeLabels(
  nodes: readonly TimelineNode[],
  textCandidates: readonly TimelineTextCandidate[],
): Map<number, TimelineTextCandidate> {
  const usedTextIndexes = new Set<number>();
  const assignments = new Map<number, TimelineTextCandidate>();

  nodes.forEach((node) => {
    const label = textCandidates
      .filter((candidate) => !usedTextIndexes.has(candidate.index))
      .filter((candidate) => isTimelineNodeLabelText(candidate.text))
      .map((candidate) => {
        const center = rectCenter(candidate.rect);
        const dx = Math.abs(center.x - node.center.x);
        const dy = Math.abs(center.y - node.center.y);
        return {
          candidate,
          dx,
          dy,
          score: dx + dy * 0.35,
        };
      })
      .filter(
        (item) =>
          item.dx <= TIMELINE_NODE_LABEL_X_TOLERANCE && item.dy <= TIMELINE_NODE_LABEL_Y_TOLERANCE,
      )
      .sort((a, b) => a.score - b.score)[0]?.candidate;

    if (!label) return;
    usedTextIndexes.add(label.index);
    assignments.set(node.index, label);
  });

  return assignments;
}

function scoreTimelineTextPlacement<T extends SlideLayoutElement>(
  elements: readonly T[],
  movingIndex: number,
  rect: Rect,
): number {
  return elements.reduce((score, element, index) => {
    if (index === movingIndex) return score;
    if (element.type !== 'text' && element.type !== 'shape') return score;
    const otherRect = rectFromElement(element);
    if (!otherRect) return score;
    return score + overlapArea(rect, otherRect);
  }, 0);
}

function chooseTimelineTextTop<T extends SlideLayoutElement>(
  elements: readonly T[],
  movingIndex: number,
  rect: Rect,
  line: Omit<TriadLine, 'touchCount'>,
  nodes: readonly TimelineNode[],
  options: Required<LayoutRepairOptions>,
): number {
  const nodeRadius = Math.max(...nodes.map((node) => node.radius), 0);
  const aboveTop = clamp(
    line.midpoint.y - nodeRadius - TIMELINE_LINE_CLEARANCE - rectHeight(rect),
    options.safeMargin,
    options.canvasHeight - options.safeMargin - rectHeight(rect),
  );
  const belowTop = clamp(
    line.midpoint.y + nodeRadius + TIMELINE_LINE_CLEARANCE,
    options.safeMargin,
    options.canvasHeight - options.safeMargin - rectHeight(rect),
  );

  const aboveRect = shiftRect(rect, 0, aboveTop - rect.top);
  const belowRect = shiftRect(rect, 0, belowTop - rect.top);
  const aboveScore = scoreTimelineTextPlacement(elements, movingIndex, aboveRect);
  const belowScore = scoreTimelineTextPlacement(elements, movingIndex, belowRect);
  if (aboveScore !== belowScore) return aboveScore < belowScore ? aboveTop : belowTop;
  return rectCenter(rect).y <= line.midpoint.y ? aboveTop : belowTop;
}

/**
 * Repairs generated horizontal timeline/process-line diagrams. The detector is
 * intentionally narrow: it requires one long horizontal line and at least three
 * circle-like nodes on that line before it moves any labels.
 */
export function repairTimelineDiagramLayout<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };
  const timeline = findTimelineCandidate(elements, options);
  if (!timeline) return elements as T[];

  const textCandidates = collectTimelineTextCandidates(elements, timeline.line, options);
  const assignments = assignTimelineNodeLabels(timeline.nodes, textCandidates);
  let next: T[] | null = null;
  const movedTextIndexes = new Set<number>();

  timeline.nodes.forEach((node) => {
    const label = assignments.get(node.index);
    if (!label) return;
    if (!next) next = elements.map((element) => ({ ...element }));

    const labelWidth = rectWidth(label.rect);
    const labelHeight = rectHeight(label.rect);
    const centeredLeft = clamp(
      node.center.x - labelWidth / 2,
      options.safeMargin,
      options.canvasWidth - options.safeMargin - labelWidth,
    );
    let top = label.rect.top;
    if (textCrossesTimelineLine(label.rect, timeline.line)) {
      const placeAbove = rectCenter(label.rect).y <= timeline.line.midpoint.y;
      top = placeAbove
        ? timeline.line.midpoint.y - node.radius - TIMELINE_LINE_CLEARANCE - labelHeight
        : timeline.line.midpoint.y + node.radius + TIMELINE_LINE_CLEARANCE;
      top = clamp(top, options.safeMargin, options.canvasHeight - options.safeMargin - labelHeight);
    }

    next[label.index] = centerTextElement({
      ...next[label.index],
      left: roundToTenth(centeredLeft),
      top: roundToTenth(top),
    });
    movedTextIndexes.add(label.index);
  });

  const sourceForCrossing = next ?? elements;
  textCandidates.forEach((candidate) => {
    if (movedTextIndexes.has(candidate.index)) return;
    const currentRect = rectFromElement(sourceForCrossing[candidate.index]) ?? candidate.rect;
    if (!textCrossesTimelineLine(currentRect, timeline.line)) return;
    if (!next) next = elements.map((element) => ({ ...element }));

    const top = chooseTimelineTextTop(
      next,
      candidate.index,
      currentRect,
      timeline.line,
      timeline.nodes,
      options,
    );
    next[candidate.index] = centerTextElement({
      ...next[candidate.index],
      top: roundToTenth(top),
    });
  });

  return next ?? (elements as T[]);
}

function lineTouchesNode(line: Omit<TriadLine, 'touchCount'>, node: TriadNode): boolean {
  const center = rectCenter(node.rect);
  const tolerance =
    Math.max(rectWidth(node.rect), rectHeight(node.rect)) * 0.55 + TRIAD_LINE_TOUCH_PADDING;
  return (
    pointInExpandedRect(line.start, node.rect, TRIAD_LINE_TOUCH_PADDING) ||
    pointInExpandedRect(line.end, node.rect, TRIAD_LINE_TOUCH_PADDING) ||
    distancePointToSegment(center, line.start, line.end) <= tolerance
  );
}

function findTriadLines<T extends SlideLayoutElement>(
  elements: readonly T[],
  nodes: TriadNodes,
): TriadLine[] {
  const nodeList = [nodes.top, nodes.left, nodes.right];
  const lines = elements
    .map((element, index) => getAbsoluteLineSegment(element, index))
    .filter((line): line is Omit<TriadLine, 'touchCount'> => !!line)
    .map((line) => ({
      ...line,
      touchCount: nodeList.filter((node) => lineTouchesNode(line, node)).length,
    }))
    .filter((line) => line.touchCount >= 2)
    .sort((a, b) => b.touchCount - a.touchCount || b.length - a.length);

  return lines.slice(0, 3);
}

function angleOfSegment(start: Point, end: Point): number {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return angle < 0 ? angle + Math.PI : angle;
}

function angleDifference(first: number, second: number): number {
  const raw = Math.abs(first - second);
  return Math.min(raw, Math.PI - raw);
}

function lineAssignmentCost(line: TriadLine, start: Point, end: Point): number {
  const desiredMidpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const desiredLength = distance(start, end);
  return (
    distance(line.midpoint, desiredMidpoint) +
    Math.abs(line.length - desiredLength) * 0.18 +
    angleDifference(angleOfSegment(line.start, line.end), angleOfSegment(start, end)) * 160
  );
}

function assignTriadLines(
  lines: readonly [TriadLine, TriadLine, TriadLine],
  targetRects: Record<TriadPair, { start: Rect; end: Rect }>,
): Record<TriadPair, TriadLine> {
  const pairs: TriadPair[] = ['leftTop', 'topRight', 'leftRight'];
  const permutations: Array<[TriadLine, TriadLine, TriadLine]> = [
    [lines[0], lines[1], lines[2]],
    [lines[0], lines[2], lines[1]],
    [lines[1], lines[0], lines[2]],
    [lines[1], lines[2], lines[0]],
    [lines[2], lines[0], lines[1]],
    [lines[2], lines[1], lines[0]],
  ];

  let best = permutations[0];
  let bestCost = Number.POSITIVE_INFINITY;

  permutations.forEach((permutation) => {
    const cost = permutation.reduce((total, line, index) => {
      const pair = pairs[index];
      const rects = targetRects[pair];
      return total + lineAssignmentCost(line, rectCenter(rects.start), rectCenter(rects.end));
    }, 0);

    if (cost < bestCost) {
      best = permutation;
      bestCost = cost;
    }
  });

  return {
    leftTop: best[0],
    topRight: best[1],
    leftRight: best[2],
  };
}

function rectAnchorToward(rect: Rect, target: Point): Point {
  const center = rectCenter(rect);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;

  const scaleX =
    Math.abs(dx) < 0.001 ? Number.POSITIVE_INFINITY : rectWidth(rect) / 2 / Math.abs(dx);
  const scaleY =
    Math.abs(dy) < 0.001 ? Number.POSITIVE_INFINITY : rectHeight(rect) / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function updateLineElement<T extends SlideLayoutElement>(element: T, start: Point, end: Point): T {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const updated = {
    ...element,
    left: roundToTenth(left),
    top: roundToTenth(top),
    start: [roundToTenth(start.x - left), roundToTenth(start.y - top)],
    end: [roundToTenth(end.x - left), roundToTenth(end.y - top)],
  } as T;

  delete (updated as Record<string, unknown>).broken;
  delete (updated as Record<string, unknown>).broken2;
  delete (updated as Record<string, unknown>).curve;
  delete (updated as Record<string, unknown>).cubic;
  return updated;
}

function updateLineElementWithRoute<T extends SlideLayoutElement>(
  element: T,
  route: ConnectorRoute,
): T {
  if (!route.broken || distancePointToSegment(route.broken, route.start, route.end) < 1) {
    return updateLineElement(element, route.start, route.end);
  }

  const points = [route.start, route.broken, route.end];
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const updated = {
    ...element,
    left: roundToTenth(left),
    top: roundToTenth(top),
    start: relativePoint(route.start, left, top),
    end: relativePoint(route.end, left, top),
    broken: relativePoint(route.broken, left, top),
  } as T;

  delete (updated as Record<string, unknown>).broken2;
  delete (updated as Record<string, unknown>).curve;
  delete (updated as Record<string, unknown>).cubic;
  return updated;
}

function parsePathPointPairs(path: string): Point[] {
  const numbers = Array.from(path.matchAll(/-?\d+(?:\.\d+)?/g))
    .map((match) => Number.parseFloat(match[0]))
    .filter((value) => Number.isFinite(value));

  const points: Point[] = [];
  for (let index = 0; index < numbers.length - 1; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

function isTriangleLikeShape(element: SlideLayoutElement): boolean {
  if (element.type !== 'shape') return false;
  const record = asRecord(element);
  const pptxShapeType = String(record.pptxShapeType || '').toLowerCase();
  if (pptxShapeType.includes('triangle')) return true;

  const path = typeof record.path === 'string' ? record.path : '';
  if (!/\bz\b/i.test(path) || /\ba\b/i.test(path)) return false;

  const viewBox = Array.isArray(record.viewBox) ? record.viewBox : null;
  const viewBoxWidth = asFiniteNumber(viewBox?.[0]) ?? 1;
  const viewBoxHeight = asFiniteNumber(viewBox?.[1]) ?? 1;
  const points = parsePathPointPairs(path);
  if (points.length < 3) return false;

  const hasTopPoint = points.some(
    (point) =>
      point.y <= viewBoxHeight * 0.18 &&
      point.x >= viewBoxWidth * 0.32 &&
      point.x <= viewBoxWidth * 0.68,
  );
  const hasBottomLeft = points.some(
    (point) => point.y >= viewBoxHeight * 0.76 && point.x <= viewBoxWidth * 0.24,
  );
  const hasBottomRight = points.some(
    (point) => point.y >= viewBoxHeight * 0.76 && point.x >= viewBoxWidth * 0.76,
  );

  return hasTopPoint && hasBottomLeft && hasBottomRight;
}

function findBackgroundTriangleIndex<T extends SlideLayoutElement>(
  elements: readonly T[],
  nodeRects: readonly Rect[],
): number | null {
  const nodeUnion = unionRects(nodeRects);
  let bestIndex: number | null = null;
  let bestArea = Number.NEGATIVE_INFINITY;

  elements.forEach((element, index) => {
    if (!isTriangleLikeShape(element) || hasElementText(element)) return;
    if (!hasVisibleFill(element) || !hasVisibleOpacity(element)) return;

    const rect = rectFromElement(element);
    if (!rect) return;
    if (rectWidth(rect) < 380 || rectHeight(rect) < 250) return;
    if (!rectsOverlap(rect, nodeUnion)) return;

    const area = rectArea(rect);
    if (area > bestArea) {
      bestIndex = index;
      bestArea = area;
    }
  });

  return bestIndex;
}

function findCenterCircleIndex<T extends SlideLayoutElement>(
  elements: readonly T[],
  excludedIndexes: ReadonlySet<number>,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  elements.forEach((element, index) => {
    if (excludedIndexes.has(index)) return;
    const rect = rectFromElement(element);
    if (!rect || !isCircleLikeShape(element, rect)) return;

    const width = rectWidth(rect);
    const height = rectHeight(rect);
    if (Math.max(width, height) < 90 || Math.max(width, height) > 230) return;

    const center = rectCenter(rect);
    const distanceToCenter = distance(center, { x: DEFAULT_CANVAS_WIDTH / 2, y: 300 });
    if (distanceToCenter > 210) return;

    if (distanceToCenter < bestDistance) {
      bestIndex = index;
      bestDistance = distanceToCenter;
    }
  });

  return bestIndex;
}

function findCenterTextIndex<T extends SlideLayoutElement>(
  elements: readonly T[],
  excludedIndexes: ReadonlySet<number>,
): number | null {
  let bestIndex: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  elements.forEach((element, index) => {
    if (excludedIndexes.has(index)) return;
    if (element.type !== 'text' && element.type !== 'shape') return;

    const text = getNormalizedElementText(element);
    if (visualTextLength(text) < 7 || visualTextLength(text) > 28) return;

    const rect = rectFromElement(element);
    if (!rect) return;

    const center = rectCenter(rect);
    const distanceToCenter = distance(center, { x: DEFAULT_CANVAS_WIDTH / 2, y: 300 });
    if (distanceToCenter > 260) return;

    const containsKeyPhrase = /人物精神|核心|中心|精神/.test(text);
    const score = distanceToCenter - (containsKeyPhrase ? 120 : 0);
    if (score < bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestIndex;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function centerTextHtml(element: SlideLayoutElement): string | null {
  const rawText = getNormalizedElementText(element);
  if (!rawText) return null;

  const splitMatch =
    rawText.match(/^(.{3,12})[，,、](.{3,14})$/u) ?? rawText.match(/^(从.{2,8})(看见.{2,10})$/u);
  const lines = splitMatch ? [splitMatch[1], splitMatch[2]] : [rawText];
  const fontSize = clamp(getLargestFontSize(element) || 30, 22, 32);
  const color =
    typeof asRecord(element).defaultColor === 'string'
      ? String(asRecord(element).defaultColor)
      : '#334155';

  return lines
    .map(
      (line) =>
        `<p style="font-size: ${fontSize}px; color: ${color}; text-align: center; line-height: 1.2;">${escapeHtml(line)}</p>`,
    )
    .join('');
}

function setElementTextContent<T extends SlideLayoutElement>(element: T, html: string): T {
  if (element.type === 'text') {
    return {
      ...element,
      content: html,
    } as T;
  }

  const record = asRecord(element);
  const shapeText = typeof record.text === 'object' && record.text !== null ? record.text : {};
  return {
    ...element,
    text: {
      ...shapeText,
      align: 'middle',
      content: html,
    },
  } as T;
}

function collectTableRects<T extends SlideLayoutElement>(elements: readonly T[]): Rect[] {
  return elements
    .map((element) => {
      if (element.type !== 'table') return null;
      const rect = rectFromElement(element);
      if (!rect) return null;
      if (
        rectWidth(rect) < TABLE_CAPTION_MIN_WIDTH ||
        rectHeight(rect) < TABLE_CAPTION_MIN_HEIGHT
      ) {
        return null;
      }
      return rect;
    })
    .filter((rect): rect is Rect => !!rect);
}

function looksLikeTableOverlayCaption(text: string): boolean {
  if (!text) return false;
  if (text.includes('课堂互动') || text.includes('教师提问') || text.includes('学生互动')) {
    return false;
  }
  const length = visualTextLength(text);
  if (length < 6 || length > 36) return false;
  return (
    /表|table/i.test(text) &&
    (/[：:—\-]/u.test(text) ||
      text.includes('关键词') ||
      text.includes('事例') ||
      text.includes('写法') ||
      text.toLowerCase().includes('keyword'))
  );
}

function findCaptionOverlayTable(textRect: Rect, tableRects: readonly Rect[]): Rect | null {
  const textArea = rectArea(textRect);
  if (textArea <= 0) return null;

  return (
    tableRects
      .map((tableRect) => ({
        tableRect,
        overlapRatio: overlapArea(textRect, tableRect) / textArea,
      }))
      .filter(
        (item) =>
          item.overlapRatio >= TABLE_CAPTION_TEXT_OVERLAP_RATIO &&
          pointInExpandedRect(rectCenter(textRect), item.tableRect, 4),
      )
      .sort((a, b) => b.overlapRatio - a.overlapRatio)[0]?.tableRect ?? null
  );
}

function centerCaptionAboveTable<T extends SlideLayoutElement>(
  element: T,
  textRect: Rect,
  tableRect: Rect,
  options: Required<LayoutRepairOptions>,
): T | null {
  const top = tableRect.top - rectHeight(textRect) - TABLE_CAPTION_GAP;
  const minTop = Math.max(options.safeMargin, options.canvasHeight * 0.24);
  if (top < minTop) return null;

  const width = Math.min(rectWidth(textRect), rectWidth(tableRect) - options.gap * 2);
  if (width <= 0) return null;
  const left = clamp(
    tableRect.left + (rectWidth(tableRect) - width) / 2,
    options.safeMargin,
    options.canvasWidth - options.safeMargin - width,
  );
  const content = getElementContent(element);

  return {
    ...element,
    left: roundToTenth(left),
    top: roundToTenth(top),
    width: roundToTenth(width),
    content: content ? ensureCenteredParagraphText(content) : content,
  } as T;
}

export function repairTableCaptionOverlayLayout<T extends SlideLayoutElement>(
  elements: readonly T[],
  repairOptions: LayoutRepairOptions = {},
): T[] {
  const options = {
    canvasWidth: repairOptions.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
    canvasHeight: repairOptions.canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
    safeMargin: repairOptions.safeMargin ?? DEFAULT_SAFE_MARGIN,
    padding: repairOptions.padding ?? DEFAULT_CONTAINER_PADDING,
    gap: repairOptions.gap ?? DEFAULT_GROUP_GAP,
  };
  const tableRects = collectTableRects(elements);
  if (tableRects.length === 0) return elements as T[];

  let next: T[] | null = null;
  const removedIndexes = new Set<number>();

  elements.forEach((element, index) => {
    if (element.type !== 'text') return;
    const textRect = rectFromElement(element);
    if (!textRect) return;
    const text = stripHtmlToText(getElementContent(element));
    if (!looksLikeTableOverlayCaption(text)) return;

    const tableRect = findCaptionOverlayTable(textRect, tableRects);
    if (!tableRect) return;

    if (!next) next = elements.map((item) => ({ ...item }));
    const moved = centerCaptionAboveTable(next[index], textRect, tableRect, options);
    if (moved) {
      next[index] = moved;
      return;
    }
    removedIndexes.add(index);
  });

  const repaired = next as T[] | null;
  if (!repaired) return elements as T[];
  if (removedIndexes.size === 0) return repaired;
  return repaired.filter((_element, index) => !removedIndexes.has(index));
}

function getMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function buildTriadTargetRects(nodes: TriadNodes): Record<'top' | 'left' | 'right', Rect> {
  const nodeRects = [nodes.top.rect, nodes.left.rect, nodes.right.rect];
  const width = clamp(
    getMedian(nodeRects.map(rectWidth)),
    TRIAD_NODE_MIN_WIDTH,
    TRIAD_NODE_MAX_WIDTH,
  );
  const height = clamp(
    getMedian(nodeRects.map(rectHeight)),
    TRIAD_NODE_MIN_HEIGHT,
    TRIAD_NODE_MAX_HEIGHT,
  );

  return {
    top: {
      left: (DEFAULT_CANVAS_WIDTH - width) / 2,
      top: 72,
      right: (DEFAULT_CANVAS_WIDTH + width) / 2,
      bottom: 72 + height,
    },
    left: {
      left: 118,
      top: 405,
      right: 118 + width,
      bottom: 405 + height,
    },
    right: {
      left: DEFAULT_CANVAS_WIDTH - 118 - width,
      top: 405,
      right: DEFAULT_CANVAS_WIDTH - 118,
      bottom: 405 + height,
    },
  };
}

function applyRectToIndexes<T extends SlideLayoutElement>(
  elements: T[],
  indexes: readonly number[],
  rect: Rect,
): void {
  indexes.forEach((index) => {
    elements[index] = {
      ...elements[index],
      ...rectToProps(rect),
    };

    const html = getShapeTextContent(elements[index]);
    if (html) {
      elements[index] = setElementTextContent(elements[index], ensureCenteredParagraphText(html));
    }
  });
}

function reorderTriadElements<T extends SlideLayoutElement>(
  elements: readonly T[],
  priorities: ReadonlyMap<number, number>,
): T[] {
  return elements
    .map((element, index) => ({
      element,
      index,
      priority: priorities.get(index) ?? 30,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.element);
}

/**
 * Repairs AI-generated three-node relationship diagrams when the model places
 * node cards, connector lines, and center labels with visually inconsistent
 * absolute coordinates. The detector is intentionally narrow: it requires
 * three short labels in a triangular distribution and three long connector
 * lines that touch at least two of those labels.
 */
export function repairTriadDiagramAlignment<T extends SlideLayoutElement>(
  elements: readonly T[],
): T[] {
  const nodes = chooseTriadNodes(collectTriadNodeCandidates(elements));
  if (!nodes) return elements as T[];

  const lines = findTriadLines(elements, nodes);
  if (lines.length !== 3) return elements as T[];

  const targetRects = buildTriadTargetRects(nodes);
  const next = elements.map((element) => ({ ...element }));
  const nodeIndexSet = new Set([
    ...nodes.top.indexes,
    ...nodes.left.indexes,
    ...nodes.right.indexes,
  ]);

  applyRectToIndexes(next, nodes.top.indexes, targetRects.top);
  applyRectToIndexes(next, nodes.left.indexes, targetRects.left);
  applyRectToIndexes(next, nodes.right.indexes, targetRects.right);

  const lineAssignments = assignTriadLines(lines as [TriadLine, TriadLine, TriadLine], {
    leftTop: { start: targetRects.left, end: targetRects.top },
    topRight: { start: targetRects.top, end: targetRects.right },
    leftRight: { start: targetRects.left, end: targetRects.right },
  });

  (Object.entries(lineAssignments) as Array<[TriadPair, TriadLine]>).forEach(([pair, line]) => {
    const rects =
      pair === 'leftTop'
        ? { start: targetRects.left, end: targetRects.top }
        : pair === 'topRight'
          ? { start: targetRects.top, end: targetRects.right }
          : { start: targetRects.left, end: targetRects.right };
    const start = rectAnchorToward(rects.start, rectCenter(rects.end));
    const end = rectAnchorToward(rects.end, rectCenter(rects.start));
    next[line.index] = updateLineElement(next[line.index], start, end);
  });

  const backgroundTriangleIndex = findBackgroundTriangleIndex(next, [
    targetRects.top,
    targetRects.left,
    targetRects.right,
  ]);
  if (backgroundTriangleIndex !== null) {
    next[backgroundTriangleIndex] = {
      ...next[backgroundTriangleIndex],
      left: 96,
      top: 34,
      width: 808,
      height: 478,
    };
  }

  const lineIndexSet = new Set(lines.map((line) => line.index));
  const excludedForCenter = new Set([
    ...nodeIndexSet,
    ...lineIndexSet,
    ...(backgroundTriangleIndex === null ? [] : [backgroundTriangleIndex]),
  ]);
  const centerCircleIndex = findCenterCircleIndex(next, excludedForCenter);
  if (centerCircleIndex !== null) {
    const circleRect = rectFromElement(next[centerCircleIndex]);
    const diameter = clamp(
      circleRect ? Math.max(rectWidth(circleRect), rectHeight(circleRect)) : 148,
      126,
      168,
    );
    next[centerCircleIndex] = {
      ...next[centerCircleIndex],
      left: roundToTenth((DEFAULT_CANVAS_WIDTH - diameter) / 2),
      top: roundToTenth(300 - diameter / 2),
      width: roundToTenth(diameter),
      height: roundToTenth(diameter),
    };
    excludedForCenter.add(centerCircleIndex);
  }

  const centerTextIndex = findCenterTextIndex(next, excludedForCenter);
  if (centerTextIndex !== null) {
    const html = centerTextHtml(next[centerTextIndex]);
    const width = 370;
    const height = 88;
    next[centerTextIndex] = {
      ...next[centerTextIndex],
      left: (DEFAULT_CANVAS_WIDTH - width) / 2,
      top: 300 - height / 2,
      width,
      height,
    };
    if (html) next[centerTextIndex] = setElementTextContent(next[centerTextIndex], html);
  }

  const priorities = new Map<number, number>();
  if (backgroundTriangleIndex !== null) priorities.set(backgroundTriangleIndex, 10);
  lineIndexSet.forEach((index) => priorities.set(index, 40));
  if (centerCircleIndex !== null) priorities.set(centerCircleIndex, 50);
  if (centerTextIndex !== null) priorities.set(centerTextIndex, 60);
  nodeIndexSet.forEach((index) => priorities.set(index, 70));

  return reorderTriadElements(next, priorities);
}

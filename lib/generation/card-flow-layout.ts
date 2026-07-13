export interface FlowRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface FlowConnector {
  readonly left: number;
  readonly top: number;
  readonly length: number;
}

interface CenteredFlowRowOptions {
  readonly count: number;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly itemTop: number;
  readonly itemWidth: number;
  readonly itemHeight: number;
  readonly minGap?: number;
}

interface FlowConnectorOptions {
  readonly y: number;
  readonly padding?: number;
  readonly minLength?: number;
}

const DEFAULT_MIN_GAP = 64;
const DEFAULT_CONNECTOR_PADDING = 12;
const DEFAULT_CONNECTOR_MIN_LENGTH = 44;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createRect(left: number, top: number, width: number, height: number): FlowRect {
  const roundedLeft = roundToTenth(left);
  const roundedTop = roundToTenth(top);
  const roundedWidth = roundToTenth(width);
  const roundedHeight = roundToTenth(height);
  const right = roundToTenth(roundedLeft + roundedWidth);
  const bottom = roundToTenth(roundedTop + roundedHeight);

  return {
    left: roundedLeft,
    top: roundedTop,
    width: roundedWidth,
    height: roundedHeight,
    right,
    bottom,
    centerX: roundToTenth((roundedLeft + right) / 2),
    centerY: roundToTenth((roundedTop + bottom) / 2),
  };
}

export function buildCenteredFlowRow(options: CenteredFlowRowOptions): FlowRect[] {
  const count = Math.max(0, Math.trunc(options.count));
  if (count === 0) return [];

  const contentLeft = Math.min(options.contentLeft, options.contentRight);
  const contentRight = Math.max(options.contentLeft, options.contentRight);
  const contentWidth = Math.max(0, contentRight - contentLeft);
  const minGap = Math.max(0, options.minGap ?? DEFAULT_MIN_GAP);
  const gapCount = Math.max(0, count - 1);
  const effectiveMinGap =
    gapCount === 0 ? 0 : Math.min(minGap, contentWidth / Math.max(1, gapCount));
  const maxItemWidth =
    count <= 1 ? contentWidth : Math.max(0, (contentWidth - effectiveMinGap * gapCount) / count);
  const itemWidth =
    count <= 1
      ? Math.min(options.itemWidth, contentWidth)
      : Math.min(options.itemWidth, maxItemWidth);
  const totalItemWidth = itemWidth * count;
  const gap = gapCount === 0 ? 0 : (contentWidth - totalItemWidth) / gapCount;
  const totalWidth = totalItemWidth + gap * gapCount;
  const rowLeft = contentLeft + Math.max(0, (contentWidth - totalWidth) / 2);

  return Array.from({ length: count }, (_, index) =>
    createRect(rowLeft + index * (itemWidth + gap), options.itemTop, itemWidth, options.itemHeight),
  );
}

export function buildFlowConnectors(
  items: readonly FlowRect[],
  options: FlowConnectorOptions,
): FlowConnector[] {
  const padding = Math.max(0, options.padding ?? DEFAULT_CONNECTOR_PADDING);
  const minLength = Math.max(1, options.minLength ?? DEFAULT_CONNECTOR_MIN_LENGTH);

  const connectors: FlowConnector[] = [];
  for (let index = 0; index < items.length - 1; index += 1) {
    const current = items[index];
    const next = items[index + 1];
    const gapStart = current.right;
    const gapEnd = next.left;
    const gapWidth = gapEnd - gapStart;
    if (gapWidth <= 0) continue;

    const maxPadding = Math.max(0, (gapWidth - minLength) / 2);
    const effectivePadding = clamp(padding, 0, maxPadding);
    const length = Math.max(minLength, gapWidth - effectivePadding * 2);

    connectors.push({
      left: roundToTenth(gapStart + (gapWidth - length) / 2),
      top: roundToTenth(options.y),
      length: roundToTenth(length),
    });
  }

  return connectors;
}

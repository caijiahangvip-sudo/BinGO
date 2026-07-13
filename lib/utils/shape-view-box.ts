export function normalizeShapeViewBox(
  viewBox: unknown,
  elementWidth: number,
  elementHeight: number,
): [number, number] {
  const fallbackWidth = Number.isFinite(elementWidth) && elementWidth > 0 ? elementWidth : 1;
  const fallbackHeight = Number.isFinite(elementHeight) && elementHeight > 0 ? elementHeight : 1;

  const values = Array.isArray(viewBox)
    ? viewBox
    : typeof viewBox === 'string'
      ? viewBox
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
      : [];
  const dimensions = values.length >= 4 ? values.slice(-2) : values;
  const width = Number(dimensions[0]);
  const height = Number(dimensions[1]);

  return [
    Number.isFinite(width) && width > 0 ? width : fallbackWidth,
    Number.isFinite(height) && height > 0 ? height : fallbackHeight,
  ];
}

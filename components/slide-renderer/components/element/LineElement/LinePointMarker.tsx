import type { LinePoint } from '@/lib/types/slides';

type NonEmptyLinePoint = Exclude<LinePoint, ''>;

interface LinePointMarkerProps {
  id: string;
  position: 'start' | 'end';
  type: NonEmptyLinePoint;
  baseSize: number;
  color?: string;
}

const pathMap: Record<NonEmptyLinePoint, string> = {
  dot: 'm0 5a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z',
  arrow: 'M0,0 L10,5 0,10 Z',
};

export function LinePointMarker({ id, position, type, baseSize, color }: LinePointMarkerProps) {
  const path = pathMap[type];
  const size = baseSize < 2 ? 2 : baseSize;
  const markerSize = size * 3;
  const refX = type === 'arrow' ? (position === 'start' ? 0 : 10) : 5;

  return (
    <marker
      id={`${id}-${type}-${position}`}
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
      markerWidth={markerSize}
      markerHeight={markerSize}
      viewBox="0 0 10 10"
      refX={refX}
      refY={5}
    >
      <path d={path} fill={color} />
    </marker>
  );
}

import type { QuizDiagram } from '@/lib/types/stage';
import Flatten from '@flatten-js/core';

type TextAnchor = 'start' | 'middle' | 'end';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Line {
  readonly from: Point;
  readonly to: Point;
}

interface Label extends Point {
  readonly key: keyof NonNullable<QuizDiagram['points']>;
  readonly text: string;
  readonly textAnchor: TextAnchor;
}

interface BoardLabel extends Point {
  readonly key: keyof NonNullable<QuizDiagram['points']>;
  readonly text: string;
}

interface BoardSegment {
  readonly from: Point;
  readonly to: Point;
}

export interface IntersectingLinesGeometry {
  readonly viewBox: {
    readonly width: number;
    readonly height: number;
  };
  readonly lines: readonly Line[];
  readonly center: Point;
  readonly endpointDots: readonly Point[];
  readonly labels: readonly Label[];
  readonly centerLabel: Label;
  readonly board: {
    readonly boundingBox: readonly [number, number, number, number];
    readonly segments: readonly BoardSegment[];
    readonly endpointDots: readonly Point[];
    readonly labels: readonly BoardLabel[];
    readonly center: Point;
    readonly centerLabel: BoardLabel;
  };
}

const DEFAULT_POINTS = {
  upperLeft: 'A',
  upperRight: 'C',
  lowerRight: 'B',
  lowerLeft: 'D',
  center: 'O',
} as const;

function findSegmentIntersection(first: BoardSegment, second: BoardSegment): Point {
  const intersections = Flatten.segment(
    Flatten.point(first.from.x, first.from.y),
    Flatten.point(first.to.x, first.to.y),
  ).intersect(
    Flatten.segment(
      Flatten.point(second.from.x, second.from.y),
      Flatten.point(second.to.x, second.to.y),
    ),
  );

  const [intersection] = intersections;
  return intersection ? { x: intersection.x, y: intersection.y } : { x: 0, y: 0 };
}

export function getIntersectingLinesGeometry(
  pointOverrides: QuizDiagram['points'] = {},
): IntersectingLinesGeometry {
  const points = {
    ...DEFAULT_POINTS,
    ...pointOverrides,
  };

  const upperLeft = { x: 72, y: 58 };
  const lowerRight = { x: 348, y: 162 };
  const lowerLeft = { x: 72, y: 162 };
  const upperRight = { x: 348, y: 58 };
  const center = { x: 210, y: 110 };

  const boardUpperLeft = { x: -3.1, y: 1.25 };
  const boardLowerRight = { x: 3.1, y: -1.25 };
  const boardLowerLeft = { x: -3.1, y: -1.25 };
  const boardUpperRight = { x: 3.1, y: 1.25 };
  const boardSegments = [
    { from: boardUpperLeft, to: boardLowerRight },
    { from: boardLowerLeft, to: boardUpperRight },
  ] as const;
  const boardCenter = findSegmentIntersection(boardSegments[0], boardSegments[1]);

  return {
    viewBox: { width: 420, height: 220 },
    lines: [
      { from: upperLeft, to: lowerRight },
      { from: lowerLeft, to: upperRight },
    ],
    center,
    endpointDots: [upperLeft, upperRight, lowerRight, lowerLeft],
    labels: [
      {
        key: 'upperLeft',
        text: points.upperLeft,
        x: 50,
        y: 48,
        textAnchor: 'middle',
      },
      {
        key: 'upperRight',
        text: points.upperRight,
        x: 370,
        y: 48,
        textAnchor: 'middle',
      },
      {
        key: 'lowerRight',
        text: points.lowerRight,
        x: 370,
        y: 186,
        textAnchor: 'middle',
      },
      {
        key: 'lowerLeft',
        text: points.lowerLeft,
        x: 50,
        y: 186,
        textAnchor: 'middle',
      },
    ],
    centerLabel: {
      key: 'center',
      text: points.center,
      x: 232,
      y: 102,
      textAnchor: 'middle',
    },
    board: {
      boundingBox: [-4.3, 2.2, 4.3, -2.2],
      segments: boardSegments,
      center: boardCenter,
      endpointDots: [boardUpperLeft, boardUpperRight, boardLowerRight, boardLowerLeft],
      labels: [
        {
          key: 'upperLeft',
          text: points.upperLeft,
          x: -3.65,
          y: 1.55,
        },
        {
          key: 'upperRight',
          text: points.upperRight,
          x: 3.65,
          y: 1.55,
        },
        {
          key: 'lowerRight',
          text: points.lowerRight,
          x: 3.65,
          y: -1.65,
        },
        {
          key: 'lowerLeft',
          text: points.lowerLeft,
          x: -3.65,
          y: -1.65,
        },
      ],
      centerLabel: {
        key: 'center',
        text: points.center,
        x: 0.48,
        y: 0.3,
      },
    },
  };
}

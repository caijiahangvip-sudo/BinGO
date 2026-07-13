'use client';

import { useId, useMemo } from 'react';
import type { IntersectingLinesGeometry } from '@/lib/quiz/intersecting-lines-geometry';

interface IntersectingLinesBoardProps {
  readonly geometry: IntersectingLinesGeometry;
  readonly ariaLabel: string;
}

function sanitizeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function IntersectingLinesBoard({ geometry, ariaLabel }: IntersectingLinesBoardProps) {
  const rawId = useId();
  const markerId = useMemo(() => `quiz-arrow-${sanitizeSvgId(rawId)}`, [rawId]);

  return (
    <div
      className="bingo-geometry-board relative h-[220px] w-full overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-800/70"
      role="img"
      aria-label={ariaLabel}
      data-testid="intersecting-lines-board"
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${geometry.viewBox.width} ${geometry.viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id={markerId}
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 9 4.5 L 0 9 Z" className="fill-slate-700 dark:fill-slate-300" />
          </marker>
        </defs>

        {geometry.lines.map((line, index) => (
          <line
            key={`line-${index}`}
            x1={line.from.x}
            y1={line.from.y}
            x2={line.to.x}
            y2={line.to.y}
            className="stroke-slate-700 dark:stroke-slate-300"
            strokeWidth="5"
            strokeLinecap="round"
            markerStart={`url(#${markerId})`}
            markerEnd={`url(#${markerId})`}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {geometry.labels.map((label) => (
          <text
            key={label.key}
            x={label.x}
            y={label.y}
            textAnchor={label.textAnchor}
            dominantBaseline="central"
            className="fill-slate-800 text-[24px] font-semibold dark:fill-slate-100"
          >
            {label.text}
          </text>
        ))}

        <text
          x={geometry.centerLabel.x}
          y={geometry.centerLabel.y}
          textAnchor={geometry.centerLabel.textAnchor}
          dominantBaseline="central"
          className="fill-slate-800 text-[22px] font-semibold dark:fill-slate-100"
        >
          {geometry.centerLabel.text}
        </text>
      </svg>
    </div>
  );
}

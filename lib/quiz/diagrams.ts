import type { QuizDiagram, QuizQuestion } from '@/lib/types/stage';

const INTERSECTING_LINES_POINTS = {
  upperLeft: 'A',
  upperRight: 'C',
  lowerRight: 'B',
  lowerLeft: 'D',
  center: 'O',
} as const;

function compactQuestionText(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase();
}

export function resolveQuizDiagram(
  question: Pick<QuizQuestion, 'question' | 'diagram' | 'options'>,
): QuizDiagram | undefined {
  if (question.diagram?.type) return question.diagram;

  const compact = compactQuestionText(
    [
      question.question,
      ...(question.options?.map((option) => `${option.label}${option.value}`) ?? []),
    ].join(' '),
  );
  const describesIntersectingLines =
    compact.includes('AB') &&
    compact.includes('CD') &&
    compact.includes('O') &&
    (compact.includes('相交') || compact.includes('交于')) &&
    (compact.includes('相交于点O') ||
      compact.includes('相交于O') ||
      compact.includes('交于点O') ||
      compact.includes('交于O') ||
      compact.includes('相交'));
  const usesNamedAngles = ['AOC', 'COB', 'BOD', 'DOA'].some((angle) => compact.includes(angle));
  const referencesFigure =
    compact.includes('如图') ||
    compact.includes('图示') ||
    compact.includes('图意') ||
    compact.includes('FIGURE') ||
    compact.includes('DIAGRAM');

  if (!describesIntersectingLines || (!usesNamedAngles && !referencesFigure)) return undefined;

  return {
    type: 'intersecting_lines',
    points: INTERSECTING_LINES_POINTS,
  };
}

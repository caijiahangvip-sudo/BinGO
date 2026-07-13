import { describe, expect, it } from 'vitest';

import { resolveQuizDiagram } from '@/lib/quiz/diagrams';

describe('quiz diagrams', () => {
  it('infers an intersecting-lines diagram for existing geometry quiz wording', () => {
    const diagram = resolveQuizDiagram({
      question:
        '如图意：直线AB与直线CD相交于点O，形成四个角：角AOC、角COB、角BOD、角DOA。下列哪一组角是对顶角？',
    });

    expect(diagram?.type).toBe('intersecting_lines');
    expect(diagram?.points?.center).toBe('O');
  });

  it('infers an intersecting-lines diagram when the angle names are in options', () => {
    const diagram = resolveQuizDiagram({
      question: '如图，直线 AB 和 CD 相交于点 O。下列哪组角是对顶角？',
      options: [
        { label: '∠AOC 和 ∠BOD', value: 'A' },
        { label: '∠AOC 和 ∠COB', value: 'B' },
      ],
    });

    expect(diagram?.type).toBe('intersecting_lines');
  });

  it('does not infer a diagram for text-only questions', () => {
    const diagram = resolveQuizDiagram({
      question: '下列哪一种做法符合课堂讨论规则？',
    });

    expect(diagram).toBeUndefined();
  });
});

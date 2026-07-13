import { describe, expect, it, vi } from 'vitest';

import { generateSceneContent } from '@/lib/generation/scene-generator';
import type { SceneOutline } from '@/lib/types/generation';

function quizOutline(overrides: Partial<SceneOutline> = {}): SceneOutline {
  return {
    id: 'quiz_1',
    type: 'quiz',
    title: '升旗礼仪小判断',
    description: '判断升旗时哪些做法是正确的。',
    keyPoints: ['升旗时立正站好', '认真看国旗', '安静唱国歌'],
    order: 1,
    language: 'zh-CN',
    quizConfig: {
      questionCount: 2,
      difficulty: 'easy',
      questionTypes: ['single'],
    },
    ...overrides,
  };
}

const goodQuizJson = JSON.stringify([
  {
    id: 'q1',
    type: 'single',
    question: '升旗时应该怎么做？',
    options: [
      { label: '立正站好', value: 'A' },
      { label: '随便走动', value: 'B' },
      { label: '大声聊天', value: 'C' },
      { label: '背对国旗', value: 'D' },
    ],
    answer: ['A'],
    analysis: '升旗时要立正站好，认真看国旗。',
    points: 10,
  },
]);

describe('quiz scene generation', () => {
  it('retries invalid quiz JSON with a stricter JSON prompt', async () => {
    const aiCall = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce(goodQuizJson);

    const content = await generateSceneContent(quizOutline(), aiCall);

    expect(content && 'questions' in content).toBe(true);
    expect(aiCall).toHaveBeenCalledTimes(2);
    expect(aiCall.mock.calls[1][0]).toContain('Return only one valid JSON array');
    expect(aiCall.mock.calls[1][1]).toContain('invalid JSON response');
  });

  it('falls back to a usable quiz when the model keeps failing', async () => {
    const aiCall = vi.fn(async () => {
      throw new Error('Invalid JSON response');
    });

    const content = await generateSceneContent(quizOutline(), aiCall);

    expect(content && 'questions' in content).toBe(true);
    if (!content || !('questions' in content)) return;
    expect(content.questions.length).toBeGreaterThan(0);
    expect(content.questions[0].question).toContain('升旗礼仪小判断');
    expect(content.questions[0].options?.[0].label).toBe('升旗时立正站好');
    expect(content.questions[0].answer).toEqual(['A']);
  });

  it('preserves supported quiz diagrams from model output', async () => {
    const aiCall = vi.fn().mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'q1',
          type: 'single',
          question: '如图，直线AB与直线CD相交于点O。哪一组角是对顶角？',
          diagram: {
            type: 'intersecting_lines',
            points: {
              upperLeft: 'A',
              upperRight: 'C',
              lowerRight: 'B',
              lowerLeft: 'D',
              center: 'O',
            },
          },
          options: [
            { label: '角AOC与角COB', value: 'A' },
            { label: '角AOC与角BOD', value: 'B' },
            { label: '角COB与角BOD', value: 'C' },
            { label: '角AOC与角DOA', value: 'D' },
          ],
          answer: ['B'],
          analysis: '角AOC与角BOD是对顶角。',
          points: 10,
        },
      ]),
    );

    const content = await generateSceneContent(quizOutline(), aiCall);

    expect(content && 'questions' in content).toBe(true);
    if (!content || !('questions' in content)) return;
    expect(content.questions[0].diagram?.type).toBe('intersecting_lines');
  });
});

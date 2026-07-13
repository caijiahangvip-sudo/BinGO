import { describe, expect, it } from 'vitest';

import { sanitizeGeneratedActions } from '@/lib/generation/action-sanitizer';
import { MAX_SPOTLIGHT_DIMNESS } from '@/lib/playback/spotlight-utils';
import type { Action } from '@/lib/types/action';
import type { PPTElement } from '@/lib/types/slides';

const elements = [{ id: 'text_1', type: 'text' }] as PPTElement[];

describe('sanitizeGeneratedActions', () => {
  it('drops spotlight actions that do not target a real slide element', () => {
    const actions = [
      { id: 'bad', type: 'spotlight', elementId: 'missing', dimOpacity: 0.38 },
      { id: 'speech', type: 'speech', text: 'Keep teaching.' },
    ] as Action[];

    expect(sanitizeGeneratedActions(actions, elements)).toEqual([
      { id: 'speech', type: 'speech', text: 'Keep teaching.' },
    ]);
  });

  it('normalizes spotlight dimOpacity for valid slide targets', () => {
    const actions = [
      { id: 'spotlight', type: 'spotlight', elementId: 'text_1', dimOpacity: 1 },
    ] as Action[];

    expect(sanitizeGeneratedActions(actions, elements)).toEqual([
      {
        id: 'spotlight',
        type: 'spotlight',
        elementId: 'text_1',
        dimOpacity: MAX_SPOTLIGHT_DIMNESS,
      },
    ]);
  });

  it('removes AI-teacher self introductions from generated speech', () => {
    const actions = [
      { id: 'speech', type: 'speech', text: '大家好，我是AI老师，今天我们学习分数。' },
      { id: 'empty', type: 'speech', text: '我是 AI 老师。' },
    ] as Action[];

    expect(sanitizeGeneratedActions(actions, elements)).toEqual([
      { id: 'speech', type: 'speech', text: '大家好，今天我们学习分数。' },
      { id: 'empty', type: 'speech', text: '今天我们一起开始学习。' },
    ]);
  });

  it('removes AI-teacher self references from discussion text even without agents', () => {
    const actions = [
      {
        id: 'discussion',
        type: 'discussion',
        topic: '我是AI老师，讨论一下分数。',
        prompt: '作为AI老师，我想听听你的想法。',
      },
    ] as Action[];

    expect(sanitizeGeneratedActions(actions, elements)).toEqual([
      {
        id: 'discussion',
        type: 'discussion',
        topic: '讨论一下分数。',
        prompt: '作为老师，我想听听你的想法。',
      },
    ]);
  });

  it('repairs missing discussion agentId using a selected student when available', () => {
    const actions = [{ id: 'discussion', type: 'discussion', topic: 'why' }] as Action[];

    expect(
      sanitizeGeneratedActions(actions, elements, [
        { id: 'teacher_1', name: 'Teacher', role: 'teacher' },
        { id: 'student_1', name: 'Student', role: 'student' },
      ]),
    ).toEqual([{ id: 'discussion', type: 'discussion', topic: 'why', agentId: 'student_1' }]);
  });
});

import { describe, expect, it } from 'vitest';

import { advanceDebateState, getInitialDebateState } from '@/lib/orchestration/stateless-generate';
import type { StatelessChatRequest } from '@/lib/types/chat';

function createDebateRequest(
  debateState?: NonNullable<StatelessChatRequest['directorState']>['debateState'],
): StatelessChatRequest {
  return {
    messages: [],
    config: {
      agentIds: ['agent-a', 'agent-b'],
      sessionType: 'discussion',
      discussionTopic: 'Should homework be optional?',
      discussionMode: 'debate',
      debateConfig: {
        agentAId: 'agent-a',
        agentBId: 'agent-b',
        topic: 'Should homework be optional?',
      },
    },
    storeState: {
      stage: null,
      currentSceneId: null,
      mode: 'playback',
      scenes: [],
      whiteboardOpen: false,
    },
    directorState: debateState
      ? {
          turnCount: 0,
          agentResponses: [],
          whiteboardLedger: [],
          debateState,
        }
      : undefined,
    apiKey: 'test-key',
  };
}

describe('Debate_Flow stateless state progression', () => {
  it('initializes explicit debate state from the request config', () => {
    expect(getInitialDebateState(createDebateRequest())).toEqual({
      phase: 'agent_a',
      agentAId: 'agent-a',
      agentBId: 'agent-b',
      topic: 'Should homework be optional?',
    });
  });

  it('advances A -> B -> USER -> done across stateless requests', () => {
    const afterAgentA = advanceDebateState(createDebateRequest(), 'agent-a', 1, false);
    expect(afterAgentA?.phase).toBe('agent_b');

    const afterAgentB = advanceDebateState(createDebateRequest(afterAgentA), 'agent-b', 1, false);
    expect(afterAgentB?.phase).toBe('user');

    const afterCueUser = advanceDebateState(createDebateRequest(afterAgentB), null, 0, true);
    expect(afterCueUser?.phase).toBe('done');
  });
});

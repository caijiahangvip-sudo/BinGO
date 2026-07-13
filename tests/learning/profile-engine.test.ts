import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@/lib/types/chat';
import type { LearningEvidenceRecord } from '@/lib/types/learning-profile';
import {
  extractChatEvidenceRecords,
  scoreToKnowledgeStatus,
  summarizeKnowledgePointEvidence,
} from '@/lib/learning/profile-engine';

function createEvidence(
  overrides: Partial<LearningEvidenceRecord> = {},
): LearningEvidenceRecord {
  return {
    id: 'evidence-1',
    studentId: 'local-student',
    planId: 'plan-1',
    lessonId: 'lesson-1',
    stageId: 'stage-1',
    sourceType: 'quiz',
    knowledgePointIds: ['kp-1'],
    prompt: 'Question',
    response: 'Answer',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-1',
    type: 'qa',
    title: 'Q&A',
    status: 'completed',
    messages: [],
    config: {
      agentIds: ['default-1'],
      maxTurns: 0,
      currentTurn: 0,
    },
    toolCalls: [],
    pendingToolCalls: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('scoreToKnowledgeStatus', () => {
  it('maps high scores to mastered', () => {
    expect(scoreToKnowledgeStatus(0.8)).toBe('mastered');
  });

  it('maps medium scores to review', () => {
    expect(scoreToKnowledgeStatus(0.65)).toBe('review');
  });

  it('maps low scores to weak', () => {
    expect(scoreToKnowledgeStatus(0.4)).toBe('weak');
  });
});

describe('summarizeKnowledgePointEvidence', () => {
  it('blends quiz score with a small QA bump', () => {
    const summary = summarizeKnowledgePointEvidence([
      createEvidence({ id: 'q1', normalizedScore: 1 }),
      createEvidence({ id: 'q2', normalizedScore: 0.5 }),
      createEvidence({ id: 'qa1', sourceType: 'qa', normalizedScore: undefined }),
    ]);

    expect(summary.quizEvidenceCount).toBe(2);
    expect(summary.qaEvidenceCount).toBe(1);
    expect(summary.score).toBe(0.8);
  });

  it('keeps QA-only evidence in a low-confidence band', () => {
    const summary = summarizeKnowledgePointEvidence([
      createEvidence({ id: 'qa1', sourceType: 'qa', normalizedScore: undefined }),
    ]);

    expect(summary.quizEvidenceCount).toBe(0);
    expect(summary.qaEvidenceCount).toBe(1);
    expect(summary.score).toBe(0.45);
  });

  it('counts homework evidence as scored practice signal', () => {
    const summary = summarizeKnowledgePointEvidence([
      createEvidence({
        id: 'hw1',
        sourceType: 'homework',
        normalizedScore: 0.35,
      }),
    ]);

    expect(summary.homeworkEvidenceCount).toBe(1);
    expect(summary.score).toBe(0.35);
  });
});

describe('extractChatEvidenceRecords', () => {
  it('captures student question from session config when no user bubble exists', () => {
    const records = extractChatEvidenceRecords({
      planId: 'plan-1',
      lessonId: 'lesson-1',
      stageId: 'stage-1',
      knowledgePointIds: ['kp-1'],
      sessions: [
        createSession({
          id: 'session-config',
          config: {
            agentIds: ['default-1'],
            maxTurns: 0,
            currentTurn: 0,
            studentQuestion: 'What does numerator mean?',
          },
        }),
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0].response).toBe('What does numerator mean?');
    expect(records[0].sourceType).toBe('qa');
  });

  it('uses nearby assistant text as the prompt for a user response', () => {
    const records = extractChatEvidenceRecords({
      planId: 'plan-1',
      lessonId: 'lesson-1',
      stageId: 'stage-1',
      knowledgePointIds: ['kp-1'],
      sessions: [
        createSession({
          id: 'session-user',
          messages: [
            {
              id: 'assistant-1',
              role: 'assistant',
              parts: [{ type: 'text', text: 'What is 2 + 2?' }],
              metadata: { createdAt: 1 },
            } as never,
            {
              id: 'user-1',
              role: 'user',
              parts: [{ type: 'text', text: 'It is 4.' }],
              metadata: { createdAt: 2 },
            } as never,
            {
              id: 'assistant-2',
              role: 'assistant',
              parts: [{ type: 'text', text: 'Correct.' }],
              metadata: { createdAt: 3 },
            } as never,
          ],
        }),
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0].prompt).toBe('What is 2 + 2?');
    expect(records[0].response).toBe('It is 4.');
    expect(records[0].metadata).toMatchObject({
      evidenceKind: 'student-response',
      assistantFeedback: 'Correct.',
    });
  });
});

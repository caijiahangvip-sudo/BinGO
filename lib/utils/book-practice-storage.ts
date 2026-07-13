import { db } from '@/lib/utils/database';
import type { BookPracticeQuestion, BookPracticeSession } from '@/lib/types/book-learning';
import type { LearningEvidenceRecord } from '@/lib/types/learning-profile';
import {
  LOCAL_STUDENT_ID,
  saveLearningEvidenceRecords,
} from '@/lib/utils/learning-profile-storage';

export async function saveBookPracticeSession(session: BookPracticeSession): Promise<void> {
  await db.bookPracticeSessions.put({
    ...session,
    updatedAt: Date.now(),
  });
}

export async function loadBookPracticeSession(id: string): Promise<BookPracticeSession | null> {
  return (await db.bookPracticeSessions.get(id)) ?? null;
}

export async function listBookPracticeSessions(planId: string): Promise<BookPracticeSession[]> {
  const sessions = await db.bookPracticeSessions.where('planId').equals(planId).toArray();
  return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getLatestBookPracticeSession(
  planId: string,
): Promise<BookPracticeSession | null> {
  const sessions = await listBookPracticeSessions(planId);
  return sessions[0] ?? null;
}

function normalizePracticeScore(question: BookPracticeQuestion): number | undefined {
  if (typeof question.earnedScore !== 'number') return undefined;
  const maxScore = typeof question.maxScore === 'number' && question.maxScore > 0 ? question.maxScore : 1;
  return Math.max(0, Math.min(1, question.earnedScore / maxScore));
}

export async function completeBookPracticeSession(params: {
  sessionId: string;
  questions: BookPracticeQuestion[];
  studentId?: string;
}): Promise<BookPracticeSession> {
  const session = await loadBookPracticeSession(params.sessionId);
  if (!session) throw new Error('Practice session not found');

  const now = Date.now();
  const studentId = params.studentId ?? session.studentId ?? LOCAL_STUDENT_ID;
  const updated: BookPracticeSession = {
    ...session,
    studentId,
    questions: params.questions,
    status: 'completed',
    completedAt: session.completedAt ?? now,
    updatedAt: now,
  };

  await saveBookPracticeSession(updated);

  const evidence: LearningEvidenceRecord[] = updated.questions
    .filter((question) => typeof question.userAnswer === 'string')
    .map((question) => ({
      id: `practice:${updated.id}:${question.id}`,
      studentId,
      planId: updated.planId,
      lessonId: 'post-book-practice',
      stageId: `practice:${updated.id}`,
      sourceType: 'practice',
      knowledgePointIds:
        question.knowledgePointIds && question.knowledgePointIds.length > 0
          ? question.knowledgePointIds
          : updated.targetKnowledgePointIds,
      prompt: question.prompt,
      response: question.userAnswer ?? '',
      correct:
        typeof question.earnedScore === 'number' && typeof question.maxScore === 'number'
          ? question.earnedScore >= question.maxScore * 0.8
          : null,
      earnedScore: question.earnedScore,
      maxScore: question.maxScore,
      normalizedScore: normalizePracticeScore(question),
      aiComment: question.aiComment,
      createdAt: question.answeredAt ?? now,
      updatedAt: now,
      metadata: {
        difficulty: question.difficulty,
        expectedAnswer: question.expectedAnswer,
        solution: question.solution,
        sourceUrls: question.sourceUrls,
      },
    }));

  await saveLearningEvidenceRecords(evidence);
  return updated;
}

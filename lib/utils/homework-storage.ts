import { nanoid } from 'nanoid';
import { db } from '@/lib/utils/database';
import type {
  HomeworkChatMessage,
  HomeworkProfileImpact,
  HomeworkQuestionReviewStatus,
  HomeworkSession,
} from '@/lib/types/homework';
import type { KnowledgeMasteryRecord, LearningEvidenceRecord } from '@/lib/types/learning-profile';
import {
  LOCAL_STUDENT_ID,
  buildKnowledgeMasteryId,
  getOrCreateStudentLearningProfile,
  listLearningEvidenceByPlan,
  saveKnowledgeMasteryRecords,
  saveLearningEvidenceRecords,
  saveStudentLearningProfile,
} from '@/lib/utils/learning-profile-storage';
import { scoreToKnowledgeStatus, summarizeKnowledgePointEvidence } from '@/lib/learning/profile-engine';

export const HOMEWORK_PROFILE_PLAN_ID = 'homework-profile';
export const HOMEWORK_PROFILE_LESSON_ID = 'homework-companion';

function normalizeEvidenceId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 120);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildProfileImpact(session: HomeworkSession): HomeworkProfileImpact {
  const needsHelp = session.questions.filter((question) => question.reviewStatus === 'needs_help');
  const understood = session.questions.filter((question) => question.reviewStatus === 'understood');

  return {
    strengths: unique(understood.flatMap((question) => question.knowledgePoints)).slice(0, 8),
    weaknesses: unique(needsHelp.flatMap((question) => question.knowledgePoints)).slice(0, 8),
    unresolvedQuestions: needsHelp.map((question) => question.question).slice(0, 8),
    evidenceCount: session.chatMessages.filter((message) => message.role === 'user').length + needsHelp.length,
    updatedAt: Date.now(),
  };
}

function buildQuestionEvidence(session: HomeworkSession): LearningEvidenceRecord[] {
  return session.questions
    .filter((question) => question.reviewStatus)
    .map((question) => {
      const understood = question.reviewStatus === 'understood';
      const now = question.reviewedAt || Date.now();
      return {
        id: `homework:${session.id}:review:${normalizeEvidenceId(question.id)}`,
        studentId: session.studentId,
        planId: HOMEWORK_PROFILE_PLAN_ID,
        lessonId: HOMEWORK_PROFILE_LESSON_ID,
        stageId: session.id,
        sourceType: 'homework' as const,
        knowledgePointIds:
          question.knowledgePoints.length > 0
            ? question.knowledgePoints.map((point) => `homework:${point}`)
            : [`homework:${question.id}`],
        prompt: question.question,
        response: understood ? 'understood' : 'needs_help',
        correct: understood,
        normalizedScore: understood ? 0.9 : 0.35,
        aiComment: understood ? 'Student marked this item as understood.' : 'Student needs help on this item.',
        createdAt: now,
        updatedAt: now,
        metadata: {
          fileName: session.fileName,
          language: session.language,
          homeworkSessionId: session.id,
          answer: question.answer,
          solution: question.solution,
          reviewStatus: question.reviewStatus,
        },
      } satisfies LearningEvidenceRecord;
    });
}

function buildChatEvidence(session: HomeworkSession): LearningEvidenceRecord[] {
  return session.chatMessages
    .filter((message) => message.role === 'user')
    .map((message) => {
      const relatedQuestion = message.questionId
        ? session.questions.find((question) => question.id === message.questionId)
        : undefined;
      const assistantReply = session.chatMessages.find(
        (candidate) =>
          candidate.role === 'assistant' &&
          candidate.questionId === message.questionId &&
          candidate.createdAt >= message.createdAt,
      );
      const knowledgePoints =
        relatedQuestion?.knowledgePoints && relatedQuestion.knowledgePoints.length > 0
          ? relatedQuestion.knowledgePoints.map((point) => `homework:${point}`)
          : [`homework:${message.questionId || 'general'}`];

      return {
        id: `homework:${session.id}:chat:${normalizeEvidenceId(message.id)}`,
        studentId: session.studentId,
        planId: HOMEWORK_PROFILE_PLAN_ID,
        lessonId: HOMEWORK_PROFILE_LESSON_ID,
        stageId: session.id,
        sessionId: session.id,
        sourceType: 'homework' as const,
        knowledgePointIds: knowledgePoints,
        prompt: relatedQuestion?.question || 'Homework follow-up question',
        response: message.text,
        normalizedScore: 0.45,
        aiComment: assistantReply?.text,
        createdAt: message.createdAt,
        updatedAt: assistantReply?.createdAt || message.createdAt,
        metadata: {
          fileName: session.fileName,
          language: session.language,
          homeworkSessionId: session.id,
          questionId: message.questionId,
          evidenceKind: 'homework-follow-up',
        },
      } satisfies LearningEvidenceRecord;
    });
}

export async function saveHomeworkSession(session: HomeworkSession): Promise<void> {
  await db.homeworkSessions.put(session);
}

export async function loadHomeworkSession(id: string): Promise<HomeworkSession | null> {
  return (await db.homeworkSessions.get(id)) ?? null;
}

export async function listHomeworkSessions(studentId = LOCAL_STUDENT_ID): Promise<HomeworkSession[]> {
  return db.homeworkSessions
    .where('studentId')
    .equals(studentId)
    .reverse()
    .sortBy('updatedAt');
}

function formatHomeworkKnowledgePoint(id: string): string {
  return id.replace(/^homework:/, '');
}

export async function recomputeHomeworkLearningProfile(
  studentId = LOCAL_STUDENT_ID,
): Promise<void> {
  const evidence = await listLearningEvidenceByPlan(HOMEWORK_PROFILE_PLAN_ID);
  const byKnowledgePoint = new Map<string, LearningEvidenceRecord[]>();
  for (const item of evidence.filter((record) => record.studentId === studentId)) {
    for (const knowledgePointId of item.knowledgePointIds) {
      const list = byKnowledgePoint.get(knowledgePointId) || [];
      list.push(item);
      byKnowledgePoint.set(knowledgePointId, list);
    }
  }

  const now = Date.now();
  const masteryRecords: KnowledgeMasteryRecord[] = [];
  for (const [knowledgePointId, records] of byKnowledgePoint) {
    const summary = summarizeKnowledgePointEvidence(records);
    masteryRecords.push({
      id: buildKnowledgeMasteryId(HOMEWORK_PROFILE_PLAN_ID, knowledgePointId, studentId),
      studentId,
      planId: HOMEWORK_PROFILE_PLAN_ID,
      lessonId: HOMEWORK_PROFILE_LESSON_ID,
      knowledgePointId,
      score: summary.score,
      status: scoreToKnowledgeStatus(summary.score),
      evidenceCount: summary.evidenceCount,
      quizEvidenceCount: summary.quizEvidenceCount,
      qaEvidenceCount: summary.qaEvidenceCount,
      voiceEvidenceCount: summary.voiceEvidenceCount,
      practiceEvidenceCount: summary.practiceEvidenceCount,
      homeworkEvidenceCount: summary.homeworkEvidenceCount,
      lastEvidenceAt: summary.lastEvidenceAt || now,
      summary: `作业证据 ${summary.homeworkEvidenceCount} 条，互动 ${summary.qaEvidenceCount} 条，综合得分 ${Math.round(summary.score * 100)}%。`,
      createdAt: now,
      updatedAt: now,
    });
  }

  await saveKnowledgeMasteryRecords(masteryRecords);

  const strengths = masteryRecords
    .filter((record) => record.evidenceCount > 0)
    .sort((left, right) => right.score - left.score)
    .map((record) => formatHomeworkKnowledgePoint(record.knowledgePointId))
    .slice(0, 5);
  const weaknesses = masteryRecords
    .filter((record) => record.status === 'weak' || record.status === 'review')
    .sort((left, right) => left.score - right.score)
    .map((record) => formatHomeworkKnowledgePoint(record.knowledgePointId))
    .slice(0, 8);
  const existingProfile = await getOrCreateStudentLearningProfile(
    HOMEWORK_PROFILE_PLAN_ID,
    studentId,
  );
  await saveStudentLearningProfile({
    ...existingProfile,
    overallSummary:
      weaknesses.length > 0
        ? `作业模式已记录 ${evidence.length} 条学习证据。当前需要重点巩固：${weaknesses.join('、')}。`
        : `作业模式已记录 ${evidence.length} 条学习证据，暂未发现稳定薄弱点。`,
    strengths,
    weaknesses,
    completedLessons: existingProfile.completedLessons,
    masteredKnowledgePointCount: masteryRecords.filter((record) => record.status === 'mastered')
      .length,
    weakKnowledgePointCount: masteryRecords.filter((record) => record.status === 'weak').length,
    updatedAt: now,
  });
}

export async function createHomeworkSession(
  input: Omit<HomeworkSession, 'id' | 'studentId' | 'chatMessages' | 'profileImpact' | 'status' | 'createdAt' | 'updatedAt'>,
  studentId = LOCAL_STUDENT_ID,
): Promise<HomeworkSession> {
  const now = Date.now();
  const session: HomeworkSession = {
    ...input,
    id: nanoid(),
    studentId,
    chatMessages: [],
    profileImpact: {
      strengths: [],
      weaknesses: [],
      unresolvedQuestions: [],
      evidenceCount: 0,
      updatedAt: now,
    },
    status: 'solved',
    createdAt: now,
    updatedAt: now,
  };
  await saveHomeworkSession(session);
  return session;
}

export async function updateHomeworkQuestionReview(params: {
  sessionId: string;
  questionId: string;
  status: HomeworkQuestionReviewStatus;
}): Promise<HomeworkSession> {
  const session = await loadHomeworkSession(params.sessionId);
  if (!session) throw new Error('Homework session not found');

  const now = Date.now();
  const updated: HomeworkSession = {
    ...session,
    status: 'reviewing',
    questions: session.questions.map((question) =>
      question.id === params.questionId
        ? {
            ...question,
            reviewStatus: params.status,
            reviewedAt: now,
          }
        : question,
    ),
    updatedAt: now,
  };
  updated.profileImpact = buildProfileImpact(updated);
  await saveHomeworkSession(updated);
  await saveLearningEvidenceRecords(buildQuestionEvidence(updated));
  await recomputeHomeworkLearningProfile(updated.studentId);
  return updated;
}

export async function appendHomeworkChatMessages(params: {
  sessionId: string;
  messages: HomeworkChatMessage[];
}): Promise<HomeworkSession> {
  const session = await loadHomeworkSession(params.sessionId);
  if (!session) throw new Error('Homework session not found');

  const now = Date.now();
  const updated: HomeworkSession = {
    ...session,
    status: 'reviewing',
    chatMessages: [...session.chatMessages, ...params.messages],
    updatedAt: now,
  };
  updated.profileImpact = buildProfileImpact(updated);
  await saveHomeworkSession(updated);
  await saveLearningEvidenceRecords(buildChatEvidence(updated));
  await recomputeHomeworkLearningProfile(updated.studentId);
  return updated;
}

import type { UIMessage } from 'ai';
import type { ChatSession } from '@/lib/types/chat';
import type { Stage } from '@/lib/types/stage';
import type {
  BookLearningLanguage,
  BookLearningPlan,
  BookLessonPlan,
  KnowledgePointStatus,
} from '@/lib/types/book-learning';
import type {
  LearningEvidenceRecord,
  KnowledgeMasteryRecord,
  LessonSummaryRecord,
  StudentLearningProfile,
} from '@/lib/types/learning-profile';
import { loadChatSessions } from '@/lib/utils/chat-storage';
import {
  LOCAL_STUDENT_ID,
  buildKnowledgeMasteryId,
  buildLessonSummaryId,
  getOrCreateStudentLearningProfile,
  listKnowledgeMasteryByPlan,
  listLearningEvidenceByPlan,
  listLearningEvidenceByStageId,
  saveKnowledgeMasteryRecords,
  saveLearningEvidenceRecords,
  saveLessonSummary,
  saveStudentLearningProfile,
} from '@/lib/utils/learning-profile-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('LearningProfileEngine');

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 100);
}

function extractMessageText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: 'text'; text: string }> =>
        part.type === 'text' && typeof part.text === 'string',
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n');
}

function resolveStageLearningContext(stage: Stage | null | undefined): {
  planId: string;
  lessonId: string;
  stageId: string;
  knowledgePointIds: string[];
} | null {
  const context = stage?.bookLessonContext;
  if (!stage?.id || !context?.planId || !context.lessonId) return null;

  return {
    planId: context.planId,
    lessonId: context.lessonId,
    stageId: stage.id,
    knowledgePointIds: context.knowledgePointIds ?? [],
  };
}

async function queueEvidenceEmbedding(record: LearningEvidenceRecord): Promise<void> {
  try {
    if (typeof window === 'undefined') {
      const { upsertStudentEvidenceEmbedding } = await import('@/lib/server/vector-store');
      await upsertStudentEvidenceEmbedding(record.studentId, record);
      return;
    }

    const response = await fetch('/api/learning/evidence-vector', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: record.studentId, evidence: record }),
      keepalive: true,
    });
    if (!response.ok) {
      log.warn(`Evidence vector upsert returned ${response.status}`);
    }
  } catch (error) {
    log.warn('Evidence vector upsert failed:', error);
  }
}

export async function recordTeachBackHintEvidence(params: {
  stage: Stage | null | undefined;
  sceneId?: string | null;
  prompt?: string | null;
  studentId?: string;
  createdAt?: number;
}): Promise<LearningEvidenceRecord | null> {
  const context = resolveStageLearningContext(params.stage);
  if (!context) return null;

  const now = params.createdAt ?? Date.now();
  const record: LearningEvidenceRecord = {
    id: `teach-back-hint:${context.stageId}:${params.sceneId ?? 'unknown'}:${now}`,
    studentId: params.studentId ?? LOCAL_STUDENT_ID,
    planId: context.planId,
    lessonId: context.lessonId,
    stageId: context.stageId,
    sceneId: params.sceneId ?? undefined,
    sourceType: 'qa',
    knowledgePointIds: context.knowledgePointIds,
    prompt: params.prompt || 'Teach-back whiteboard explanation',
    response: 'USER_REQUESTED_HINT',
    createdAt: now,
    updatedAt: now,
    metadata: {
      evidenceKind: 'teach-back-bailout',
      tags: ['建构受阻/需引导'],
      icapLevel: 'constructive',
      hiddenControlMessage: true,
    },
  };

  await saveLearningEvidenceRecords([record]);
  void queueEvidenceEmbedding(record);
  return record;
}

export async function recordDebateJudgmentEvidence(params: {
  stage: Stage | null | undefined;
  sessionId?: string;
  sceneId?: string | null;
  debateTopic?: string;
  judgmentText: string;
  studentId?: string;
  createdAt?: number;
}): Promise<LearningEvidenceRecord | null> {
  const context = resolveStageLearningContext(params.stage);
  const judgmentText = params.judgmentText.trim();
  if (!context || !judgmentText) return null;

  const now = params.createdAt ?? Date.now();
  const record: LearningEvidenceRecord = {
    id: `debate-judgment:${context.stageId}:${params.sessionId ?? 'unknown'}`,
    studentId: params.studentId ?? LOCAL_STUDENT_ID,
    planId: context.planId,
    lessonId: context.lessonId,
    stageId: context.stageId,
    sceneId: params.sceneId ?? undefined,
    sessionId: params.sessionId,
    sourceType: 'qa',
    knowledgePointIds: context.knowledgePointIds,
    prompt: params.debateTopic
      ? `Debate final judgment: ${params.debateTopic}`
      : 'Debate final judgment',
    response: judgmentText,
    createdAt: now,
    updatedAt: now,
    metadata: {
      evidenceKind: 'debate-judgment',
      tags: ['批判性思维/观点判决'],
      icapLevel: 'interactive',
    },
  };

  await saveLearningEvidenceRecords([record]);
  void queueEvidenceEmbedding(record);
  return record;
}

function findNeighborAssistantText(
  messages: UIMessage[],
  startIndex: number,
  direction: -1 | 1,
): string {
  for (
    let index = startIndex + direction;
    index >= 0 && index < messages.length;
    index += direction
  ) {
    const candidate = messages[index];
    if (candidate.role !== 'assistant') continue;
    const text = extractMessageText(candidate);
    if (text) return text;
  }

  return '';
}

export function scoreToKnowledgeStatus(score: number): KnowledgePointStatus {
  if (score >= 0.8) return 'mastered';
  if (score >= 0.55) return 'review';
  return 'weak';
}

export function summarizeKnowledgePointEvidence(evidence: LearningEvidenceRecord[]): {
  score: number;
  evidenceCount: number;
  quizEvidenceCount: number;
  qaEvidenceCount: number;
  voiceEvidenceCount: number;
  practiceEvidenceCount: number;
  homeworkEvidenceCount: number;
  lastEvidenceAt: number;
} {
  const scoredEvidence = evidence
    .filter(
      (item) =>
        item.sourceType === 'quiz' ||
        item.sourceType === 'practice' ||
        item.sourceType === 'homework',
    )
    .map((item) => item.normalizedScore)
    .filter((value): value is number => typeof value === 'number');
  const qaEvidenceCount = evidence.filter((item) => item.sourceType === 'qa').length;
  const voiceEvidenceCount = evidence.filter((item) => item.sourceType === 'voice').length;
  const quizEvidenceCount = evidence.filter((item) => item.sourceType === 'quiz').length;
  const practiceEvidenceCount = evidence.filter((item) => item.sourceType === 'practice').length;
  const homeworkEvidenceCount = evidence.filter((item) => item.sourceType === 'homework').length;
  const scoredAverage = average(scoredEvidence);
  const interactionEvidenceCount = qaEvidenceCount + voiceEvidenceCount;

  let score = 0.25;
  if (scoredAverage !== null) {
    score = scoredAverage;
    if (interactionEvidenceCount > 0) {
      score += 0.05;
    }
  } else if (interactionEvidenceCount > 0) {
    score = 0.45;
  }

  return {
    score: clamp(score),
    evidenceCount: evidence.length,
    quizEvidenceCount,
    qaEvidenceCount,
    voiceEvidenceCount,
    practiceEvidenceCount,
    homeworkEvidenceCount,
    lastEvidenceAt: evidence.reduce((max, item) => Math.max(max, item.updatedAt), 0),
  };
}

export function extractChatEvidenceRecords(params: {
  planId: string;
  lessonId: string;
  stageId: string;
  knowledgePointIds: string[];
  sessions: ChatSession[];
  studentId?: string;
}): LearningEvidenceRecord[] {
  const studentId = params.studentId ?? LOCAL_STUDENT_ID;
  const records: LearningEvidenceRecord[] = [];

  for (const session of params.sessions) {
    if (session.type === 'lecture') continue;

    const userMessages = session.messages.filter(
      (message) => message.role === 'user' && !message.metadata?.hidden,
    );
    const normalizedUserTexts = new Set(
      userMessages
        .map((message) => extractMessageText(message).trim())
        .filter(Boolean)
        .map((text) => text.toLowerCase()),
    );

    const studentQuestion = session.config.studentQuestion?.trim();
    if (studentQuestion && !normalizedUserTexts.has(studentQuestion.toLowerCase())) {
      records.push({
        id: `qa:${params.stageId}:${session.id}:student-question`,
        studentId,
        planId: params.planId,
        lessonId: params.lessonId,
        stageId: params.stageId,
        sessionId: session.id,
        sourceType: 'qa',
        knowledgePointIds: params.knowledgePointIds,
        prompt: session.title || 'Student question',
        response: studentQuestion,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        metadata: {
          evidenceKind: 'student-question',
        },
      });
    }

    session.messages.forEach((message, index) => {
      if (message.role !== 'user') return;
      if (message.metadata?.hidden) return;

      const response = extractMessageText(message).trim();
      if (!response) return;

      const prompt =
        findNeighborAssistantText(session.messages, index, -1) ||
        session.title ||
        'Classroom interaction';
      const feedback = findNeighborAssistantText(session.messages, index, 1);
      const createdAt = message.metadata?.createdAt ?? session.updatedAt;

      records.push({
        id: `qa:${params.stageId}:${session.id}:${message.id}`,
        studentId,
        planId: params.planId,
        lessonId: params.lessonId,
        stageId: params.stageId,
        sessionId: session.id,
        sourceType: 'qa',
        knowledgePointIds: params.knowledgePointIds,
        prompt,
        response,
        createdAt,
        updatedAt: createdAt,
        metadata: feedback
          ? {
              evidenceKind: 'student-response',
              assistantFeedback: feedback,
            }
          : {
              evidenceKind: 'student-response',
            },
      });
    });
  }

  return records;
}

export function buildLessonSummaryText(params: {
  language: BookLearningLanguage;
  averageScore: number | null;
  quizQuestionCount: number;
  qaInteractionCount: number;
  voiceInteractionCount?: number;
  practiceQuestionCount?: number;
  masteredTitles: string[];
  weakTitles: string[];
}): string {
  const scoreText =
    params.averageScore === null
      ? params.language === 'zh-CN'
        ? '暂无测验分数'
        : 'No quiz score yet'
      : `${toPercent(params.averageScore)}%`;
  const masteredText =
    params.masteredTitles.length > 0
      ? params.masteredTitles.join('、')
      : params.language === 'zh-CN'
        ? '暂无'
        : 'None yet';
  const weakText =
    params.weakTitles.length > 0
      ? params.weakTitles.join('、')
      : params.language === 'zh-CN'
        ? '暂无'
        : 'None yet';

  if (params.language === 'zh-CN') {
    const voicePart = params.voiceInteractionCount
      ? `，语音记录 ${params.voiceInteractionCount} 段`
      : '';
    const practicePart = params.practiceQuestionCount
      ? `，课后练习 ${params.practiceQuestionCount} 题`
      : '';
    return `测验题 ${params.quizQuestionCount} 道，课堂互动 ${params.qaInteractionCount} 次${voicePart}${practicePart}，当前综合表现 ${scoreText}。掌握较好：${masteredText}。仍需巩固：${weakText}。`;
  }

  const voicePart = params.voiceInteractionCount
    ? `, voice records: ${params.voiceInteractionCount}`
    : '';
  const practicePart = params.practiceQuestionCount
    ? `, practice items: ${params.practiceQuestionCount}`
    : '';
  return `Quiz items: ${params.quizQuestionCount}, classroom interactions: ${params.qaInteractionCount}${voicePart}${practicePart}, current performance: ${scoreText}. Stronger points: ${masteredText}. Needs reinforcement: ${weakText}.`;
}

function buildProfileSummaryText(params: {
  language: BookLearningLanguage;
  completedLessons: number;
  totalLessons: number;
  strengths: string[];
  weaknesses: string[];
}): string {
  const strengthText =
    params.strengths.length > 0
      ? params.strengths.join('、')
      : params.language === 'zh-CN'
        ? '暂无明显强项'
        : 'No clear strengths yet';
  const weaknessText =
    params.weaknesses.length > 0
      ? params.weaknesses.join('、')
      : params.language === 'zh-CN'
        ? '暂无明显薄弱点'
        : 'No clear weak points yet';

  if (params.language === 'zh-CN') {
    return `已完成 ${params.completedLessons}/${params.totalLessons} 节。当前优势：${strengthText}。当前薄弱点：${weaknessText}。`;
  }

  return `Completed ${params.completedLessons}/${params.totalLessons} lessons. Current strengths: ${strengthText}. Current weak points: ${weaknessText}.`;
}

export async function finalizeBookLessonProfile(params: {
  plan: BookLearningPlan;
  lesson: BookLessonPlan;
  stageId: string;
  studentId?: string;
}): Promise<{
  masteryRecords: KnowledgeMasteryRecord[];
  lessonSummary: LessonSummaryRecord;
  profile: StudentLearningProfile;
}> {
  const studentId = params.studentId ?? LOCAL_STUDENT_ID;
  const sessions = await loadChatSessions(params.stageId);
  const existingEvidence = await listLearningEvidenceByStageId(params.stageId);
  const chatEvidence = extractChatEvidenceRecords({
    planId: params.plan.id,
    lessonId: params.lesson.id,
    stageId: params.stageId,
    knowledgePointIds: params.lesson.knowledgePointIds,
    sessions,
    studentId,
  });

  await saveLearningEvidenceRecords(chatEvidence);

  const evidenceMap = new Map<string, LearningEvidenceRecord>();
  for (const item of existingEvidence) {
    evidenceMap.set(item.id, item);
  }
  for (const item of chatEvidence) {
    evidenceMap.set(item.id, item);
  }

  const lessonEvidence = [...evidenceMap.values()].filter(
    (item) => item.planId === params.plan.id && item.lessonId === params.lesson.id,
  );
  const quizEvidence = lessonEvidence.filter((item) => item.sourceType === 'quiz');
  const practiceEvidence = lessonEvidence.filter((item) => item.sourceType === 'practice');
  const qaEvidence = lessonEvidence.filter((item) => item.sourceType === 'qa');
  const voiceEvidence = lessonEvidence.filter((item) => item.sourceType === 'voice');
  const quizAverage = average(
    [...quizEvidence, ...practiceEvidence]
      .map((item) => item.normalizedScore)
      .filter((value): value is number => typeof value === 'number'),
  );

  const masteryRecords = params.lesson.knowledgePointIds.map((knowledgePointId) => {
    const relatedEvidence = lessonEvidence.filter((item) =>
      item.knowledgePointIds.includes(knowledgePointId),
    );
    const summary = summarizeKnowledgePointEvidence(relatedEvidence);
    const status = scoreToKnowledgeStatus(summary.score);
    const now = Date.now();

    return {
      id: buildKnowledgeMasteryId(params.plan.id, knowledgePointId, studentId),
      studentId,
      planId: params.plan.id,
      lessonId: params.lesson.id,
      knowledgePointId,
      score: summary.score,
      status,
      evidenceCount: summary.evidenceCount,
      quizEvidenceCount: summary.quizEvidenceCount,
      qaEvidenceCount: summary.qaEvidenceCount,
      voiceEvidenceCount: summary.voiceEvidenceCount,
      practiceEvidenceCount: summary.practiceEvidenceCount,
      homeworkEvidenceCount: summary.homeworkEvidenceCount,
      lastEvidenceAt: summary.lastEvidenceAt || now,
      summary:
        params.plan.language === 'zh-CN'
          ? `测验 ${summary.quizEvidenceCount} 条，课后练习 ${summary.practiceEvidenceCount} 条，作业 ${summary.homeworkEvidenceCount} 条，互动 ${summary.qaEvidenceCount} 条，语音 ${summary.voiceEvidenceCount} 条，综合得分 ${toPercent(summary.score)}%。`
          : `Quiz evidence ${summary.quizEvidenceCount}, practice evidence ${summary.practiceEvidenceCount}, homework evidence ${summary.homeworkEvidenceCount}, interaction evidence ${summary.qaEvidenceCount}, voice evidence ${summary.voiceEvidenceCount}, score ${toPercent(summary.score)}%.`,
      createdAt: now,
      updatedAt: now,
    } satisfies KnowledgeMasteryRecord;
  });

  await saveKnowledgeMasteryRecords(masteryRecords);

  const masteryMap = new Map(
    masteryRecords.map((record) => [record.knowledgePointId, record] as const),
  );
  const lessonPoints = params.plan.knowledgePoints.filter((point) =>
    params.lesson.knowledgePointIds.includes(point.id),
  );
  const masteredTitles = lessonPoints
    .filter((point) => masteryMap.get(point.id)?.status === 'mastered')
    .map((point) => point.title);
  const weakTitles = lessonPoints
    .filter((point) => masteryMap.get(point.id)?.status === 'weak')
    .map((point) => point.title);
  const now = Date.now();

  const lessonSummary: LessonSummaryRecord = {
    id: buildLessonSummaryId(params.plan.id, params.lesson.id, studentId),
    studentId,
    planId: params.plan.id,
    lessonId: params.lesson.id,
    stageId: params.stageId,
    summary: buildLessonSummaryText({
      language: params.plan.language,
      averageScore: quizAverage,
      quizQuestionCount: quizEvidence.length,
      qaInteractionCount: qaEvidence.length,
      voiceInteractionCount: voiceEvidence.length,
      practiceQuestionCount: practiceEvidence.length,
      masteredTitles,
      weakTitles,
    }),
    averageScore: quizAverage,
    quizQuestionCount: quizEvidence.length,
    qaInteractionCount: qaEvidence.length,
    voiceInteractionCount: voiceEvidence.length,
    practiceQuestionCount: practiceEvidence.length,
    masteredKnowledgePointIds: lessonPoints
      .filter((point) => masteryMap.get(point.id)?.status === 'mastered')
      .map((point) => point.id),
    weakKnowledgePointIds: lessonPoints
      .filter((point) => masteryMap.get(point.id)?.status === 'weak')
      .map((point) => point.id),
    createdAt: now,
    updatedAt: now,
  };

  await saveLessonSummary(lessonSummary);

  const allMastery = await listKnowledgeMasteryByPlan(params.plan.id);
  const planPointMap = new Map(params.plan.knowledgePoints.map((point) => [point.id, point]));
  const strengths = [...allMastery]
    .sort((left, right) => right.score - left.score)
    .map((record) => planPointMap.get(record.knowledgePointId)?.title)
    .filter((title): title is string => Boolean(title))
    .slice(0, 3);
  const weaknesses = [...allMastery]
    .filter((record) => record.status === 'weak' || record.status === 'review')
    .sort((left, right) => left.score - right.score)
    .map((record) => planPointMap.get(record.knowledgePointId)?.title)
    .filter((title): title is string => Boolean(title))
    .slice(0, 3);
  const completedLessons =
    params.plan.lessons.filter((lesson) => lesson.status === 'completed').length +
    (params.lesson.status === 'completed' ? 0 : 1);
  const masteredKnowledgePointCount = allMastery.filter(
    (record) => record.status === 'mastered',
  ).length;
  const weakKnowledgePointCount = allMastery.filter((record) => record.status === 'weak').length;
  const existingProfile = await getOrCreateStudentLearningProfile(params.plan.id, studentId);

  const profile: StudentLearningProfile = {
    ...existingProfile,
    overallSummary: buildProfileSummaryText({
      language: params.plan.language,
      completedLessons,
      totalLessons: params.plan.totalLessons,
      strengths,
      weaknesses,
    }),
    strengths,
    weaknesses,
    completedLessons,
    masteredKnowledgePointCount,
    weakKnowledgePointCount,
    updatedAt: now,
  };

  await saveStudentLearningProfile(profile);

  return {
    masteryRecords,
    lessonSummary,
    profile,
  };
}

export async function recomputeBookLearningProfile(params: {
  plan: BookLearningPlan;
  studentId?: string;
}): Promise<{
  masteryRecords: KnowledgeMasteryRecord[];
  profile: StudentLearningProfile;
}> {
  const studentId = params.studentId ?? LOCAL_STUDENT_ID;
  const evidence = await listLearningEvidenceByPlan(params.plan.id);
  const now = Date.now();

  const masteryRecords = params.plan.knowledgePoints.map((point) => {
    const relatedEvidence = evidence.filter((item) => item.knowledgePointIds.includes(point.id));
    const summary = summarizeKnowledgePointEvidence(relatedEvidence);
    const latestEvidence = relatedEvidence.reduce<LearningEvidenceRecord | null>(
      (latest, item) => (!latest || item.updatedAt > latest.updatedAt ? item : latest),
      null,
    );

    return {
      id: buildKnowledgeMasteryId(params.plan.id, point.id, studentId),
      studentId,
      planId: params.plan.id,
      lessonId: latestEvidence?.lessonId ?? 'aggregate',
      knowledgePointId: point.id,
      score: summary.score,
      status: scoreToKnowledgeStatus(summary.score),
      evidenceCount: summary.evidenceCount,
      quizEvidenceCount: summary.quizEvidenceCount,
      qaEvidenceCount: summary.qaEvidenceCount,
      voiceEvidenceCount: summary.voiceEvidenceCount,
      practiceEvidenceCount: summary.practiceEvidenceCount,
      homeworkEvidenceCount: summary.homeworkEvidenceCount,
      lastEvidenceAt: summary.lastEvidenceAt || now,
      summary:
        params.plan.language === 'zh-CN'
          ? `测验 ${summary.quizEvidenceCount} 条，课后练习 ${summary.practiceEvidenceCount} 条，作业 ${summary.homeworkEvidenceCount} 条，互动 ${summary.qaEvidenceCount} 条，语音 ${summary.voiceEvidenceCount} 条，综合得分 ${toPercent(summary.score)}%。`
          : `Quiz evidence ${summary.quizEvidenceCount}, practice evidence ${summary.practiceEvidenceCount}, homework evidence ${summary.homeworkEvidenceCount}, interaction evidence ${summary.qaEvidenceCount}, voice evidence ${summary.voiceEvidenceCount}, score ${toPercent(summary.score)}%.`,
      createdAt: now,
      updatedAt: now,
    } satisfies KnowledgeMasteryRecord;
  });

  await saveKnowledgeMasteryRecords(masteryRecords);

  const strengths = masteryRecords
    .filter((record) => record.evidenceCount > 0)
    .sort((left, right) => right.score - left.score)
    .map(
      (record) =>
        params.plan.knowledgePoints.find((point) => point.id === record.knowledgePointId)?.title,
    )
    .filter((title): title is string => Boolean(title))
    .slice(0, 3);
  const weaknesses = masteryRecords
    .filter((record) => record.status === 'weak' || record.status === 'review')
    .sort((left, right) => left.score - right.score)
    .map(
      (record) =>
        params.plan.knowledgePoints.find((point) => point.id === record.knowledgePointId)?.title,
    )
    .filter((title): title is string => Boolean(title))
    .slice(0, 5);
  const completedLessons = params.plan.lessons.filter(
    (lesson) => lesson.status === 'completed',
  ).length;
  const existingProfile = await getOrCreateStudentLearningProfile(params.plan.id, studentId);

  const profile: StudentLearningProfile = {
    ...existingProfile,
    overallSummary: buildProfileSummaryText({
      language: params.plan.language,
      completedLessons,
      totalLessons: params.plan.totalLessons,
      strengths,
      weaknesses,
    }),
    strengths,
    weaknesses,
    completedLessons,
    masteredKnowledgePointCount: masteryRecords.filter((record) => record.status === 'mastered')
      .length,
    weakKnowledgePointCount: masteryRecords.filter((record) => record.status === 'weak').length,
    updatedAt: now,
  };

  await saveStudentLearningProfile(profile);

  return { masteryRecords, profile };
}

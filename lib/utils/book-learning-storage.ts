import { db } from './database';
import { finalizeBookLessonProfile } from '@/lib/learning/profile-engine';
import type {
  BookLearningPlan,
  BookLessonContent,
  BookLessonSummarySnapshot,
  BookProfileSnapshot,
} from '@/lib/types/book-learning';
import type { LessonSummaryRecord, StudentLearningProfile } from '@/lib/types/learning-profile';
import { deleteLearningProfileDataByPlan } from '@/lib/utils/learning-profile-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('BookLearningStorage');
const ACTIVE_BOOK_PLAN_ID_KEY = 'activeBookLearningPlanId';

function toLessonSummarySnapshot(
  plan: BookLearningPlan,
  summary: LessonSummaryRecord,
): BookLessonSummarySnapshot {
  const pointMap = new Map(plan.knowledgePoints.map((point) => [point.id, point.title]));

  return {
    summary: summary.summary,
    averageScore: summary.averageScore,
    quizQuestionCount: summary.quizQuestionCount,
    qaInteractionCount: summary.qaInteractionCount,
    masteredPointTitles: summary.masteredKnowledgePointIds
      .map((id) => pointMap.get(id))
      .filter((title): title is string => Boolean(title)),
    weakPointTitles: summary.weakKnowledgePointIds
      .map((id) => pointMap.get(id))
      .filter((title): title is string => Boolean(title)),
    updatedAt: summary.updatedAt,
  };
}

function toProfileSnapshot(profile: StudentLearningProfile): BookProfileSnapshot {
  return {
    overallSummary: profile.overallSummary,
    strengths: profile.strengths,
    weaknesses: profile.weaknesses,
    updatedAt: profile.updatedAt,
    completedLessons: profile.completedLessons,
    masteredKnowledgePointCount: profile.masteredKnowledgePointCount,
    weakKnowledgePointCount: profile.weakKnowledgePointCount,
  };
}

export async function saveBookLearningPlan(plan: BookLearningPlan): Promise<void> {
  try {
    await db.bookLearningPlans.put({
      ...plan,
      mode: plan.mode ?? 'classroom',
      updatedAt: Date.now(),
    });
  } catch (error) {
    log.error('Failed to save book learning plan:', error);
    throw error;
  }
}

function getStoredActiveBookLearningPlanId(): string | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    return localStorage.getItem(ACTIVE_BOOK_PLAN_ID_KEY);
  } catch {
    return null;
  }
}

export function setActiveBookLearningPlanId(planId: string | null): void {
  if (typeof localStorage === 'undefined') return;

  try {
    if (planId) {
      localStorage.setItem(ACTIVE_BOOK_PLAN_ID_KEY, planId);
    } else {
      localStorage.removeItem(ACTIVE_BOOK_PLAN_ID_KEY);
    }
  } catch (error) {
    log.warn('Failed to persist active book learning plan id:', error);
  }
}

export async function listBookLearningPlans(): Promise<BookLearningPlan[]> {
  try {
    return await db.bookLearningPlans.orderBy('updatedAt').reverse().toArray();
  } catch (error) {
    log.error('Failed to list book learning plans:', error);
    return [];
  }
}

export async function getActiveBookLearningPlan(): Promise<BookLearningPlan | null> {
  const activeId = getStoredActiveBookLearningPlanId();
  if (activeId) {
    const activePlan = await loadBookLearningPlan(activeId);
    if (activePlan) return activePlan;
    setActiveBookLearningPlanId(null);
  }

  const plans = await listBookLearningPlans();
  const fallback = plans[0] ?? null;
  if (fallback) setActiveBookLearningPlanId(fallback.id);
  return fallback;
}

export async function loadBookLearningPlan(id: string): Promise<BookLearningPlan | null> {
  try {
    return (await db.bookLearningPlans.get(id)) ?? null;
  } catch (error) {
    log.error(`Failed to load book learning plan ${id}:`, error);
    return null;
  }
}

export async function deleteBookLearningPlan(id: string): Promise<void> {
  try {
    await deleteLearningProfileDataByPlan(id);
    await db.bookPracticeSessions.where('planId').equals(id).delete();
    await db.bookLearningPlans.delete(id);
    if (getStoredActiveBookLearningPlanId() === id) {
      setActiveBookLearningPlanId(null);
    }
  } catch (error) {
    log.error(`Failed to delete book learning plan ${id}:`, error);
    throw error;
  }
}

export async function startBookLesson(planId: string, lessonId: string): Promise<BookLearningPlan> {
  const plan = await loadBookLearningPlan(planId);
  if (!plan) throw new Error('Book learning plan not found');

  const lessonIndex = plan.lessons.findIndex((lesson) => lesson.id === lessonId);
  if (lessonIndex < 0) throw new Error('Book lesson not found');

  const now = Date.now();
  const lessons = plan.lessons.map((lesson, index) =>
    index === lessonIndex
      ? {
          ...lesson,
          status: 'in_progress' as const,
          startedAt: lesson.startedAt ?? now,
        }
      : lesson,
  );

  const knowledgePointIds = new Set(lessons[lessonIndex].knowledgePointIds);
  const knowledgePoints = plan.knowledgePoints.map((point) =>
    knowledgePointIds.has(point.id) && point.status === 'pending'
      ? { ...point, status: 'learning' as const }
      : point,
  );

  const updated: BookLearningPlan = {
    ...plan,
    mode: 'classroom',
    lessons,
    knowledgePoints,
    currentLessonIndex: lessonIndex,
    updatedAt: now,
  };
  await saveBookLearningPlan(updated);
  return updated;
}

export async function saveBookLessonContent(params: {
  planId: string;
  lessonId: string;
  content: BookLessonContent;
}): Promise<BookLearningPlan> {
  const plan = await loadBookLearningPlan(params.planId);
  if (!plan) throw new Error('Book learning plan not found');

  const lessonIndex = plan.lessons.findIndex((lesson) => lesson.id === params.lessonId);
  if (lessonIndex < 0) throw new Error('Book lesson not found');

  const lessons = plan.lessons.map((lesson, index) =>
    index === lessonIndex
      ? {
          ...lesson,
          content: params.content,
        }
      : lesson,
  );

  const updated: BookLearningPlan = {
    ...plan,
    mode: plan.mode ?? 'classroom',
    lessons,
    updatedAt: Date.now(),
  };
  await saveBookLearningPlan(updated);
  return updated;
}

export async function completeBookLesson(
  planId: string,
  lessonId: string,
  options?: { stageId?: string },
): Promise<BookLearningPlan> {
  const plan = await loadBookLearningPlan(planId);
  if (!plan) throw new Error('Book learning plan not found');

  const lessonIndex = plan.lessons.findIndex((lesson) => lesson.id === lessonId);
  if (lessonIndex < 0) throw new Error('Book lesson not found');

  const now = Date.now();
  let knowledgePoints = plan.knowledgePoints;
  let latestSummary = plan.lessons[lessonIndex].latestSummary;
  let profileSnapshot = plan.profileSnapshot;

  if (options?.stageId) {
    const finalized = await finalizeBookLessonProfile({
      plan,
      lesson: plan.lessons[lessonIndex],
      stageId: options.stageId,
    });
    const masteryMap = new Map(
      finalized.masteryRecords.map((record) => [record.knowledgePointId, record.status] as const),
    );

    knowledgePoints = plan.knowledgePoints.map((point) =>
      masteryMap.has(point.id)
        ? {
            ...point,
            status: masteryMap.get(point.id)!,
          }
        : point,
    );
    latestSummary = toLessonSummarySnapshot(plan, finalized.lessonSummary);
    profileSnapshot = toProfileSnapshot(finalized.profile);
  }

  const lessons = plan.lessons.map((lesson, index) =>
    index === lessonIndex
      ? {
          ...lesson,
          status: 'completed' as const,
          completedAt: lesson.completedAt ?? now,
          latestSummary,
        }
      : lesson,
  );

  const nextLessonIndex = lessons.findIndex((lesson) => lesson.status !== 'completed');
  const allCompleted = nextLessonIndex < 0;

  const updated: BookLearningPlan = {
    ...plan,
    mode: allCompleted ? 'completed_pending_practice' : 'classroom',
    lessons,
    knowledgePoints,
    profileSnapshot,
    currentLessonIndex: allCompleted ? lessons.length - 1 : nextLessonIndex,
    updatedAt: now,
    completedAt: allCompleted ? (plan.completedAt ?? now) : undefined,
  };
  await saveBookLearningPlan(updated);
  return updated;
}

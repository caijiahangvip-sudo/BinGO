import { db } from '@/lib/utils/database';
import type {
  StudentLearningProfile,
  KnowledgeMasteryRecord,
  LearningEvidenceRecord,
  LessonSummaryRecord,
  LearningVoiceRecord,
} from '@/lib/types/learning-profile';

export const LOCAL_STUDENT_ID = 'local-student';

export function buildStudentLearningProfileId(
  planId: string,
  studentId = LOCAL_STUDENT_ID,
): string {
  return `${studentId}:${planId}`;
}

export function buildKnowledgeMasteryId(
  planId: string,
  knowledgePointId: string,
  studentId = LOCAL_STUDENT_ID,
): string {
  return `${studentId}:${planId}:${knowledgePointId}`;
}

export function buildLessonSummaryId(
  planId: string,
  lessonId: string,
  studentId = LOCAL_STUDENT_ID,
): string {
  return `${studentId}:${planId}:${lessonId}`;
}

export async function loadStudentLearningProfile(
  planId: string,
  studentId = LOCAL_STUDENT_ID,
): Promise<StudentLearningProfile | null> {
  return (await db.studentLearningProfiles.get(buildStudentLearningProfileId(planId, studentId))) ?? null;
}

export async function getOrCreateStudentLearningProfile(
  planId: string,
  studentId = LOCAL_STUDENT_ID,
): Promise<StudentLearningProfile> {
  const existing = await loadStudentLearningProfile(planId, studentId);
  if (existing) return existing;

  const now = Date.now();
  const profile: StudentLearningProfile = {
    id: buildStudentLearningProfileId(planId, studentId),
    studentId,
    planId,
    overallSummary: '',
    strengths: [],
    weaknesses: [],
    completedLessons: 0,
    masteredKnowledgePointCount: 0,
    weakKnowledgePointCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.studentLearningProfiles.put(profile);
  return profile;
}

export async function saveStudentLearningProfile(profile: StudentLearningProfile): Promise<void> {
  await db.studentLearningProfiles.put(profile);
}

export async function saveKnowledgeMasteryRecords(
  records: KnowledgeMasteryRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await db.knowledgeMastery.bulkPut(records);
}

export async function listKnowledgeMasteryByPlan(planId: string): Promise<KnowledgeMasteryRecord[]> {
  return db.knowledgeMastery.where('planId').equals(planId).toArray();
}

export async function saveLearningEvidenceRecords(
  records: LearningEvidenceRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await db.learningEvidence.bulkPut(records);
}

export async function listLearningEvidenceByStageId(
  stageId: string,
): Promise<LearningEvidenceRecord[]> {
  return db.learningEvidence.where('stageId').equals(stageId).toArray();
}

export async function listLearningEvidenceByPlan(
  planId: string,
): Promise<LearningEvidenceRecord[]> {
  return db.learningEvidence.where('planId').equals(planId).toArray();
}

export async function listLearningEvidenceByLesson(
  planId: string,
  lessonId: string,
): Promise<LearningEvidenceRecord[]> {
  return db.learningEvidence.where('[planId+lessonId]').equals([planId, lessonId]).toArray();
}

export async function saveLessonSummary(summary: LessonSummaryRecord): Promise<void> {
  await db.lessonSummaries.put(summary);
}

export async function saveLearningVoiceRecord(record: LearningVoiceRecord): Promise<void> {
  await db.learningVoiceRecords.put(record);
}

export async function saveLearningVoiceRecords(records: LearningVoiceRecord[]): Promise<void> {
  if (records.length === 0) return;
  await db.learningVoiceRecords.bulkPut(records);
}

export async function listLearningVoiceRecordsByStageId(
  stageId: string,
): Promise<LearningVoiceRecord[]> {
  return db.learningVoiceRecords.where('stageId').equals(stageId).toArray();
}

export async function loadLessonSummary(
  planId: string,
  lessonId: string,
  studentId = LOCAL_STUDENT_ID,
): Promise<LessonSummaryRecord | null> {
  return (await db.lessonSummaries.get(buildLessonSummaryId(planId, lessonId, studentId))) ?? null;
}

export async function deleteLearningProfileDataByPlan(planId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.studentLearningProfiles,
      db.knowledgeMastery,
      db.learningEvidence,
      db.lessonSummaries,
      db.learningVoiceRecords,
    ],
    async () => {
      await db.studentLearningProfiles.where('planId').equals(planId).delete();
      await db.knowledgeMastery.where('planId').equals(planId).delete();
      await db.learningEvidence.where('planId').equals(planId).delete();
      await db.lessonSummaries.where('planId').equals(planId).delete();
      await db.learningVoiceRecords.where('planId').equals(planId).delete();
    },
  );
}

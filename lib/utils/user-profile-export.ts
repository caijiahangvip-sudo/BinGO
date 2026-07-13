import { db, initDatabase } from '@/lib/utils/database';

function readLocalStorageJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function exportUserLearningProfileSnapshot() {
  await initDatabase();

  const [
    bookLearningPlans,
    bookPracticeSessions,
    homeworkSessions,
    studentLearningProfiles,
    knowledgeMastery,
    learningEvidence,
    lessonSummaries,
    learningVoiceRecords,
  ] = await Promise.all([
    db.bookLearningPlans.toArray(),
    db.bookPracticeSessions.toArray(),
    db.homeworkSessions.toArray(),
    db.studentLearningProfiles.toArray(),
    db.knowledgeMastery.toArray(),
    db.learningEvidence.toArray(),
    db.lessonSummaries.toArray(),
    db.learningVoiceRecords.toArray(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    userProfile: readLocalStorageJson('user-profile-storage'),
    summary: {
      bookLearningPlans: bookLearningPlans.length,
      bookPracticeSessions: bookPracticeSessions.length,
      homeworkSessions: homeworkSessions.length,
      studentLearningProfiles: studentLearningProfiles.length,
      knowledgeMastery: knowledgeMastery.length,
      learningEvidence: learningEvidence.length,
      lessonSummaries: lessonSummaries.length,
      learningVoiceRecords: learningVoiceRecords.length,
    },
    bookLearningPlans,
    bookPracticeSessions,
    homeworkSessions,
    studentLearningProfiles,
    knowledgeMastery,
    learningEvidence,
    lessonSummaries,
    learningVoiceRecords: learningVoiceRecords.map(({ audioBlob: _audioBlob, ...record }) => ({
      ...record,
      audioBlobOmitted: true,
    })),
  };
}

export async function exportUserLearningProfileJson(): Promise<Blob> {
  const snapshot = await exportUserLearningProfileSnapshot();
  return new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
}

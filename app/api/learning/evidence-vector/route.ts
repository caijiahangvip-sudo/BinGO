import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import {
  DEFAULT_RAG_STUDENT_ID,
  upsertStudentEvidenceEmbedding,
} from '@/lib/server/vector-store';
import type { LearningEvidenceRecord } from '@/lib/types/learning-profile';

const log = createLogger('EvidenceVectorAPI');

export const runtime = 'nodejs';

function isLearningEvidenceRecord(value: unknown): value is LearningEvidenceRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<LearningEvidenceRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.studentId === 'string' &&
    typeof record.planId === 'string' &&
    typeof record.lessonId === 'string' &&
    typeof record.stageId === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.response === 'string' &&
    Array.isArray(record.knowledgePointIds) &&
    record.knowledgePointIds.every((item) => typeof item === 'string') &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      studentId?: unknown;
      evidence?: unknown;
    };
    const evidence = body.evidence;
    if (!isLearningEvidenceRecord(evidence)) {
      return apiError('INVALID_REQUEST', 400, 'A valid LearningEvidenceRecord is required');
    }

    const studentId =
      typeof body.studentId === 'string' && body.studentId.trim()
        ? body.studentId.trim()
        : evidence.studentId || DEFAULT_RAG_STUDENT_ID;

    await upsertStudentEvidenceEmbedding(studentId, evidence);
    return apiSuccess({ upserted: true });
  } catch (error) {
    log.error('Failed to upsert learning evidence vector:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to upsert learning evidence vector',
    );
  }
}

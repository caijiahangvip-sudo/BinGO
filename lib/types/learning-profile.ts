import type { KnowledgePointStatus } from '@/lib/types/book-learning';

export type LearningEvidenceSource = 'quiz' | 'qa' | 'voice' | 'practice' | 'homework';

export interface LearningEvidenceRecord {
  id: string;
  studentId: string;
  planId: string;
  lessonId: string;
  stageId: string;
  sourceType: LearningEvidenceSource;
  knowledgePointIds: string[];
  prompt: string;
  response: string;
  sceneId?: string;
  sessionId?: string;
  correct?: boolean | null;
  earnedScore?: number;
  maxScore?: number;
  normalizedScore?: number;
  aiComment?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeMasteryRecord {
  id: string;
  studentId: string;
  planId: string;
  lessonId: string;
  knowledgePointId: string;
  score: number;
  status: KnowledgePointStatus;
  evidenceCount: number;
  quizEvidenceCount: number;
  qaEvidenceCount: number;
  voiceEvidenceCount?: number;
  practiceEvidenceCount?: number;
  homeworkEvidenceCount?: number;
  lastEvidenceAt: number;
  summary: string;
  createdAt: number;
  updatedAt: number;
}

export interface LessonSummaryRecord {
  id: string;
  studentId: string;
  planId: string;
  lessonId: string;
  stageId: string;
  summary: string;
  averageScore: number | null;
  quizQuestionCount: number;
  qaInteractionCount: number;
  voiceInteractionCount?: number;
  practiceQuestionCount?: number;
  masteredKnowledgePointIds: string[];
  weakKnowledgePointIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StudentLearningProfile {
  id: string;
  studentId: string;
  planId: string;
  overallSummary: string;
  strengths: string[];
  weaknesses: string[];
  completedLessons: number;
  masteredKnowledgePointCount: number;
  weakKnowledgePointCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface LearningVoiceRecord {
  id: string;
  studentId: string;
  planId?: string;
  lessonId?: string;
  stageId: string;
  sceneId?: string;
  knowledgePointIds: string[];
  transcript: string;
  audioBlob: Blob;
  mimeType: string;
  durationMs?: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

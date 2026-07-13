export type BookLearningLanguage = 'zh-CN' | 'en-US';
export type BookLearningMode = 'classroom' | 'completed_pending_practice' | 'practice';

export type KnowledgePointStatus = 'pending' | 'learning' | 'mastered' | 'review' | 'weak';

export interface BookKnowledgePoint {
  id: string;
  title: string;
  chapterTitle?: string;
  summary: string;
  order: number;
  difficulty: 'easy' | 'medium' | 'hard';
  prerequisites: string[];
  estimatedMinutes: number;
  status: KnowledgePointStatus;
}

export interface BookLessonLectureSection {
  title: string;
  explanation: string;
  examples: string[];
  checkpointQuestion?: string;
}

export interface BookPracticeQuestion {
  id: string;
  prompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  expectedAnswer: string;
  hints: string[];
  solution: string;
  knowledgePointIds?: string[];
  sourceUrls?: string[];
  sourceTitles?: string[];
  userAnswer?: string;
  earnedScore?: number;
  maxScore?: number;
  aiComment?: string;
  answeredAt?: number;
}

export interface BookPracticeSession {
  id: string;
  planId: string;
  studentId: string;
  title: string;
  targetKnowledgePointIds: string[];
  sourceUrls: string[];
  questions: BookPracticeQuestion[];
  status: 'generated' | 'completed';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface BookLessonContent {
  generatedAt: number;
  language: BookLearningLanguage;
  title: string;
  objective: string;
  lecture: {
    durationMinutes: number;
    sections: BookLessonLectureSection[];
  };
  practice: {
    durationMinutes: number;
    questions: BookPracticeQuestion[];
  };
  summary: {
    durationMinutes: number;
    keyTakeaways: string[];
    reviewFocus: string[];
    nextLessonPreview?: string;
  };
}

export interface BookLessonSummarySnapshot {
  summary: string;
  averageScore: number | null;
  quizQuestionCount: number;
  qaInteractionCount: number;
  masteredPointTitles: string[];
  weakPointTitles: string[];
  updatedAt: number;
}

export interface BookProfileSnapshot {
  overallSummary: string;
  strengths: string[];
  weaknesses: string[];
  updatedAt: number;
  completedLessons: number;
  masteredKnowledgePointCount: number;
  weakKnowledgePointCount: number;
}

export interface BookLessonPlan {
  id: string;
  order: number;
  title: string;
  objective: string;
  knowledgePointIds: string[];
  lectureMinutes: number;
  breakMinutes: number;
  practiceMinutes: number;
  summaryMinutes: number;
  status: 'pending' | 'in_progress' | 'completed';
  startedAt?: number;
  completedAt?: number;
  content?: BookLessonContent;
  latestSummary?: BookLessonSummarySnapshot;
}

export interface BookLearningPlan {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  pdfStorageKey: string;
  coverImage?: string;
  coverImageVersion?: number;
  language: BookLearningLanguage;
  summary: string;
  totalLessons: number;
  currentLessonIndex: number;
  mode?: BookLearningMode;
  knowledgePoints: BookKnowledgePoint[];
  lessons: BookLessonPlan[];
  profileSnapshot?: BookProfileSnapshot;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

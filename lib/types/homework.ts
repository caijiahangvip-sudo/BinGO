export type HomeworkLanguage = 'zh-CN' | 'en-US';
export type HomeworkFileType = 'pdf' | 'image';
export type HomeworkQuestionReviewStatus = 'understood' | 'needs_help';

export interface HomeworkQuestionSolution {
  id: string;
  question: string;
  answer: string;
  solution: string;
  knowledgePoints: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  confidence?: 'low' | 'medium' | 'high';
  reviewStatus?: HomeworkQuestionReviewStatus;
  reviewedAt?: number;
}

export interface HomeworkChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  questionId?: string;
  createdAt: number;
}

export interface HomeworkProfileImpact {
  strengths: string[];
  weaknesses: string[];
  unresolvedQuestions: string[];
  evidenceCount: number;
  updatedAt: number;
}

export interface HomeworkSession {
  id: string;
  studentId: string;
  title: string;
  fileName: string;
  fileType: HomeworkFileType;
  files?: Array<{
    name: string;
    type: HomeworkFileType;
    size: number;
  }>;
  language: HomeworkLanguage;
  questions: HomeworkQuestionSolution[];
  chatMessages: HomeworkChatMessage[];
  profileImpact: HomeworkProfileImpact;
  status: 'solved' | 'reviewing';
  createdAt: number;
  updatedAt: number;
}

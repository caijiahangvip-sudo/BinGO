import type {
  HomeworkLanguage,
  HomeworkQuestionSolution,
  HomeworkSession,
} from '@/lib/types/homework';

export type HomeworkSolveJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type HomeworkSolveJobStage =
  | 'queued'
  | 'validating'
  | 'parsing_pdf'
  | 'preparing_images'
  | 'dictionary_lookup'
  | 'generating_answers'
  | 'parsing_result'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface HomeworkSolveJobLog {
  timestamp: string;
  stage: HomeworkSolveJobStage;
  message: string;
  progress?: number;
}

export interface HomeworkSolveResult {
  title: string;
  fileName: string;
  fileType: 'pdf' | 'image';
  files: HomeworkSession['files'];
  language: HomeworkLanguage;
  questions: HomeworkQuestionSolution[];
  model: string;
}

export interface HomeworkSolveProgress {
  stage: HomeworkSolveJobStage;
  progress: number;
  message: string;
}

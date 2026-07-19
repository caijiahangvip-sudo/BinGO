export type BookPlanProgressPhase =
  | 'idle'
  | 'parsing'
  | 'planning'
  | 'saving'
  | 'complete'
  | 'error';

export function getBookPlanProgressView(phase: BookPlanProgressPhase) {
  switch (phase) {
    case 'parsing':
      return { step: 1, total: 4, percent: 25 };
    case 'planning':
      return { step: 2, total: 4, percent: 60 };
    case 'saving':
      return { step: 3, total: 4, percent: 85 };
    case 'complete':
      return { step: 4, total: 4, percent: 100 };
    case 'idle':
    case 'error':
      return { step: 0, total: 4, percent: 0 };
  }
}

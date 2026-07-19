import { describe, expect, it } from 'vitest';
import { getBookPlanProgressView } from '@/lib/generation/book-plan-progress';

describe('book plan progress', () => {
  it('maps each generation phase to a visible step and percentage', () => {
    expect(getBookPlanProgressView('parsing')).toMatchObject({ step: 1, total: 4, percent: 25 });
    expect(getBookPlanProgressView('planning')).toMatchObject({ step: 2, total: 4, percent: 60 });
    expect(getBookPlanProgressView('saving')).toMatchObject({ step: 3, total: 4, percent: 85 });
    expect(getBookPlanProgressView('complete')).toMatchObject({ step: 4, total: 4, percent: 100 });
    expect(getBookPlanProgressView('error')).toMatchObject({ step: 0, total: 4, percent: 0 });
  });
});

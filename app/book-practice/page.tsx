'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, RefreshCw, Send } from 'lucide-react';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { getModelApiHeaders } from '@/lib/utils/model-config';
import {
  getActiveBookLearningPlan,
  loadBookLearningPlan,
  saveBookLearningPlan,
  setActiveBookLearningPlanId,
} from '@/lib/utils/book-learning-storage';
import {
  completeBookPracticeSession,
  getLatestBookPracticeSession,
  saveBookPracticeSession,
} from '@/lib/utils/book-practice-storage';
import { LOCAL_STUDENT_ID } from '@/lib/utils/learning-profile-storage';
import { recomputeBookLearningProfile } from '@/lib/learning/profile-engine';
import type {
  BookKnowledgePoint,
  BookLearningPlan,
  BookPracticeQuestion,
  BookPracticeSession,
} from '@/lib/types/book-learning';
import type { StudentLearningProfile } from '@/lib/types/learning-profile';

const log = createLogger('BookPracticePage');

type GeneratePracticeResponse = {
  success?: boolean;
  questions?: BookPracticeQuestion[];
  sourceUrls?: string[];
  sourceTitles?: string[];
  error?: string;
};

type GradeResponse = {
  success?: boolean;
  score?: number;
  comment?: string;
  error?: string;
};

function profileSnapshotFrom(profile: StudentLearningProfile) {
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

function selectTargetKnowledgePoints(plan: BookLearningPlan): BookKnowledgePoint[] {
  const weakPoints = plan.knowledgePoints.filter(
    (point) => point.status === 'weak' || point.status === 'review',
  );
  if (weakPoints.length > 0) return weakPoints.slice(0, 8);

  const incomplete = plan.knowledgePoints.filter((point) => point.status !== 'mastered');
  if (incomplete.length > 0) return incomplete.slice(0, 8);

  return plan.knowledgePoints.slice(0, 8);
}

function sourceLabel(url: string, fallback?: string): string {
  if (fallback) return fallback;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function gradePracticeAnswer(params: {
  question: BookPracticeQuestion;
  answer: string;
  language: string;
}): Promise<{ earnedScore: number; aiComment: string }> {
  const response = await fetch('/api/quiz-grade', {
    method: 'POST',
    headers: getModelApiHeaders(),
    body: JSON.stringify({
      question: params.question.prompt,
      userAnswer: params.answer,
      points: params.question.maxScore || 1,
      language: params.language,
      commentPrompt: [
        `Expected answer: ${params.question.expectedAnswer}`,
        `Solution: ${params.question.solution}`,
      ].join('\n'),
    }),
  });

  const data = (await response.json().catch(() => ({}))) as GradeResponse;
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to grade practice answer');
  }

  return {
    earnedScore: typeof data.score === 'number' ? data.score : 0,
    aiComment: data.comment || '',
  };
}

function BookPracticePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState<BookLearningPlan | null>(null);
  const [session, setSession] = useState<BookPracticeSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetPoints = useMemo(() => (plan ? selectTargetKnowledgePoints(plan) : []), [plan]);
  const canSubmit =
    !!session &&
    session.status !== 'completed' &&
    session.questions.some((question) => answers[question.id]?.trim());

  const generatePractice = useCallback(async (activePlan: BookLearningPlan) => {
    const points = selectTargetKnowledgePoints(activePlan);
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/generate/practice-questions', {
        method: 'POST',
        headers: getModelApiHeaders(),
        body: JSON.stringify({
          planTitle: activePlan.title,
          language: activePlan.language,
          weaknesses: activePlan.profileSnapshot?.weaknesses || [],
          knowledgePoints: points.map((point) => ({
            id: point.id,
            title: point.title,
            summary: point.summary,
            status: point.status,
          })),
          count: 6,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as GeneratePracticeResponse;
      if (!response.ok || !data.success || !data.questions?.length) {
        throw new Error(data.error || 'Failed to generate practice questions');
      }

      const now = Date.now();
      const practiceSession: BookPracticeSession = {
        id: nanoid(),
        planId: activePlan.id,
        studentId: LOCAL_STUDENT_ID,
        title:
          activePlan.language === 'zh-CN'
            ? `${activePlan.title} 刷题训练`
            : `${activePlan.title} Practice Drill`,
        targetKnowledgePointIds: points.map((point) => point.id),
        sourceUrls: data.sourceUrls || [],
        questions: data.questions,
        status: 'generated',
        createdAt: now,
        updatedAt: now,
      };

      await saveBookPracticeSession(practiceSession);
      const updatedPlan: BookLearningPlan = {
        ...activePlan,
        mode: 'practice',
        updatedAt: now,
      };
      await saveBookLearningPlan(updatedPlan);
      setPlan(updatedPlan);
      setSession(practiceSession);
      setAnswers({});
    } catch (err) {
      log.error('Failed to generate practice:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate practice questions');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const requestedPlanId = searchParams.get('planId');
        const activePlan = requestedPlanId
          ? await loadBookLearningPlan(requestedPlanId)
          : await getActiveBookLearningPlan();
        if (!activePlan) {
          router.replace('/');
          return;
        }
        setActiveBookLearningPlanId(activePlan.id);

        if (cancelled) return;
        setPlan(activePlan);
        const latestSession = await getLatestBookPracticeSession(activePlan.id);
        if (cancelled) return;

        if (latestSession && latestSession.status === 'generated') {
          setSession(latestSession);
        } else {
          await generatePractice(activePlan);
        }
      } catch (err) {
        if (!cancelled) {
          log.error('Failed to load practice mode:', err);
          setError(err instanceof Error ? err.message : 'Failed to load practice mode');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [generatePractice, router, searchParams]);

  const submitPractice = async () => {
    if (!plan || !session || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const gradedQuestions: BookPracticeQuestion[] = [];
      for (const question of session.questions) {
        const answer = answers[question.id]?.trim() || '';
        if (!answer) {
          gradedQuestions.push({
            ...question,
            userAnswer: '',
            earnedScore: 0,
            maxScore: question.maxScore || 1,
            aiComment: plan.language === 'zh-CN' ? '未作答' : 'No answer submitted.',
            answeredAt: Date.now(),
          });
          continue;
        }

        const grade = await gradePracticeAnswer({
          question,
          answer,
          language: plan.language,
        });
        gradedQuestions.push({
          ...question,
          userAnswer: answer,
          earnedScore: grade.earnedScore,
          maxScore: question.maxScore || 1,
          aiComment: grade.aiComment,
          answeredAt: Date.now(),
        });
      }

      const completed = await completeBookPracticeSession({
        sessionId: session.id,
        questions: gradedQuestions,
      });
      const recomputed = await recomputeBookLearningProfile({ plan });
      const masteryMap = new Map(
        recomputed.masteryRecords.map(
          (record) => [record.knowledgePointId, record.status] as const,
        ),
      );
      const updatedPlan: BookLearningPlan = {
        ...plan,
        mode: 'practice',
        knowledgePoints: plan.knowledgePoints.map((point) =>
          masteryMap.has(point.id)
            ? {
                ...point,
                status: masteryMap.get(point.id)!,
              }
            : point,
        ),
        profileSnapshot: profileSnapshotFrom(recomputed.profile),
        updatedAt: Date.now(),
      };
      await saveBookLearningPlan(updatedPlan);
      setPlan(updatedPlan);
      setSession(completed);
    } catch (err) {
      log.error('Failed to submit practice:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit practice answers');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isZh = plan?.language === 'zh-CN';

  if (isLoading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-100">
        <Loader2 className="size-7 animate-spin text-violet-500" />
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-5 py-5 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-2xl font-semibold">{isZh ? '刷题训练' : 'Practice Drill'}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{plan?.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push('/')}>
              <ArrowLeft className="size-4" />
              {isZh ? '返回' : 'Back'}
            </Button>
            {plan && (
              <Button
                variant="outline"
                onClick={() => void generatePractice(plan)}
                disabled={isGenerating || isSubmitting}
              >
                {isGenerating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {isZh ? '换一组' : 'New Set'}
              </Button>
            )}
          </div>
        </header>

        {targetPoints.length > 0 && (
          <section className="flex flex-wrap gap-2">
            {targetPoints.map((point) => (
              <span
                key={point.id}
                className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200"
              >
                {point.title}
              </span>
            ))}
          </section>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}

        {isGenerating && !session ? (
          <section className="flex min-h-[50dvh] items-center justify-center rounded-md border border-dashed border-slate-300 dark:border-slate-700">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <Loader2 className="size-5 animate-spin text-violet-500" />
              {isZh ? '正在联网生成近年练习题...' : 'Searching the web for practice questions...'}
            </div>
          </section>
        ) : (
          session && (
            <>
              <section className="grid gap-4">
                {session.questions.map((question, index) => {
                  const completed = session.status === 'completed';
                  const score =
                    typeof question.earnedScore === 'number' &&
                    typeof question.maxScore === 'number'
                      ? `${question.earnedScore}/${question.maxScore}`
                      : null;

                  return (
                    <article
                      key={question.id}
                      className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                            <span>#{index + 1}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                              {question.difficulty}
                            </span>
                            {score && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                                {score}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-6">{question.prompt}</p>
                        </div>
                      </div>

                      <Textarea
                        className="mt-4 min-h-28"
                        value={answers[question.id] ?? question.userAnswer ?? ''}
                        disabled={completed || isSubmitting}
                        onChange={(event) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [question.id]: event.target.value,
                          }))
                        }
                        placeholder={isZh ? '输入你的答案' : 'Type your answer'}
                      />

                      {completed && (
                        <div className="mt-4 grid gap-3 text-sm">
                          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-800/70">
                            <div className="font-medium">
                              {isZh ? '参考答案' : 'Expected answer'}
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                              {question.expectedAnswer}
                            </p>
                          </div>
                          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-800/70">
                            <div className="font-medium">{isZh ? '解析' : 'Solution'}</div>
                            <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                              {question.solution}
                            </p>
                          </div>
                          {question.aiComment && (
                            <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-200">
                              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                              <span>{question.aiComment}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {question.sourceUrls && question.sourceUrls.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {question.sourceUrls.slice(0, 3).map((url, sourceIndex) => (
                            <a
                              key={`${question.id}:${url}`}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
                            >
                              <ExternalLink className="size-3" />
                              {sourceLabel(url, question.sourceTitles?.[sourceIndex])}
                            </a>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>

              <div className="sticky bottom-5 flex justify-end">
                <Button
                  className={cn('shadow-lg', session.status === 'completed' && 'hidden')}
                  disabled={!canSubmit || isSubmitting}
                  onClick={() => void submitPractice()}
                >
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {isZh ? '提交并更新画像' : 'Submit and Update Profile'}
                </Button>
              </div>
            </>
          )
        )}
      </div>
    </main>
  );
}

export default function BookPracticePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-100">
          <Loader2 className="size-7 animate-spin text-violet-500" />
        </main>
      }
    >
      <BookPracticePageContent />
    </Suspense>
  );
}

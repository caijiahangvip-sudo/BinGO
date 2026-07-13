'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useSettingsStore } from '@/lib/store/settings';
import { startBookLesson } from '@/lib/utils/book-learning-storage';
import { buildBookLessonGenerationSession } from '@/lib/utils/book-lesson-generation-session';
import type { BookLearningLanguage } from '@/lib/types/book-learning';

type BookLessonSession = {
  planId: string;
  lessonId: string;
  lessonOrder: number;
  language?: BookLearningLanguage;
  startedAt: number;
};

function getSession(): BookLessonSession | null {
  try {
    const raw = sessionStorage.getItem('bookLessonSession');
    return raw ? (JSON.parse(raw) as BookLessonSession) : null;
  } catch {
    return null;
  }
}

export default function BookClassroomPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function migrateToNormalClassroom() {
      try {
        const session = getSession();
        if (!session) {
          router.replace('/');
          return;
        }

        const updatedPlan = await startBookLesson(session.planId, session.lessonId);
        const lesson = updatedPlan.lessons.find((item) => item.id === session.lessonId);
        if (!lesson) throw new Error('Lesson not found.');

        const language = session.language || updatedPlan.language || 'zh-CN';
        const settings = useSettingsStore.getState();
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        const sessionState = buildBookLessonGenerationSession({
          plan: updatedPlan,
          lesson,
          language,
          pdfProviderId: settings.pdfProviderId,
          pdfProviderConfig: providerCfg
            ? {
                apiKey: providerCfg.apiKey,
                baseUrl: providerCfg.baseUrl,
              }
            : undefined,
        });

        sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
        sessionStorage.removeItem('bookLessonSession');

        if (!cancelled) router.replace('/generation-preview');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to start the classroom.');
        }
      }
    }

    void migrateToNormalClassroom();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-[100dvh] bg-[linear-gradient(135deg,#f2fbff_0%,#f5f1fb_48%,#fff0f5_100%)] px-5 py-5 text-slate-800 dark:bg-[linear-gradient(135deg,#0f172a_0%,#1d1b2f_52%,#281f2b_100%)] dark:text-slate-100">
      <section className="flex min-h-[calc(100dvh-40px)] flex-col items-center justify-center gap-4 text-center">
        {error ? (
          <>
            <h1 className="text-2xl font-semibold">Unable to start classroom</h1>
            <p className="max-w-xl text-sm text-red-500">{error}</p>
          </>
        ) : (
          <>
            <Loader2 className="size-7 animate-spin text-violet-500" />
            <div>
              <h1 className="text-2xl font-semibold">Starting normal Bingo classroom</h1>
              <p className="mt-2 text-sm text-slate-500">
                Generating classroom roles, lesson outline, and scene content.
              </p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

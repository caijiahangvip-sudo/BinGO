'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ImagePlus,
  Pencil,
  Trash2,
  Settings,
  Sun,
  Moon,
  Monitor,
  BotOff,
  ChevronUp,
  BookOpen,
  ClipboardCheck,
  Compass,
  LibraryBig,
  Loader2,
  Palette,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { useTheme } from '@/lib/hooks/use-theme';
import { nanoid } from 'nanoid';
import { loadPdfBlob, storePdfBlob } from '@/lib/utils/image-storage';
import type { UserRequirements } from '@/lib/types/generation';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  StageListItem,
  listStages,
  deleteStageData,
  renameStage,
  getFirstSlideByStages,
} from '@/lib/utils/stage-storage';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import type { Slide } from '@/lib/types/slides';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { getModelApiHeaders } from '@/lib/utils/model-config';
import {
  getActiveBookLearningPlan,
  deleteBookLearningPlan,
  listBookLearningPlans,
  saveBookLearningPlan,
  setActiveBookLearningPlanId,
  startBookLesson,
} from '@/lib/utils/book-learning-storage';
import { buildBookLessonGenerationSession } from '@/lib/utils/book-lesson-generation-session';
import type { BookLearningPlan } from '@/lib/types/book-learning';
import type { Locale } from '@/lib/i18n';
import { shouldUseOpenAIResponsesApi } from '@/lib/ai/openai-routing';
import { useTourStore } from '@/lib/store/tour';
import { trackEvent } from '@/lib/telemetry';
import { COLOR_THEME_PRESETS } from '@/lib/theme/color-themes';
import { getCurrentColorTheme } from '@/lib/theme/theme-runtime';
import {
  getBookPlanProgressView,
  type BookPlanProgressPhase,
} from '@/lib/generation/book-plan-progress';

const log = createLogger('Home');

const LANGUAGE_STORAGE_KEY = 'generationLanguage';
const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';
const PDF_COVER_IMAGE_VERSION = 3;
const BOOK_PDF_PARSE_TIMEOUT_MS = 15 * 60 * 1000;
const BOOK_PDF_FAST_MAX_PAGES = 8;

type ParsePdfApiResponse = {
  success?: boolean;
  data?: {
    text: string;
    images?: string[];
    coverImage?: string;
    metadata?: {
      fileName?: string;
      fileSize?: number;
      pageCount?: number;
    };
  };
  error?: string;
};

async function readApiJson<T>(response: Response, fallbackError: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    log.error('API returned a non-JSON response:', {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType: contentType || 'unknown',
      bodyPreview: body.replace(/\s+/g, ' ').slice(0, 200),
    });
    throw new Error(fallbackError);
  }

  try {
    return JSON.parse(body) as T;
  } catch (error) {
    log.error('Failed to parse API JSON response:', {
      url: response.url,
      status: response.status,
      contentType,
      bodyPreview: body.replace(/\s+/g, ' ').slice(0, 200),
      error,
    });
    throw new Error(fallbackError);
  }
}

type GenerateBookPlanApiResponse = {
  success?: boolean;
  plan?: BookLearningPlan;
  warning?: string;
  error?: string;
};

type PdfCoverApiResponse = {
  success?: boolean;
  coverImage?: string;
  error?: string;
};

function isInlineImageSrc(src: unknown): src is string {
  return typeof src === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(src.trim());
}

function getInlineParsedCoverImage(data?: ParsePdfApiResponse['data']): string | undefined {
  if (isInlineImageSrc(data?.coverImage)) return data.coverImage;
  return data?.images?.find(isInlineImageSrc);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getBookPdfParseTimeoutMessage(locale: Locale): string {
  return locale === 'zh-CN'
    ? 'PDF 快速解析超时。Bingo 已在首次快速超时后自动重启 MinerU 并延长时间重试，仍未完成；如果文件很大，可以拆分 PDF，或调高 BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS。'
    : 'Fast PDF parsing timed out. Bingo already restarted MinerU after the initial fast timeout and retried with a longer window; split a large PDF or increase BINGO_MINERU_FAST_PDF_RETRY_TASK_TIMEOUT_MS.';
}

async function renderPdfCoverFromFile(file: File): Promise<string | undefined> {
  try {
    const formData = new FormData();
    formData.append(
      'pdf',
      new File([file], file.name || 'book.pdf', {
        type: file.type || 'application/pdf',
      }),
    );

    const response = await fetch('/api/pdf-cover', {
      method: 'POST',
      body: formData,
    });
    const result = (await response.json()) as PdfCoverApiResponse;
    if (!response.ok || !result.success || !isInlineImageSrc(result.coverImage)) {
      log.warn('Failed to render PDF cover:', result.error || response.statusText);
      return undefined;
    }

    return result.coverImage;
  } catch (err) {
    log.warn('Failed to render PDF cover:', err);
    return undefined;
  }
}

function getBookPlanProgress(plan: BookLearningPlan) {
  const completedLessons = plan.lessons.filter((lesson) => lesson.status === 'completed').length;
  const progressPercent = plan.totalLessons
    ? Math.round((completedLessons / plan.totalLessons) * 100)
    : 0;
  const nextLesson = plan.lessons.find((lesson) => lesson.status !== 'completed') ?? null;
  const currentLesson =
    nextLesson ??
    plan.lessons[plan.currentLessonIndex] ??
    plan.lessons[plan.lessons.length - 1] ??
    null;

  return {
    completedLessons,
    progressPercent,
    nextLesson,
    currentLesson,
  };
}

interface FormState {
  pdfFile: File | null;
  requirement: string;
  language: 'zh-CN' | 'en-US';
}

const initialFormState: FormState = {
  pdfFile: null,
  requirement: '',
  language: 'zh-CN',
};

function HomePage() {
  const { t, locale } = useI18n();
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const router = useRouter();
  const startTour = useTourStore.use.startTour();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  // Draft cache for requirement text
  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } =
    useDraftCache<string>({ key: 'requirementDraft' });

  // Model setup state
  const currentModelId = useSettingsStore((s) => s.modelId);
  const [recentOpen, setRecentOpen] = useState(true);

  // Hydrate client-only state after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setRecentOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
    try {
      const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const updates: Partial<FormState> = {};
      if (savedLanguage === 'zh-CN' || savedLanguage === 'en-US') {
        updates.language = savedLanguage;
      } else {
        updates.language = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
      }
      if (Object.keys(updates).length > 0) {
        setForm((prev) => ({ ...prev, ...updates }));
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [locale]);

  // Restore requirement draft from cache (derived state pattern — no effect needed)
  const [prevCachedRequirement, setPrevCachedRequirement] = useState(cachedRequirement);
  if (cachedRequirement !== prevCachedRequirement) {
    setPrevCachedRequirement(cachedRequirement);
    if (cachedRequirement) {
      setForm((prev) => ({ ...prev, requirement: cachedRequirement }));
    }
  }

  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, Slide>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteBookPlanId, setPendingDeleteBookPlanId] = useState<string | null>(null);
  const [bookPlans, setBookPlans] = useState<BookLearningPlan[]>([]);
  const [activeBookPlan, setActiveBookPlan] = useState<BookLearningPlan | null>(null);
  const [bookShelfOpen, setBookShelfOpen] = useState(false);
  const [isCreatingBookPlan, setIsCreatingBookPlan] = useState(false);
  const [bookPlanPhase, setBookPlanPhase] = useState<BookPlanProgressPhase>('idle');
  const [isDeletingBookPlan, setIsDeletingBookPlan] = useState(false);
  const [openingClassroomId, setOpeningClassroomId] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!themeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen]);

  const loadClassrooms = useCallback(async () => {
    try {
      const list = await listStages();
      setClassrooms(list);
      // Load first slide thumbnails
      if (list.length > 0) {
        const slides = await getFirstSlideByStages(list.map((c) => c.id));
        setThumbnails(slides);
      }
    } catch (err) {
      log.error('Failed to load classrooms:', err);
    }
  }, []);

  const prefetchClassroom = useCallback(
    (id: string) => {
      try {
        router.prefetch(`/classroom/${id}`);
      } catch {
        /* prefetch is best-effort */
      }
    },
    [router],
  );

  const openClassroom = useCallback(
    (id: string) => {
      const href = `/classroom/${id}`;
      setOpeningClassroomId(id);
      try {
        router.prefetch(href);
      } catch {
        /* prefetch is best-effort */
      }
      router.push(href);
    },
    [router],
  );

  const refreshBookPlanCover = useCallback(async (plan: BookLearningPlan) => {
    try {
      const pdfBlob = await loadPdfBlob(plan.pdfStorageKey);
      if (!pdfBlob) return;

      const formData = new FormData();
      formData.append(
        'pdf',
        new File([pdfBlob], plan.fileName || 'book.pdf', {
          type: pdfBlob.type || 'application/pdf',
        }),
      );

      const response = await fetch('/api/pdf-cover', {
        method: 'POST',
        body: formData,
      });
      const result = (await response.json()) as PdfCoverApiResponse;
      if (!response.ok || !result.success || !isInlineImageSrc(result.coverImage)) {
        if (plan.coverImage && !isInlineImageSrc(plan.coverImage)) {
          const updatedPlan: BookLearningPlan = {
            ...plan,
            coverImage: undefined,
            coverImageVersion: undefined,
          };
          await saveBookLearningPlan(updatedPlan);
          setActiveBookPlan((current) => (current?.id === plan.id ? updatedPlan : current));
          setBookPlans((current) =>
            current.map((item) => (item.id === plan.id ? updatedPlan : item)),
          );
        }
        return;
      }

      const updatedPlan: BookLearningPlan = {
        ...plan,
        coverImage: result.coverImage,
        coverImageVersion: PDF_COVER_IMAGE_VERSION,
      };
      await saveBookLearningPlan(updatedPlan);
      setActiveBookPlan((current) => (current?.id === plan.id ? updatedPlan : current));
      setBookPlans((current) => current.map((item) => (item.id === plan.id ? updatedPlan : item)));
    } catch (err) {
      log.warn('Failed to refresh book cover:', err);
    }
  }, []);

  const loadBookPlan = useCallback(async () => {
    try {
      const [plans, plan] = await Promise.all([
        listBookLearningPlans(),
        getActiveBookLearningPlan(),
      ]);
      setBookPlans(plans);
      setActiveBookPlan(plan);
      if (plan && plan.coverImageVersion !== PDF_COVER_IMAGE_VERSION) {
        void refreshBookPlanCover(plan);
      }
    } catch (err) {
      log.error('Failed to load book learning plan:', err);
    }
  }, [refreshBookPlanCover]);

  useEffect(() => {
    // Clear stale media store to prevent cross-course thumbnail contamination.
    // The store may hold tasks from a previously visited classroom whose elementIds
    // (gen_img_1, etc.) collide with other courses' placeholders.
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    loadClassrooms();
    loadBookPlan();
  }, [loadBookPlan, loadClassrooms]);

  useEffect(() => {
    for (const classroom of classrooms.slice(0, 12)) {
      prefetchClassroom(classroom.id);
    }
  }, [classrooms, prefetchClassroom]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmDelete = async (id: string) => {
    setPendingDeleteId(null);
    try {
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const clearDeletedBookPlanSessions = (planId: string) => {
    try {
      const rawGenerationSession = sessionStorage.getItem('generationSession');
      if (rawGenerationSession) {
        const parsed = JSON.parse(rawGenerationSession) as {
          bookLessonContext?: { planId?: string };
        };
        if (parsed.bookLessonContext?.planId === planId) {
          sessionStorage.removeItem('generationSession');
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const rawBookLessonSession = sessionStorage.getItem('bookLessonSession');
      if (rawBookLessonSession) {
        const parsed = JSON.parse(rawBookLessonSession) as { planId?: string };
        if (parsed.planId === planId) {
          sessionStorage.removeItem('bookLessonSession');
        }
      }
    } catch {
      /* ignore */
    }
  };

  const handleSelectBookPlan = (plan: BookLearningPlan) => {
    setActiveBookLearningPlanId(plan.id);
    setActiveBookPlan(plan);
    setBookShelfOpen(false);
    setPendingDeleteBookPlanId(null);
    if (plan.coverImageVersion !== PDF_COVER_IMAGE_VERSION) {
      void refreshBookPlanCover(plan);
    }
  };

  const confirmDeleteBookPlan = async (planId: string) => {
    setIsDeletingBookPlan(true);
    try {
      await deleteBookLearningPlan(planId);
      clearDeletedBookPlanSessions(planId);
      const plans = await listBookLearningPlans();
      const nextActivePlan = plans[0] ?? null;
      setBookPlans(plans);
      setActiveBookPlan(nextActivePlan);
      setActiveBookLearningPlanId(nextActivePlan?.id ?? null);
      if (!nextActivePlan) {
        setBookShelfOpen(false);
      }
      toast.success(locale === 'zh-CN' ? '学习计划已删除' : 'Learning plan deleted');
    } catch (err) {
      log.error('Failed to delete book learning plan:', err);
      toast.error(locale === 'zh-CN' ? '删除学习计划失败' : 'Failed to delete learning plan');
    } finally {
      setPendingDeleteBookPlanId(null);
      setIsDeletingBookPlan(false);
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await renameStage(id, newName);
      setClassrooms((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    } catch (err) {
      log.error('Failed to rename classroom:', err);
      toast.error(t('classroom.renameFailed'));
    }
  };

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'language') localStorage.setItem(LANGUAGE_STORAGE_KEY, String(value));
      if (field === 'requirement') updateRequirementCache(value as string);
    } catch {
      /* ignore */
    }
  };

  const syncGenerationLanguageFromLocale = (nextLocale: Locale) => {
    const nextLanguage: FormState['language'] = nextLocale === 'zh-CN' ? 'zh-CN' : 'en-US';
    updateForm('language', nextLanguage);
    toast.success(
      nextLanguage === 'zh-CN'
        ? '已切换为简体中文，之后所有生成都会使用简体中文'
        : 'Switched to English. Future generation will use English.',
    );
  };

  const showSetupToast = (icon: React.ReactNode, title: string, desc: string) => {
    toast.custom(
      (id) => (
        <div
          className="w-[356px] rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-gradient-to-r from-amber-50 via-white to-amber-50 dark:from-amber-950/60 dark:via-slate-900 dark:to-amber-950/60 shadow-lg shadow-amber-500/8 dark:shadow-amber-900/20 p-4 flex items-start gap-3 cursor-pointer"
          onClick={() => {
            toast.dismiss(id);
            setSettingsOpen(true);
          }}
        >
          <div className="shrink-0 mt-0.5 size-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center ring-1 ring-amber-200/50 dark:ring-amber-800/30">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 leading-tight">
              {title}
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-0.5 leading-relaxed">
              {desc}
            </p>
          </div>
          <div className="shrink-0 mt-1 text-[10px] font-medium text-amber-500 dark:text-amber-500/70 tracking-wide">
            <Settings className="size-3.5 animate-[spin_3s_linear_infinite]" />
          </div>
        </div>
      ),
      { duration: 4000 },
    );
  };

  const handleGenerate = async () => {
    // Validate setup before proceeding
    if (!currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600 dark:text-amber-400" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    if (!form.requirement.trim() && !form.pdfFile) {
      setError(t('upload.requirementRequired'));
      return;
    }

    setError(null);

    try {
      const activeColorTheme = getCurrentColorTheme(colorTheme);
      const userProfile = useUserProfileStore.getState();
      const defaultPdfRequirement =
        form.language === 'zh-CN'
          ? '请根据我上传的 PDF 生成一个完整的互动课堂，包括讲解幻灯片、知识检查题目，以及必要的补充示例、互动或项目活动。'
          : 'Generate a complete interactive classroom from the uploaded PDF, including lecture slides, knowledge-check questions, and useful supplementary examples, interactions, or activities.';
      const requirements: UserRequirements = {
        requirement: form.requirement.trim() || defaultPdfRequirement,
        language: form.language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        visualTheme: activeColorTheme,
      };

      let pdfStorageKey: string | undefined;
      let pdfFileName: string | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string } | undefined;

      if (form.pdfFile) {
        pdfStorageKey = await storePdfBlob(form.pdfFile);
        pdfFileName = form.pdfFile.name;

        const settings = useSettingsStore.getState();
        pdfProviderId = settings.pdfProviderId;
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        if (providerCfg) {
          pdfProviderConfig = {
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.baseUrl,
          };
        }
      }

      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        pdfStorageKey,
        pdfFileName,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating' as const,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('classroom.today');
    if (diffDays === 1) return t('classroom.yesterday');
    if (diffDays < 7) return `${diffDays} ${t('classroom.daysAgo')}`;
    return date.toLocaleDateString();
  };

  const canGenerate = !!form.requirement.trim() && !isCreatingBookPlan;
  const canCreateBookPlan = !!form.pdfFile && !isCreatingBookPlan;
  const canStartBookPractice =
    !!activeBookPlan &&
    (activeBookPlan.mode === 'completed_pending_practice' || activeBookPlan.mode === 'practice') &&
    !form.pdfFile &&
    !form.requirement.trim() &&
    !isCreatingBookPlan;
  const primaryActionEnabled = canCreateBookPlan || canGenerate || canStartBookPractice;

  const getApiHeaders = () => {
    return getModelApiHeaders();
  };

  const createBookLearningPlan = async () => {
    if (!currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600 dark:text-amber-400" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    if (!form.pdfFile) {
      setError('Please upload a PDF book first');
      return;
    }

    setError(null);
    setIsCreatingBookPlan(true);
    setBookPlanPhase('parsing');

    try {
      const pdfStorageKey = await storePdfBlob(form.pdfFile);
      const parseFormData = new FormData();
      parseFormData.append('pdf', form.pdfFile);

      const settings = useSettingsStore.getState();
      parseFormData.append('providerId', settings.pdfProviderId);
      const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
      if (providerCfg?.apiKey?.trim()) {
        parseFormData.append('apiKey', providerCfg.apiKey);
      }
      if (providerCfg?.baseUrl?.trim()) {
        parseFormData.append('baseUrl', providerCfg.baseUrl);
      }
      parseFormData.append('mode', 'fast');
      parseFormData.append('needsCover', 'false');
      parseFormData.append('needsImages', 'false');
      parseFormData.append('needsMiddleJson', 'false');
      parseFormData.append('maxPages', String(BOOK_PDF_FAST_MAX_PAGES));

      const parseAbortController = new AbortController();
      const parseTimeout = window.setTimeout(() => {
        parseAbortController.abort();
      }, BOOK_PDF_PARSE_TIMEOUT_MS);
      let parseResponse: Response;
      try {
        parseResponse = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: parseFormData,
          signal: parseAbortController.signal,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw new Error(getBookPdfParseTimeoutMessage(locale));
        }
        throw error;
      } finally {
        window.clearTimeout(parseTimeout);
      }
      const parseResult = await readApiJson<ParsePdfApiResponse>(
        parseResponse,
        t('generation.pdfParseFailed'),
      );

      if (parseResponse.status === 504) {
        throw new Error(getBookPdfParseTimeoutMessage(locale));
      }

      if (!parseResponse.ok || !parseResult.success || !parseResult.data?.text) {
        throw new Error(parseResult.error || t('generation.pdfParseFailed'));
      }

      const coverImage =
        (await renderPdfCoverFromFile(form.pdfFile)) ?? getInlineParsedCoverImage(parseResult.data);

      setBookPlanPhase('planning');
      const planResponse = await fetch('/api/generate/book-plan', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          fileName: form.pdfFile.name,
          fileSize: form.pdfFile.size,
          pdfStorageKey,
          coverImage,
          coverImageVersion: coverImage ? PDF_COVER_IMAGE_VERSION : undefined,
          pdfText: parseResult.data.text,
          language: form.language,
        }),
      });
      const planResult = (await planResponse.json()) as GenerateBookPlanApiResponse;

      if (!planResponse.ok || !planResult.success || !planResult.plan) {
        throw new Error(planResult.error || 'Failed to generate the book learning plan');
      }

      setBookPlanPhase('saving');
      await saveBookLearningPlan(planResult.plan);
      setActiveBookLearningPlanId(planResult.plan.id);
      setActiveBookPlan(planResult.plan);
      setBookPlanPhase('complete');
      setBookPlans((current) => [
        planResult.plan!,
        ...current.filter((plan) => plan.id !== planResult.plan!.id),
      ]);
      setBookShelfOpen(false);
      updateForm('pdfFile', null);
      if (planResult.warning) toast.warning(planResult.warning);
      else toast.success('Book learning plan generated');
    } catch (err) {
      log.error('Failed to create book learning plan:', err);
      setBookPlanPhase('error');
      setError(err instanceof Error ? err.message : 'Failed to generate the book learning plan');
    } finally {
      setIsCreatingBookPlan(false);
      window.setTimeout(() => setBookPlanPhase('idle'), 1800);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canCreateBookPlan) createBookLearningPlan();
      else if (canStartBookLesson) handleBookLessonStart();
      else if (canStartBookPractice) handleBookPracticeStart();
      else if (canGenerate) handleGenerate();
    }
  };

  const activeBookProgress = activeBookPlan ? getBookPlanProgress(activeBookPlan) : null;
  const bookPlanProgress = getBookPlanProgressView(bookPlanPhase);
  const bookPlanProgressLabel =
    bookPlanPhase === 'parsing'
      ? '正在解析教材'
      : bookPlanPhase === 'planning'
        ? '正在生成学习计划'
        : bookPlanPhase === 'saving'
          ? '正在保存学习计划'
          : bookPlanPhase === 'complete'
            ? '学习计划已生成'
            : bookPlanPhase === 'error'
              ? '学习计划生成失败'
              : '';
  const completedLessons = activeBookProgress?.completedLessons ?? 0;
  const progressPercent = activeBookProgress?.progressPercent ?? 0;
  const nextBookLesson = activeBookProgress?.nextLesson ?? null;
  const currentBookLesson = activeBookProgress?.currentLesson ?? null;
  const canStartBookLesson =
    !!activeBookPlan &&
    !!nextBookLesson &&
    activeBookPlan.mode !== 'practice' &&
    activeBookPlan.mode !== 'completed_pending_practice' &&
    !form.pdfFile &&
    !form.requirement.trim() &&
    !isCreatingBookPlan;
  const bookLessonActionLabel =
    activeBookPlan && nextBookLesson
      ? completedLessons === 0 && nextBookLesson.status !== 'in_progress'
        ? 'Start Lesson 1'
        : 'Continue Class'
      : activeBookPlan?.mode === 'completed_pending_practice' || activeBookPlan?.mode === 'practice'
        ? 'Start Practice'
        : '';
  const deleteBookPlanLabel = locale === 'zh-CN' ? '删除学习计划' : 'Delete learning plan';
  const deleteBookPlanConfirmText =
    locale === 'zh-CN' ? '删除当前学习计划？' : 'Delete the current learning plan?';
  const deletingBookPlanLabel = locale === 'zh-CN' ? '删除中...' : 'Deleting...';

  const handleBookPracticeStart = () => {
    if (!activeBookPlan) return;

    if (!currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600 dark:text-amber-400" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    const settings = useSettingsStore.getState();
    const providerCfg = settings.providersConfig?.[settings.providerId];
    const responsesBaseUrl = providerCfg?.baseUrl || providerCfg?.serverBaseUrl;
    if (!shouldUseOpenAIResponsesApi(settings.providerId, responsesBaseUrl)) {
      setError(
        'Practice mode requires OpenAI Responses API. Use native OpenAI or configure /responses in the compatible provider base URL.',
      );
      setSettingsOpen(true);
      return;
    }

    setActiveBookLearningPlanId(activeBookPlan.id);
    router.push(`/book-practice?planId=${encodeURIComponent(activeBookPlan.id)}`);
  };

  const handleBookLessonStart = async () => {
    if (!activeBookPlan || !nextBookLesson) return;

    if (!currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600 dark:text-amber-400" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    setError(null);

    try {
      const activeColorTheme = getCurrentColorTheme(colorTheme);
      const updatedPlan = await startBookLesson(activeBookPlan.id, nextBookLesson.id);
      const lesson =
        updatedPlan.lessons.find((item) => item.id === nextBookLesson.id) ?? nextBookLesson;
      const language = updatedPlan.language || form.language;
      const userProfile = useUserProfileStore.getState();

      const settings = useSettingsStore.getState();
      const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
      const sessionState = buildBookLessonGenerationSession({
        plan: updatedPlan,
        lesson,
        language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        visualTheme: activeColorTheme,
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
      setActiveBookLearningPlanId(updatedPlan.id);
      setActiveBookPlan(updatedPlan);
      setBookPlans((current) =>
        current.map((plan) => (plan.id === updatedPlan.id ? updatedPlan : plan)),
      );
      router.push('/generation-preview');
    } catch (err) {
      log.error('Failed to start book lesson classroom:', err);
      setError(err instanceof Error ? err.message : 'Failed to start the lesson classroom');
    }
  };

  const handleStartTourFromHome = () => {
    const targetClassroom = classrooms[0];
    if (!targetClassroom) {
      toast.info(
        locale === 'zh-CN'
          ? '请先创建或打开一个课堂，导览会在课堂中演示完整 ICAP 流程。'
          : 'Create or open a classroom first. The tour runs inside a classroom.',
      );
      return;
    }

    startTour();
    trackEvent('icap_tour', {
      type: 'tour_started_from_home',
      classroomId: targetClassroom.id,
    });
    router.push(`/classroom/${targetClassroom.id}`);
  };

  return (
    <div
      className="relative h-[100dvh] min-h-[100dvh] w-full overflow-hidden overscroll-none bg-background text-foreground"
      style={{ background: 'var(--app-gradient)' }}
    >
      {/* ═══ Top-right pill (unchanged) ═══ */}
      <div ref={toolbarRef} className="fixed top-5 right-5 z-50 flex items-center gap-3">
        {/* Language Selector */}
        <LanguageSwitcher
          onOpen={() => setThemeOpen(false)}
          onLocaleChange={syncGenerationLanguageFromLocale}
        />

        {/* Theme Selector */}
        <div className="relative">
          <button
            onClick={() => {
              setThemeOpen(!themeOpen);
            }}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground hover:shadow-[0_10px_30px_rgba(var(--app-shadow-rgb),0.12)]"
            title={t('settings.theme')}
          >
            {theme === 'light' && <Sun className="w-4 h-4" />}
            {theme === 'dark' && <Moon className="w-4 h-4" />}
            {theme === 'system' && <Monitor className="w-4 h-4" />}
          </button>
          {themeOpen && (
            <div className="absolute top-full mt-3 right-0 z-50 w-[260px] overflow-hidden rounded-xl border border-border/70 bg-popover/95 p-1.5 text-popover-foreground shadow-[0_18px_50px_rgba(var(--app-shadow-rgb),0.16)] backdrop-blur-xl">
              <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
                {locale === 'zh-CN' ? '显示模式' : 'Display'}
              </div>
              <button
                onClick={() => {
                  setTheme('light');
                  setThemeOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60',
                  theme === 'light' && 'bg-primary/10 text-primary',
                )}
              >
                <Sun className="w-4 h-4" />
                {t('settings.themeOptions.light')}
              </button>
              <button
                onClick={() => {
                  setTheme('dark');
                  setThemeOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60',
                  theme === 'dark' && 'bg-primary/10 text-primary',
                )}
              >
                <Moon className="w-4 h-4" />
                {t('settings.themeOptions.dark')}
              </button>
              <button
                onClick={() => {
                  setTheme('system');
                  setThemeOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60',
                  theme === 'system' && 'bg-primary/10 text-primary',
                )}
              >
                <Monitor className="w-4 h-4" />
                {t('settings.themeOptions.system')}
              </button>
            </div>
          )}
        </div>

        {/* Settings Button */}
        <div className="relative">
          <button
            onClick={() => setSettingsOpen(true)}
            className="group flex size-9 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-card/70 hover:text-foreground hover:shadow-[0_10px_30px_rgba(var(--app-shadow-rgb),0.12)]"
            title={t('settings.title')}
          >
            <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
          </button>
        </div>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      <div className="fixed left-5 top-5 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={handleStartTourFromHome}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-white/78 px-3 text-sm font-medium text-cyan-700 shadow-[0_10px_28px_rgba(88,76,120,0.10)] ring-1 ring-cyan-100/80 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white/92 hover:text-cyan-900 dark:bg-slate-950/52 dark:text-cyan-200 dark:ring-cyan-400/20 dark:hover:bg-slate-900"
          title={locale === 'zh-CN' ? '开启功能导览' : 'Start Feature Tour'}
          aria-label={locale === 'zh-CN' ? '开启功能导览' : 'Start Feature Tour'}
        >
          <Compass className="size-4 text-cyan-500" />
          <span>{locale === 'zh-CN' ? '开启功能导览' : 'Feature Tour'}</span>
        </button>

        <button
          type="button"
          onClick={() => router.push('/homework')}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-white/72 px-3 text-sm font-medium text-slate-600 shadow-[0_10px_28px_rgba(88,76,120,0.10)] ring-1 ring-white/70 backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white/90 hover:text-slate-900 dark:bg-slate-950/48 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-slate-900"
        >
          <ClipboardCheck className="size-4 text-violet-500" />
          <span>{locale === 'zh-CN' ? '作业模式' : 'Homework Mode'}</span>
        </button>
      </div>

      {/* ═══ Hero section: title + input (centered, wider) ═══ */}
      <div className="pointer-events-none absolute left-1/2 top-[35%] z-20 w-full -translate-x-1/2 -translate-y-1/2 px-4 sm:top-[36%]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="pointer-events-auto mx-auto flex w-full max-w-[840px] flex-col items-center"
        >
          <div className="mb-8 text-center md:mb-9">
            <motion.h1
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: 0.1,
                type: 'spring',
                stiffness: 200,
                damping: 20,
              }}
              className="text-[60px] font-bold leading-none tracking-normal text-[#33333A] md:text-[72px] dark:text-slate-100"
            >
              BinGo
            </motion.h1>
            {activeBookPlan && (
              <div className="relative mt-5 w-[min(86vw,260px)]">
                <button
                  type="button"
                  onClick={handleBookLessonStart}
                  disabled={
                    !canStartBookLesson ||
                    isDeletingBookPlan ||
                    pendingDeleteBookPlanId === activeBookPlan.id
                  }
                  className={cn(
                    'group inline-flex w-full flex-col items-center text-left transition-all',
                    canStartBookLesson &&
                      !isDeletingBookPlan &&
                      pendingDeleteBookPlanId !== activeBookPlan.id
                      ? 'cursor-pointer hover:-translate-y-0.5'
                      : 'cursor-default',
                  )}
                >
                  <div className="relative w-[132px] sm:w-[148px]">
                    <div className="absolute -right-2 top-2 bottom-2 w-4 rounded-r-md bg-[repeating-linear-gradient(90deg,#f8fafc_0px,#e2e8f0_2px,#f8fafc_4px)] shadow-[8px_12px_28px_rgba(88,76,120,0.16)] dark:bg-[repeating-linear-gradient(90deg,#475569_0px,#334155_2px,#475569_4px)]" />
                    <div className="relative aspect-[3/4] overflow-hidden rounded-l-[5px] rounded-r-lg bg-slate-100 shadow-[0_18px_50px_rgba(88,76,120,0.22)] ring-1 ring-black/5 transition-shadow group-hover:shadow-[0_24px_64px_rgba(88,76,120,0.28)] dark:bg-slate-900 dark:ring-white/10">
                      <div className="absolute inset-y-0 left-0 z-20 w-5 bg-gradient-to-r from-black/36 via-black/12 to-transparent" />
                      <div className="absolute inset-y-0 left-4 z-20 w-px bg-white/28" />
                      {activeBookPlan.coverImage ? (
                        <img
                          src={activeBookPlan.coverImage}
                          alt=""
                          className="h-full w-full object-contain bg-white"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[linear-gradient(145deg,#f8fafc_0%,#e9d5ff_48%,#dbeafe_100%)] dark:bg-[linear-gradient(145deg,#1e293b_0%,#4c1d95_58%,#172554_100%)]">
                          <BookOpen className="size-10 text-violet-500/70 dark:text-violet-200/70" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/52 via-transparent to-white/10" />
                      <div className="absolute inset-x-0 bottom-0 z-30 p-2.5 text-white">
                        <div className="truncate text-xs font-semibold drop-shadow">
                          {activeBookPlan.title}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/82">
                          <span className="tabular-nums">{progressPercent}%</span>
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/28">
                            <div
                              className="h-full rounded-full bg-white"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 w-[min(86vw,260px)] rounded-full bg-white/68 px-3 py-2 text-center shadow-[0_12px_34px_rgba(88,76,120,0.10)] ring-1 ring-white/70 backdrop-blur-xl dark:bg-slate-950/45 dark:ring-white/10">
                    <div className="truncate text-xs font-medium text-slate-600 dark:text-slate-200">
                      {completedLessons}/{activeBookPlan.totalLessons} lessons
                      {currentBookLesson
                        ? ` · Lesson ${currentBookLesson.order}: ${currentBookLesson.title}`
                        : ''}
                    </div>
                    {bookLessonActionLabel && (
                      <div className="mt-0.5 text-[11px] font-medium text-violet-500">
                        {bookLessonActionLabel}
                      </div>
                    )}
                  </div>
                </button>
                {bookPlans.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute left-0 top-0 h-8 rounded-full bg-black/30 px-2.5 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/45 hover:text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBookShelfOpen((open) => !open);
                      setPendingDeleteBookPlanId(null);
                    }}
                    title={locale === 'zh-CN' ? '切换书本计划' : 'Switch book plan'}
                    aria-label={locale === 'zh-CN' ? '切换书本计划' : 'Switch book plan'}
                  >
                    <LibraryBig className="size-3.5" />
                    <span>{bookPlans.length}</span>
                  </Button>
                )}
                {pendingDeleteBookPlanId === activeBookPlan.id ? (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className="absolute right-0 top-0 z-40 w-52 rounded-2xl border border-white/10 bg-slate-950/88 p-3 text-left shadow-[0_18px_50px_rgba(15,23,42,0.28)] backdrop-blur-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[12px] font-medium leading-relaxed text-white/90">
                      {deleteBookPlanConfirmText}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={isDeletingBookPlan}
                        className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => setPendingDeleteBookPlanId(null)}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={isDeletingBookPlan}
                        className="flex-1 rounded-lg bg-red-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70"
                        onClick={() => void confirmDeleteBookPlan(activeBookPlan.id)}
                      >
                        {isDeletingBookPlan ? deletingBookPlanLabel : t('classroom.delete')}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-0 top-0 size-8 rounded-full bg-black/30 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-destructive/80 hover:text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteBookPlanId(activeBookPlan.id);
                    }}
                    title={deleteBookPlanLabel}
                    aria-label={deleteBookPlanLabel}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
                <AnimatePresence>
                  {bookShelfOpen && bookPlans.length > 1 && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.96 }}
                      transition={{ duration: 0.16, ease: 'easeOut' }}
                      className="absolute left-1/2 top-full z-50 mt-3 max-h-[min(46vh,360px)] w-[min(90vw,360px)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/70 bg-white/92 p-2 text-left shadow-[0_22px_70px_rgba(88,76,120,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-100">
                          {locale === 'zh-CN' ? '书本计划' : 'Book Plans'}
                        </div>
                        <div className="text-[11px] text-slate-400">{bookPlans.length}</div>
                      </div>
                      <div className="mt-1 space-y-1">
                        {bookPlans.map((plan) => {
                          const progress = getBookPlanProgress(plan);
                          const selected = plan.id === activeBookPlan.id;
                          return (
                            <button
                              key={plan.id}
                              type="button"
                              onClick={() => handleSelectBookPlan(plan)}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                                selected
                                  ? 'bg-violet-100/80 text-slate-900 dark:bg-violet-400/18 dark:text-white'
                                  : 'hover:bg-slate-100/80 dark:hover:bg-white/8',
                              )}
                            >
                              <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded bg-slate-100 shadow-sm ring-1 ring-black/5 dark:bg-slate-800 dark:ring-white/10">
                                {plan.coverImage ? (
                                  <img
                                    src={plan.coverImage}
                                    alt=""
                                    className="h-full w-full object-cover"
                                    draggable={false}
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,#f8fafc_0%,#e9d5ff_55%,#dbeafe_100%)] dark:bg-[linear-gradient(145deg,#1e293b_0%,#4c1d95_58%,#172554_100%)]">
                                    <BookOpen className="size-4 text-violet-500/75 dark:text-violet-200/75" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-100">
                                  {plan.title}
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                  <span className="tabular-nums">
                                    {progress.completedLessons}/{plan.totalLessons}
                                  </span>
                                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                    <div
                                      className="h-full rounded-full bg-violet-500"
                                      style={{ width: `${progress.progressPercent}%` }}
                                    />
                                  </div>
                                  <span className="tabular-nums">{progress.progressPercent}%</span>
                                </div>
                                <div className="mt-0.5 truncate text-[10px] text-slate-400">
                                  {progress.currentLesson
                                    ? `Lesson ${progress.currentLesson.order}: ${progress.currentLesson.title}`
                                    : plan.fileName}
                                </div>
                              </div>
                              {selected && <Check className="size-4 shrink-0 text-violet-500" />}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* ── Unified input area ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35 }}
            className="w-full"
          >
            <div
              className="w-full rounded-[28px] border border-border/60 bg-card/90 shadow-[0_28px_90px_rgba(var(--app-shadow-rgb),0.18),0_8px_26px_rgba(var(--app-shadow-rgb),0.08)] backdrop-blur-xl transition-shadow focus-within:shadow-[0_34px_110px_rgba(var(--app-shadow-rgb),0.22),0_10px_32px_rgba(var(--app-shadow-rgb),0.10)]"
              style={{ background: 'var(--app-surface-strong)' }}
            >
              {/* ── Greeting + Profile + Agents ── */}
              <div className="relative z-20 flex items-start justify-between">
                <GreetingBar />
                <div className="pr-3 pt-3.5 shrink-0">
                  <AgentBar />
                </div>
              </div>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                placeholder="Let's do something..."
                className="w-full min-h-[92px] max-h-[190px] resize-none border-0 bg-transparent px-5 pt-2 pb-3 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/80 focus:outline-none md:min-h-[104px]"
                value={form.requirement}
                onChange={(e) => updateForm('requirement', e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
              />

              {/* Toolbar row */}
              {(isCreatingBookPlan || bookPlanPhase === 'complete' || bookPlanPhase === 'error') && (
                <div className="mx-4 mb-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-left">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{bookPlanProgressLabel}</span>
                    <span>
                      {bookPlanProgress.step}/{bookPlanProgress.total} · {bookPlanProgress.percent}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className={cn(
                        'h-full rounded-full',
                        bookPlanPhase === 'error' ? 'bg-destructive' : 'bg-primary',
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${bookPlanProgress.percent}%` }}
                      transition={{ duration: 0.35, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-end gap-2 px-4 pb-4">
                <div className="flex-1 min-w-0">
                  <GenerationToolbar
                    language={form.language}
                    onLanguageChange={(lang) => updateForm('language', lang)}
                    onSettingsOpen={(section) => {
                      setSettingsSection(section);
                      setSettingsOpen(true);
                    }}
                    pdfFile={form.pdfFile}
                    onPdfFileChange={(f) => updateForm('pdfFile', f)}
                    onPdfError={setError}
                  />
                </div>

                {/* Voice input */}
                <SpeechButton
                  size="md"
                  onTranscription={(text) => {
                    setForm((prev) => {
                      const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                      updateRequirementCache(next);
                      return { ...prev, requirement: next };
                    });
                  }}
                />

                {/* Send button */}
                <button
                  onClick={() => {
                    if (canCreateBookPlan) {
                      createBookLearningPlan();
                    } else if (canStartBookLesson) {
                      handleBookLessonStart();
                    } else if (canStartBookPractice) {
                      handleBookPracticeStart();
                    } else {
                      handleGenerate();
                    }
                  }}
                  disabled={!primaryActionEnabled && !canStartBookLesson && !canStartBookPractice}
                  className={cn(
                    'shrink-0 h-9 rounded-full flex items-center justify-center gap-1.5 transition-all px-4 shadow-sm',
                    primaryActionEnabled || canStartBookLesson || canStartBookPractice
                      ? 'bg-primary text-primary-foreground hover:shadow-[0_12px_30px_rgba(var(--app-shadow-rgb),0.24)] hover:brightness-[1.03] cursor-pointer'
                      : 'bg-muted text-muted-foreground/60 cursor-not-allowed',
                  )}
                >
                  <span className="text-sm font-medium">
                    {isCreatingBookPlan
                      ? 'Planning...'
                      : form.pdfFile
                        ? 'Create Plan'
                        : canStartBookLesson
                          ? bookLessonActionLabel
                          : canStartBookPractice
                            ? bookLessonActionLabel
                            : !form.requirement.trim() && !form.pdfFile && bookLessonActionLabel
                              ? bookLessonActionLabel
                              : t('toolbar.enterClassroom')}
                  </span>
                  <ArrowUp className="size-3.5" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* ── Error ── */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
              >
                <p className="text-sm text-destructive">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ═══ Recent classrooms — collapsible ═══ */}
      {classrooms.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute inset-x-4 bottom-9 z-10 mx-auto flex max-h-[32dvh] max-w-6xl flex-col items-center overflow-hidden"
        >
          {/* Trigger — divider-line with centered text */}
          <button
            onClick={() => {
              const next = !recentOpen;
              setRecentOpen(next);
              try {
                localStorage.setItem(RECENT_OPEN_STORAGE_KEY, String(next));
              } catch {
                /* ignore */
              }
            }}
            className="group w-full flex items-center gap-4 py-2 cursor-pointer"
          >
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
            <span className="shrink-0 flex items-center gap-2 text-[13px] text-muted-foreground/60 group-hover:text-foreground/70 transition-colors select-none">
              <Clock className="size-3.5" />
              {t('classroom.recentClassrooms')}
              <span className="text-[11px] tabular-nums opacity-60">{classrooms.length}</span>
              <motion.div
                animate={{ rotate: recentOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <ChevronDown className="size-3.5" />
              </motion.div>
            </span>
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
          </button>

          {/* Expandable content */}
          <AnimatePresence>
            {recentOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-full overflow-hidden"
              >
                <div className="pt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
                  {classrooms.map((classroom, i) => (
                    <motion.div
                      key={classroom.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: i * 0.04,
                        duration: 0.35,
                        ease: 'easeOut',
                      }}
                    >
                      <ClassroomCard
                        classroom={classroom}
                        slide={thumbnails[classroom.id]}
                        formatDate={formatDate}
                        onDelete={handleDelete}
                        onRename={handleRename}
                        confirmingDelete={pendingDeleteId === classroom.id}
                        onConfirmDelete={() => confirmDelete(classroom.id)}
                        onCancelDelete={() => setPendingDeleteId(null)}
                        onOpenIntent={() => prefetchClassroom(classroom.id)}
                        onClick={() => openClassroom(classroom.id)}
                        isOpening={openingClassroomId === classroom.id}
                      />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

// ─── Greeting Bar — avatar + "Hi, Name", click to edit in-place ────
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

function GreetingBar() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = nickname || t('profile.defaultNickname');

  // Click-outside to collapse
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingName(false);
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div ref={containerRef} className="relative pl-4 pr-2 pt-3.5 pb-1 w-auto">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />

      {/* ── Collapsed pill (always in flow) ── */}
      {!open && (
        <div
          className="flex items-center gap-2.5 cursor-pointer transition-all duration-200 group rounded-full px-2.5 py-1.5 border border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 active:scale-[0.97]"
          onClick={() => setOpen(true)}
        >
          <div className="shrink-0 relative">
            <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-border/30 group-hover:ring-violet-400/60 dark:group-hover:ring-violet-400/40 transition-all duration-300">
              <img src={avatar} alt="" className="size-full object-cover" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/40 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
              <Pencil className="size-[7px] text-muted-foreground/70" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="leading-none select-none flex items-center gap-1">
                  <span className="text-[13px] font-semibold text-foreground/85 group-hover:text-foreground transition-colors">
                    {t('home.greetingWithName', { name: displayName })}
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t('profile.editTooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* ── Expanded panel (absolute, floating) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-4 top-3.5 z-50 w-64"
          >
            <div className="rounded-2xl bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_1px_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_8px_-2px_rgba(0,0,0,0.3)] px-2.5 py-2">
              {/* ── Row: avatar + name ── */}
              <div
                className="flex items-center gap-2.5 cursor-pointer transition-all duration-200"
                onClick={() => {
                  setOpen(false);
                  setEditingName(false);
                  setAvatarPickerOpen(false);
                }}
              >
                {/* Avatar */}
                <div
                  className="shrink-0 relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarPickerOpen(!avatarPickerOpen);
                  }}
                >
                  <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-violet-300/70 dark:ring-violet-500/40 transition-all duration-300">
                    <img src={avatar} alt="" className="size-full object-cover" />
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/60 flex items-center justify-center"
                  >
                    <ChevronDown
                      className={cn(
                        'size-2 text-muted-foreground/70 transition-transform duration-200',
                        avatarPickerOpen && 'rotate-180',
                      )}
                    />
                  </motion.div>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName();
                          if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={commitName}
                        maxLength={20}
                        placeholder={t('profile.defaultNickname')}
                        className="flex-1 min-w-0 h-6 bg-transparent border-b border-border/80 text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
                      />
                      <button
                        onClick={commitName}
                        className="shrink-0 size-5 rounded flex items-center justify-center text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditName();
                      }}
                      className="group/name inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-[13px] font-semibold text-foreground/85 group-hover/name:text-foreground transition-colors">
                        {displayName}
                      </span>
                      <Pencil className="size-2.5 text-muted-foreground/30 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    </span>
                  )}
                </div>

                {/* Collapse arrow */}
                <motion.div
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 size-6 rounded-full flex items-center justify-center hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <ChevronUp className="size-3.5 text-muted-foreground/50" />
                </motion.div>
              </div>

              {/* ── Expandable content ── */}
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                {/* Avatar picker */}
                <AnimatePresence>
                  {avatarPickerOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-1 pb-2.5 flex items-center gap-1.5 flex-wrap">
                        {AVATAR_OPTIONS.map((url) => (
                          <button
                            key={url}
                            onClick={() => setAvatar(url)}
                            className={cn(
                              'size-7 rounded-full overflow-hidden bg-gray-50 dark:bg-gray-800 cursor-pointer transition-all duration-150',
                              'hover:scale-110 active:scale-95',
                              avatar === url
                                ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0'
                                : 'hover:ring-1 hover:ring-muted-foreground/30',
                            )}
                          >
                            <img src={url} alt="" className="size-full" />
                          </button>
                        ))}
                        <label
                          className={cn(
                            'size-7 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                            'hover:scale-110 active:scale-95',
                            isCustomAvatar(avatar)
                              ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0 border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30'
                              : 'border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/50',
                          )}
                          onClick={() => avatarInputRef.current?.click()}
                          title={t('profile.uploadAvatar')}
                        >
                          <ImagePlus className="size-3" />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bio */}
                <UITextarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                  className="resize-none border-border/40 bg-transparent min-h-[72px] !text-[13px] !leading-relaxed placeholder:!text-[11px] placeholder:!leading-relaxed focus-visible:ring-1 focus-visible:ring-border/60"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Classroom Card — clean, minimal style ──────────────────────
function ClassroomCard({
  classroom,
  slide,
  formatDate,
  onDelete,
  onRename,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onOpenIntent,
  onClick,
  isOpening,
}: {
  classroom: StageListItem;
  slide?: Slide;
  formatDate: (ts: number) => string;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onOpenIntent: () => void;
  onClick: () => void;
  isOpening: boolean;
}) {
  const { t } = useI18n();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(classroom.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== classroom.name) {
      onRename(classroom.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      role="button"
      tabIndex={editing ? -1 : 0}
      className={cn(
        'group cursor-pointer outline-none',
        isOpening && 'pointer-events-none opacity-80',
      )}
      onPointerEnter={onOpenIntent}
      onFocus={onOpenIntent}
      onClick={confirmingDelete || editing ? undefined : onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (confirmingDelete || editing) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick();
      }}
      aria-busy={isOpening}
    >
      {/* Thumbnail — large radius, no border, subtle bg */}
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] rounded-2xl bg-slate-100 dark:bg-slate-800/80 overflow-hidden transition-transform duration-200 group-hover:scale-[1.02]"
      >
        {slide && thumbWidth > 0 ? (
          <ThumbnailSlide
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
          />
        ) : !slide ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
              <span className="text-xl opacity-50">📄</span>
            </div>
          </div>
        ) : null}

        {isOpening && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/22 backdrop-blur-[2px]">
            <div className="flex size-10 items-center justify-center rounded-full bg-white/90 text-violet-600 shadow-lg dark:bg-slate-950/90 dark:text-violet-300">
              <Loader2 className="size-5 animate-spin" />
            </div>
          </div>
        )}

        {/* Delete — top-right, only on hover */}
        <AnimatePresence>
          {!confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-destructive/80 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(classroom.id, e);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-11 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-black/50 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={startRename}
              >
                <Pencil className="size-3.5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline delete confirmation overlay */}
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[6px]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[13px] font-medium text-white/90">
                {t('classroom.deleteConfirmTitle')}?
              </span>
              <div className="flex gap-2">
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-white/15 text-white/80 hover:bg-white/25 backdrop-blur-sm transition-colors"
                  onClick={onCancelDelete}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  onClick={onConfirmDelete}
                >
                  {t('classroom.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info — outside the thumbnail */}
      <div className="mt-2.5 px-1 flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
          {classroom.sceneCount} {t('classroom.slides')} · {formatDate(classroom.updatedAt)}
        </span>
        {editing ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              maxLength={100}
              placeholder={t('classroom.renamePlaceholder')}
              className="w-full bg-transparent border-b border-violet-400/60 text-[15px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="font-medium text-[15px] truncate text-foreground/90 min-w-0 cursor-text"
                onDoubleClick={startRename}
              >
                {classroom.name}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={4}
              className="!max-w-[min(90vw,32rem)] break-words whitespace-normal"
            >
              <div className="flex items-center gap-1.5">
                <span className="break-all">{classroom.name}</span>
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-foreground/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(classroom.name);
                    toast.success(t('classroom.nameCopied'));
                  }}
                >
                  <Copy className="size-3 opacity-60" />
                </button>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <HomePage />;
}

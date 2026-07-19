'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Send,
  Settings,
  Upload,
  XCircle,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SpeechButton } from '@/components/audio/speech-button';
import { HomeworkMathText } from '@/components/homework/homework-math-text';
import { SettingsDialog } from '@/components/settings';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { getModelApiHeaders } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore } from '@/lib/store/user-profile';
import {
  appendHomeworkChatMessages,
  createHomeworkSession,
  listHomeworkSessions,
  updateHomeworkQuestionReview,
} from '@/lib/utils/homework-storage';
import type {
  HomeworkChatMessage,
  HomeworkLanguage,
  HomeworkQuestionSolution,
  HomeworkSession,
} from '@/lib/types/homework';

const log = createLogger('HomeworkPage');

type SolveResponse = {
  success?: boolean;
  jobId?: string;
  status?: HomeworkSolveJobStatus;
  stage?: HomeworkSolveJobStage;
  progress?: number;
  message?: string;
  logs?: HomeworkSolveJobLog[];
  heartbeatAt?: string;
  updatedAt?: string;
  inputSummary?: {
    fileNames?: string[];
    fileCount?: number;
    totalBytes?: number;
    language?: HomeworkLanguage;
    pdfProviderId?: string;
    modelString?: string;
  };
  pollUrl?: string;
  pollIntervalMs?: number;
  done?: boolean;
  result?: HomeworkSolveResult;
  error?: string;
  details?: string;
};

type HomeworkSolveJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type HomeworkSolveJobStage =
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

type HomeworkSolveJobLog = {
  timestamp: string;
  stage: HomeworkSolveJobStage;
  message: string;
  progress?: number;
};

type HomeworkSolveResult = {
  title?: string;
  fileName?: string;
  fileType?: 'pdf' | 'image';
  files?: HomeworkSession['files'];
  language?: HomeworkLanguage;
  questions?: HomeworkQuestionSolution[];
  model?: string;
};

type ChatResponse = {
  success?: boolean;
  reply?: string;
  error?: string;
  details?: string;
};

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const HOMEWORK_SOLVE_JOB_STORAGE_KEY = 'activeHomeworkSolveJobId';
const STALE_HEARTBEAT_MS = 60 * 1000;

function getMultipartModelHeaders(): HeadersInit {
  const headers = { ...getModelApiHeaders() } as Record<string, string>;
  delete headers['Content-Type'];
  return headers;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatIsoTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString();
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function stageLabel(stage: HomeworkSolveJobStage | undefined, isZh: boolean): string {
  const zh: Record<HomeworkSolveJobStage, string> = {
    queued: '排队中',
    validating: '校验文件',
    parsing_pdf: '解析 PDF',
    preparing_images: '准备图片',
    dictionary_lookup: '检索字典',
    generating_answers: '生成答案',
    parsing_result: '整理结果',
    completed: '已完成',
    cancelled: '已中断',
    failed: '失败',
  };
  const en: Record<HomeworkSolveJobStage, string> = {
    queued: 'Queued',
    validating: 'Validating',
    parsing_pdf: 'Parsing PDF',
    preparing_images: 'Preparing Images',
    dictionary_lookup: 'Dictionary Lookup',
    generating_answers: 'Generating Answers',
    parsing_result: 'Parsing Result',
    completed: 'Completed',
    cancelled: 'Cancelled',
    failed: 'Failed',
  };
  if (!stage) return isZh ? '准备中' : 'Preparing';
  return isZh ? zh[stage] : en[stage];
}

function isAcceptedFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/webp' ||
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(pdf|png|jpe?g|webp|heic|heif)$/i.test(file.name)
  );
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function HomeworkPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressLogRef = useRef<HTMLDivElement>(null);
  const questionListRef = useRef<HTMLDivElement>(null);
  const questionCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const completedJobRef = useRef<string | null>(null);
  const activePollJobRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const currentModelId = useSettingsStore((state) => state.modelId);
  const pdfProviderId = useSettingsStore((state) => state.pdfProviderId);
  const pdfProvidersConfig = useSettingsStore((state) => state.pdfProvidersConfig);
  const userBio = useUserProfileStore((state) => state.bio);
  const [language, setLanguage] = useState<HomeworkLanguage>('zh-CN');
  const [files, setFiles] = useState<File[]>([]);
  const [session, setSession] = useState<HomeworkSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<HomeworkSession[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSolving, setIsSolving] = useState(false);
  const [isCancellingSolve, setIsCancellingSolve] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solveJob, setSolveJob] = useState<SolveResponse | null>(null);
  const [solveStartedAt, setSolveStartedAt] = useState<string | undefined>(undefined);

  const selectedQuestion =
    session?.questions.find((question) => question.id === selectedQuestionId) ||
    session?.questions[0] ||
    null;
  const isZh = language === 'zh-CN';

  useEffect(() => {
    let cancelled = false;
    listHomeworkSessions()
      .then((items) => {
        if (!cancelled) setRecentSessions(items.slice(0, 6));
      })
      .catch((err) => log.warn('Failed to list homework sessions:', err));
    return () => {
      cancelled = true;
    };
  }, [session?.id]);

  useEffect(() => {
    progressLogRef.current?.scrollTo({
      top: progressLogRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [solveJob?.logs?.length]);

  useEffect(() => {
    if (!session?.id) return;
    questionListRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id || !selectedQuestionId) return;
    const card = questionCardRefs.current[selectedQuestionId];
    if (!card) return;

    requestAnimationFrame(() => {
      card.scrollIntoView({ block: 'nearest' });
    });
  }, [session?.id, selectedQuestionId]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const persistSolvedHomework = useCallback(
    async (result: HomeworkSolveResult, fallbackFiles: File[] = files) => {
      if (!result.questions?.length) {
        throw new Error(isZh ? '生成答案失败' : 'Failed to solve');
      }
      const created = await createHomeworkSession({
        title: result.title || fallbackFiles[0]?.name.replace(/\.[^.]+$/, '') || 'homework',
        fileName: result.fileName || fallbackFiles.map((item) => item.name).join(', '),
        fileType:
          result.fileType ||
          (fallbackFiles.some((item) => item.type === 'application/pdf') ? 'pdf' : 'image'),
        files:
          result.files ||
          fallbackFiles.map((item) => ({
            name: item.name,
            type: item.type === 'application/pdf' ? 'pdf' : 'image',
            size: item.size,
          })),
        language: result.language || language,
        questions: result.questions,
      });
      setSession(created);
      setSelectedQuestionId(created.questions[0]?.id || null);
      return created;
    },
    [files, isZh, language],
  );

  const pollHomeworkSolveJob = useCallback(
    async (jobId: string) => {
      activePollJobRef.current = jobId;
      let nextDelay = 3000;
      try {
        const response = await fetch(`/api/homework/solve/${encodeURIComponent(jobId)}`);
        const data = (await response.json().catch(() => ({}))) as SolveResponse;
        if (!response.ok || !data.success) {
          if (response.status === 404) {
            activePollJobRef.current = null;
            setIsSolving(false);
            localStorage.removeItem(HOMEWORK_SOLVE_JOB_STORAGE_KEY);
            setSolveJob(data);
            setError(data.error || (isZh ? '作业任务不存在或已被清理' : 'Homework job was not found'));
            return;
          }
          throw new Error(data.details || data.error || (isZh ? '查询作业进度失败' : 'Failed to poll homework progress'));
        }

        setSolveJob(data);
        nextDelay = data.pollIntervalMs || nextDelay;

        if (data.done) {
          setIsSolving(false);
          activePollJobRef.current = null;
          localStorage.removeItem(HOMEWORK_SOLVE_JOB_STORAGE_KEY);
          if (data.status === 'succeeded' && data.result && completedJobRef.current !== jobId) {
            completedJobRef.current = jobId;
            await persistSolvedHomework(data.result);
          } else if (data.status === 'failed') {
            setError(data.error || data.message || (isZh ? '生成答案失败' : 'Failed to solve'));
          } else if (data.status === 'cancelled') {
            setError(data.error || data.message || (isZh ? '已中断当前 PDF 解析' : 'PDF parsing stopped'));
          }
          return;
        }
      } catch (err) {
        log.error('Failed to poll homework solve job:', err);
        setError(err instanceof Error ? err.message : isZh ? '查询作业进度失败' : 'Failed to poll homework progress');
      }

      if (activePollJobRef.current === jobId) {
        pollTimerRef.current = window.setTimeout(() => void pollHomeworkSolveJob(jobId), nextDelay);
      }
    },
    [isZh, persistSolvedHomework],
  );

  useEffect(() => {
    try {
      const activeJobId = localStorage.getItem(HOMEWORK_SOLVE_JOB_STORAGE_KEY);
      if (!activeJobId) return;
      if (activePollJobRef.current === activeJobId) return;
      setIsSolving(true);
      setSolveStartedAt(new Date().toISOString());
      void pollHomeworkSolveJob(activeJobId);
    } catch {
      /* localStorage unavailable */
    }
  }, [pollHomeworkSolveJob]);

  const handleFiles = (nextFiles: FileList | File[]) => {
    const incoming = Array.from(nextFiles);
    const valid: File[] = [];
    const rejected: string[] = [];

    for (const nextFile of incoming) {
      if (!isAcceptedFile(nextFile)) {
        rejected.push(nextFile.name);
        continue;
      }
      if (nextFile.size > MAX_UPLOAD_SIZE) {
        rejected.push(nextFile.name);
        continue;
      }
      valid.push(nextFile);
    }

    if (rejected.length > 0) {
      setError(
        isZh
          ? `已跳过不支持或超过 50MB 的文件：${rejected.join('、')}`
          : `Skipped unsupported or oversized files: ${rejected.join(', ')}`,
      );
    } else {
      setError(null);
    }

    if (valid.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map(fileKey));
      return [...prev, ...valid.filter((item) => !existing.has(fileKey(item)))];
    });
  };

  const removeFile = (target: File) => {
    setFiles((prev) => prev.filter((item) => fileKey(item) !== fileKey(target)));
    setError(null);
  };

  const solveHomework = async () => {
    if (!currentModelId) {
      setError(isZh ? '请先在设置中配置模型' : 'Configure a model first');
      return;
    }
    if (files.length === 0 || isSolving) return;

    setIsSolving(true);
    activePollJobRef.current = null;
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setError(null);
    setSession(null);
    completedJobRef.current = null;
    const startedAt = new Date().toISOString();
    setSolveStartedAt(startedAt);
    setSolveJob({
      success: true,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      message: isZh ? '作业任务已提交，等待后端开始处理。' : 'Homework job submitted.',
      logs: [
        {
          timestamp: startedAt,
          stage: 'queued',
          message: isZh ? '作业任务已提交，等待后端开始处理。' : 'Homework job submitted.',
          progress: 0,
        },
      ],
      done: false,
    });
    try {
      const formData = new FormData();
      for (const item of files) {
        formData.append('files', item);
      }
      formData.append('language', language);
      formData.append('pdfProviderId', pdfProviderId);
      const pdfCfg = pdfProvidersConfig[pdfProviderId];
      if (pdfCfg?.apiKey) formData.append('pdfApiKey', pdfCfg.apiKey);
      if (pdfCfg?.baseUrl) formData.append('pdfBaseUrl', pdfCfg.baseUrl);

      const response = await fetch('/api/homework/solve', {
        method: 'POST',
        headers: getMultipartModelHeaders(),
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as SolveResponse;
      if (!response.ok || !data.success || !data.jobId) {
        throw new Error(data.details || data.error || (isZh ? '生成答案失败' : 'Failed to solve'));
      }

      setSolveJob(data);
      localStorage.setItem(HOMEWORK_SOLVE_JOB_STORAGE_KEY, data.jobId);
      void pollHomeworkSolveJob(data.jobId);
    } catch (err) {
      log.error('Failed to solve homework:', err);
      setError(err instanceof Error ? err.message : isZh ? '生成答案失败' : 'Failed to solve');
      activePollJobRef.current = null;
      localStorage.removeItem(HOMEWORK_SOLVE_JOB_STORAGE_KEY);
      setIsSolving(false);
    }
  };

  const cancelHomeworkSolve = async () => {
    const jobId =
      solveJob?.jobId ||
      activePollJobRef.current ||
      (() => {
        try {
          return localStorage.getItem(HOMEWORK_SOLVE_JOB_STORAGE_KEY);
        } catch {
          return null;
        }
      })();
    if (!jobId || isCancellingSolve) return;

    setIsCancellingSolve(true);
    setError(null);
    try {
      const response = await fetch(`/api/homework/solve/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      });
      const data = (await response.json().catch(() => ({}))) as SolveResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.details || data.error || (isZh ? '中断任务失败' : 'Failed to stop task'));
      }
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      activePollJobRef.current = null;
      localStorage.removeItem(HOMEWORK_SOLVE_JOB_STORAGE_KEY);
      setIsSolving(false);
      setSolveJob({
        ...(solveJob || {}),
        ...data,
        jobId,
        status: 'cancelled',
        stage: 'cancelled',
        done: true,
        message: data.message || (isZh ? '已中断当前 PDF 解析。' : 'PDF parsing stopped.'),
      });
      setError(data.message || (isZh ? '已中断当前 PDF 解析' : 'PDF parsing stopped'));
    } catch (err) {
      log.error('Failed to cancel homework solve job:', err);
      setError(err instanceof Error ? err.message : isZh ? '中断任务失败' : 'Failed to stop task');
    } finally {
      setIsCancellingSolve(false);
    }
  };

  const markQuestion = async (
    question: HomeworkQuestionSolution,
    status: 'understood' | 'needs_help',
  ) => {
    if (!session) return;
    try {
      const updated = await updateHomeworkQuestionReview({
        sessionId: session.id,
        questionId: question.id,
        status,
      });
      setSession(updated);
      setSelectedQuestionId(question.id);
    } catch (err) {
      log.error('Failed to mark homework question:', err);
      setError(isZh ? '记录画像失败' : 'Failed to update profile evidence');
    }
  };

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!session || !selectedQuestion || !trimmed || isChatting) return;
    setIsChatting(true);
    setError(null);
    const now = Date.now();
    const userMessage: HomeworkChatMessage = {
      id: nanoid(),
      role: 'user',
      text: trimmed,
      questionId: selectedQuestion.id,
      createdAt: now,
    };
    setMessage('');

    try {
      const response = await fetch('/api/homework/chat', {
        method: 'POST',
        headers: {
          ...getModelApiHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          language: session.language,
          question: selectedQuestion,
          userMessage: trimmed,
          previousMessages: session.chatMessages
            .filter((item) => !item.questionId || item.questionId === selectedQuestion.id)
            .map((item) => ({ role: item.role, text: item.text })),
          profileWeaknesses: [...session.profileImpact.weaknesses, ...(userBio ? [userBio] : [])],
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ChatResponse;
      if (!response.ok || !data.success || !data.reply) {
        throw new Error(data.details || data.error || (isZh ? '回答失败' : 'Failed to answer'));
      }

      const assistantMessage: HomeworkChatMessage = {
        id: nanoid(),
        role: 'assistant',
        text: data.reply,
        questionId: selectedQuestion.id,
        createdAt: Date.now(),
      };
      const updated = await appendHomeworkChatMessages({
        sessionId: session.id,
        messages: [userMessage, assistantMessage],
      });
      setSession(updated);
    } catch (err) {
      log.error('Failed to answer homework question:', err);
      setError(err instanceof Error ? err.message : isZh ? '回答失败' : 'Failed to answer');
      setMessage(trimmed);
    } finally {
      setIsChatting(false);
    }
  };

  const questionMessages = session?.chatMessages.filter(
    (item) => !selectedQuestion || item.questionId === selectedQuestion.id,
  );
  const heartbeatTime = solveJob?.heartbeatAt ? new Date(solveJob.heartbeatAt).getTime() : 0;
  const heartbeatIsStale =
    isSolving && heartbeatTime > 0 && Date.now() - heartbeatTime > STALE_HEARTBEAT_MS;
  const solveProgress = Math.max(0, Math.min(100, solveJob?.progress ?? 0));

  return (
    <main className="min-h-[100dvh] bg-[#f7f7fa] text-[#1d1d1f] lg:h-[100dvh] lg:overflow-hidden dark:bg-[#1c1c1e] dark:text-[#f5f5f7]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col px-5 py-5 lg:h-full lg:min-h-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => router.push('/')}>
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{isZh ? '作业模式' : 'Homework Mode'}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isZh
                  ? '上传练习照片或 PDF，先对答案，再问不懂的地方。'
                  : 'Upload a worksheet photo or PDF, check answers, then ask about confusing parts.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              title={isZh ? 'PDF 解析设置' : 'PDF parsing settings'}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" />
            </Button>
            <Button
              variant={language === 'zh-CN' ? 'default' : 'outline'}
              onClick={() => setLanguage('zh-CN')}
            >
              中文
            </Button>
            <Button
              variant={language === 'en-US' ? 'default' : 'outline'}
              onClick={() => setLanguage('en-US')}
            >
              EN
            </Button>
          </div>
        </header>

        <div
          className={cn(
            'grid flex-1 gap-4 py-5 lg:min-h-0',
            selectedQuestion
              ? 'lg:grid-cols-[260px_minmax(0,1fr)_minmax(280px,320px)]'
              : 'lg:grid-cols-[260px_minmax(0,1fr)_220px]',
          )}
        >
          <aside className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <section className="rounded-2xl border border-[#e5e5ea] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:border-[#48484a] dark:bg-[#2c2c2e]">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files;
                  if (picked?.length) handleFiles(picked);
                  event.target.value = '';
                }}
              />
              <div
                className={cn(
                  'flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-4 text-center transition-colors',
                  isDragging
                    ? 'border-violet-400 bg-violet-50 dark:bg-violet-400/10'
                    : 'border-[#d1d1d6] hover:border-[#007aff] dark:border-[#48484a]',
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  const dropped = event.dataTransfer.files;
                  if (dropped?.length) handleFiles(dropped);
                }}
              >
                <Upload className="mb-3 size-7 text-[#007aff]" />
                <div className="text-sm font-medium">
                  {files.length > 0
                    ? isZh
                      ? `已选择 ${files.length} 个文件`
                      : `${files.length} files selected`
                    : isZh
                      ? '上传练习照片或 PDF'
                      : 'Upload worksheet photos or PDFs'}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {isZh
                    ? 'PDF / PNG / JPG / WebP / HEIC，单个文件 50MB'
                    : 'PDF / PNG / JPG / WebP / HEIC, 50MB each'}
                </div>
              </div>
              {files.length > 0 && (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-md border border-slate-200 p-2 text-xs dark:border-slate-800">
                  {files.map((item) => (
                    <div
                      key={fileKey(item)}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="shrink-0 text-slate-400">
                        {(item.size / 1024 / 1024).toFixed(1)}MB
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-slate-400 hover:text-red-500"
                        onClick={() => removeFile(item)}
                      >
                        {isZh ? '移除' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                className="mt-3 w-full"
                disabled={files.length === 0 || isSolving}
                onClick={solveHomework}
              >
                {isSolving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                {isZh ? '生成参考答案' : 'Generate Answers'}
              </Button>
              {error && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  {error}
                </div>
              )}
            </section>

            {recentSessions.length > 0 && (
              <section className="rounded-2xl border border-[#e5e5ea] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:border-[#48484a] dark:bg-[#2c2c2e]">
                <h2 className="mb-3 text-sm font-semibold">{isZh ? '最近作业' : 'Recent'}</h2>
                <div className="grid gap-2">
                  {recentSessions.map((item) => (
                    <button
                      key={item.id}
                      className="rounded-md border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                      onClick={() => {
                        setSession(item);
                        setLanguage(item.language);
                        setSelectedQuestionId(item.questions[0]?.id || null);
                      }}
                    >
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {formatTime(item.updatedAt)}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>

          <section className="flex min-h-[60dvh] flex-col overflow-hidden rounded-2xl border border-[#e5e5ea] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] lg:min-h-0 dark:border-[#48484a] dark:bg-[#2c2c2e]">
            {isSolving ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Loader2 className="size-4 animate-spin text-violet-500" />
                        {stageLabel(solveJob?.stage, isZh)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {solveJob?.message ||
                          (isZh ? 'Bingo 正在读题并生成答案...' : 'Bingo is reading the worksheet...')}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div>{isZh ? '已运行' : 'Elapsed'} {formatElapsed(solveStartedAt)}</div>
                      <div>
                        {isZh ? '最近心跳' : 'Last heartbeat'}{' '}
                        {formatIsoTime(solveJob?.heartbeatAt || solveJob?.updatedAt) || '-'}
                      </div>
                    </div>
                    {solveJob?.stage === 'parsing_pdf' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-200 dark:hover:bg-red-500/10"
                        title={
                          isZh
                            ? '停止当前 PDF；运行中的解析会重启 MinerU，其他 Bingo 队列保留。'
                            : 'Stop the current PDF. A running parse restarts MinerU while keeping the Bingo queue.'
                        }
                        disabled={isCancellingSolve}
                        onClick={() => void cancelHomeworkSolve()}
                      >
                        {isCancellingSolve ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <XCircle className="size-4" />
                        )}
                        {isZh ? '停止当前 PDF' : 'Stop Current PDF'}
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${solveProgress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-slate-500">
                    <span>{solveJob?.inputSummary?.modelString || currentModelId}</span>
                    <span>{solveProgress}%</span>
                  </div>
                </div>
                {heartbeatIsStale && (
                  <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    {isZh
                      ? '后端或本地模型超过 60 秒没有更新心跳，可能仍在处理大文件，也可能已经卡住。'
                      : 'No backend heartbeat for over 60 seconds. A large file may still be processing, or the job may be stuck.'}
                  </div>
                )}
                <div ref={progressLogRef} className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="grid gap-2">
                    {(solveJob?.logs || []).map((item, index) => (
                      <div
                        key={`${item.timestamp}:${index}`}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{stageLabel(item.stage, isZh)}</span>
                          <span>{formatIsoTime(item.timestamp)}</span>
                        </div>
                        <div className="leading-6 text-slate-800 dark:text-slate-100">
                          {item.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : session ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    {session.fileType === 'image' ? (
                      <ImageIcon className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                    <h2 className="truncate text-lg font-semibold">{session.title}</h2>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {session.files?.length
                      ? session.files.map((item) => item.name).join(' / ')
                      : session.fileName}
                  </div>
                </div>
                <div ref={questionListRef} className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">
                  {session.questions.map((question, index) => {
                    const active = selectedQuestion?.id === question.id;
                    return (
                      <article
                        key={question.id}
                        ref={(node) => {
                          questionCardRefs.current[question.id] = node;
                        }}
                        className={cn(
                          'rounded-md border p-4 transition-colors',
                          active
                            ? 'border-violet-300 bg-violet-50/60 dark:border-violet-400/40 dark:bg-violet-400/10'
                            : 'border-slate-200 dark:border-slate-800',
                        )}
                        onClick={() => setSelectedQuestionId(question.id)}
                      >
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>#{index + 1}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                            {question.difficulty || 'medium'}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                            {question.confidence || 'medium'}
                          </span>
                          {question.reviewStatus === 'understood' && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                              {isZh ? '已看懂' : 'Understood'}
                            </span>
                          )}
                          {question.reviewStatus === 'needs_help' && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                              {isZh ? '需要讲解' : 'Needs help'}
                            </span>
                          )}
                        </div>
                        <HomeworkMathText
                          text={question.question}
                          paragraphClassName="text-sm font-medium leading-6"
                        />
                        <div className="mt-4 grid gap-3 text-sm">
                          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-800/70">
                            <div className="text-xs font-semibold text-slate-500">
                              {isZh ? '参考答案' : 'Answer'}
                            </div>
                            <HomeworkMathText
                              text={question.answer}
                              className="mt-1"
                              paragraphClassName="leading-6"
                            />
                          </div>
                          <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-800/70">
                            <div className="text-xs font-semibold text-slate-500">
                              {isZh ? '解题过程' : 'Solution'}
                            </div>
                            <HomeworkMathText
                              text={question.solution}
                              className="mt-1"
                              paragraphClassName="leading-6"
                            />
                          </div>
                        </div>
                        {question.knowledgePoints.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {question.knowledgePoints.map((point) => (
                              <span
                                key={`${question.id}:${point}`}
                                className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 dark:border-slate-700"
                              >
                                {point}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void markQuestion(question, 'understood');
                            }}
                          >
                            <CheckCircle2 className="size-4" />
                            {isZh ? '我看懂了' : 'Understood'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void markQuestion(question, 'needs_help');
                              setSelectedQuestionId(question.id);
                            }}
                          >
                            <HelpCircle className="size-4" />
                            {isZh ? '这里不懂' : 'I need help'}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[60dvh] flex-col items-center justify-center px-6 text-center text-slate-500">
                <MessageSquare className="mb-3 size-9 text-violet-400" />
                <div className="text-sm font-medium">
                  {isZh
                    ? '先上传练习，Bingo 会生成答案和解析。'
                    : 'Upload homework first. Bingo will generate answers and solutions.'}
                </div>
              </div>
            )}
          </section>

          <aside
            className={cn(
              'flex min-h-[60dvh] flex-col rounded-2xl border border-[#e5e5ea] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] lg:min-h-0 dark:border-[#48484a] dark:bg-[#2c2c2e]',
              !selectedQuestion && 'lg:min-h-0',
            )}
          >
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <h2 className="text-sm font-semibold">{isZh ? '追问讲解' : 'Ask About It'}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {selectedQuestion
                  ? selectedQuestion.question.slice(0, 72)
                  : isZh
                    ? '选择一道题后开始问'
                    : 'Select a question first'}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {questionMessages && questionMessages.length > 0 ? (
                <div className="grid gap-3">
                  {questionMessages.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-md px-3 py-2 text-sm leading-6',
                        item.role === 'user'
                          ? 'ml-8 bg-violet-50 text-violet-900 dark:bg-violet-400/10 dark:text-violet-100'
                          : 'mr-8 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
                      )}
                    >
                      <HomeworkMathText text={item.text} />
                    </div>
                  ))}
                  {isChatting && (
                    <div className="mr-8 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800">
                      <Loader2 className="inline size-4 animate-spin" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-sm text-[#6e6e73] dark:text-[#aeaeb2]">
                  {isZh
                    ? '对完答案后，不懂的地方直接问。'
                    : 'After checking answers, ask about anything unclear.'}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 p-3 dark:border-slate-800">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={!selectedQuestion || isChatting}
                placeholder=""
                className="min-h-24 resize-none"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <div className="mt-2 flex items-center gap-2">
                <SpeechButton
                  size="md"
                  disabled={!selectedQuestion || isChatting}
                  onTranscription={(text) => {
                    setMessage((prev) => `${prev}${prev ? ' ' : ''}${text}`);
                  }}
                />
                <Button
                  className="flex-1"
                  disabled={!selectedQuestion || !message.trim() || isChatting}
                  onClick={() => void sendMessage()}
                >
                  {isChatting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {isZh ? '发送' : 'Send'}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialSection="pdf" />
    </main>
  );
}

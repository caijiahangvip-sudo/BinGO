import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { callLLM } from '@/lib/ai/llm';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import type {
  BookKnowledgePoint,
  BookLearningLanguage,
  BookLearningPlan,
  BookLessonPlan,
} from '@/lib/types/book-learning';
import type { ModelInfo } from '@/lib/types/provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('BookPlan API');

export const maxDuration = 300;

const DEFAULT_BOOK_PLAN_CONTEXT_WINDOW = 32000;
const BOOK_PLAN_PROMPT_RESERVE_TOKENS = 3000;
const BOOK_PLAN_MIN_OUTPUT_TOKENS = 1800;
const BOOK_PLAN_MIN_INPUT_CHARS = 1800;
const BOOK_PLAN_HEADING_CHARS = 24000;
const BOOK_PLAN_MAX_KNOWLEDGE_POINTS = 30;
const BOOK_PLAN_MAX_LESSONS = 24;
const BOOK_PLAN_MAX_OUTPUT_TOKENS = 6000;
const MIN_HEADING_LENGTH = 2;
const MAX_HEADING_LENGTH = 120;

type PlanningSourceMode = 'full' | 'outline';

interface BookPlanRequest {
  fileName?: string;
  fileSize?: number;
  pdfStorageKey?: string;
  coverImage?: string;
  coverImageVersion?: number;
  pdfText?: string;
  language?: BookLearningLanguage;
}

interface GeneratedKnowledgePoint {
  title?: string;
  chapterTitle?: string;
  summary?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  prerequisites?: string[];
  estimatedMinutes?: number;
}

interface GeneratedLesson {
  title?: string;
  objective?: string;
  knowledgePointIndexes?: number[];
  knowledgePointIds?: string[];
}

interface GeneratedBookPlan {
  title?: string;
  summary?: string;
  knowledgePoints?: GeneratedKnowledgePoint[];
  lessons?: GeneratedLesson[];
}

interface PlanningPdfContext {
  text: string;
  mode: PlanningSourceMode;
  contextWindow: number;
  maxInputChars: number;
  headings: string[];
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n')
    .trim();
}

function cleanLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s*(?:[-.\uff0e\u00b7\u2022\u2026]{2,})\s*\d{1,4}\s*$/u, '')
    .replace(/[ \t]{2,}\d{1,4}\s*$/u, '')
    .replace(/\s+(?:\u7b2c\s*)?\d{1,4}\s*\u9875\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTocTitle(line: string): boolean {
  return /^(\u76ee\s*\u5f55|contents?|table of contents)$/i.test(cleanLine(line));
}

function hasTocPageMarker(line: string): boolean {
  return /(?:[-.\uff0e\u00b7\u2022\u2026]{2,}|[ \t]{2,})\s*\d{1,4}\s*$/u.test(line);
}

function hasTextCharacter(line: string): boolean {
  return /[\u4e00-\u9fffA-Za-z]/u.test(line);
}

function isCompactTocEntry(line: string): boolean {
  const cleaned = cleanLine(line);
  if (cleaned.length < MIN_HEADING_LENGTH || cleaned.length > 60) return false;
  if (!hasTextCharacter(cleaned)) return false;
  if (/^[\d\s.,;:()\[\]\-_/\\]+$/.test(cleaned)) return false;
  if (/[\u3002\uff1b;]$/u.test(cleaned)) return false;
  return true;
}

function isLikelyHeading(line: string, options: { withinToc?: boolean } = {}): boolean {
  const cleaned = cleanLine(line);
  if (cleaned.length < MIN_HEADING_LENGTH || cleaned.length > MAX_HEADING_LENGTH) return false;
  if (/^\d+$/.test(cleaned)) return false;
  if (/^(?:page\s*)?\d{1,4}$/i.test(cleaned)) return false;
  if (/^(?:\u7b2c\s*)?\d{1,4}\s*\u9875$/u.test(cleaned)) return false;

  return (
    isTocTitle(cleaned) ||
    /^\u7b2c[\u4e00-\u9fff\d]{1,8}[\u7ae0\u8282\u8bfe\u5355\u5143\u90e8\u5206\u7bc7\u8bb2]/u.test(
      cleaned,
    ) ||
    /^(chapter|unit|lesson|part|section|module)\s+[\w\d]/i.test(cleaned) ||
    /^[\u96f6\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4e24]{1,6}[\u3001.\uff0e]\s*\S/u.test(
      cleaned,
    ) ||
    /^[\uff08(][\u96f6\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4e24\d]{1,6}[\uff09)]\s*\S/u.test(
      cleaned,
    ) ||
    /^\d{1,3}([.\uff0e\u3001-]\d{1,3}){0,3}\s*\S/u.test(cleaned) ||
    /^\d{1,3}\s+[\u4e00-\u9fffA-Za-z][\s\S]{1,}/u.test(cleaned) ||
    (hasTocPageMarker(line) && isCompactTocEntry(cleaned)) ||
    (!!options.withinToc && isCompactTocEntry(cleaned))
  );
}

function extractPlanHeadings(pdfText: string, maxChars = BOOK_PLAN_HEADING_CHARS): string[] {
  const headings: string[] = [];
  const seen = new Set<string>();
  let totalChars = 0;
  let tocLineBudget = 0;

  for (const rawLine of pdfText.split('\n')) {
    const line = cleanLine(rawLine);
    const withinToc = tocLineBudget > 0;
    if (isTocTitle(line)) {
      tocLineBudget = 300;
    } else if (tocLineBudget > 0) {
      tocLineBudget -= 1;
    }
    if (!isLikelyHeading(rawLine, { withinToc })) continue;

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    headings.push(line);
    totalChars += line.length + 1;
    if (totalChars >= maxChars) break;
  }

  return headings;
}

function joinLinesWithinBudget(lines: string[], maxChars: number): string {
  const selected: string[] = [];
  let totalChars = 0;

  for (const line of lines) {
    const nextTotal = totalChars + line.length + 1;
    if (nextTotal > maxChars) break;
    selected.push(line);
    totalChars = nextTotal;
  }

  return selected.join('\n');
}

function isDirectoryMarker(heading: string): boolean {
  return isTocTitle(heading);
}

function selectRepresentativeHeadings(headings: string[], maxHeadings: number): string[] {
  if (headings.length <= maxHeadings) return headings;
  if (maxHeadings <= 1) return headings.slice(0, maxHeadings);

  const selected: string[] = [];
  const seenIndexes = new Set<number>();

  for (let i = 0; i < maxHeadings; i++) {
    const index = Math.round((i * (headings.length - 1)) / (maxHeadings - 1));
    if (seenIndexes.has(index)) continue;
    seenIndexes.add(index);
    selected.push(headings[index]);
  }

  return selected;
}

function selectHeadingsWithinBudget(headings: string[], maxChars: number): string[] {
  if (headings.length === 0 || maxChars <= 0) return [];
  if (headings.join('\n').length <= maxChars) return headings;

  const averageLength =
    headings.reduce((total, heading) => total + heading.length + 1, 0) / headings.length;
  let maxHeadings = Math.max(1, Math.floor(maxChars / Math.max(12, averageLength)));

  while (maxHeadings > 0) {
    const selected = selectRepresentativeHeadings(headings, maxHeadings);
    if (selected.join('\n').length <= maxChars) return selected;
    maxHeadings -= 1;
  }

  return [truncateText(headings[0], maxChars)];
}

function buildEvenSamples(text: string, budget: number): string[] {
  if (budget <= 0) return [];
  if (text.length <= budget) return [text];

  const chunkCount = 5;
  const chunkLength = Math.max(800, Math.floor(budget / chunkCount) - 80);
  const maxStart = Math.max(0, text.length - chunkLength);
  const ratios = [0, 0.25, 0.5, 0.75, 1];
  const starts = ratios.map((ratio) => Math.min(maxStart, Math.floor(maxStart * ratio)));

  return starts.map((start, index) => {
    const end = Math.min(text.length, start + chunkLength);
    return `Sample ${index + 1} (${start}-${end}):\n${text.slice(start, end).trim()}`;
  });
}

function getPlanMaxOutputTokens(modelInfo: ModelInfo | null): number {
  const contextWindow = modelInfo?.contextWindow ?? DEFAULT_BOOK_PLAN_CONTEXT_WINDOW;
  const modelOutputWindow = modelInfo?.outputWindow ?? BOOK_PLAN_MAX_OUTPUT_TOKENS;
  const contextLimitedOutput = Math.max(
    BOOK_PLAN_MIN_OUTPUT_TOKENS,
    Math.floor(contextWindow * 0.25),
  );
  return Math.min(modelOutputWindow, BOOK_PLAN_MAX_OUTPUT_TOKENS, contextLimitedOutput);
}

function getMaxBookPlanInputChars(modelInfo: ModelInfo | null): {
  contextWindow: number;
  maxInputChars: number;
} {
  const contextWindow = modelInfo?.contextWindow ?? DEFAULT_BOOK_PLAN_CONTEXT_WINDOW;
  const outputTokens = getPlanMaxOutputTokens(modelInfo);
  const promptReserveTokens = Math.min(
    BOOK_PLAN_PROMPT_RESERVE_TOKENS,
    Math.max(1200, Math.floor(contextWindow * 0.12)),
  );
  const availableTokens = contextWindow - outputTokens - promptReserveTokens;
  return {
    contextWindow,
    maxInputChars: Math.max(BOOK_PLAN_MIN_INPUT_CHARS, availableTokens),
  };
}

function buildOutlinePlanningText(params: {
  headings: string[];
  pdfText: string;
  maxInputChars: number;
}): string {
  const usefulHeadings = params.headings.filter((heading) => !isDirectoryMarker(heading));
  const headingBudget = Math.max(params.maxInputChars - 1200, BOOK_PLAN_MIN_INPUT_CHARS);
  const headingsWithinBudget = selectHeadingsWithinBudget(usefulHeadings, headingBudget);
  const headingText = joinLinesWithinBudget(headingsWithinBudget, headingBudget);

  if (headingText.length >= Math.min(params.maxInputChars * 0.85, headingBudget)) {
    return [
      'The full PDF exceeds the selected model context window.',
      'Use this extracted table of contents / chapter outline to create the learning plan.',
      'Cover all main chapters and sections in learning order. Do not create only a generic book overview.',
      '',
      'Extracted table of contents / chapter outline:',
      headingText,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, params.maxInputChars);
  }

  const remainingBudget = params.maxInputChars - headingText.length - 900;
  const samples = buildEvenSamples(params.pdfText, Math.max(0, remainingBudget)).join('\n\n');
  return [
    'The full PDF exceeds the selected model context window.',
    'Use this extracted table of contents / chapter outline as the primary source for the learning plan.',
    'The content samples are secondary hints only. Cover all main chapters and sections in learning order.',
    '',
    'Extracted table of contents / chapter outline:',
    headingText,
    '',
    samples ? 'Evenly spaced content samples:' : '',
    samples,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, params.maxInputChars);
}

function buildPlanningPdfContext(pdfText: string, modelInfo: ModelInfo | null): PlanningPdfContext {
  const normalized = normalizePdfText(pdfText);
  const { contextWindow, maxInputChars } = getMaxBookPlanInputChars(modelInfo);
  const headings = extractPlanHeadings(normalized);

  if (normalized.length <= maxInputChars) {
    return {
      text: normalized,
      mode: 'full',
      contextWindow,
      maxInputChars,
      headings,
    };
  }

  return {
    text: buildOutlinePlanningText({
      headings,
      pdfText: normalized,
      maxInputChars,
    }),
    mode: 'outline',
    contextWindow,
    maxInputChars,
    headings,
  };
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function mergeModelInfoFromHeaders(
  req: NextRequest,
  modelInfo: ModelInfo | null,
): ModelInfo | null {
  const contextWindow = parsePositiveInteger(req.headers.get('x-model-context-window'));
  const outputWindow = parsePositiveInteger(req.headers.get('x-model-output-window'));
  if (!contextWindow && !outputWindow) return modelInfo;

  return {
    id: modelInfo?.id ?? req.headers.get('x-model') ?? 'selected-model',
    name: modelInfo?.name ?? req.headers.get('x-model') ?? 'Selected model',
    ...modelInfo,
    contextWindow: contextWindow ?? modelInfo?.contextWindow,
    outputWindow: outputWindow ?? modelInfo?.outputWindow,
  };
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function fallbackSummary(title: string, language: BookLearningLanguage): string {
  return language === 'zh-CN'
    ? `\u56f4\u7ed5\u201c${truncateText(title, 48)}\u201d\u5efa\u7acb\u6838\u5fc3\u6982\u5ff5\u3001\u65b9\u6cd5\u548c\u5e94\u7528\u7684\u5b66\u4e60\u6846\u67b6\u3002`
    : `Build a learning path around the core concepts, methods, and applications in "${truncateText(title, 64)}".`;
}

function buildFallbackGeneratedPlan(params: {
  fileName: string;
  language: BookLearningLanguage;
  pdfText: string;
  headings?: string[];
}): GeneratedBookPlan {
  const normalized = normalizePdfText(params.pdfText);
  const extractedHeadings =
    params.headings && params.headings.length > 0
      ? params.headings
      : extractPlanHeadings(normalized, BOOK_PLAN_HEADING_CHARS);
  const headings = selectRepresentativeHeadings(
    extractedHeadings.filter((heading) => !isDirectoryMarker(heading)),
    BOOK_PLAN_MAX_KNOWLEDGE_POINTS,
  );
  const fallbackTitles =
    params.language === 'zh-CN'
      ? [
          '\u5168\u4e66\u5bfc\u8bfb',
          '\u6838\u5fc3\u6982\u5ff5',
          '\u5173\u952e\u65b9\u6cd5',
          '\u7efc\u5408\u5e94\u7528',
          '\u590d\u4e60\u4e0e\u63d0\u5347',
        ]
      : [
          'Book overview',
          'Core concepts',
          'Key methods',
          'Applied practice',
          'Review and extension',
        ];
  const titles = headings.length > 0 ? headings : fallbackTitles;
  const knowledgePoints: GeneratedKnowledgePoint[] = titles.map((title, index) => ({
    title: truncateText(title, 80),
    chapterTitle: truncateText(title, 80),
    summary: fallbackSummary(title, params.language),
    difficulty:
      index < Math.ceil(titles.length * 0.35)
        ? 'easy'
        : index < Math.ceil(titles.length * 0.8)
          ? 'medium'
          : 'hard',
    prerequisites: index > 0 ? [truncateText(titles[index - 1], 80)] : [],
    estimatedMinutes: 35,
  }));
  const groupSize = knowledgePoints.length > 18 ? 2 : 1;
  const lessons: GeneratedLesson[] = [];

  for (
    let start = 0;
    start < knowledgePoints.length && lessons.length < BOOK_PLAN_MAX_LESSONS;
    start += groupSize
  ) {
    const indexes = Array.from(
      { length: Math.min(groupSize, knowledgePoints.length - start) },
      (_, offset) => start + offset,
    );
    const firstTitle = knowledgePoints[start]?.title || fallbackTitles[0];
    lessons.push({
      title:
        params.language === 'zh-CN'
          ? `\u7b2c ${lessons.length + 1} \u8bfe\uff1a${truncateText(firstTitle, 48)}`
          : `Lesson ${lessons.length + 1}: ${truncateText(firstTitle, 64)}`,
      objective: fallbackSummary(firstTitle, params.language),
      knowledgePointIndexes: indexes,
    });
  }

  return {
    title: params.fileName.replace(/\.pdf$/i, ''),
    summary:
      params.language === 'zh-CN'
        ? '\u6839\u636e PDF \u6807\u9898\u548c\u7ae0\u8282\u7ebf\u7d22\u751f\u6210\u7684\u957f\u671f\u5b66\u4e60\u8ba1\u5212\u8349\u7a3f\u3002'
        : 'A draft long-term learning plan generated from PDF headings and chapter cues.',
    knowledgePoints,
    lessons,
  };
}

function stringifySnippet(value: unknown, maxLength = 240): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function summarizeGenerationError(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return stringifySnippet(error);
  }

  const record = error as {
    name?: unknown;
    message?: unknown;
    statusCode?: unknown;
    responseBody?: unknown;
    data?: unknown;
    cause?: unknown;
  };
  const parts: string[] = [];
  if (typeof record.name === 'string' && record.name) parts.push(record.name);
  if (typeof record.statusCode === 'number') parts.push(`HTTP ${record.statusCode}`);
  if (typeof record.message === 'string' && record.message.trim()) {
    parts.push(record.message.trim());
  }

  const body = stringifySnippet(record.responseBody ?? record.data);
  if (body) parts.push(body);

  if (record.cause instanceof Error && record.cause.message) {
    parts.push(record.cause.message);
  }

  return parts.length > 0 ? [...new Set(parts)].join(': ') : undefined;
}

function getBookPlanWarning(language: BookLearningLanguage, reason?: string): string {
  const base =
    language === 'zh-CN'
      ? 'AI \u89c4\u5212\u751f\u6210\u5931\u8d25\uff0c\u5df2\u6839\u636e PDF \u6807\u9898\u548c\u7ae0\u8282\u7ebf\u7d22\u521b\u5efa\u8349\u7a3f\u8ba1\u5212\u3002'
      : 'AI plan generation failed, so Bingo created a draft plan from PDF headings and chapter cues.';
  if (!reason) return base;
  return language === 'zh-CN' ? `${base}\u539f\u56e0\uff1a${reason}` : `${base} Reason: ${reason}`;
}

function buildSystemPrompt(language: BookLearningLanguage) {
  return [
    'You are an AI private tutor curriculum planner.',
    'Your task is to create a long-term one-book learning plan from the uploaded book.',
    'The user uploads the book once, then the classroom system keeps teaching from the saved plan until the book is finished.',
    'Each lesson is exactly 60 minutes: 25 minutes lecture, 5 minutes break, 25 minutes practice, 5 minutes summary.',
    `Write all user-facing plan text in ${language === 'zh-CN' ? 'Simplified Chinese' : 'English'}.`,
    'Output JSON only. Do not output Markdown or explanations.',
  ].join('\n');
}

function buildUserPrompt(params: {
  fileName: string;
  language: BookLearningLanguage;
  pdfText: string;
  sourceMode: PlanningSourceMode;
}) {
  const sourceInstruction =
    params.sourceMode === 'full'
      ? 'Create a long-term learning plan from the full book content below.'
      : 'The full PDF exceeds the selected model context window, so the source below is the extracted table of contents / chapter outline. Create the learning plan from that outline and cover every main chapter/section represented there.';
  return [
    `Book/file name: ${params.fileName}`,
    `Plan language: ${params.language === 'zh-CN' ? 'Simplified Chinese' : 'English'}`,
    `Source mode: ${params.sourceMode === 'full' ? 'full book text' : 'table of contents / chapter outline'}`,
    '',
    sourceInstruction,
    '',
    'Requirements:',
    '- Extract the core knowledge points of the whole book in learning order.',
    '- Cover the full book structure. Do not stop at an introduction or a generic overview.',
    '- If the source is an outline, treat each main chapter/section as planning evidence and distribute lessons across the entire outline.',
    '- Each knowledge point must include title, chapter title, short summary, difficulty, prerequisites, and estimated minutes.',
    '- Group knowledge points into multiple 60-minute lessons.',
    '- Each lesson must follow: 25 minutes lecture, 5 minutes break, 25 minutes practice, 5 minutes summary.',
    '- Let the number of lessons be determined by the book. Do not invent excessive filler lessons.',
    '- If the book is long, plan the main chapters and key knowledge points while keeping the plan sustainable.',
    `- Keep the plan concise: at most ${BOOK_PLAN_MAX_KNOWLEDGE_POINTS} knowledge points and at most ${BOOK_PLAN_MAX_LESSONS} lessons.`,
    '- Use short strings. This is a planning index, not the lesson content itself.',
    '',
    'Output JSON shape:',
    '{',
    '  "title": "Book title",',
    '  "summary": "Learning goal summary",',
    '  "knowledgePoints": [',
    '    {',
    '      "title": "Knowledge point title",',
    '      "chapterTitle": "Chapter title",',
    '      "summary": "What this point teaches",',
    '      "difficulty": "easy | medium | hard",',
    '      "prerequisites": ["Prerequisite"],',
    '      "estimatedMinutes": 25',
    '    }',
    '  ],',
    '  "lessons": [',
    '    {',
    '      "title": "Lesson 1 title",',
    '      "objective": "Lesson objective",',
    '      "knowledgePointIndexes": [0, 1]',
    '    }',
    '  ]',
    '}',
    '',
    'Book content:',
    params.pdfText,
  ].join('\n');
}

function clampDifficulty(value: unknown): 'easy' | 'medium' | 'hard' {
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : 'medium';
}

function normalizePlan(params: {
  generated: GeneratedBookPlan;
  fileName: string;
  fileSize: number;
  pdfStorageKey: string;
  coverImage?: string;
  coverImageVersion?: number;
  language: BookLearningLanguage;
}): BookLearningPlan {
  const now = Date.now();
  const knowledgePointsInput = Array.isArray(params.generated.knowledgePoints)
    ? params.generated.knowledgePoints
    : [];

  const knowledgePoints: BookKnowledgePoint[] = knowledgePointsInput
    .slice(0, BOOK_PLAN_MAX_KNOWLEDGE_POINTS)
    .filter((point) => point?.title || point?.summary)
    .map((point, index) => ({
      id: `kp_${nanoid(8)}`,
      title: point.title?.trim() || `Knowledge Point ${index + 1}`,
      chapterTitle: point.chapterTitle?.trim() || undefined,
      summary: point.summary?.trim() || '',
      order: index + 1,
      difficulty: clampDifficulty(point.difficulty),
      prerequisites: Array.isArray(point.prerequisites)
        ? point.prerequisites.filter((item): item is string => typeof item === 'string')
        : [],
      estimatedMinutes:
        typeof point.estimatedMinutes === 'number' && Number.isFinite(point.estimatedMinutes)
          ? Math.max(10, Math.min(90, Math.round(point.estimatedMinutes)))
          : 25,
      status: 'pending',
    }));

  if (knowledgePoints.length === 0) {
    throw new Error('No valid knowledge points generated');
  }

  const lessonsInput = Array.isArray(params.generated.lessons) ? params.generated.lessons : [];
  const lessons: BookLessonPlan[] = lessonsInput
    .slice(0, BOOK_PLAN_MAX_LESSONS)
    .filter((lesson) => lesson?.title || lesson?.objective)
    .map((lesson, index) => {
      const idsFromIndexes = Array.isArray(lesson.knowledgePointIndexes)
        ? lesson.knowledgePointIndexes
            .map((item) => (typeof item === 'number' ? knowledgePoints[item]?.id : undefined))
            .filter((item): item is string => !!item)
        : [];
      const idsFromValues = Array.isArray(lesson.knowledgePointIds)
        ? lesson.knowledgePointIds.filter((item): item is string => typeof item === 'string')
        : [];
      const knowledgePointIds = [...new Set([...idsFromIndexes, ...idsFromValues])];
      const fallbackPoint = knowledgePoints[index] ?? knowledgePoints[0];

      return {
        id: `lesson_${nanoid(8)}`,
        order: index + 1,
        title: lesson.title?.trim() || `Lesson ${index + 1}`,
        objective: lesson.objective?.trim() || '',
        knowledgePointIds: knowledgePointIds.length > 0 ? knowledgePointIds : [fallbackPoint.id],
        lectureMinutes: 25,
        breakMinutes: 5,
        practiceMinutes: 25,
        summaryMinutes: 5,
        status: 'pending',
      };
    });

  if (lessons.length === 0) {
    for (let i = 0; i < knowledgePoints.length; i++) {
      const point = knowledgePoints[i];
      lessons.push({
        id: `lesson_${nanoid(8)}`,
        order: i + 1,
        title: point.title,
        objective: point.summary,
        knowledgePointIds: [point.id],
        lectureMinutes: 25,
        breakMinutes: 5,
        practiceMinutes: 25,
        summaryMinutes: 5,
        status: 'pending',
      });
    }
  }

  return {
    id: `book_${nanoid(10)}`,
    title: params.generated.title?.trim() || params.fileName.replace(/\.pdf$/i, ''),
    fileName: params.fileName,
    fileSize: params.fileSize,
    pdfStorageKey: params.pdfStorageKey,
    coverImage: params.coverImage,
    coverImageVersion: params.coverImageVersion,
    language: params.language,
    summary: params.generated.summary?.trim() || '',
    totalLessons: lessons.length,
    currentLessonIndex: 0,
    knowledgePoints,
    lessons,
    createdAt: now,
    updatedAt: now,
  };
}

export async function POST(req: NextRequest) {
  let fileName: string | undefined;
  try {
    const body = (await req.json()) as BookPlanRequest;
    fileName = body.fileName;

    if (!body.fileName || !body.pdfStorageKey || !body.pdfText) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'fileName, pdfStorageKey and pdfText are required',
      );
    }

    const language: BookLearningLanguage = body.language === 'en-US' ? 'en-US' : 'zh-CN';
    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req);
    const effectiveModelInfo = mergeModelInfoFromHeaders(req, modelInfo);
    const boundedPdfText = body.pdfText;
    const planningContext = buildPlanningPdfContext(boundedPdfText, effectiveModelInfo);
    const maxOutputTokens = getPlanMaxOutputTokens(effectiveModelInfo);
    log.info(
      `Creating book plan [file="${body.fileName}", model=${modelString}, mode=${planningContext.mode}, contextWindow=${planningContext.contextWindow}, maxInputChars=${planningContext.maxInputChars}, maxOutputTokens=${maxOutputTokens}, pdfChars=${body.pdfText.length}, planningChars=${planningContext.text.length}, headings=${planningContext.headings.length}]`,
    );

    let generated: GeneratedBookPlan | null = null;
    let warning: string | undefined;

    try {
      const result = await callLLM(
        {
          model: languageModel,
          system: buildSystemPrompt(language),
          prompt: buildUserPrompt({
            fileName: body.fileName,
            language,
            pdfText: planningContext.text,
            sourceMode: planningContext.mode,
          }),
          maxOutputTokens,
          maxRetries: 0,
        },
        'book-learning-plan',
        { retries: 1 },
      );

      generated = parseJsonResponse<GeneratedBookPlan>(result.text);
    } catch (error) {
      const failureReason = summarizeGenerationError(error);
      warning = getBookPlanWarning(language, failureReason);
      log.warn(
        `LLM book plan generation failed; falling back to heading-based draft [file="${body.fileName}", model=${modelString}${failureReason ? `, reason="${failureReason}"` : ''}]`,
        error,
      );
      generated = buildFallbackGeneratedPlan({
        fileName: body.fileName,
        language,
        pdfText: boundedPdfText,
        headings: planningContext.headings,
      });
    }

    if (!generated) {
      warning = getBookPlanWarning(language, 'LLM response was not valid JSON');
      log.warn(
        `LLM book plan response was not valid JSON; falling back to heading-based draft [file="${body.fileName}", model=${modelString}]`,
      );
      generated = buildFallbackGeneratedPlan({
        fileName: body.fileName,
        language,
        pdfText: boundedPdfText,
        headings: planningContext.headings,
      });
    }

    const plan = normalizePlan({
      generated,
      fileName: body.fileName,
      fileSize: body.fileSize || 0,
      pdfStorageKey: body.pdfStorageKey,
      coverImage: body.coverImage,
      coverImageVersion: body.coverImageVersion,
      language,
    });

    log.info(
      `Generated book plan "${plan.title}" with ${plan.knowledgePoints.length} knowledge points and ${plan.lessons.length} lessons [model=${modelString}]`,
    );

    return apiSuccess({ plan, ...(warning ? { warning } : {}) });
  } catch (error) {
    log.error(`Book plan generation failed [file="${fileName ?? 'unknown'}"]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate book plan',
    );
  }
}

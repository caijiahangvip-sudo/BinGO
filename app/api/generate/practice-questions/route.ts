import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { parseModelString } from '@/lib/server/ai-provider-runtime';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import {
  OPENAI_REASONING_EFFORT_XHIGH,
  normalizeOpenAIBaseUrlForSdk,
  shouldUseOpenAIResponsesApi,
} from '@/lib/ai/openai-routing';
import { buildChineseXinhuaPromptContext } from '@/lib/server/chinese-xinhua';
import { createLogger } from '@/lib/logger';
import type { BookLearningLanguage, BookPracticeQuestion } from '@/lib/types/book-learning';

export const maxDuration = 120;

const log = createLogger('PracticeQuestions API');

interface PracticeQuestionsRequest {
  planTitle?: string;
  language?: BookLearningLanguage;
  weaknesses?: string[];
  knowledgePoints?: Array<{
    id: string;
    title: string;
    summary?: string;
    status?: string;
  }>;
  count?: number;
}

interface GeneratedPracticeQuestion {
  prompt?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  expectedAnswer?: string;
  hints?: string[];
  solution?: string;
  knowledgePointIds?: string[];
  sourceUrls?: string[];
  sourceTitles?: string[];
}

interface GeneratedPracticeResponse {
  questions?: GeneratedPracticeQuestion[];
  sourceUrls?: string[];
  sourceTitles?: string[];
}

function normalizeCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 6;
  return Math.max(3, Math.min(10, Math.round(count)));
}

function sourceListFromResult(result: unknown): Array<{ title: string; url: string }> {
  const sources = (result as { sources?: unknown[] }).sources || [];
  return sources
    .map((source) => {
      const item = source as Record<string, unknown>;
      const url = typeof item.url === 'string' ? item.url : '';
      const title =
        typeof item.title === 'string' && item.title.trim()
          ? item.title
          : url.replace(/^https?:\/\//i, '');
      return { title, url };
    })
    .filter((source) => source.url);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeQuestion(
  question: GeneratedPracticeQuestion,
  fallbackKnowledgePointIds: string[],
  fallbackSources: Array<{ title: string; url: string }>,
): BookPracticeQuestion | null {
  const prompt = typeof question.prompt === 'string' ? question.prompt.trim() : '';
  if (!prompt) return null;

  const sourceUrls = unique([
    ...(question.sourceUrls || []).filter((url): url is string => typeof url === 'string'),
    ...fallbackSources.map((source) => source.url),
  ]).slice(0, 6);
  const sourceTitles = unique([
    ...(question.sourceTitles || []).filter((title): title is string => typeof title === 'string'),
    ...fallbackSources.map((source) => source.title),
  ]).slice(0, sourceUrls.length || 6);

  return {
    id: nanoid(),
    prompt,
    difficulty: question.difficulty || 'medium',
    expectedAnswer:
      typeof question.expectedAnswer === 'string' && question.expectedAnswer.trim()
        ? question.expectedAnswer.trim()
        : 'See the solution.',
    hints: Array.isArray(question.hints)
      ? question.hints.filter((hint): hint is string => typeof hint === 'string').slice(0, 3)
      : [],
    solution:
      typeof question.solution === 'string' && question.solution.trim()
        ? question.solution.trim()
        : question.expectedAnswer || '',
    knowledgePointIds:
      Array.isArray(question.knowledgePointIds) && question.knowledgePointIds.length > 0
        ? question.knowledgePointIds.filter((id): id is string => typeof id === 'string')
        : fallbackKnowledgePointIds,
    sourceUrls,
    sourceTitles,
    maxScore: 1,
  };
}

function buildPrompt(body: PracticeQuestionsRequest, count: number): string {
  const isZh = body.language !== 'en-US';
  const knowledgePointText = (body.knowledgePoints || [])
    .map((point, index) => {
      const summary = point.summary ? ` - ${point.summary}` : '';
      return `${index + 1}. [${point.id}] ${point.title}${summary}`;
    })
    .join('\n');
  const weaknessText = (body.weaknesses || []).map((item) => `- ${item}`).join('\n');

  return isZh
    ? `请联网搜索近几年与学生薄弱能力相关的真实练习题或考试题材料，并生成 ${count} 道刷题练习。

教材/课程：${body.planTitle || '未命名教材'}

需要补足的知识点：
${knowledgePointText || '暂无明确知识点，请根据用户画像薄弱项生成。'}

用户画像薄弱项：
${weaknessText || '暂无'}

要求：
- 题目要贴近近几年公开题型、考试题、竞赛题、面试题或能力训练题。
- 每题都要标注关联的 knowledgePointIds。
- 每题给出标准答案、解析、1-3 个提示、来源 URL。
- 不要复制长篇原文；可以改编题目，但必须保留来源链接。
- 只输出 JSON，不要输出 Markdown。

JSON 格式：
{
  "questions": [
    {
      "prompt": "题目",
      "difficulty": "easy|medium|hard",
      "expectedAnswer": "标准答案",
      "hints": ["提示1"],
      "solution": "解析",
      "knowledgePointIds": ["知识点 id"],
      "sourceUrls": ["https://..."],
      "sourceTitles": ["来源标题"]
    }
  ],
  "sourceUrls": ["https://..."],
  "sourceTitles": ["来源标题"]
}`
    : `Search the web for recent public practice, exam, contest, interview, or skills-training questions related to this student's weak areas, then generate ${count} practice questions.

Book/course: ${body.planTitle || 'Untitled book'}

Target knowledge points:
${knowledgePointText || 'No explicit knowledge points. Use the weaknesses below.'}

Student weaknesses:
${weaknessText || 'None'}

Requirements:
- Prefer recent public question styles from the last several years.
- Attach relevant knowledgePointIds to every question.
- Include expected answer, solution, 1-3 hints, and source URLs.
- Do not reproduce long copyrighted passages; adapt questions and keep source links.
- Output JSON only, no Markdown.

JSON shape:
{
  "questions": [
    {
      "prompt": "Question",
      "difficulty": "easy|medium|hard",
      "expectedAnswer": "Expected answer",
      "hints": ["Hint 1"],
      "solution": "Solution",
      "knowledgePointIds": ["knowledge point id"],
      "sourceUrls": ["https://..."],
      "sourceTitles": ["Source title"]
    }
  ],
  "sourceUrls": ["https://..."],
  "sourceTitles": ["Source title"]
}`;
}

export async function POST(req: NextRequest) {
  let resolvedModelString: string | undefined;

  try {
    const body = (await req.json()) as PracticeQuestionsRequest;
    const count = normalizeCount(body.count);
    const resolved = resolveModelFromHeaders(req);
    resolvedModelString = resolved.modelString;
    const { providerId, modelId } = parseModelString(resolved.modelString);

    if (!shouldUseOpenAIResponsesApi(providerId, resolved.baseUrl)) {
      return apiError(
        'INVALID_REQUEST',
        400,
        'Practice mode requires OpenAI Responses API. Use native OpenAI or an OpenAI-compatible base URL that contains /responses.',
      );
    }

    const openai = createOpenAI({
      apiKey: resolved.apiKey,
      baseURL: normalizeOpenAIBaseUrlForSdk(resolved.baseUrl),
    });
    const dictionaryContext = await buildChineseXinhuaPromptContext({
      text: [
        body.planTitle,
        ...(body.weaknesses || []),
        ...(body.knowledgePoints || []).flatMap((point) => [point.title, point.summary || '']),
      ]
        .filter(Boolean)
        .join('\n'),
      language: body.language,
      limit: 10,
    });
    const result = await generateText({
      model: openai.responses(modelId),
      system:
        `You generate concise educational practice questions. Use web search, cite source URLs, and return valid JSON only.${dictionaryContext ? `\n\n# Chinese Dictionary References\n${dictionaryContext}` : ''}`,
      prompt: buildPrompt(body, count),
      tools: {
        web_search: openai.tools.webSearch({
          externalWebAccess: true,
          searchContextSize: 'high',
        }),
      },
      toolChoice: { type: 'tool', toolName: 'web_search' },
      maxOutputTokens: 5000,
      providerOptions: {
        openai: {
          reasoningEffort: OPENAI_REASONING_EFFORT_XHIGH,
        },
      },
    });

    const parsed = parseJsonResponse<GeneratedPracticeResponse>(result.text);
    if (!parsed?.questions || parsed.questions.length === 0) {
      return apiError('PARSE_FAILED', 502, 'Failed to parse generated practice questions');
    }

    const fallbackSources = sourceListFromResult(result);
    const fallbackKnowledgePointIds =
      body.knowledgePoints?.map((point) => point.id).filter(Boolean) || [];
    const questions = parsed.questions
      .map((question) => normalizeQuestion(question, fallbackKnowledgePointIds, fallbackSources))
      .filter((question): question is BookPracticeQuestion => Boolean(question))
      .slice(0, count);
    const sourceUrls = unique([
      ...(parsed.sourceUrls || []).filter((url): url is string => typeof url === 'string'),
      ...fallbackSources.map((source) => source.url),
      ...questions.flatMap((question) => question.sourceUrls || []),
    ]);

    return apiSuccess({
      questions,
      sourceUrls,
      sourceTitles: unique([
        ...(parsed.sourceTitles || []).filter(
          (title): title is string => typeof title === 'string',
        ),
        ...fallbackSources.map((source) => source.title),
        ...questions.flatMap((question) => question.sourceTitles || []),
      ]),
    });
  } catch (error) {
    log.error(
      `Practice question generation failed [model=${resolvedModelString ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate practice questions',
    );
  }
}

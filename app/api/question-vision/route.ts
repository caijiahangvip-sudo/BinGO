import { NextRequest } from 'next/server';
import { generateText, type UserContent } from 'ai';
import { z } from 'zod';

import { parseJsonResponse } from '@/lib/generation/json-repair';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 120;

const log = createLogger('QuestionVision API');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([a-z0-9+/=\s]+)$/i;

const RequestSchema = z.object({
  imageDataUrl: z.string().min(100),
  fileName: z.string().optional(),
});

const AgentSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    role: z.string().optional(),
    initialViewpoint: z.string().min(1),
    openingLine: z.string().optional(),
    guidance: z.array(z.string()).optional(),
    conflictPoint: z.string().optional(),
  })
  .passthrough();

const ScriptFlowStepSchema = z
  .object({
    speaker: z.string().min(1),
    intent: z.string().optional(),
    message: z.string().min(1),
  })
  .passthrough();

const QuestionVisionConfigSchema = z
  .object({
    discussionTopic: z.string().min(1),
    initialStage: z.enum(['Debate_Flow', 'wait_for_user_teaching']),
    extractedMarkdown: z.string().min(1),
    agents: z.array(AgentSchema).min(2),
    teacherGuide: z.array(z.string()).optional(),
    scriptFlow: z.array(ScriptFlowStepSchema).optional(),
  })
  .passthrough();

type QuestionVisionConfig = z.infer<typeof QuestionVisionConfigSchema>;

function parseImageDataUrl(imageDataUrl: string): { base64: string; mediaType: string } | null {
  const match = imageDataUrl.match(DATA_URL_RE);
  if (!match) return null;

  const mediaType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');
  const byteLength = Buffer.byteLength(base64, 'base64');

  if (byteLength <= 0 || byteLength > MAX_IMAGE_BYTES) {
    return null;
  }

  return { base64, mediaType };
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && !!item.trim());
  return strings.length > 0 ? strings.map((item) => item.trim()) : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeAgent(
  value: unknown,
  index: number,
  discussionTopic: string,
): QuestionVisionConfig['agents'][number] {
  const record = readRecord(value);
  const label = index === 0 ? 'Agent A' : index === 1 ? 'Agent B' : `Agent ${index + 1}`;

  return {
    id: readString(record.id, `agent-${index + 1}`),
    name: readString(record.name, label),
    role: readString(
      record.role,
      index === 0 ? '直觉解法提出者' : index === 1 ? '严谨推理挑战者' : '学习讨论参与者',
    ),
    initialViewpoint: readString(
      record.initialViewpoint,
      index === 0
        ? `先用直觉或常见公式尝试解决“${discussionTopic}”。`
        : `检查 Agent A 的假设，并从定义或边界条件重新验证“${discussionTopic}”。`,
    ),
    openingLine: readString(
      record.openingLine,
      index === 0
        ? '我先按最直接的思路试一下，但这里可能有一个容易忽略的条件。'
        : '我想先确认题目条件是否真的支持这个推法。我们逐步核对。',
    ),
    guidance: readStringArray(record.guidance),
    conflictPoint: readString(record.conflictPoint),
  };
}

function normalizeConfig(input: unknown): QuestionVisionConfig | null {
  const rootRecord = readRecord(input);
  const nested =
    rootRecord.config ??
    rootRecord.bingoScript ??
    rootRecord.lessonConfig ??
    rootRecord.result ??
    input;
  const record = readRecord(nested);

  const discussionTopic = readString(
    record.discussionTopic,
    readString(record.topic, readString(record.title, '拍照题目互动课')),
  );
  const extractedMarkdown = readString(
    record.extractedMarkdown,
    readString(record.markdown, readString(record.questionMarkdown, discussionTopic)),
  );
  const rawInitialStage = readString(record.initialStage, 'Debate_Flow');
  const initialStage =
    rawInitialStage === 'wait_for_user_teaching' ? 'wait_for_user_teaching' : 'Debate_Flow';
  const rawAgents = Array.isArray(record.agents) ? record.agents : [];

  const agents = rawAgents.map((agent, index) => normalizeAgent(agent, index, discussionTopic));
  while (agents.length < 2) {
    agents.push(normalizeAgent({}, agents.length, discussionTopic));
  }

  const rawScriptFlow = Array.isArray(record.scriptFlow) ? record.scriptFlow : [];
  const scriptFlow = rawScriptFlow
    .map((step) => {
      const stepRecord = readRecord(step);
      const message = readString(stepRecord.message, readString(stepRecord.content));
      if (!message) return null;
      return {
        speaker: readString(stepRecord.speaker, 'Teacher'),
        intent: readString(stepRecord.intent),
        message,
      };
    })
    .filter((step): step is NonNullable<typeof step> => Boolean(step));

  const normalized = {
    ...record,
    discussionTopic,
    initialStage,
    extractedMarkdown,
    agents: agents.slice(0, 4),
    teacherGuide: readStringArray(record.teacherGuide),
    scriptFlow: scriptFlow.length > 0 ? scriptFlow : undefined,
  };

  const result = QuestionVisionConfigSchema.safeParse(normalized);
  return result.success ? result.data : null;
}

function buildPrompt(fileName?: string): string {
  return `你是 BinGo AI 互动教育平台的课程设计师和数学 OCR 校对员。

请仔细阅读用户上传的题目图片${fileName ? `（文件名：${fileName}）` : ''}，完成两件事：
1. 精确提取题干、选项、图表文字、答案线索和数学公式，输出为干净 Markdown。数学公式用 LaTeX，行内公式用 $...$，独立公式用 $$...$$。不要擅自补题；看不清处标记为 [不确定]。
2. 把这道题改造成 BinGo 的互动课 JSON，让两个 Agent 用不同解题思路产生可教学的冲突，再引导学生判断和修正。

只返回 JSON，不要 Markdown 代码块，不要解释。

JSON 格式必须是：
{
  "discussionTopic": "核心知识点或题目主题",
  "initialStage": "Debate_Flow",
  "extractedMarkdown": "从图片 OCR 得到的题目 Markdown，保留公式和选项",
  "agents": [
    {
      "id": "agent-a",
      "name": "Agent A",
      "role": "直觉解法提出者",
      "initialViewpoint": "用一种常见但可能有漏洞的思路解题",
      "openingLine": "第一句发言",
      "guidance": ["接下来应该追问学生的问题"],
      "conflictPoint": "与 Agent B 的分歧点"
    },
    {
      "id": "agent-b",
      "name": "Agent B",
      "role": "严谨推理挑战者",
      "initialViewpoint": "用定义、条件核对或另一种方法解题",
      "openingLine": "第一句发言",
      "guidance": ["接下来应该追问学生的问题"],
      "conflictPoint": "与 Agent A 的分歧点"
    }
  ],
  "teacherGuide": ["教师/系统如何引导学生参与"],
  "scriptFlow": [
    {
      "speaker": "Agent A",
      "intent": "提出初始思路",
      "message": "面向学生的一段话"
    }
  ]
}

要求：
- discussionTopic 要短而具体。
- initialStage 只能是 "Debate_Flow" 或 "wait_for_user_teaching"，优先使用 "Debate_Flow"。
- extractedMarkdown 必须足够完整，能脱离图片复现题目。
- agents 至少 2 个，必须包含 Agent A 和 Agent B。
- 输出必须是可被 JSON.parse 解析的 JSON。`;
}

export async function POST(req: NextRequest) {
  let resolvedModelString: string | undefined;

  try {
    const bodyResult = RequestSchema.safeParse(await req.json());
    if (!bodyResult.success) {
      return apiError('INVALID_REQUEST', 400, 'Request body must include imageDataUrl');
    }

    const image = parseImageDataUrl(bodyResult.data.imageDataUrl);
    if (!image) {
      return apiError(
        'INVALID_REQUEST',
        400,
        'imageDataUrl must be a base64 PNG, JPEG, or WebP data URL under 10MB',
      );
    }

    const resolved = resolveModelFromHeaders(req);
    resolvedModelString = resolved.modelString;

    if (resolved.modelInfo?.capabilities?.vision === false) {
      return apiError(
        'INVALID_REQUEST',
        400,
        'The selected model is marked as not supporting vision. Please choose a vision-capable model.',
      );
    }

    const content: UserContent = [
      { type: 'text', text: buildPrompt(bodyResult.data.fileName) },
      { type: 'image', image: image.base64, mediaType: image.mediaType },
    ];

    const result = await generateText({
      model: resolved.model,
      messages: [{ role: 'user', content }],
      maxOutputTokens: 5000,
      temperature: 0.2,
    });

    const parsed = parseJsonResponse<unknown>(result.text);
    const config = normalizeConfig(parsed);
    if (!config) {
      return apiError(
        'PARSE_FAILED',
        502,
        'Vision model returned JSON that could not be parsed into a BinGo script',
        result.text.slice(0, 1000),
      );
    }

    return apiSuccess({ config });
  } catch (error) {
    log.error(
      `Question vision generation failed [model=${resolvedModelString ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate BinGo vision script',
    );
  }
}

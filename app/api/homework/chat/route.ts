import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { buildChineseXinhuaPromptContext } from '@/lib/server/chinese-xinhua';
import { createLogger } from '@/lib/logger';
import type { HomeworkLanguage, HomeworkQuestionSolution } from '@/lib/types/homework';

export const runtime = 'nodejs';
export const maxDuration = 120;

const log = createLogger('Homework Chat API');

interface HomeworkChatRequest {
  language?: HomeworkLanguage;
  question?: HomeworkQuestionSolution;
  userMessage?: string;
  previousMessages?: Array<{
    role: 'user' | 'assistant';
    text: string;
  }>;
  profileWeaknesses?: string[];
}

function buildSystemPrompt(language: HomeworkLanguage): string {
  return language === 'zh-CN'
    ? `你是 Bingo 的作业陪写老师。学生已经拿到参考答案，现在会问“不懂的地方”。
你的回答要：
- 直接解释学生卡住的点，不重新生成整份答案。
- 用循序渐进的提示和简短例子带着学生理解。
- 如果学生明显只是要抄答案，改为解释思路和检查方法。
- 结尾给一个很小的自检问题。`
    : `You are Bingo's homework companion. The student already has reference answers and is asking about confusing parts.
Answer by:
- Explaining the stuck point directly, not regenerating the whole sheet.
- Using step-by-step hints and short examples.
- If the student is only copying, explain reasoning and checking methods.
- End with one tiny self-check question.`;
}

function buildPrompt(body: HomeworkChatRequest, language: HomeworkLanguage): string {
  const question = body.question;
  const history = (body.previousMessages || [])
    .slice(-8)
    .map((message) => `${message.role === 'user' ? 'Student' : 'Bingo'}: ${message.text}`)
    .join('\n');
  const weaknesses = (body.profileWeaknesses || []).filter(Boolean).join(', ');

  if (language === 'zh-CN') {
    return `当前题目：
${question?.question || '未指定'}

参考答案：
${question?.answer || '无'}

解题过程：
${question?.solution || '无'}

关联知识点：${question?.knowledgePoints?.join('、') || '未标注'}
用户画像薄弱项：${weaknesses || '暂无'}

对话历史：
${history || '暂无'}

学生刚刚问：
${body.userMessage || ''}

请回答学生。`;
  }

  return `Current question:
${question?.question || 'Not specified'}

Reference answer:
${question?.answer || 'None'}

Solution:
${question?.solution || 'None'}

Knowledge points: ${question?.knowledgePoints?.join(', ') || 'Unspecified'}
Profile weak areas: ${weaknesses || 'None'}

Conversation history:
${history || 'None'}

Student asks:
${body.userMessage || ''}

Answer the student.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as HomeworkChatRequest;
    const language: HomeworkLanguage = body.language === 'en-US' ? 'en-US' : 'zh-CN';
    const userMessage = body.userMessage?.trim();
    if (!userMessage) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'userMessage is required');
    }

    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req);
    const dictionaryContext = await buildChineseXinhuaPromptContext({
      text: [
        userMessage,
        body.question?.question,
        body.question?.answer,
        body.question?.solution,
        ...(body.question?.knowledgePoints || []),
      ]
        .filter(Boolean)
        .join('\n'),
      language,
      limit: 10,
    });
    const systemPrompt = dictionaryContext
      ? `${buildSystemPrompt(language)}\n\n# Chinese Dictionary References\n${dictionaryContext}`
      : buildSystemPrompt(language);
    const result = await callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: buildPrompt(body, language),
        maxOutputTokens: modelInfo?.outputWindow,
      },
      'homework-chat',
    );

    return apiSuccess({ reply: result.text.trim(), model: modelString });
  } catch (error) {
    log.error('Homework chat failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to answer homework question',
    );
  }
}

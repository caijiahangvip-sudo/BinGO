/**
 * Stateless Chat API Endpoint
 *
 * POST /api/chat - Send message, receive SSE stream
 *
 * This endpoint:
 * 1. Receives full state from client (messages + storeState)
 * 2. Runs single-pass generation
 * 3. Streams events as SSE (text deltas + tool calls)
 *
 * Fully stateless: interruption is handled by the client aborting
 * the fetch request, which triggers req.signal on the server side.
 */

import { NextRequest } from 'next/server';
import { statelessGenerate } from '@/lib/orchestration/stateless-generate';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import { OPENAI_REASONING_EFFORT_XHIGH } from '@/lib/ai/openai-routing';
import { resolveAutoThinkingEffort } from '@/lib/ai/thinking-auto';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModel } from '@/lib/server/resolve-model';
import { buildChineseXinhuaPromptContext } from '@/lib/server/chinese-xinhua';
import {
  DEFAULT_RAG_STUDENT_ID,
  buildLongTermMemoryContext,
  searchStudentEvidenceEmbeddings,
} from '@/lib/server/vector-store';
import {
  containsImagePayload,
  estimateTokensFromText,
  estimateTokensFromUnknown,
  recordLlmTelemetry,
  type LlmTelemetryStatus,
} from '@/lib/telemetry';
const log = createLogger('Chat API');

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;
const CHAT_RAG_TIMEOUT_MS = 5_000;

async function withChatTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function extractLatestUserText(body: StatelessChatRequest): string {
  return (
    body.messages
      .slice()
      .reverse()
      .find((message) => message.role === 'user')
      ?.parts?.map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
      .join('\n') || ''
  );
}

function buildRagQuery(body: StatelessChatRequest, latestUserText: string): string {
  return [
    body.config.discussionTopic,
    body.config.debateConfig?.topic,
    body.config.studentQuestion,
    latestUserText,
    body.storeState.stage?.name,
    body.storeState.stage?.description,
  ]
    .filter(Boolean)
    .join('\n');
}

async function resolveLongTermMemoryContext(
  body: StatelessChatRequest,
  latestUserText: string,
): Promise<string> {
  const query = buildRagQuery(body, latestUserText).trim();
  if (!query) return '';

  try {
    const matches = await withChatTimeout(
      'Long-term memory retrieval',
      CHAT_RAG_TIMEOUT_MS,
      searchStudentEvidenceEmbeddings({
        studentId: DEFAULT_RAG_STUDENT_ID,
        query,
        topK: 3,
      }),
    );
    return buildLongTermMemoryContext(matches);
  } catch (error) {
    log.warn('Long-term memory retrieval failed; continuing without RAG context:', error);
    return '';
  }
}

/**
 * POST /api/chat
 * Send a message and receive SSE stream of generation events
 *
 * Request body: StatelessChatRequest
 * {
 *   messages: UIMessage[],
 *   storeState: { stage, scenes, currentSceneId, mode },
 *   config: { agentIds, sessionType? },
 *   apiKey: string,
 *   baseUrl?: string,
 *   model?: string
 * }
 *
 * Response: SSE stream of StatelessEvent
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const requestStartedAt = Date.now();
  let chatModel: string | undefined;
  let chatProviderType: string | undefined;
  let chatMessageCount: number | undefined;
  let inputTokensForTelemetry = 0;
  let outputTextForTelemetry = '';
  let outputActionTextForTelemetry = '';
  let telemetryTags: string[] = [];
  let telemetryRecorded = false;

  const finalizeLlmTelemetry = (status: LlmTelemetryStatus, error?: unknown) => {
    if (telemetryRecorded) return;
    telemetryRecorded = true;

    const outputTokens =
      estimateTokensFromText(outputTextForTelemetry) +
      estimateTokensFromText(outputActionTextForTelemetry);

    recordLlmTelemetry({
      route: '/api/chat',
      model: chatModel,
      providerType: chatProviderType,
      latencyMs: Date.now() - requestStartedAt,
      inputTokens: inputTokensForTelemetry,
      outputTokens,
      totalTokens: inputTokensForTelemetry + outputTokens,
      messageCount: chatMessageCount,
      tags: telemetryTags,
      status,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    });
  };

  try {
    const body: StatelessChatRequest = await req.json();
    chatModel = body.model;
    chatProviderType = body.providerType;
    chatMessageCount = body.messages?.length;

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }

    if (!body.storeState) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: storeState');
    }

    if (!body.config || !body.config.agentIds || body.config.agentIds.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: config.agentIds');
    }

    const { model: languageModel, apiKey: resolvedApiKey } = resolveModel({
      modelString: body.model,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      providerType: body.providerType,
      requiresApiKey: body.requiresApiKey,
    });

    if (!resolvedApiKey && body.requiresApiKey !== false) {
      return apiError('MISSING_API_KEY', 401, 'API Key is required');
    }

    log.info('Processing request');
    log.info(
      `Agents: ${body.config.agentIds.join(', ')}, Messages: ${body.messages.length}, Turn: ${body.directorState?.turnCount ?? 0}`,
    );

    // Use the native request signal for abort propagation
    const signal = req.signal;
    const latestUserText = extractLatestUserText(body);
    const stageLanguage = body.storeState.stage?.language;
    const dictionaryContext = await buildChineseXinhuaPromptContext({
      text: [
        latestUserText,
        body.config.studentQuestion,
        body.config.discussionTopic,
        body.storeState.stage?.name,
        body.storeState.stage?.description,
      ]
        .filter(Boolean)
        .join('\n'),
      language: stageLanguage,
      limit: 8,
    });
    const longTermMemoryContext = await resolveLongTermMemoryContext(body, latestUserText);

    telemetryTags = [
      containsImagePayload(body.messages) ? 'vision-teach-back' : undefined,
      body.config.sessionType ? `session:${body.config.sessionType}` : undefined,
      body.config.discussionMode === 'debate' ? 'debate-flow' : undefined,
      longTermMemoryContext ? 'learning-memory-rag' : undefined,
    ].filter((tag): tag is string => Boolean(tag));
    inputTokensForTelemetry = estimateTokensFromUnknown({
      messages: body.messages,
      storeState: body.storeState,
      config: body.config,
      directorState: body.directorState,
      userProfile: body.userProfile,
      dictionaryContext,
      longTermMemoryContext,
    });

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Stream generation in background with heartbeat to prevent connection timeout
    const HEARTBEAT_INTERVAL_MS = 15_000;
    (async () => {
      // Heartbeat: periodically send SSE comments to keep the connection alive.
      // Proxies / browsers may close idle SSE connections after 30-120s of silence.
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            writer.write(encoder.encode(`:heartbeat\n\n`)).catch(() => stopHeartbeat());
          } catch {
            stopHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      try {
        startHeartbeat();

        const generator = statelessGenerate(
          {
            ...body,
            apiKey: resolvedApiKey,
            dictionaryContext,
            longTermMemoryContext,
          },
          signal,
          languageModel,
          ((): ThinkingConfig => {
            // 读取客户端传入的思考程度；未传则回退到超高（保持原有行为）
            const effort = body.thinkingEffort;
            if (effort === 'none') {
              return { enabled: false };
            }
            if (effort === 'auto') {
              // 自动档：根据本次请求内容智能判断思考深度
              const { effort: resolved, reason } = resolveAutoThinkingEffort(body.messages);
              log.info(`[Chat] 自动思考判断 → ${resolved}（${reason}）`);
              return { enabled: true, effort: resolved };
            }
            if (effort) {
              return { enabled: true, effort };
            }
            return { enabled: true, effort: OPENAI_REASONING_EFFORT_XHIGH };
          })(),
        );

        let streamStatus: LlmTelemetryStatus = 'success';

        for await (const event of generator) {
          if (signal.aborted) {
            log.info('Request was aborted');
            streamStatus = 'aborted';
            break;
          }

          if (event.type === 'text_delta') {
            outputTextForTelemetry += event.data.content;
          } else if (event.type === 'action') {
            outputActionTextForTelemetry += JSON.stringify({
              actionName: event.data.actionName,
              params: event.data.params,
            });
          }

          const data = `data: ${JSON.stringify(event)}\n\n`;
          await writer.write(encoder.encode(data));
        }

        stopHeartbeat();
        finalizeLlmTelemetry(streamStatus);
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        // If aborted, just close the writer silently
        if (signal.aborted) {
          log.info('Request aborted during streaming');
          finalizeLlmTelemetry('aborted', error);
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        finalizeLlmTelemetry('error', error);
        log.error(
          `Chat stream error [model=${body.model ?? 'unknown'}, agents=${body.config?.agentIds?.length ?? 0}, messages=${body.messages?.length ?? 0}]:`,
          error,
        );

        // Try to send error event
        try {
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
        } catch {
          // Writer may already be closed
        }
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error(
      `Chat request failed [model=${chatModel ?? 'unknown'}, messages=${chatMessageCount ?? 0}]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to process request',
    );
  }
}

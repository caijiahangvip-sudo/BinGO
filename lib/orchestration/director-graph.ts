/**
 * Director Graph — LangGraph StateGraph for Multi-Agent Orchestration
 *
 * Unified graph topology (same for single and multi-agent):
 *
 *   START → director ──(end)──→ END
 *              │
 *              └─(next)→ agent_generate ──→ director (loop)
 *
 * The director node adapts its strategy based on agent count:
 *   - Single agent: pure code logic (no LLM). Dispatches the agent on
 *     turn 0, then cues the user on subsequent turns.
 *   - Multi agent: LLM-based decision (with code fast-paths for turn 0
 *     trigger agent and turn limits).
 *
 * Uses LangGraph's custom stream mode: each node pushes StatelessEvent
 * chunks via config.writer() for real-time SSE delivery.
 */

import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { LanguageModel } from 'ai';

import { AISdkLangGraphAdapter } from './ai-sdk-adapter';
import type {
  DebateConfig,
  DebateState,
  DiscussionMode,
  StatelessEvent,
  StatelessChatRequest,
} from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import {
  buildStructuredPrompt,
  summarizeConversation,
  convertMessagesToOpenAI,
} from './prompt-builder';
import {
  buildDirectorPrompt,
  DEFAULT_VISUAL_CLARIFICATION_MESSAGE,
  REQUEST_CLARIFICATION_ACTION_NAME,
  isWhiteboardLedgerSummary,
  parseDirectorDecision,
} from './director-prompt';
import { getEffectiveActions } from './tool-schemas';
import type {
  AgentTurnSummary,
  WhiteboardActionRecord,
  WhiteboardLedgerRecord,
} from './director-prompt';
import { parseStructuredChunk, createParserState, finalizeParser } from './stateless-generate';
import { createLogger } from '@/lib/logger';

const log = createLogger('DirectorGraph');
const DEFAULT_MAX_GRAPH_ITERATIONS = 5;

function writeGraphError(config: LangGraphRunnableConfig, message: string): void {
  const rawWrite = config.writer as ((chunk: StatelessEvent) => void) | undefined;
  if (!rawWrite) return;
  try {
    rawWrite({ type: 'error', data: { message } });
  } catch {
    /* controller closed after abort */
  }
}

function shouldStopForGraphIterationLimit(
  state: OrchestratorStateType,
  config: LangGraphRunnableConfig,
  nodeName: string,
): boolean {
  if (state.graphIterations < state.maxGraphIterations) return false;

  const message = `Director graph exceeded maxIterations=${state.maxGraphIterations} at node "${nodeName}". Generation was stopped to prevent an infinite graph loop.`;
  log.error(message);
  writeGraphError(config, message);
  return true;
}

function getClarificationMessage(params: Record<string, unknown>): string {
  const message = params.message;
  return typeof message === 'string' && message.trim()
    ? message.trim()
    : DEFAULT_VISUAL_CLARIFICATION_MESSAGE;
}

function isRequestClarificationAction(actionName: string): boolean {
  return actionName === REQUEST_CLARIFICATION_ACTION_NAME;
}

// ==================== State Definition ====================

/**
 * LangGraph state annotation for the orchestration graph
 */
const OrchestratorState = Annotation.Root({
  // Input (set once at graph entry)
  messages: Annotation<StatelessChatRequest['messages']>,
  storeState: Annotation<StatelessChatRequest['storeState']>,
  availableAgentIds: Annotation<string[]>,
  maxTurns: Annotation<number>,
  languageModel: Annotation<LanguageModel>,
  thinkingConfig: Annotation<ThinkingConfig | null>,
  discussionContext: Annotation<{
    topic: string;
    prompt?: string;
    autoEndPolicy?: 'quiz_pass';
    studentQuestion?: string;
  } | null>,
  discussionMode: Annotation<DiscussionMode>,
  debateConfig: Annotation<DebateConfig | null>,
  debateState: Annotation<DebateState | null>,
  triggerAgentId: Annotation<string | null>,
  userProfile: Annotation<{ nickname?: string; bio?: string } | null>,
  dictionaryContext: Annotation<string | null>,
  longTermMemoryContext: Annotation<string | null>,
  /** Request-scoped agent configs for generated agents (not in the default registry) */
  agentConfigOverrides: Annotation<Record<string, AgentConfig>>,
  /** Request-scoped graph safety fuse. Incremented by every graph node. */
  graphIterations: Annotation<number>,
  /** Hard limit for graph node transitions in a single SSE request. */
  maxGraphIterations: Annotation<number>,

  // Mutable (updated by nodes)
  currentAgentId: Annotation<string | null>,
  turnCount: Annotation<number>,
  agentResponses: Annotation<AgentTurnSummary[]>({
    reducer: (prev, update) => [...prev, ...update],
    default: () => [],
  }),
  whiteboardLedger: Annotation<WhiteboardLedgerRecord[]>({
    reducer: (prev, update) => [...prev, ...update],
    default: () => [],
  }),
  shouldEnd: Annotation<boolean>,
  totalActions: Annotation<number>,
});

type OrchestratorStateType = typeof OrchestratorState.State;

/**
 * Look up an agent config: request-scoped overrides first, then global registry.
 * This keeps the server stateless — generated agent configs travel with the request.
 */
function resolveAgent(state: OrchestratorStateType, agentId: string): AgentConfig | undefined {
  return state.agentConfigOverrides[agentId] ?? useAgentRegistry.getState().getAgent(agentId);
}

function getInitialDebateState(config: DebateConfig, topic?: string): DebateState {
  return {
    phase: 'agent_a',
    agentAId: config.agentAId,
    agentBId: config.agentBId,
    topic: config.topic || topic,
  };
}

function buildSocraticConstructivistPrompt(ledger: WhiteboardLedgerRecord[]): string {
  const userTraceCount = ledger.filter(
    (record) => !isWhiteboardLedgerSummary(record) && record.actorType === 'user',
  ).length;

  return `# Socratic Constructivist Constraint (CRITICAL)
- You MUST deeply inspect the whiteboard Ledger in the context, especially user actions.
- User whiteboard trace count in this request context: ${userTraceCount}.
- If the student has drawn, written, cleared, or connected anything on the whiteboard, you MUST ask a targeted follow-up about those exact traces.
- Do NOT give the final answer directly. Guide the student to derive it with hints, contrastive questions, and requests to justify their next step.
- If the student's trace is incomplete or incorrect, name the observed part and ask what should change, instead of replacing their reasoning with your own solution.`;
}

function buildDebateAgentPrompt(state: OrchestratorStateType, agentId: string): string {
  if (state.discussionMode !== 'debate' || !state.debateConfig || !state.debateState) {
    return '';
  }

  const isAgentA = agentId === state.debateState.agentAId;
  const isAgentB = agentId === state.debateState.agentBId;
  if (!isAgentA && !isAgentB) return '';

  const side = isAgentA ? 'Agent A' : 'Agent B';
  const half = isAgentA ? 'left half' : 'right half';
  const xRange = isAgentA ? 'x between 60 and 430' : 'x between 560 and 920';
  const persona =
    (isAgentA ? state.debateConfig.agentAPersona : state.debateConfig.agentBPersona) ||
    (isAgentA
      ? 'argue the affirmative/pro side with clear evidence'
      : 'argue the opposing/con side with clear counter-evidence');

  return `# Debate_Flow Constraint (CRITICAL)
You are ${side} in a forced two-agent debate on "${state.debateState.topic || state.discussionContext?.topic || 'the current topic'}".
Persona for this turn: ${persona}.
- Present the opposite side from the other debate agent. Do not hedge into a neutral summary.
- You MUST use wb_draw_text to write your core claim and 1-2 supporting points on the whiteboard ${half}.
- Place all debate text with ${xRange}; y should be between 80 and 460. Do not write in the other half.
- Keep speech concise and invite the student to judge the stronger argument.
- Your visible whiteboard note should be short enough to fit on one side.`;
}

// ==================== Director Node ====================

/**
 * Unified director: decides which agent speaks next.
 *
 * Strategy varies by agent count:
 *   Single agent — pure code logic, zero LLM calls:
 *     turn 0: dispatch the sole agent
 *     turn 1+: cue user to speak (keeps session active for follow-ups)
 *
 *   Multi agent — LLM-based with code fast-paths:
 *     turn 0 + triggerAgentId: dispatch trigger agent (skip LLM)
 *     otherwise: LLM decides next agent / USER / END
 */
async function directorNode(
  state: OrchestratorStateType,
  config: LangGraphRunnableConfig,
): Promise<Partial<OrchestratorStateType>> {
  if (shouldStopForGraphIterationLimit(state, config, 'director')) {
    return {
      shouldEnd: true,
      graphIterations: state.graphIterations,
    };
  }

  const nextGraphIterations = state.graphIterations + 1;
  const rawWrite = config.writer as (chunk: StatelessEvent) => void;
  const write = (chunk: StatelessEvent) => {
    try {
      rawWrite(chunk);
    } catch {
      /* controller closed after abort */
    }
  };
  const isSingleAgent = state.availableAgentIds.length <= 1;

  // ── Debate_Flow: deterministic A -> B -> USER routing across stateless requests ──
  if (state.discussionMode === 'debate' && state.debateConfig) {
    const debateState =
      state.debateState ??
      getInitialDebateState(state.debateConfig, state.discussionContext?.topic);

    if (state.turnCount >= state.maxTurns) {
      log.info(`[Director][Debate_Flow] Request turn limit reached; returning to client`);
      return { shouldEnd: true, debateState, graphIterations: nextGraphIterations };
    }

    if (debateState.phase === 'agent_a' || debateState.phase === 'agent_b') {
      const nextAgentId =
        debateState.phase === 'agent_a' ? debateState.agentAId : debateState.agentBId;
      if (!state.availableAgentIds.includes(nextAgentId)) {
        log.warn(`[Director][Debate_Flow] Agent "${nextAgentId}" is not available, ending`);
        return { shouldEnd: true, debateState, graphIterations: nextGraphIterations };
      }

      log.info(`[Director][Debate_Flow] Dispatching ${debateState.phase}: "${nextAgentId}"`);
      write({
        type: 'thinking',
        data: { stage: 'agent_loading', agentId: nextAgentId },
      });
      return {
        currentAgentId: nextAgentId,
        shouldEnd: false,
        debateState,
        graphIterations: nextGraphIterations,
      };
    }

    if (debateState.phase === 'user') {
      const prompt = `请比较白板左半区和右半区的两种观点，说出你更支持哪一边，并说明理由。`;
      log.info('[Director][Debate_Flow] Cueing USER after both debate agents');
      write({
        type: 'cue_user',
        data: { fromAgentId: debateState.agentBId, prompt },
      });
      return {
        shouldEnd: true,
        debateState: { ...debateState, phase: 'done' },
        graphIterations: nextGraphIterations,
      };
    }

    return { shouldEnd: true, debateState, graphIterations: nextGraphIterations };
  }

  // ── Turn limit check (applies to both single & multi) ──
  if (state.turnCount >= state.maxTurns) {
    log.info(`[Director] Turn limit reached (${state.turnCount}/${state.maxTurns}), ending`);
    return { shouldEnd: true, graphIterations: nextGraphIterations };
  }

  // ── Single agent: code-only director ──
  if (isSingleAgent) {
    const agentId = state.availableAgentIds[0] || 'default-1';

    if (state.turnCount === 0) {
      // First turn: dispatch the agent
      log.info(`[Director] Single agent: dispatching "${agentId}"`);
      write({ type: 'thinking', data: { stage: 'agent_loading', agentId } });
      return { currentAgentId: agentId, shouldEnd: false, graphIterations: nextGraphIterations };
    }

    // Agent already responded: cue user for follow-up
    log.info(`[Director] Single agent: cueing user after "${agentId}"`);
    write({ type: 'cue_user', data: { fromAgentId: agentId } });
    return { shouldEnd: true, graphIterations: nextGraphIterations };
  }

  // ── Multi agent: fast-path for first turn with trigger ──
  if (state.turnCount === 0 && state.triggerAgentId) {
    const triggerId = state.triggerAgentId;
    if (state.availableAgentIds.includes(triggerId)) {
      log.info(`[Director] First turn: dispatching trigger agent "${triggerId}"`);
      write({
        type: 'thinking',
        data: { stage: 'agent_loading', agentId: triggerId },
      });
      return {
        currentAgentId: triggerId,
        shouldEnd: false,
        graphIterations: nextGraphIterations,
      };
    }
    log.warn(
      `[Director] Trigger agent "${triggerId}" not in available agents, falling through to LLM`,
    );
  }

  // ── Multi agent: LLM-based decision ──
  const agents: AgentConfig[] = state.availableAgentIds
    .map((id) => resolveAgent(state, id))
    .filter((a): a is AgentConfig => a != null);

  if (agents.length === 0) {
    return { shouldEnd: true, graphIterations: nextGraphIterations };
  }

  write({ type: 'thinking', data: { stage: 'director' } });

  const openaiMessages = convertMessagesToOpenAI(state.messages);
  const conversationSummary = summarizeConversation(openaiMessages);

  const prompt = buildDirectorPrompt(
    agents,
    conversationSummary,
    state.agentResponses,
    state.turnCount,
    state.discussionContext,
    state.triggerAgentId,
    state.whiteboardLedger,
    state.userProfile || undefined,
    state.storeState.whiteboardOpen,
  );

  const adapter = new AISdkLangGraphAdapter(state.languageModel, state.thinkingConfig ?? undefined);

  try {
    const result = await adapter._generate(
      [new SystemMessage(prompt), new HumanMessage('Decide which agent should speak next.')],
      { signal: config.signal } as Record<string, unknown>,
    );

    const content = result.generations[0]?.text || '';
    log.info(`[Director] Raw decision: ${content}`);

    const decision = parseDirectorDecision(content);

    if (decision.shouldEnd || !decision.nextAgentId) {
      log.info('[Director] Decision: END');
      return { shouldEnd: true, graphIterations: nextGraphIterations };
    }

    if (decision.nextAgentId === 'USER') {
      log.info('[Director] Decision: cue USER to speak');
      write({
        type: 'cue_user',
        data: { fromAgentId: state.currentAgentId || undefined },
      });
      return { shouldEnd: true, graphIterations: nextGraphIterations };
    }

    const agentExists = agents.some((a) => a.id === decision.nextAgentId);
    if (!agentExists) {
      log.warn(`[Director] Unknown agent "${decision.nextAgentId}", ending`);
      return { shouldEnd: true, graphIterations: nextGraphIterations };
    }

    write({
      type: 'thinking',
      data: { stage: 'agent_loading', agentId: decision.nextAgentId },
    });

    log.info(`[Director] Decision: dispatch agent "${decision.nextAgentId}"`);
    return {
      currentAgentId: decision.nextAgentId,
      shouldEnd: false,
      graphIterations: nextGraphIterations,
    };
  } catch (error) {
    log.error('[Director] Error:', error);
    return { shouldEnd: true, graphIterations: nextGraphIterations };
  }
}

function directorCondition(state: OrchestratorStateType): 'agent_generate' | typeof END {
  return state.shouldEnd ? END : 'agent_generate';
}

// ==================== Agent Generate Node ====================

/**
 * Run generation for one agent. Streams agent_start, text_delta,
 * action, and agent_end events via config.writer().
 */
async function runAgentGeneration(
  state: OrchestratorStateType,
  agentId: string,
  config: LangGraphRunnableConfig,
): Promise<{
  contentPreview: string;
  actionCount: number;
  whiteboardActions: WhiteboardActionRecord[];
}> {
  const agentConfig = resolveAgent(state, agentId);
  if (!agentConfig) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const rawWrite = config.writer as (chunk: StatelessEvent) => void;
  const write = (chunk: StatelessEvent) => {
    try {
      rawWrite(chunk);
    } catch (e) {
      log.warn(`[AgentGenerate] write failed for ${agentId}:`, e);
    }
  };
  const messageId = `assistant-${agentId}-${Date.now()}`;

  write({
    type: 'agent_start',
    data: {
      messageId,
      agentId,
      agentName: agentConfig.name,
      agentAvatar: agentConfig.avatar,
      agentColor: agentConfig.color,
    },
  });

  // Compute effective actions: filter by scene type for defense-in-depth
  // e.g. spotlight/laser stripped for non-slide scenes even if in static allowedActions
  const currentScene = state.storeState.currentSceneId
    ? state.storeState.scenes.find((s) => s.id === state.storeState.currentSceneId)
    : undefined;
  const sceneType = currentScene?.type;
  const effectiveActions = getEffectiveActions(agentConfig.allowedActions, sceneType);

  const discussionContext = state.discussionContext || undefined;
  const systemPrompt = buildStructuredPrompt(
    agentConfig,
    state.storeState,
    discussionContext,
    state.whiteboardLedger,
    state.userProfile || undefined,
    state.agentResponses,
  );
  const effectiveSystemPrompt = [
    systemPrompt,
    state.dictionaryContext ? `# Chinese Dictionary References\n${state.dictionaryContext}` : '',
    state.longTermMemoryContext
      ? `# Long-Term Student Learning Memory (RAG)\n${state.longTermMemoryContext}`
      : '',
    buildSocraticConstructivistPrompt(state.whiteboardLedger),
    buildDebateAgentPrompt(state, agentId),
  ]
    .filter(Boolean)
    .join('\n\n');
  const openaiMessages = convertMessagesToOpenAI(state.messages, agentId);
  const adapter = new AISdkLangGraphAdapter(state.languageModel, state.thinkingConfig ?? undefined);

  const lcMessages = [
    new SystemMessage(effectiveSystemPrompt),
    ...openaiMessages.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    ),
  ];

  // Ensure the message list ends with a HumanMessage.
  // After agent-aware role mapping, other agents' messages become user role,
  // so trailing AIMessage is less likely. But guard against edge cases
  // (e.g. agent's own previous response is last in history).
  const lastMsg = lcMessages[lcMessages.length - 1];
  if (!lcMessages.some((m) => m instanceof HumanMessage)) {
    lcMessages.push(new HumanMessage('Please begin.'));
  } else if (lastMsg instanceof AIMessage) {
    lcMessages.push(new HumanMessage("It's your turn to speak. Respond from your perspective."));
  }

  const parserState = createParserState();
  let fullText = '';
  let actionCount = 0;
  let clarificationRequested = false;
  const whiteboardActions: WhiteboardActionRecord[] = [];

  try {
    for await (const chunk of adapter.streamGenerate(lcMessages, {
      signal: config.signal,
    })) {
      if (clarificationRequested) break;

      if (chunk.type === 'delta') {
        const parseResult = parseStructuredChunk(chunk.content, parserState);

        // Emit events in original interleaved order via the `ordered` array.
        // The ordered array tracks complete items from Step 5 of the parser;
        // trailing partial text deltas (Step 6) are in textChunks but not in ordered.
        let emittedTextCount = 0;
        if (parseResult.ordered.length > 0 || parseResult.textChunks.length > 0) {
          log.debug(
            `[AgentGenerate] Parse: ordered=${parseResult.ordered.length} (${parseResult.ordered.map((e) => e.type).join(',')}), textChunks=${parseResult.textChunks.length}, actions=${parseResult.actions.length}, done=${parseResult.isDone}`,
          );
        }

        const clarificationEntry = parseResult.ordered.find((entry) => {
          if (entry.type !== 'action') return false;
          const action = parseResult.actions[entry.index];
          return action ? isRequestClarificationAction(action.actionName) : false;
        });

        if (clarificationEntry?.type === 'action') {
          const ac = parseResult.actions[clarificationEntry.index];
          if (ac && effectiveActions.includes(ac.actionName)) {
            const clarificationMessage = getClarificationMessage(ac.params);
            actionCount++;
            fullText += clarificationMessage;
            write({
              type: 'text_delta',
              data: { content: clarificationMessage, messageId },
            });
            write({
              type: 'action',
              data: {
                actionId: ac.actionId,
                actionName: ac.actionName,
                params: ac.params,
                agentId,
                messageId,
              },
            });
            clarificationRequested = true;
            log.warn(
              `[VisionFallback] Agent ${agentConfig.name} requested clarification instead of evaluating low-confidence whiteboard vision.`,
            );
            break;
          }
        }

        for (const entry of parseResult.ordered) {
          if (entry.type === 'text') {
            const rawText = parseResult.textChunks[entry.index];
            if (!rawText) {
              log.warn(
                `[AgentGenerate] Ordered text entry index=${entry.index} but textChunks[${entry.index}] is empty`,
              );
              continue;
            }
            const text = rawText.replace(/^>+\s?/gm, '');
            if (!text) continue;
            fullText += text;
            write({
              type: 'text_delta',
              data: { content: text, messageId },
            });
            emittedTextCount++;
          } else if (entry.type === 'action') {
            const ac = parseResult.actions[entry.index];
            if (!ac) continue;
            if (!effectiveActions.includes(ac.actionName)) {
              log.warn(
                `[AgentGenerate] Agent ${agentConfig.name} attempted disallowed action: ${ac.actionName}, skipping`,
              );
              continue;
            }
            actionCount++;

            // Record whiteboard actions to the ledger
            if (ac.actionName.startsWith('wb_')) {
              whiteboardActions.push({
                actionName: ac.actionName as WhiteboardActionRecord['actionName'],
                actorType: 'agent',
                agentId,
                agentName: agentConfig.name,
                params: ac.params,
              });
            }
            write({
              type: 'action',
              data: {
                actionId: ac.actionId,
                actionName: ac.actionName,
                params: ac.params,
                agentId,
                messageId,
              },
            });
          }
        }

        if (clarificationRequested) break;

        // Emit trailing partial text deltas not covered by ordered
        for (let i = emittedTextCount; i < parseResult.textChunks.length; i++) {
          const rawText = parseResult.textChunks[i];
          if (!rawText) continue;
          const text = rawText.replace(/^>+\s?/gm, '');
          if (!text) continue;
          fullText += text;
          write({
            type: 'text_delta',
            data: { content: text, messageId },
          });
        }
      }
    }

    // Finalize: emit any remaining content if the model didn't produce valid JSON
    if (!clarificationRequested) {
      const finalResult = finalizeParser(parserState);
      for (const entry of finalResult.ordered) {
        if (entry.type === 'text') {
          const rawText = finalResult.textChunks[entry.index];
          if (!rawText) continue;
          const text = rawText.replace(/^>+\s?/gm, '');
          if (!text) continue;
          fullText += text;
          write({
            type: 'text_delta',
            data: { content: text, messageId },
          });
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    log.error(`[AgentGenerate] Error for ${agentConfig.name}:`, error);
    write({
      type: 'error',
      data: { message: error instanceof Error ? error.message : String(error) },
    });
  }

  write({
    type: 'agent_end',
    data: { messageId, agentId },
  });

  return {
    contentPreview: fullText.slice(0, 300),
    actionCount,
    whiteboardActions,
  };
}

/**
 * Agent generate node — runs one agent, then loops back to director.
 */
async function agentGenerateNode(
  state: OrchestratorStateType,
  config: LangGraphRunnableConfig,
): Promise<Partial<OrchestratorStateType>> {
  if (shouldStopForGraphIterationLimit(state, config, 'agent_generate')) {
    return {
      shouldEnd: true,
      currentAgentId: null,
      graphIterations: state.graphIterations,
    };
  }

  const nextGraphIterations = state.graphIterations + 1;
  const agentId = state.currentAgentId;
  if (!agentId) {
    return { shouldEnd: true, graphIterations: nextGraphIterations };
  }

  const agentConfig = resolveAgent(state, agentId);
  const result = await runAgentGeneration(state, agentId, config);

  if (!result.contentPreview && result.actionCount === 0) {
    log.warn(
      `[AgentGenerate] Agent "${agentConfig?.name || agentId}" produced empty response (no text, no actions)`,
    );
  }

  return {
    turnCount: state.turnCount + 1,
    totalActions: state.totalActions + result.actionCount,
    agentResponses: [
      {
        agentId,
        agentName: agentConfig?.name || agentId,
        contentPreview: result.contentPreview,
        actionCount: result.actionCount,
        whiteboardActions: result.whiteboardActions,
      },
    ],
    whiteboardLedger: result.whiteboardActions,
    currentAgentId: null,
    graphIterations: nextGraphIterations,
  };
}

// ==================== Graph Construction ====================

/**
 * Create the orchestration LangGraph StateGraph.
 *
 * Topology:
 *   START → director ──(end)──→ END
 *              │
 *              └─(next)→ agent_generate ──→ director (loop)
 */
export function createOrchestrationGraph() {
  const graph = new StateGraph(OrchestratorState)
    .addNode('director', directorNode)
    .addNode('agent_generate', agentGenerateNode)
    .addEdge(START, 'director')
    .addConditionalEdges('director', directorCondition, {
      agent_generate: 'agent_generate',
      [END]: END,
    })
    .addEdge('agent_generate', 'director');

  return graph.compile();
}

/**
 * Build initial state for the orchestration graph from a StatelessChatRequest
 * and a pre-created LanguageModel instance.
 */
export function buildInitialState(
  request: StatelessChatRequest,
  languageModel: LanguageModel,
  thinkingConfig?: ThinkingConfig,
): typeof OrchestratorState.State {
  // Build request-scoped agent config overrides for generated agents.
  // These travel with each request — no server-side persistence needed.
  const agentConfigOverrides: Record<string, AgentConfig> = {};
  if (request.config.agentConfigs?.length) {
    for (const cfg of request.config.agentConfigs) {
      agentConfigOverrides[cfg.id] = {
        ...cfg,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  const discussionContext = request.config.discussionTopic
    ? {
        topic: request.config.discussionTopic,
        prompt: request.config.discussionPrompt,
        autoEndPolicy: request.config.autoEndPolicy,
        studentQuestion: request.config.studentQuestion,
      }
    : null;

  const incoming = request.directorState;
  const turnCount = incoming?.turnCount ?? 0;
  const debateConfig = request.config.debateConfig ?? null;
  const discussionMode = request.config.discussionMode ?? 'standard';
  const debateState =
    incoming?.debateState ??
    (discussionMode === 'debate' && debateConfig
      ? getInitialDebateState(debateConfig, discussionContext?.topic)
      : null);

  return {
    messages: request.messages,
    storeState: request.storeState,
    availableAgentIds: request.config.agentIds,
    maxTurns: turnCount + 1, // Allow exactly one more director→agent cycle
    languageModel,
    thinkingConfig: thinkingConfig ?? null,
    discussionContext,
    discussionMode,
    debateConfig,
    debateState,
    triggerAgentId: request.config.triggerAgentId || null,
    userProfile: request.userProfile || null,
    dictionaryContext: request.dictionaryContext || null,
    longTermMemoryContext: request.longTermMemoryContext || null,
    agentConfigOverrides,
    graphIterations: 0,
    maxGraphIterations: DEFAULT_MAX_GRAPH_ITERATIONS,
    currentAgentId: null,
    turnCount,
    agentResponses: incoming?.agentResponses ?? [],
    whiteboardLedger: incoming?.whiteboardLedger ?? [],
    shouldEnd: false,
    totalActions: 0,
  };
}

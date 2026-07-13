import { nanoid } from 'nanoid';
import { normalizeSpotlightDimness } from '@/lib/playback/spotlight-utils';
import type { Action } from '@/lib/types/action';
import type { PPTElement } from '@/lib/types/slides';
import type { AgentInfo } from './pipeline-types';
import { createLogger } from '@/lib/logger';

const log = createLogger('ActionSanitizer');

function sanitizeTeacherSelfReference(text: string): string {
  const cleaned = text
    .replace(/我是\s*(?:Bingo\s*的\s*)?(?:一名|一个|你的|大家的)?\s*(?:AI|人工智能)\s*老师[，,。！!；;:\s]*/gi, '')
    .replace(/作为\s*(?:AI|人工智能)\s*老师/gi, '作为老师')
    .replace(/\bI\s*(?:am|'m)\s*(?:Bingo['’]s\s*)?(?:an?\s+|your\s+|everyone['’]s\s+)?(?:AI|artificial intelligence)\s+teacher[,.!;:\s]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[，,。！!；;:\s]+/, '')
    .trim();

  return cleaned || '今天我们一起开始学习。';
}

export function sanitizeGeneratedActions(
  actions: Action[],
  elements: PPTElement[],
  agents?: AgentInfo[],
): Action[] {
  const elementIds = new Set(elements.map((el) => el.id));
  const agentIds = new Set(agents?.map((a) => a.id) || []);
  const studentAgents = agents?.filter((a) => a.role === 'student') || [];
  const nonTeacherAgents = agents?.filter((a) => a.role !== 'teacher') || [];
  const processedActions: Action[] = [];

  for (const action of actions) {
    const processedAction: Action = {
      ...action,
      id: action.id || `action_${nanoid(8)}`,
    };

    if (processedAction.type === 'laser') {
      log.info(`Dropping disabled laser action: ${processedAction.id}`);
      continue;
    }

    if (processedAction.type === 'spotlight') {
      if (!processedAction.elementId || !elementIds.has(processedAction.elementId)) {
        log.warn(
          `Dropping spotlight with invalid elementId: ${processedAction.elementId || '(none)'}`,
        );
        continue;
      }

      processedAction.dimOpacity = normalizeSpotlightDimness(processedAction.dimOpacity);
    }

    if (processedAction.type === 'speech') {
      processedAction.text = sanitizeTeacherSelfReference(processedAction.text);
    }

    if (processedAction.type === 'discussion') {
      processedAction.topic = sanitizeTeacherSelfReference(processedAction.topic);
      if (processedAction.prompt) {
        processedAction.prompt = sanitizeTeacherSelfReference(processedAction.prompt);
      }

      if (!agents || agents.length === 0) {
        processedActions.push(processedAction);
        continue;
      }

      if (processedAction.agentId && agentIds.has(processedAction.agentId)) {
        // Valid agentId; keep it.
      } else {
        const pool = studentAgents.length > 0 ? studentAgents : nonTeacherAgents;
        if (pool.length > 0) {
          const picked = pool[Math.floor(Math.random() * pool.length)];
          log.warn(
            `Discussion agentId "${processedAction.agentId || '(none)'}" invalid, assigned: ${picked.id} (${picked.name})`,
          );
          processedAction.agentId = picked.id;
        }
      }
    }

    processedActions.push(processedAction);
  }

  return processedActions;
}

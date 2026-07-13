export type InteractiveTemplateKind =
  | 'angle-relations'
  | 'function-graph'
  | 'probability'
  | 'vector'
  | 'circuit';

export interface InteractiveTemplateGuidanceInput {
  readonly subject?: string;
  readonly conceptName: string;
  readonly conceptOverview?: string;
  readonly designIdea?: string;
  readonly keyPoints?: readonly string[];
}

function buildHaystack(input: InteractiveTemplateGuidanceInput): string {
  return [
    input.subject || '',
    input.conceptName,
    input.conceptOverview || '',
    input.designIdea || '',
    ...(input.keyPoints || []),
  ]
    .join('\n')
    .toLowerCase();
}

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function getInteractiveTemplateKind(
  input: InteractiveTemplateGuidanceInput,
): InteractiveTemplateKind | null {
  const haystack = buildHaystack(input);

  if (
    includesAny(haystack, [
      '\u5bf9\u9876\u89d2',
      '\u90bb\u8865\u89d2',
      '\u8865\u89d2',
      '\u76f8\u4ea4\u7ebf',
      '\u5782\u76f4\u89d2',
      'vertical angle',
      'vertical angles',
      'supplementary angle',
      'supplementary angles',
      'intersecting lines',
      'linear pair',
    ])
  ) {
    return 'angle-relations';
  }

  if (
    includesAny(haystack, [
      '\u51fd\u6570',
      '\u629b\u7269\u7ebf',
      '\u4e00\u6b21\u51fd\u6570',
      '\u4e8c\u6b21\u51fd\u6570',
      'graph',
      'function',
      'parabola',
      'sine',
      'cosine',
      'transformation',
    ])
  ) {
    return 'function-graph';
  }

  if (
    includesAny(haystack, [
      '\u6982\u7387',
      '\u7edf\u8ba1',
      '\u62bd\u6837',
      '\u968f\u673a',
      'probability',
      'statistics',
      'sampling',
      'distribution',
    ])
  ) {
    return 'probability';
  }

  if (
    includesAny(haystack, [
      '\u529b\u7684',
      '\u53d7\u529b',
      '\u5408\u529b',
      '\u5206\u529b',
      '\u529b\u5b66',
      '\u5411\u91cf',
      'vector',
      'force',
      'component',
      'decomposition',
    ])
  ) {
    return 'vector';
  }

  if (
    includesAny(haystack, [
      '\u7535\u8def',
      '\u6b27\u59c6\u5b9a\u5f8b',
      '\u4e32\u8054',
      '\u5e76\u8054',
      'circuit',
      'ohm',
      'resistance',
      'voltage',
      'current',
    ])
  ) {
    return 'circuit';
  }

  return null;
}

const DEFAULT_SIMPLICITY_GUIDANCE = [
  'Default template policy: keep the page simple and highly reliable.',
  '- Use one large central visualization as the main experience.',
  '- Allow at most 1 primary interaction and at most 2 supporting controls.',
  '- Prefer direct manipulation such as drag, a single slider, or one toggle.',
  '- Keep explanation text to one short instruction line and one short conclusion line.',
  '- Do not build a right sidebar, dashboard, calculator area, multi-step form, or repeated summary cards unless the concept absolutely requires them.',
  '- Do not duplicate the same information in both the diagram and separate panels.',
  '- Prefer a proven classroom template over inventing a new feature-rich interface.',
].join('\n');

const TEMPLATE_GUIDANCE: Record<InteractiveTemplateKind, string> = {
  'angle-relations': [
    'Template: intersecting lines / angle relationships.',
    '- Layout: one large centered diagram only. No side panel.',
    '- Main interaction: drag one line or one handle to rotate the line continuously around the intersection.',
    '- Controls: at most 3 compact controls total: highlight mode, show/hide labels, reset.',
    '- Show all four angle values directly on the diagram.',
    '- Keep one short relation sentence near the top or bottom.',
    '- Do not add a known-angle calculator, manual numeric form, extra status cards, or separate angle tables.',
    '- The student should understand the rule by watching the diagram change, not by filling forms.',
  ].join('\n'),
  'function-graph': [
    'Template: function graph exploration.',
    '- Layout: one large graph area with a small control strip.',
    '- Controls: use 1-3 sliders for the truly essential parameters, plus reset if needed.',
    '- Show the equation and key changes near the graph itself.',
    '- Do not add side explanations, extra cards, or secondary tools unless explicitly required.',
  ].join('\n'),
  probability: [
    'Template: probability / statistics experiment.',
    '- Layout: one simulation area with one result area directly beside or below it.',
    '- Controls: sample size and run/reset are usually enough.',
    '- Prefer one comparison between experimental result and theoretical result.',
    '- Do not add multiple charts, settings panels, or advanced filters by default.',
  ].join('\n'),
  vector: [
    'Template: vector / force decomposition.',
    '- Layout: one vector diagram with the decomposition drawn in place.',
    '- Controls: angle slider, magnitude slider, optional component toggle, reset.',
    '- Display values close to the vectors instead of using separate summary panels.',
    '- Do not add calculator blocks or duplicated numeric cards.',
  ].join('\n'),
  circuit: [
    'Template: simple circuit law exploration.',
    '- Layout: one circuit diagram plus one compact readout row.',
    '- Controls: one or two essential controls only, such as resistance slider or switch state.',
    '- Keep measured values next to the circuit, not in a large dashboard.',
    '- Avoid complex virtual lab controls unless the lesson explicitly demands them.',
  ].join('\n'),
};

export function getInteractiveTemplateGuidance(
  input: InteractiveTemplateGuidanceInput,
): string {
  const kind = getInteractiveTemplateKind(input);
  if (!kind) return DEFAULT_SIMPLICITY_GUIDANCE;

  return `${DEFAULT_SIMPLICITY_GUIDANCE}\n\n${TEMPLATE_GUIDANCE[kind]}`;
}

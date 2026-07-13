export type HomeworkTextSegment =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'math';
      value: string;
    };

const MATH_CHAR_CLASS =
  "A-Za-z0-9()（）\\[\\]【】［］{}｛｝|,:.;；.%％°+＋\\-−－×÷=＝<>≤≥≠'/／^*＊∠⊥∥√△";
const MATH_CANDIDATE_REGEX = new RegExp(
  `[${MATH_CHAR_CLASS}]+(?:\\s*[${MATH_CHAR_CLASS}]+)*`,
  'g',
);
const EDGE_PUNCTUATION = new Set([',', '，', ';', '；', ':', '：', '。', '、', '!', '！', '?', '？']);

const SIMPLE_FRACTION_TOKEN = String.raw`-?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9']*|\([^()]+\)|\|[^|]+\|)`;
const SIMPLE_FRACTION_REGEX = new RegExp(
  `(${SIMPLE_FRACTION_TOKEN})\\s*/\\s*(${SIMPLE_FRACTION_TOKEN})`,
  'g',
);

function normalizeMathCandidate(value: string): string {
  return value
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[【［]/g, '[')
    .replace(/[】］]/g, ']')
    .replace(/｛/g, '{')
    .replace(/｝/g, '}')
    .replace(/＋/g, '+')
    .replace(/－/g, '-')
    .replace(/＝/g, '=')
    .replace(/／/g, '/')
    .replace(/＊/g, '*')
    .replace(/％/g, '%')
    .replace(/．/g, '.')
    .replace(/＜/g, '<')
    .replace(/＞/g, '>')
    .replace(/，/g, ', ')
    .replace(/；/g, '; ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasCoordinateShape(value: string): boolean {
  return /[A-Za-z]?'?\(\s*-?[A-Za-z0-9.']+\s*,\s*-?[A-Za-z0-9.']+\s*\)/.test(value);
}

function isLikelyMathCandidate(value: string): boolean {
  const normalized = normalizeMathCandidate(value);
  if (normalized.length < 2) return false;
  if (!/[0-9A-Za-z]/.test(normalized)) return false;

  if (/[=<>≤≥≠+\-−×÷/%^;∠⊥∥√△]/.test(normalized)) return true;
  if (normalized.includes('/')) return true;
  if (/\|[^|]+\|/.test(normalized)) return true;
  if (hasCoordinateShape(normalized)) return true;

  return false;
}

function trimMathCandidate(value: string): {
  leading: string;
  core: string;
  trailing: string;
} {
  let start = 0;
  let end = value.length;

  while (start < end && EDGE_PUNCTUATION.has(value[start])) {
    start += 1;
  }

  while (end > start && EDGE_PUNCTUATION.has(value[end - 1])) {
    end -= 1;
  }

  return {
    leading: value.slice(0, start),
    core: value.slice(start, end),
    trailing: value.slice(end),
  };
}

function convertSimpleFractions(value: string): string {
  let current = value;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = current.replace(SIMPLE_FRACTION_REGEX, String.raw`\frac{$1}{$2}`);
    if (next === current) break;
    current = next;
  }

  return current;
}

function convertSquareRoots(value: string): string {
  return value
    .replace(/√\s*\(([^()]+)\)/g, String.raw`\sqrt{$1}`)
    .replace(/√\s*([A-Za-z0-9.]+)/g, String.raw`\sqrt{$1}`);
}

export function convertHomeworkMathToLatex(value: string): string {
  let latex = normalizeMathCandidate(value);
  latex = convertSimpleFractions(latex);
  latex = convertSquareRoots(latex);

  return latex
    .replace(/≤/g, String.raw`\le `)
    .replace(/≥/g, String.raw`\ge `)
    .replace(/≠/g, String.raw`\ne `)
    .replace(/×/g, String.raw`\times `)
    .replace(/÷/g, String.raw`\div `)
    .replace(/∠/g, String.raw`\angle `)
    .replace(/⊥/g, String.raw`\perp `)
    .replace(/∥/g, String.raw`\parallel `)
    .replace(/△/g, String.raw`\triangle `)
    .replace(/°/g, String.raw`^{\circ}`)
    .replace(/%/g, String.raw`\%`);
}

export function segmentHomeworkText(text: string): HomeworkTextSegment[] {
  const segments: HomeworkTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MATH_CANDIDATE_REGEX)) {
    const { leading, core, trailing } = trimMathCandidate(match[0]);
    const matchStart = match.index ?? 0;
    const start = matchStart + leading.length;
    const end = matchStart + match[0].length - trailing.length;

    if (!core || !isLikelyMathCandidate(core)) {
      continue;
    }

    if (start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, start) });
    }

    segments.push({ type: 'math', value: core });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

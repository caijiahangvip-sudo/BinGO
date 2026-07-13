const WINDOWS_RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const DEFAULT_EXPORT_FILE_NAME = 'slides';
const DEFAULT_CLASSROOM_TITLE = 'Bingo课堂';

function truncateVisibleChars(value: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  return Array.from(value).slice(0, maxLength).join('');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\s\u00a0]+/g, ' ').trim();
}

function stripEdgePunctuation(value: string): string {
  return value.replace(/^[\s._\-"'“”‘’]+|[\s._\-"'“”‘’]+$/g, '');
}

function trimToLength(value: string, maxLength: number): string {
  return stripEdgePunctuation(truncateVisibleChars(value, maxLength));
}

function cleanClassroomTitleCandidate(value: string): string {
  let title = normalizeWhitespace(value)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:关于|主题|课题|课程)\s*[：:]\s*/i, '')
    .replace(/^(?:关于|主题|课题|课程)\s+/i, '')
    .replace(/^(?:请)?(?:根据|基于)(?:这本|这个|我上传的|上传的)?\s*PDF\s*/i, '')
    .replace(/^(?:给我)?(?:上|生成|制作)(?:一节|1节|一堂|一个)?(?:关于)?\s*/i, '')
    .replace(/(?:的)?(?:课|课堂|课程|课件)$/i, '');

  title = title
    .replace(/\s*(?:本节目标|当前只生成|这必须是|不生成\s*TTS|走\s*Bingo).*$/i, '')
    .replace(/[，,。；;].*$/, '');

  return stripEdgePunctuation(title);
}

function isUsefulClassroomTitle(value: string): boolean {
  const title = cleanClassroomTitleCandidate(value);
  if (!title) return false;
  if (/互动课堂|完整的互动课堂|普通课堂生成流程/i.test(title) && Array.from(title).length > 12) {
    return false;
  }
  return true;
}

function firstUsefulCandidate(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (isUsefulClassroomTitle(candidate)) {
      return cleanClassroomTitleCandidate(candidate);
    }
  }
  return undefined;
}

export function sanitizeExportFileName(
  value: string | null | undefined,
  options: { fallback?: string; maxLength?: number } = {},
): string {
  const fallback = options.fallback || DEFAULT_EXPORT_FILE_NAME;
  const maxLength = options.maxLength ?? 60;
  const raw = String(value ?? '').normalize('NFKC');
  let cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]+/g, '_')
    .replace(/[\s\u00a0]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._\- ]+|[._\- ]+$/g, '');

  cleaned = trimToLength(cleaned, maxLength);

  if (!cleaned) {
    cleaned =
      fallback === value
        ? DEFAULT_EXPORT_FILE_NAME
        : sanitizeExportFileName(fallback, {
            fallback: DEFAULT_EXPORT_FILE_NAME,
            maxLength,
          });
  }

  if (WINDOWS_RESERVED_FILE_NAMES.test(cleaned)) {
    cleaned =
      truncateVisibleChars(`_${cleaned}`, maxLength).replace(/[\s.\-]+$/g, '') ||
      DEFAULT_EXPORT_FILE_NAME;
  }

  return cleaned || DEFAULT_EXPORT_FILE_NAME;
}

export function extractClassroomTitleFromRequirement(
  requirement: string | null | undefined,
  options: { fallback?: string; maxLength?: number } = {},
): string {
  const fallback = options.fallback || DEFAULT_CLASSROOM_TITLE;
  const maxLength = options.maxLength ?? 40;
  const normalized = normalizeWhitespace(String(requirement ?? ''));
  if (!normalized) return fallback;

  const bracketCandidates = Array.from(
    normalized.matchAll(/[【\[]\s*([^【】\[\]\n]{2,80}?)\s*[】\]]/g),
    (match) => match[1],
  );
  const lessonBracketCandidate = firstUsefulCandidate(
    bracketCandidates.filter((candidate) =>
      /第\s*[0-9一二三四五六七八九十百千万]+\s*(?:课|节|单元)/.test(candidate),
    ),
  );
  const bracketCandidate = lessonBracketCandidate || firstUsefulCandidate(bracketCandidates);
  if (bracketCandidate) return trimToLength(bracketCandidate, maxLength) || fallback;

  const lessonMatch = normalized.match(
    /(第\s*[0-9一二三四五六七八九十百千万]+\s*(?:课|节|单元)\s*[^】\]\n，,。；;：:“”"']{0,28})/,
  );
  if (lessonMatch?.[1]) {
    const title = cleanClassroomTitleCandidate(lessonMatch[1]);
    if (title) return trimToLength(title, maxLength) || fallback;
  }

  const quotedCandidates = Array.from(
    normalized.matchAll(/[“"]([^“”"\n]{2,80})[”"]/g),
    (match) => match[1],
  );
  const quotedCandidate = firstUsefulCandidate(quotedCandidates);
  if (quotedCandidate) return trimToLength(quotedCandidate, maxLength) || fallback;

  const title = cleanClassroomTitleCandidate(normalized);
  return trimToLength(title, maxLength) || fallback;
}

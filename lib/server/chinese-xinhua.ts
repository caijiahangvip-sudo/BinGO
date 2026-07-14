import fs from 'fs';
import { gunzipSync } from 'node:zlib';
import { semanticSearchChineseXinhua } from '@/lib/server/chinese-xinhua-embedding';
import {
  ensureOptionalChineseXinhuaData,
  getChineseXinhuaDataRoots,
  resolveChineseXinhuaDataFile,
} from '@/lib/server/chinese-xinhua-data';

export type ChineseXinhuaEntryType = 'character' | 'word' | 'idiom' | 'xiehouyu';

export interface ChineseXinhuaEntry {
  type: ChineseXinhuaEntryType;
  key: string;
  source: string;
  pinyin?: string;
  explanation?: string;
  more?: string;
  derivation?: string;
  example?: string;
  answer?: string;
  strokes?: number;
  radicals?: string;
}

export interface ChineseXinhuaSearchOptions {
  limit?: number;
  includeSemantic?: boolean;
}

export interface ChineseXinhuaSearchResult {
  query: string;
  entries: ChineseXinhuaEntry[];
  semanticAvailable: boolean;
  semanticError?: string;
}

interface RawCharacterEntry {
  word?: string;
  oldword?: string;
  strokes?: number;
  pinyin?: string;
  radicals?: string;
  explanation?: string;
  more?: string;
}

interface RawCiEntry {
  ci?: string;
  explanation?: string;
}

interface RawIdiomEntry {
  word?: string;
  pinyin?: string;
  explanation?: string;
  derivation?: string;
  example?: string;
  abbreviation?: string;
}

interface RawXiehouyuEntry {
  riddle?: string;
  answer?: string;
}

interface ChineseXinhuaIndex {
  character: Map<string, ChineseXinhuaEntry[]>;
  word: Map<string, ChineseXinhuaEntry[]>;
  idiom: Map<string, ChineseXinhuaEntry[]>;
  xiehouyu: Map<string, ChineseXinhuaEntry[]>;
}

const MAX_QUERY_CHARS = 160;
const DEFAULT_LIMIT = 12;
const LEXICON_TRIGGER_PATTERN =
  /语文|汉语|汉字|字词|词语|成语|歇后语|拼音|读音|注音|释义|字义|词义|意思|解释|出处|造句|近义|反义|多音字|文言|古诗|课文|阅读/;

let cachedIndex: ChineseXinhuaIndex | null = null;

function readJsonArray<T>(fileName: string): T[] {
  const filePath = resolveChineseXinhuaDataFile(fileName);
  if (!filePath) return [];
  const raw = filePath.endsWith('.gz')
    ? gunzipSync(fs.readFileSync(filePath)).toString('utf8')
    : fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function pushEntry(map: Map<string, ChineseXinhuaEntry[]>, key: string, entry: ChineseXinhuaEntry) {
  const normalized = normalizeLookupKey(key);
  if (!normalized) return;
  const existing = map.get(normalized);
  if (existing) existing.push(entry);
  else map.set(normalized, [entry]);
}

function loadIndex(): ChineseXinhuaIndex {
  if (cachedIndex) return cachedIndex;

  const index: ChineseXinhuaIndex = {
    character: new Map(),
    word: new Map(),
    idiom: new Map(),
    xiehouyu: new Map(),
  };

  for (const item of readJsonArray<RawCharacterEntry>('word.json')) {
    const key = item.word?.trim();
    if (!key) continue;
    pushEntry(index.character, key, {
      type: 'character',
      key,
      source: 'chinese-xinhua/data/word.json',
      pinyin: item.pinyin,
      explanation: item.explanation,
      more: item.more,
      strokes: item.strokes,
      radicals: item.radicals,
    });
  }

  for (const item of readJsonArray<RawCiEntry>('ci.json')) {
    const key = item.ci?.trim();
    if (!key) continue;
    pushEntry(index.word, key, {
      type: 'word',
      key,
      source: 'chinese-xinhua/data/ci.json',
      explanation: item.explanation,
    });
  }

  for (const item of readJsonArray<RawIdiomEntry>('idiom.json')) {
    const key = item.word?.trim();
    if (!key) continue;
    pushEntry(index.idiom, key, {
      type: 'idiom',
      key,
      source: 'chinese-xinhua/data/idiom.json',
      pinyin: item.pinyin,
      explanation: item.explanation,
      derivation: item.derivation,
      example: item.example,
    });
  }

  for (const item of readJsonArray<RawXiehouyuEntry>('xiehouyu.json')) {
    const key = item.riddle?.trim();
    if (!key) continue;
    pushEntry(index.xiehouyu, key, {
      type: 'xiehouyu',
      key,
      source: 'chinese-xinhua/data/xiehouyu.json',
      answer: item.answer,
    });
  }

  cachedIndex = index;
  return index;
}

function getTypeMap(index: ChineseXinhuaIndex, type: ChineseXinhuaEntryType) {
  switch (type) {
    case 'character':
      return index.character;
    case 'word':
      return index.word;
    case 'idiom':
      return index.idiom;
    case 'xiehouyu':
      return index.xiehouyu;
  }
}

function normalizeLookupKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '')
    .trim();
}

function getChineseText(value: string): string {
  return value.slice(0, MAX_QUERY_CHARS).replace(/[^\u3400-\u9fff]/g, ' ');
}

function collectCandidates(query: string): string[] {
  const normalized = normalizeLookupKey(getChineseText(query));
  const candidates = new Set<string>();
  if (!normalized) return [];

  candidates.add(normalized);

  const runs = getChineseText(query).match(/[\u3400-\u9fff]{1,12}/g) || [];
  for (const run of runs) {
    const normalizedRun = normalizeLookupKey(run);
    if (!normalizedRun) continue;
    candidates.add(normalizedRun);

    const maxLen = Math.min(8, normalizedRun.length);
    for (let len = maxLen; len >= 1; len--) {
      for (let start = 0; start + len <= normalizedRun.length; start++) {
        candidates.add(normalizedRun.slice(start, start + len));
      }
    }
  }

  return Array.from(candidates).sort((a, b) => b.length - a.length);
}

function addMatches(
  output: ChineseXinhuaEntry[],
  seen: Set<string>,
  entries: ChineseXinhuaEntry[] | undefined,
  limit: number,
) {
  if (!entries) return;
  for (const entry of entries) {
    const id = `${entry.type}:${entry.key}:${entry.explanation || entry.answer || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(entry);
    if (output.length >= limit) return;
  }
}

function searchStructured(query: string, limit: number): ChineseXinhuaEntry[] {
  const index = loadIndex();
  const candidates = collectCandidates(query);
  const output: ChineseXinhuaEntry[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    addMatches(output, seen, index.idiom.get(candidate), limit);
    if (output.length >= limit) break;
    addMatches(output, seen, index.word.get(candidate), limit);
    if (output.length >= limit) break;
    addMatches(output, seen, index.character.get(candidate), limit);
    if (output.length >= limit) break;
    addMatches(output, seen, index.xiehouyu.get(candidate), limit);
    if (output.length >= limit) break;
  }

  return output;
}

function findExactEntry(type: ChineseXinhuaEntryType, key: string): ChineseXinhuaEntry | null {
  const index = loadIndex();
  const map = getTypeMap(index, type);
  return map.get(normalizeLookupKey(key))?.[0] || null;
}

export function isChineseLanguageOrText(languageOrText?: string): boolean {
  if (!languageOrText) return false;
  return languageOrText === 'zh-CN' || /[\u3400-\u9fff]/.test(languageOrText);
}

export function shouldUseChineseXinhuaContext(text: string, language?: string): boolean {
  if (!isChineseLanguageOrText(language || text)) return false;
  if (LEXICON_TRIGGER_PATTERN.test(text)) return true;
  const compact = normalizeLookupKey(text);
  return compact.length > 0 && compact.length <= 4;
}

export function getChineseXinhuaStatus() {
  const files = ['word.json', 'ci.json', 'idiom.json', 'xiehouyu.json'].map((file) => {
    const resolvedPath = resolveChineseXinhuaDataFile(file);
    return {
      file,
      exists: !!resolvedPath,
      bytes: resolvedPath ? fs.statSync(resolvedPath).size : 0,
    };
  });

  return {
    dataRoot: getChineseXinhuaDataRoots(),
    ready: files.every((file) => file.exists),
    files,
  };
}

export async function searchChineseXinhua(
  query: string,
  options: ChineseXinhuaSearchOptions = {},
): Promise<ChineseXinhuaSearchResult> {
  await ensureOptionalChineseXinhuaData();
  const cleanQuery = query.trim();
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 30));
  const entries = searchStructured(cleanQuery, limit);
  let semanticError: string | undefined;

  if (options.includeSemantic && entries.length < limit) {
    const semantic = await semanticSearchChineseXinhua(cleanQuery, limit - entries.length);
    semanticError = semantic.error;
    const seen = new Set(entries.map((entry) => `${entry.type}:${entry.key}`));
    for (const match of semantic.matches) {
      const type = match.type as ChineseXinhuaEntryType;
      if (!['character', 'word', 'idiom', 'xiehouyu'].includes(type)) continue;
      const id = `${type}:${match.key}`;
      if (seen.has(id)) continue;
      const full = findExactEntry(type, match.key);
      if (!full) continue;
      seen.add(id);
      entries.push(full);
      if (entries.length >= limit) break;
    }
  }

  return {
    query: cleanQuery,
    entries,
    semanticAvailable: options.includeSemantic ? !semanticError : false,
    ...(semanticError ? { semanticError } : {}),
  };
}

export function formatChineseXinhuaReferences(entries: ChineseXinhuaEntry[]): string {
  if (entries.length === 0) return '';

  const lines = entries.slice(0, DEFAULT_LIMIT).map((entry, index) => {
    const parts = [`${index + 1}. [${entry.type}] ${entry.key}`];
    if (entry.pinyin) parts.push(`pinyin: ${entry.pinyin}`);
    if (entry.radicals) parts.push(`radical: ${entry.radicals}`);
    if (entry.strokes) parts.push(`strokes: ${entry.strokes}`);
    if (entry.explanation) parts.push(`explanation: ${entry.explanation}`);
    if (entry.more) parts.push(`more: ${entry.more}`);
    if (entry.derivation) parts.push(`derivation: ${entry.derivation}`);
    if (entry.example) parts.push(`example: ${entry.example}`);
    if (entry.answer) parts.push(`answer: ${entry.answer}`);
    parts.push(`source: ${entry.source}`);
    return parts.join('\n   ');
  });

  return `Chinese Xinhua local dictionary references. Use these as the source of truth for Chinese characters, words, idioms, xiehouyu meanings, pinyin, readings, and examples. If a reference is relevant, do not contradict it. If nothing here answers the question, explain normally without claiming the dictionary says it.\n${lines.join('\n')}`;
}

export async function buildChineseXinhuaPromptContext(params: {
  text: string;
  language?: string;
  limit?: number;
}): Promise<string> {
  if (!shouldUseChineseXinhuaContext(params.text, params.language)) return '';
  const result = await searchChineseXinhua(params.text, { limit: params.limit });
  return formatChineseXinhuaReferences(result.entries);
}

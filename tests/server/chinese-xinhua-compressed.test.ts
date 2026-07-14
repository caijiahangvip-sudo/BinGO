import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
let temporaryRoot = '';

afterEach(async () => {
  process.chdir(originalCwd);
  vi.resetModules();
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = '';
});

describe('compressed Chinese Xinhua data', () => {
  it('loads packaged gzip dictionaries transparently', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'bingo-xinhua-'));
    const dataRoot = join(temporaryRoot, 'data', 'chinese-xinhua', 'data');
    await mkdir(dataRoot, { recursive: true });
    const files = {
      'word.json': [{ word: '学', pinyin: 'xué', explanation: '学习。' }],
      'ci.json': [],
      'idiom.json': [],
      'xiehouyu.json': [],
    };
    await Promise.all(
      Object.entries(files).map(([fileName, value]) =>
        writeFile(join(dataRoot, `${fileName}.gz`), gzipSync(JSON.stringify(value))),
      ),
    );

    process.chdir(temporaryRoot);
    const { getChineseXinhuaStatus, searchChineseXinhua } = await import(
      '@/lib/server/chinese-xinhua'
    );
    const result = await searchChineseXinhua('学');

    expect(getChineseXinhuaStatus().ready).toBe(true);
    expect(result.entries[0]).toMatchObject({ key: '学', pinyin: 'xué' });
  });
});

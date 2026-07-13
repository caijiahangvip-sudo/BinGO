import { describe, expect, it } from 'vitest';
import {
  buildChineseXinhuaPromptContext,
  getChineseXinhuaStatus,
  searchChineseXinhua,
} from '@/lib/server/chinese-xinhua';

describe('chinese-xinhua local dictionary', () => {
  it('reports bundled dictionary data files', () => {
    const status = getChineseXinhuaStatus();
    expect(status.ready).toBe(true);
    expect(status.files.map((file) => file.file).sort()).toEqual([
      'ci.json',
      'idiom.json',
      'word.json',
      'xiehouyu.json',
    ]);
  });

  it('finds the complete character entry for 尽', async () => {
    const result = await searchChineseXinhua('尽', { limit: 5 });
    const entry = result.entries.find((item) => item.type === 'character' && item.key === '尽');
    expect(entry).toBeTruthy();
    expect(entry?.pinyin).toContain('jìn');
    expect(entry?.explanation?.length).toBeGreaterThan(100);
    expect(entry?.more?.length).toBeGreaterThan(100);
  });

  it('finds idiom entries from natural Chinese questions', async () => {
    const result = await searchChineseXinhua('请解释一下精卫填海这个成语的意思', { limit: 8 });
    expect(result.entries.some((entry) => entry.type === 'idiom' && entry.key === '精卫填海')).toBe(
      true,
    );
  });

  it('builds prompt context only for Chinese lexicon-looking text', async () => {
    await expect(buildChineseXinhuaPromptContext({ text: '尽的意思是什么？' })).resolves.toContain(
      'Chinese Xinhua local dictionary references',
    );
    await expect(buildChineseXinhuaPromptContext({ text: '请讲解勾股定理' })).resolves.toBe('');
    await expect(
      buildChineseXinhuaPromptContext({ text: 'What is the meaning?', language: 'en-US' }),
    ).resolves.toBe('');
  });
});

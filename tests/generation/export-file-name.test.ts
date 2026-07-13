import { describe, expect, it } from 'vitest';

import {
  extractClassroomTitleFromRequirement,
  sanitizeExportFileName,
} from '@/lib/utils/export-file-name';

function visibleLength(value: string) {
  return Array.from(value).length;
}

describe('export file name utilities', () => {
  it('keeps exported file names short and Windows-safe', () => {
    const name = sanitizeExportFileName(
      '请像用户在首页直接提问“根据这本 PDF 给我上一节关于【第2课 言行与劝学】的课”一样，走 Bingo 普通课堂生成流程。不生成 TTS 的 - 当前只生成了 2 节课：第2课 言行与劝学】',
      { maxLength: 60 },
    );

    expect(visibleLength(name)).toBeLessThanOrEqual(60);
    expect(name).not.toMatch(/[<>:"/\\|?*\x00-\x1f\x7f]/);
    expect(name).not.toMatch(/\s/);
  });

  it('falls back for empty or reserved Windows names', () => {
    expect(sanitizeExportFileName('  <>:"/\\|?*  ', { fallback: 'Bingo课堂' })).toBe('Bingo课堂');
    expect(sanitizeExportFileName('CON')).toBe('_CON');
  });

  it('extracts the real lesson title from a meta classroom prompt', () => {
    const title = extractClassroomTitleFromRequirement(
      '请像用户在首页直接提问“根据这本 PDF 给我上一节关于【第2课 言行与劝学】的课”一样，走 Bingo 普通课堂生成流程。不生成 TTS 的 - 当前只生成了 2 节课：第2课 言行与劝学】 本节目标：完成25分钟讲授、5分钟休息、25分钟练习。',
    );

    expect(title).toBe('第2课 言行与劝学');
  });

  it('truncates generic classroom titles instead of keeping the full prompt', () => {
    const title = extractClassroomTitleFromRequirement(
      '请根据我上传的 PDF 生成一个完整的互动课堂，包括讲解幻灯片、知识检查题目，以及必要的补充示例、互动或项目活动。',
      { maxLength: 20 },
    );

    expect(visibleLength(title)).toBeLessThanOrEqual(20);
    expect(title).not.toContain('知识检查题目');
  });
});

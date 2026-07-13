import { describe, expect, it } from 'vitest';

import { shouldAutoCenterBoxText } from '@/lib/utils/text-box-alignment';

describe('text box alignment repair', () => {
  it('auto-centers short Chinese card labels inside large boxes', () => {
    for (const label of ['共用顶点', '位置决定关系', '角度可推理']) {
      expect(
        shouldAutoCenterBoxText({
          html: `<p style="font-size: 40px;">${label}</p>`,
          boxWidth: 407,
          boxHeight: 153,
        }),
      ).toBe(true);
    }
  });

  it('auto-centers long horizontal prompt strips', () => {
    expect(
      shouldAutoCenterBoxText({
        html: '<p style="font-size: 20px;">计算顺序：先看位置 -> 再用关系 -> 得出结果</p>',
        boxWidth: 820,
        boxHeight: 58,
      }),
    ).toBe(true);
  });

  it('does not auto-center list-like content', () => {
    expect(
      shouldAutoCenterBoxText({
        html: '<p style="font-size: 18px;">• 先看位置</p><p style="font-size: 18px;">• 再用关系</p>',
        boxWidth: 820,
        boxHeight: 86,
      }),
    ).toBe(false);
  });
});

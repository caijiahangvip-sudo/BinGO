import { describe, expect, it } from 'vitest';
import {
  convertHomeworkMathToLatex,
  segmentHomeworkText,
} from '@/lib/homework/math-rendering';

describe('convertHomeworkMathToLatex', () => {
  it('converts chained fractions and operators into LaTeX', () => {
    expect(convertHomeworkMathToLatex('7/11×1/4+3/4÷11/7')).toBe(
      String.raw`\frac{7}{11}\times \frac{1}{4}+\frac{3}{4}\div \frac{11}{7}`,
    );
  });

  it('normalizes full-width operators from homework output', () => {
    expect(convertHomeworkMathToLatex('10；7/11；9/19')).toBe(
      String.raw`10; \frac{7}{11}; \frac{9}{19}`,
    );
    expect(convertHomeworkMathToLatex('7/11×1/4＋3/4÷11/7＝7/44＋21/44＝7/11')).toBe(
      String.raw`\frac{7}{11}\times \frac{1}{4}+\frac{3}{4}\div \frac{11}{7}=\frac{7}{44}+\frac{21}{44}=\frac{7}{11}`,
    );
  });

  it('converts inequalities, angles, degrees, roots, and percentages', () => {
    expect(convertHomeworkMathToLatex('|x|≥2，∠4=50°，√16=4，60%')).toBe(
      String.raw`|x|\ge 2, \angle 4=50^{\circ}, \sqrt{16}=4, 60\%`,
    );
  });
});

describe('segmentHomeworkText', () => {
  it('splits normal text and embedded math expressions', () => {
    expect(segmentHomeworkText('参考答案：7/11×1/4 + 3/4÷11/7')).toEqual([
      { type: 'text', value: '参考答案：' },
      { type: 'math', value: '7/11×1/4 + 3/4÷11/7' },
    ]);
  });

  it('detects coordinate and equation expressions inside Chinese text', () => {
    expect(segmentHomeworkText("所以A'=(2-2,0+1)=(0,1)，x=3满足x<5。")).toEqual([
      { type: 'text', value: '所以' },
      { type: 'math', value: "A'=(2-2,0+1)=(0,1)" },
      { type: 'text', value: '，' },
      { type: 'math', value: 'x=3' },
      { type: 'text', value: '满足' },
      { type: 'math', value: 'x<5' },
      { type: 'text', value: '。' },
    ]);
  });

  it('detects full-width arithmetic sequences from real homework output', () => {
    expect(segmentHomeworkText('参考答案：10；7/11；9/19')).toEqual([
      { type: 'text', value: '参考答案：' },
      { type: 'math', value: '10；7/11；9/19' },
    ]);
    expect(
      segmentHomeworkText(
        '②7/11×1/4＋3/4÷11/7＝7/44＋3/4×7/11＝7/44＋21/44＝28/44＝7/11。',
      ),
    ).toEqual([
      { type: 'text', value: '②' },
      { type: 'math', value: '7/11×1/4＋3/4÷11/7＝7/44＋3/4×7/11＝7/44＋21/44＝28/44＝7/11' },
      { type: 'text', value: '。' },
    ]);
  });
});

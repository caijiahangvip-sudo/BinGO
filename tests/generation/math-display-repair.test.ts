import { describe, expect, it } from 'vitest';

import { repairMathDisplayText, repairMathLatex } from '@/lib/utils/math-display-repair';

describe('math display repair', () => {
  it('repairs degree notation that was rendered as superscript c in angle text', () => {
    expect(repairMathDisplayText('<p>∠2 = 180° - xᶜ</p>')).toBe('<p>∠2 = 180° - x°</p>');
    expect(repairMathDisplayText('<p>平角关系：180° - x<sup>c</sup></p>')).toBe(
      '<p>平角关系：180° - x°</p>',
    );
  });

  it('does not rewrite normal algebraic exponents without degree context', () => {
    expect(repairMathDisplayText('<p>f(x)=x^c</p>')).toBe('<p>f(x)=x^c</p>');
    expect(repairMathLatex('a^c+b')).toBe('a^c+b');
  });

  it('repairs latex degree notation before KaTeX rendering', () => {
    expect(repairMathLatex(String.raw`180^{\circ}-x^c`)).toBe(
      String.raw`180^{\circ}-x^{\circ}`,
    );
  });
});

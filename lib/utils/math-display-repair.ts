const DEGREE_CONTEXT_RE =
  /角|∠|度|°|&deg;|&#176;|&#x0*b0;|180|90|360|平角|补角|邻补角|同旁内角|对顶角|angle|degree|supplementary/i;

function hasDegreeContext(value: string): boolean {
  return DEGREE_CONTEXT_RE.test(value);
}

export function repairMathDisplayText(html: string): string {
  if (!html || !hasDegreeContext(html)) return html;

  return html
    .replace(/([A-Za-z])\s*ᶜ/g, '$1°')
    .replace(/([A-Za-z])\s*\^\s*c\b/g, '$1°')
    .replace(/([A-Za-z])\s*<sup[^>]*>\s*c\s*<\/sup>/gi, '$1°')
    .replace(
      /([A-Za-z])\s*<span([^>]*)>\s*c\s*<\/span>/gi,
      (match, variable: string, attrs: string) => {
        if (!/vertical-align\s*:\s*super|font-size\s*:\s*(?:smaller|[0-9.]+(?:px|em|rem|%))/i.test(attrs)) {
          return match;
        }
        return `${variable}°`;
      },
    );
}

export function repairMathLatex(latex: string): string {
  if (!latex || !hasDegreeContext(latex)) return latex;

  return latex
    .replace(/([A-Za-z])\s*ᶜ/g, String.raw`$1^{\circ}`)
    .replace(/([A-Za-z])\s*\^\s*\{\s*c\s*\}/g, String.raw`$1^{\circ}`)
    .replace(/([A-Za-z])\s*\^\s*c\b/g, String.raw`$1^{\circ}`)
    .replace(/(\d)°/g, String.raw`$1^{\circ}`)
    .replace(/([A-Za-z])°/g, String.raw`$1^{\circ}`);
}

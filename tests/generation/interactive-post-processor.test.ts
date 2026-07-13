import { describe, expect, it } from 'vitest';

import {
  INTERACTIVE_COMPACT_REPAIR_MARKER,
  needsCompactInteractiveRepair,
  postProcessInteractiveHtml,
  repairCompactInteractiveLayout,
} from '@/lib/generation/interactive-post-processor';

const compactCenteredHtml = `<!doctype html>
<html>
<head>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; }
    body { display: grid; place-items: center; background: #f8fafc; }
    main {
      width: min(920px, 92vw);
      min-height: min(500px, 86vh);
      border-radius: 8px;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
    }
  </style>
</head>
<body>
  <main>
    <h1>课堂判断</h1>
    <div class="choices"><button>选项一</button><button>选项二</button></div>
    <div id="feedback">请选择一个答案。</div>
  </main>
</body>
</html>`;

describe('interactive HTML post processor', () => {
  it('repairs compact centered-card layouts into full-stage iframe layouts', () => {
    expect(needsCompactInteractiveRepair(compactCenteredHtml)).toBe(true);

    const processed = postProcessInteractiveHtml(compactCenteredHtml);

    expect(processed).toContain(INTERACTIVE_COMPACT_REPAIR_MARKER);
    expect(processed).toContain('width: 100vw !important');
    expect(processed).toContain('max-width: none !important');
    expect(processed).toContain('min-height: 100vh !important');
    expect(processed).toContain('place-items: initial !important');
  });

  it('does not repair known deterministic interactive templates', () => {
    const templateHtml = compactCenteredHtml.replace(
      '<main>',
      '<main data-template="angle-relations">',
    );

    const processed = repairCompactInteractiveLayout(templateHtml);

    expect(processed).not.toContain(INTERACTIVE_COMPACT_REPAIR_MARKER);
  });

  it('still injects KaTeX resources for normal generated HTML', () => {
    const processed = postProcessInteractiveHtml(`<!doctype html>
<html>
<head><title>Math</title></head>
<body><main><p>$x+1$</p></main></body>
</html>`);

    expect(processed).toContain('katex.min.css');
    expect(processed).toContain('\\(x+1\\)');
    expect(processed).not.toContain(INTERACTIVE_COMPACT_REPAIR_MARKER);
  });
});

/**
 * Interactive HTML Post-Processor
 *
 * Ported from Python's PostProcessor class (learn-your-way/concept_to_html.py:287-385)
 *
 * Handles:
 * - LaTeX delimiter conversion ($$...$$ -> \[...\], $...$ -> \(...\))
 * - KaTeX CSS/JS injection with auto-render and MutationObserver
 * - Script tag protection during LaTeX conversion
 * - Compact centered-card layout detection and full-stage repair
 */

export const INTERACTIVE_COMPACT_REPAIR_MARKER = 'data-bingo-interactive-compact-repair';

/**
 * Main entry point: post-process generated interactive HTML
 * Converts LaTeX delimiters and injects KaTeX rendering resources.
 */
export function postProcessInteractiveHtml(html: string): string {
  // Convert LaTeX delimiters while protecting script tags
  let processed = convertLatexDelimiters(html);

  // Inject KaTeX resources if not already present
  if (!processed.toLowerCase().includes('katex')) {
    processed = injectKatex(processed);
  }

  return repairCompactInteractiveLayout(processed);
}

/**
 * Detect AI-generated pages that render as a small centered card inside the
 * 16:9 iframe and inject CSS that turns the top-level app shell into a
 * full-stage classroom interaction.
 */
export function repairCompactInteractiveLayout(html: string): string {
  if (!needsCompactInteractiveRepair(html)) return html;
  return injectCompactInteractiveRepairCss(html);
}

export function needsCompactInteractiveRepair(html: string): boolean {
  if (!html.trim()) return false;
  if (html.includes(INTERACTIVE_COMPACT_REPAIR_MARKER)) return false;
  if (hasKnownDeterministicTemplate(html)) return false;

  const normalized = html.replace(/\s+/g, ' ').toLowerCase();
  const bodyCss = extractCssRule(normalized, 'body');
  const mainCss = extractCssRule(normalized, 'main');
  const appCss = extractCssRule(normalized, '.app') || extractCssRule(normalized, '#app');

  const pageCentersContent =
    /display\s*:\s*grid/.test(bodyCss) && /place-items\s*:\s*center/.test(bodyCss);
  const pageFlexCentersContent =
    /display\s*:\s*flex/.test(bodyCss) &&
    /(?:align-items|justify-content)\s*:\s*center/.test(bodyCss);
  const hasPageCentering =
    pageCentersContent || pageFlexCentersContent || /place-items\s*:\s*center/.test(normalized);

  const rootCss = `${mainCss} ${appCss}`;
  const hasConstrainedRoot =
    /width\s*:\s*min\s*\(/.test(rootCss) ||
    /max-width\s*:\s*(?:\d{2,4}px|[0-9.]+rem)/.test(rootCss) ||
    /min-height\s*:\s*min\s*\(/.test(rootCss);
  const hasFallbackSignature =
    /width\s*:\s*min\s*\(\s*920px\s*,\s*92vw\s*\)/.test(normalized) ||
    /min-height\s*:\s*min\s*\(\s*500px\s*,\s*86vh\s*\)/.test(normalized);

  return hasFallbackSignature || (hasPageCentering && hasConstrainedRoot);
}

function hasKnownDeterministicTemplate(html: string): boolean {
  return /\bdata-template\s*=\s*["']angle-relations["']/i.test(html);
}

function extractCssRule(normalizedHtml: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = normalizedHtml.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'gi'));
  return Array.from(matches, (match) => match[1] || '').join(' ');
}

function injectCompactInteractiveRepairCss(html: string): string {
  const repairCss = `
<style ${INTERACTIVE_COMPACT_REPAIR_MARKER}>
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    min-height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  body {
    display: block !important;
    place-items: initial !important;
    align-items: stretch !important;
    justify-content: stretch !important;
    background: #f8fafc !important;
  }

  body > :where(main, .app, #app, .container, .wrapper, .page, .card, .panel, section, div):first-of-type {
    width: 100vw !important;
    max-width: none !important;
    min-width: 0 !important;
    height: 100vh !important;
    min-height: 100vh !important;
    margin: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    display: grid !important;
    grid-template-rows: auto minmax(0, 1fr) auto !important;
    gap: clamp(14px, 2.2vh, 28px) !important;
    padding: clamp(22px, 3.4vw, 48px) !important;
    overflow: hidden !important;
  }

  body > :where(main, .app, #app, .container, .wrapper, .page, .card, .panel, section, div):first-of-type > * {
    min-width: 0 !important;
  }

  .choices,
  .options,
  .answers {
    width: 100% !important;
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: clamp(14px, 2.2vw, 28px) !important;
    align-self: stretch !important;
  }

  button,
  [role='button'] {
    min-height: clamp(104px, 20vh, 220px) !important;
    font-size: clamp(18px, 2.1vw, 28px) !important;
    line-height: 1.35 !important;
  }

  #feedback,
  .feedback {
    min-height: clamp(56px, 8vh, 96px) !important;
    font-size: clamp(16px, 1.7vw, 22px) !important;
  }

  svg,
  canvas {
    width: 100% !important;
    height: 100% !important;
    min-height: 300px !important;
    display: block !important;
  }

  @media (max-width: 720px) {
    .choices,
    .options,
    .answers {
      grid-template-columns: 1fr !important;
    }
  }
</style>`;

  const headCloseMatch = /<\/head\s*>/i.exec(html);
  if (headCloseMatch?.index !== undefined) {
    const idx = headCloseMatch.index;
    return html.substring(0, idx) + repairCss + '\n' + html.substring(idx);
  }

  const bodyCloseMatch = /<\/body\s*>/i.exec(html);
  if (bodyCloseMatch?.index !== undefined) {
    const idx = bodyCloseMatch.index;
    return html.substring(0, idx) + repairCss + '\n' + html.substring(idx);
  }

  return html + repairCss;
}

/**
 * Convert LaTeX delimiters while protecting <script> tags.
 *
 * - Protects script blocks from modification
 * - Converts $$...$$ to \[...\] (display math)
 * - Converts $...$ to \(...\) (inline math)
 * - Restores script blocks after conversion
 */
function convertLatexDelimiters(html: string): string {
  const scriptBlocks: string[] = [];

  // Protect script tags by replacing them with placeholders
  let processed = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, (match) => {
    scriptBlocks.push(match);
    return `__SCRIPT_BLOCK_${scriptBlocks.length - 1}__`;
  });

  // Convert display math: $$...$$ -> \[...\]
  processed = processed.replace(/\$\$([^$]+)\$\$/g, '\\[$1\\]');

  // Convert inline math: $...$ -> \(...\)
  // Use non-greedy match and exclude newlines to avoid false positives
  processed = processed.replace(/\$([^$\n]+?)\$/g, '\\($1\\)');

  // Restore script blocks using indexOf + substring (not .replace())
  // because script content may contain $ characters that .replace()
  // would interpret as special substitution patterns.
  for (let i = 0; i < scriptBlocks.length; i++) {
    const placeholder = `__SCRIPT_BLOCK_${i}__`;
    const idx = processed.indexOf(placeholder);
    if (idx !== -1) {
      processed =
        processed.substring(0, idx) +
        scriptBlocks[i] +
        processed.substring(idx + placeholder.length);
    }
  }

  return processed;
}

/**
 * Inject KaTeX CSS, JS, auto-render, and MutationObserver before </head>.
 * Falls back to appending at end if </head> is not found.
 */
function injectKatex(html: string): string {
  const katexInjection = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<script>
document.addEventListener("DOMContentLoaded", function() {
    const katexOptions = {
        delimiters: [
            {left: '\\\\[', right: '\\\\]', display: true},
            {left: '\\\\(', right: '\\\\)', display: false},
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
        ],
        throwOnError: false,
        strict: false,
        trust: true
    };

    let renderTimeout;
    function safeRender() {
        if (renderTimeout) clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
            renderMathInElement(document.body, katexOptions);
        }, 100);
    }

    renderMathInElement(document.body, katexOptions);

    const observer = new MutationObserver((mutations) => {
        let shouldRender = false;
        mutations.forEach((mutation) => {
            if (mutation.target &&
                mutation.target.className &&
                typeof mutation.target.className === 'string' &&
                mutation.target.className.includes('katex')) {
                return;
            }
            shouldRender = true;
        });

        if (shouldRender) {
            safeRender();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    setInterval(() => {
        const text = document.body.innerText;
        if (text.includes('\\\\(') || text.includes('$$')) {
            safeRender();
        }
    }, 2000);
});
</script>`;

  // Use indexOf + substring instead of String.replace() because the
  // katexInjection string contains '$' characters that .replace() would
  // interpret as special substitution patterns ($$ → $, $' → post-match text).
  const headCloseIdx = html.indexOf('</head>');
  if (headCloseIdx !== -1) {
    return (
      html.substring(0, headCloseIdx) +
      katexInjection +
      '\n</head>' +
      html.substring(headCloseIdx + 7)
    );
  }

  // Fallback: inject before </body> if </head> is missing
  const bodyCloseIdx = html.indexOf('</body>');
  if (bodyCloseIdx !== -1) {
    return (
      html.substring(0, bodyCloseIdx) +
      katexInjection +
      '\n</body>' +
      html.substring(bodyCloseIdx + 7)
    );
  }

  // Last resort: append at end
  return html + katexInjection;
}

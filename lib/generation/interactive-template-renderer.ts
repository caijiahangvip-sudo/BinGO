import {
  getInteractiveTemplateKind,
  type InteractiveTemplateGuidanceInput,
} from './interactive-template-guidance';
import { SCREEN_FONT_STACK } from '@/lib/constants/fonts';

export interface InteractiveTemplateRenderInput extends InteractiveTemplateGuidanceInput {
  readonly language?: 'zh-CN' | 'en-US';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderInteractiveTemplate(input: InteractiveTemplateRenderInput): string | null {
  const kind = getInteractiveTemplateKind(input);
  if (kind === 'angle-relations') {
    return renderAngleRelationsTemplate(input);
  }

  return null;
}

function renderAngleRelationsTemplate(input: InteractiveTemplateRenderInput): string {
  const isChinese = input.language !== 'en-US';
  const title = escapeHtml(
    input.conceptName ||
      (isChinese
        ? '\u76f8\u4ea4\u7ebf\u4e2d\u7684\u90bb\u8865\u89d2\u4e0e\u5bf9\u9876\u89d2'
        : 'Vertical and Supplementary Angles'),
  );
  const copy = {
    subtitle: isChinese
      ? '\u62d6\u52a8\u84dd\u8272\u76f4\u7ebf\uff0c\u89c2\u5bdf\u56db\u4e2a\u89d2\u5982\u4f55\u540c\u6b65\u53d8\u5316\u3002'
      : 'Drag the blue line and watch how the four angles change together.',
    rule: isChinese
      ? '\u5bf9\u9876\u89d2\u76f8\u7b49\uff1b\u90bb\u8865\u89d2\u548c\u4e3a 180\u00b0'
      : 'Vertical angles are equal; adjacent supplementary angles add to 180\u00b0',
    opposite: isChinese ? '\u5bf9\u9876\u89d2' : 'Vertical angles',
    supplementary: isChinese ? '\u90bb\u8865\u89d2' : 'Supplementary',
    all: isChinese ? '\u5168\u90e8' : 'All',
    labels: isChinese ? '\u6807\u7b7e' : 'Labels',
    reset: isChinese ? '\u91cd\u7f6e' : 'Reset',
    hint: isChinese
      ? '\u53ea\u9700\u8bb0\u4f4f\u4e24\u4e2a\u5173\u7cfb\uff1a\u5bf9\u9762\u7684\u89d2\u76f8\u7b49\uff0c\u76f8\u90bb\u7684\u89d2\u4e92\u8865\u3002'
      : 'Two relationships are enough: opposite angles are equal, and adjacent angles are supplementary.',
  };

  return `<!DOCTYPE html>
<html lang="${isChinese ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #111827;
      --muted: #475569;
      --line: #27364d;
      --blue: #2563eb;
      --green: #0f9f6e;
      --amber: #d97706;
      --surface: #ffffff;
      --soft: #eef6ff;
      --border: #d7e2f1;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body {
      font-family: ${SCREEN_FONT_STACK};
      color: var(--ink);
      background: #edf3f9;
      overflow: hidden;
    }
    .app {
      width: 100%;
      height: 100vh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: clamp(8px, 1.5vw, 14px);
      padding: clamp(12px, 2vw, 24px);
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    h1 {
      margin: 0;
      font-size: clamp(22px, 3vw, 36px);
      line-height: 1.08;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: clamp(13px, 1.5vw, 17px);
      line-height: 1.35;
    }
    .rule {
      flex: 0 1 430px;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 10px 14px;
      background: rgba(255,255,255,0.86);
      color: #334155;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
      font-size: clamp(13px, 1.5vw, 18px);
      line-height: 1.35;
    }
    .stage {
      min-height: 0;
      border-radius: 24px;
      border: 1px solid var(--border);
      background: linear-gradient(180deg, #f7fbff, var(--soft));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 16px 38px rgba(15, 23, 42, 0.08);
      overflow: hidden;
      display: grid;
      place-items: stretch;
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      user-select: none;
    }
    .sector { opacity: 0.12; transition: opacity 120ms ease, fill 120ms ease; }
    .sector.active { opacity: 0.34; }
    .sector.opposite { fill: #2dd4bf; }
    .sector.supplementary { fill: #f4b183; }
    .base-line { stroke: var(--line); stroke-width: 7; stroke-linecap: round; }
    .rot-line { stroke: var(--blue); stroke-width: 8; stroke-linecap: round; }
    .center-dot { fill: #111827; }
    .handle-halo { fill: #dbeafe; stroke: #bfdbfe; stroke-width: 6; }
    .handle { fill: var(--blue); cursor: grab; }
    .handle:active { cursor: grabbing; }
    .angle-label text {
      paint-order: stroke;
      stroke: white;
      stroke-width: 8px;
      stroke-linejoin: round;
      fill: #111827;
      font-size: 30px;
      font-weight: 760;
      letter-spacing: 0;
    }
    .angle-label.is-hidden { display: none; }
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      min-height: 38px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0 14px;
      background: rgba(255,255,255,0.86);
      color: #334155;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    button[aria-pressed="true"] {
      border-color: #93c5fd;
      background: #dbeafe;
      color: #1d4ed8;
    }
    .hint {
      margin: 0;
      color: var(--muted);
      font-size: clamp(12px, 1.35vw, 15px);
      line-height: 1.35;
      flex: 1 1 320px;
      text-align: right;
    }
    @media (max-width: 760px) {
      header { display: block; }
      .rule { margin-top: 10px; }
      footer { display: block; }
      .toolbar { margin-bottom: 8px; }
      .hint { text-align: left; }
      button { min-height: 36px; padding: 0 12px; }
    }
  </style>
</head>
<body>
  <div class="app" data-template="angle-relations">
    <header>
      <div>
        <h1>${title}</h1>
        <p class="subtitle">${copy.subtitle}</p>
      </div>
      <div class="rule">${copy.rule}</div>
    </header>

    <main class="stage" aria-label="${title}">
      <svg id="diagram" viewBox="0 0 1000 620" role="img">
        <path id="sector1" class="sector supplementary" />
        <path id="sector2" class="sector opposite" />
        <path id="sector3" class="sector supplementary" />
        <path id="sector4" class="sector opposite" />
        <line id="baseLine" class="base-line" x1="70" y1="320" x2="930" y2="320" />
        <line id="rotLine" class="rot-line" />
        <circle class="center-dot" cx="500" cy="320" r="12" />
        <circle id="handleHalo" class="handle-halo" r="32" />
        <circle id="handle" class="handle" r="20" tabindex="0" />
        <g id="label1" class="angle-label"><text text-anchor="middle" dominant-baseline="middle"></text></g>
        <g id="label2" class="angle-label"><text text-anchor="middle" dominant-baseline="middle"></text></g>
        <g id="label3" class="angle-label"><text text-anchor="middle" dominant-baseline="middle"></text></g>
        <g id="label4" class="angle-label"><text text-anchor="middle" dominant-baseline="middle"></text></g>
      </svg>
    </main>

    <footer>
      <div class="toolbar" role="toolbar">
        <button type="button" data-mode="opposite" aria-pressed="true">${copy.opposite}</button>
        <button type="button" data-mode="supplementary" aria-pressed="false">${copy.supplementary}</button>
        <button type="button" data-mode="all" aria-pressed="false">${copy.all}</button>
        <button type="button" id="toggleLabels" aria-pressed="true">${copy.labels}</button>
        <button type="button" id="resetBtn">${copy.reset}</button>
      </div>
      <p class="hint">${copy.hint}</p>
    </footer>
  </div>

  <script>
    (function() {
      const svg = document.getElementById('diagram');
      const cx = 500;
      const cy = 320;
      const lineRadius = 470;
      const handleRadius = 220;
      const labelRadius = 150;
      let angle = 62;
      let mode = 'opposite';
      let showLabels = true;
      let dragging = false;

      const rotLine = document.getElementById('rotLine');
      const handle = document.getElementById('handle');
      const handleHalo = document.getElementById('handleHalo');
      const sectors = [
        document.getElementById('sector1'),
        document.getElementById('sector2'),
        document.getElementById('sector3'),
        document.getElementById('sector4')
      ];
      const labels = [
        document.getElementById('label1'),
        document.getElementById('label2'),
        document.getElementById('label3'),
        document.getElementById('label4')
      ];

      function point(deg, radius) {
        const rad = deg * Math.PI / 180;
        return {
          x: cx + radius * Math.cos(rad),
          y: cy - radius * Math.sin(rad)
        };
      }

      function sectorPath(startDeg, endDeg) {
        const radius = 185;
        const start = point(startDeg, radius);
        const end = point(endDeg, radius);
        const delta = Math.abs(endDeg - startDeg);
        const largeArc = delta > 180 ? 1 : 0;
        return 'M ' + cx + ' ' + cy +
          ' L ' + start.x.toFixed(2) + ' ' + start.y.toFixed(2) +
          ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 0 ' +
          end.x.toFixed(2) + ' ' + end.y.toFixed(2) + ' Z';
      }

      function formatDeg(value) {
        return Math.round(value) + '\\u00b0';
      }

      function setActiveSectors() {
        sectors.forEach(function(sector, index) {
          let active = false;
          if (mode === 'all') active = true;
          if (mode === 'opposite') active = index === 0 || index === 2;
          if (mode === 'supplementary') active = index === 0 || index === 1;
          sector.classList.toggle('active', active);
        });
      }

      function update() {
        const a = Math.max(20, Math.min(160, angle));
        const b = 180 - a;
        const p1 = point(a, lineRadius);
        const p2 = point(a + 180, lineRadius);
        const h = point(a, handleRadius);

        rotLine.setAttribute('x1', p1.x);
        rotLine.setAttribute('y1', p1.y);
        rotLine.setAttribute('x2', p2.x);
        rotLine.setAttribute('y2', p2.y);
        handle.setAttribute('cx', h.x);
        handle.setAttribute('cy', h.y);
        handleHalo.setAttribute('cx', h.x);
        handleHalo.setAttribute('cy', h.y);

        const regions = [
          { start: 0, end: a, value: a, name: '\\u22201' },
          { start: a, end: 180, value: b, name: '\\u22202' },
          { start: 180, end: 180 + a, value: a, name: '\\u22203' },
          { start: 180 + a, end: 360, value: b, name: '\\u22204' }
        ];

        regions.forEach(function(region, index) {
          sectors[index].setAttribute('d', sectorPath(region.start, region.end));
          const mid = (region.start + region.end) / 2;
          const labelPoint = point(mid, labelRadius);
          const label = labels[index];
          label.setAttribute('transform', 'translate(' + labelPoint.x.toFixed(2) + ' ' + labelPoint.y.toFixed(2) + ')');
          label.classList.toggle('is-hidden', !showLabels);
          label.querySelector('text').textContent = region.name + ' ' + formatDeg(region.value);
        });

        setActiveSectors();
      }

      function angleFromPointer(event) {
        const rect = svg.getBoundingClientRect();
        const x = (event.clientX - rect.left) * 1000 / rect.width;
        const y = (event.clientY - rect.top) * 620 / rect.height;
        let deg = Math.atan2(cy - y, x - cx) * 180 / Math.PI;
        if (deg < 0) deg += 360;
        deg = deg % 180;
        return Math.max(20, Math.min(160, deg));
      }

      function startDrag(event) {
        dragging = true;
        svg.setPointerCapture(event.pointerId);
        angle = angleFromPointer(event);
        update();
      }

      svg.addEventListener('pointerdown', startDrag);
      svg.addEventListener('pointermove', function(event) {
        if (!dragging) return;
        angle = angleFromPointer(event);
        update();
      });
      svg.addEventListener('pointerup', function(event) {
        dragging = false;
        try { svg.releasePointerCapture(event.pointerId); } catch (_) {}
      });
      svg.addEventListener('pointercancel', function() {
        dragging = false;
      });

      handle.addEventListener('keydown', function(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        angle += event.key === 'ArrowRight' ? 2 : -2;
        angle = Math.max(20, Math.min(160, angle));
        update();
      });

      document.querySelectorAll('[data-mode]').forEach(function(button) {
        button.addEventListener('click', function() {
          mode = button.getAttribute('data-mode') || 'opposite';
          document.querySelectorAll('[data-mode]').forEach(function(other) {
            other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
          });
          update();
        });
      });

      document.getElementById('toggleLabels').addEventListener('click', function(event) {
        showLabels = !showLabels;
        event.currentTarget.setAttribute('aria-pressed', showLabels ? 'true' : 'false');
        update();
      });

      document.getElementById('resetBtn').addEventListener('click', function() {
        angle = 62;
        update();
      });

      update();
    })();
  </script>
</body>
</html>`;
}

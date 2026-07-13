import { DEFAULT_SCREEN_FONT_NAME } from '@/lib/constants/fonts';
import type { GeneratedSlideContent, SceneOutline } from '@/lib/types/generation';
import type { PPTElement, PPTShapeElement, PPTTextElement } from '@/lib/types/slides';
import { stripVisualPlanningMarkers, type SceneContentVisualIntent } from './scene-content-policy';

const TOP_TRIANGLE_PATH = 'M 50 0 L 100 100 L 0 100 Z';
const TRAPEZOID_PATH = 'M 20 0 L 80 0 L 100 100 L 0 100 Z';
const WIDE_TRAPEZOID_PATH = 'M 14 0 L 86 0 L 100 100 L 0 100 Z';

type PyramidLayerKey = 'action' | 'quality' | 'spirit';

interface PyramidLayer {
  readonly key: PyramidLayerKey;
  readonly label: string;
  readonly details: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

function paragraph(
  text: string,
  options: {
    readonly fontSize: number;
    readonly color: string;
    readonly weight?: number;
    readonly align?: 'left' | 'center' | 'right';
    readonly lineHeight?: number;
  },
): string {
  const weight = options.weight ? ` font-weight: ${options.weight};` : '';
  const align = options.align ? ` text-align: ${options.align};` : '';
  return `<p style="font-size: ${options.fontSize}px; color: ${options.color};${weight}${align} line-height: ${
    options.lineHeight ?? 1.2
  };">${escapeHtml(text)}</p>`;
}

function textElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  content: string,
  defaultColor: string,
  textType?: PPTTextElement['textType'],
): PPTTextElement {
  return {
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    rotate: 0,
    content,
    defaultFontName: DEFAULT_SCREEN_FONT_NAME,
    defaultColor,
    textType,
  };
}

function shapeElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  path: string,
  fill: string,
): PPTShapeElement {
  return {
    id,
    type: 'shape',
    left,
    top,
    width,
    height,
    rotate: 0,
    viewBox: [100, 100],
    path,
    fixedRatio: false,
    fill,
    outline: { style: 'solid', width: 2, color: '#ffffff' },
  };
}

function splitDetails(value: string): string[] {
  return value
    .split(/[、,，;；/]/u)
    .map(normalizeText)
    .map((item) => item.replace(/^[：:：\-\s]+/, '').trim())
    .filter(Boolean)
    .filter((item) => !/^(行动层|品质层|精神层)$/u.test(item))
    .slice(0, 5);
}

function layerTextSources(outline: SceneOutline): string[] {
  return [outline.description, ...(outline.keyPoints || [])]
    .map((item) => normalizeText(stripHtml(item || '')))
    .filter(Boolean);
}

function extractLayerDetails(sources: readonly string[], label: string): string[] {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const detailPattern = new RegExp(`${escapedLabel}\\s*[：:]\\s*([^。；;\\n]+)`, 'u');

  for (const source of sources) {
    const match = source.match(detailPattern);
    if (match?.[1]) {
      return splitDetails(match[1]);
    }
  }

  return [];
}

function sourceMentionsLayer(sources: readonly string[], label: string): boolean {
  return sources.some((source) => source.includes(label));
}

function fallbackLayerDetails(sources: readonly string[], label: string): string[] {
  const layerListSource = sources.find(
    (source) => source.includes('行动层') && source.includes('品质层') && source.includes('精神层'),
  );
  if (!layerListSource) return [];

  return sourceMentionsLayer([layerListSource], label) ? [] : [];
}

function parsePyramidLayers(outline: SceneOutline): PyramidLayer[] {
  const sources = layerTextSources(outline);
  const specs: Array<{ key: PyramidLayerKey; label: string; fallback: string[] }> = [
    { key: 'action', label: '行动层', fallback: [] },
    { key: 'quality', label: '品质层', fallback: [] },
    { key: 'spirit', label: '精神层', fallback: [] },
  ];

  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    details:
      extractLayerDetails(sources, spec.label).length > 0
        ? extractLayerDetails(sources, spec.label)
        : fallbackLayerDetails(sources, spec.label),
  }));
}

function outlineText(outline: SceneOutline): string {
  return [outline.title, outline.description, ...(outline.keyPoints || [])]
    .map(normalizeText)
    .join('\n')
    .toLowerCase();
}

export function isPyramidSlideOutline(
  outline: SceneOutline,
  visualIntent?: SceneContentVisualIntent,
): boolean {
  if (outline.type !== 'slide') return false;
  if (visualIntent?.kind === 'pyramid') return true;

  const text = outlineText(outline);
  if (/(?:金字塔图|金字塔|pyramid)/i.test(text)) return true;

  return ['行动层', '品质层', '精神层'].every((label) => text.includes(label));
}

function layerHtml(layer: PyramidLayer, color = '#ffffff'): string {
  const detailText = layer.details.join('、');
  return [
    paragraph(layer.label, {
      fontSize: detailText ? 24 : 26,
      color,
      weight: 780,
      align: 'center',
      lineHeight: 1.1,
    }),
    detailText
      ? paragraph(detailText, {
          fontSize: 17,
          color,
          weight: 560,
          align: 'center',
          lineHeight: 1.25,
        })
      : '',
  ].join('');
}

export function buildPyramidSlideContent(outline: SceneOutline): GeneratedSlideContent {
  const title = normalizeText(stripVisualPlanningMarkers(outline.title)) || '层级结构';
  const layers = parsePyramidLayers(outline);
  const action = layers.find((layer) => layer.key === 'action') || layers[0];
  const quality = layers.find((layer) => layer.key === 'quality') || layers[1];
  const spirit = layers.find((layer) => layer.key === 'spirit') || layers[2];

  const elements: PPTElement[] = [
    textElement(
      'template_pyramid_title',
      86,
      38,
      828,
      48,
      paragraph(title, {
        fontSize: 30,
        color: '#0f172a',
        weight: 760,
        align: 'center',
      }),
      '#0f172a',
      'title',
    ),
    textElement(
      'template_pyramid_subtitle',
      160,
      88,
      680,
      30,
      paragraph('由行动表现逐步上升到品质理解和精神内涵', {
        fontSize: 17,
        color: '#475569',
        weight: 540,
        align: 'center',
      }),
      '#475569',
      'subtitle',
    ),
    shapeElement('template_pyramid_layer_spirit', 380, 142, 240, 112, TOP_TRIANGLE_PATH, '#2563eb'),
    shapeElement('template_pyramid_layer_quality', 270, 254, 460, 116, TRAPEZOID_PATH, '#16a34a'),
    shapeElement(
      'template_pyramid_layer_action',
      160,
      370,
      680,
      122,
      WIDE_TRAPEZOID_PATH,
      '#f59e0b',
    ),
    textElement(
      'template_pyramid_text_spirit',
      362,
      180,
      276,
      68,
      layerHtml(spirit),
      '#ffffff',
      'itemTitle',
    ),
    textElement(
      'template_pyramid_text_quality',
      306,
      286,
      388,
      72,
      layerHtml(quality),
      '#ffffff',
      'itemTitle',
    ),
    textElement(
      'template_pyramid_text_action',
      208,
      408,
      584,
      72,
      layerHtml(action),
      '#ffffff',
      'itemTitle',
    ),
  ];

  return {
    elements,
    background: { type: 'solid', color: '#f8fafc' },
    remark: `用三层结构理解${title}。`,
  };
}

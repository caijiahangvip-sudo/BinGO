/**
 * Stage 2: Scene content and action generation.
 *
 * Generates full scenes (slide/quiz/interactive/pbl with actions)
 * from scene outlines.
 */

import { nanoid } from 'nanoid';
import katex from 'katex';
import { MAX_VISION_IMAGES } from '@/lib/constants/generation';
import type {
  SceneOutline,
  GeneratedSlideContent,
  GeneratedQuizContent,
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  ScientificModel,
  PdfImage,
  ImageMapping,
} from '@/lib/types/generation';
import type { LanguageModel } from 'ai';
import type { StageStore } from '@/lib/api/stage-api';
import { createStageAPI } from '@/lib/api/stage-api';
import { generatePBLContent } from '@/lib/pbl/generate-pbl';
import { buildPrompt, PROMPT_IDS } from './prompts';
import { postProcessInteractiveHtml } from './interactive-post-processor';
import { getInteractiveTemplateGuidance } from './interactive-template-guidance';
import { renderInteractiveTemplate } from './interactive-template-renderer';
import {
  buildAngleRelationSlideContent,
  isAngleRelationSlideOutline,
} from './angle-relation-slide-template';
import {
  buildIntersectingLinesSlideContent,
  isIntersectingLinesSlideOutline,
} from './intersecting-lines-slide-template';
import { buildPyramidSlideContent, isPyramidSlideOutline } from './pyramid-slide-template';
import {
  buildReviewRecallFlowSlideContent,
  isReviewRecallFlowSlideOutline,
} from './review-recall-flow-slide-template';
import {
  applyPresentationThemeToSlideContent,
  buildPresentationThemePrompt,
  createSlideTheme,
} from '@/lib/theme/presentation-theme';
import {
  buildSlideLayoutVariantPrompt,
  resolveSlideLayoutVariant,
  type SlideLayoutVariantId,
} from './slide-layout-variants';
import {
  detectSceneContentVisualIntent,
  formatSceneContentGenerationConstraints,
  mergeSceneContentGenerationOptions,
  sanitizeSceneContentOutline,
  type SceneContentGenerationOptions,
} from './scene-content-policy';
import { parseActionsFromStructuredOutput } from './action-parser';
import { sanitizeGeneratedActions } from './action-sanitizer';
import { parseJsonResponse } from './json-repair';
import {
  buildCourseContext,
  formatAgentsForPrompt,
  formatTeacherPersonaForPrompt,
  formatImageDescription,
  formatImagePlaceholder,
} from './prompt-formatters';
import type { PPTElement, Slide, SlideBackground, SlideTheme } from '@/lib/types/slides';
import type { QuizQuestion } from '@/lib/types/stage';
import type { Action } from '@/lib/types/action';
import { getPresentationPalette, type ColorThemeId } from '@/lib/theme/color-themes';
import { DEFAULT_SPOTLIGHT_DIMNESS } from '@/lib/playback/spotlight-utils';
import {
  ensureCenteredParagraphText,
  hasCenteredTextAlign,
  hasExplicitTextAlign,
  hasVisibleTextBoxFill,
  shouldAutoCenterBoxText,
} from '@/lib/utils/text-box-alignment';
import { normalizeShapeViewBox } from '@/lib/utils/shape-view-box';
import { repairMathLatex } from '@/lib/utils/math-display-repair';
import {
  repairSlideElementLayout,
  repairSlideVisualQuality,
  repairTriadDiagramAlignment,
  detectCriticalSlideLayoutIssues,
  normalizeVisibleSlideLayout,
} from '@/lib/utils/slide-element-layout';
import { repairGeometryDiagramLayering } from '@/lib/utils/slide-element-order';
import { buildFallbackSlideContent } from './slide-content-fallback';
import {
  detectSlideLayoutQualityIssues,
  parseSlideLayoutModelReview,
  serializeSlideForLayoutReview,
  type SlideLayoutQualityIssue,
  type SlideLayoutModelReview,
} from './slide-layout-quality';
import type {
  AgentInfo,
  SceneGenerationContext,
  GeneratedSlideData,
  AICallFn,
  GenerationResult,
  GenerationCallbacks,
} from './pipeline-types';
import { createLogger } from '@/lib/logger';
import { DEFAULT_SCREEN_FONT_NAME, SCREEN_FONT_STACK } from '@/lib/constants/fonts';
const log = createLogger('Generation');

// ==================== Stage 2: Full Scenes (Two-Step) ====================

/**
 * Stage 3: Generate full scenes (parallel version)
 *
 * Two steps:
 * - Step 3.1: Outline -> Page content (slide/quiz)
 * - Step 3.2: Content + script -> Action list
 *
 * All scenes generated in parallel using Promise.all
 */
export async function generateFullScenes(
  sceneOutlines: SceneOutline[],
  store: StageStore,
  aiCall: AICallFn,
  callbacks?: GenerationCallbacks,
): Promise<GenerationResult<string[]>> {
  const api = createStageAPI(store);
  const totalScenes = sceneOutlines.length;
  let completedCount = 0;

  callbacks?.onProgress?.({
    currentStage: 3,
    overallProgress: 66,
    stageProgress: 0,
    statusMessage: `正在并行生成 ${totalScenes} 个场景...`,
    scenesGenerated: 0,
    totalScenes,
  });

  // Generate all scenes in parallel
  const results = await Promise.all(
    sceneOutlines.map(async (outline, index) => {
      try {
        const sceneId = await generateSingleScene(outline, api, aiCall);

        // Update progress (not atomic, but sufficient for UI display)
        completedCount++;
        callbacks?.onProgress?.({
          currentStage: 3,
          overallProgress: 66 + Math.floor((completedCount / totalScenes) * 34),
          stageProgress: Math.floor((completedCount / totalScenes) * 100),
          statusMessage: `已完成 ${completedCount}/${totalScenes} 个场景`,
          scenesGenerated: completedCount,
          totalScenes,
        });

        return { success: true, sceneId, index };
      } catch (error) {
        completedCount++;
        callbacks?.onError?.(`Failed to generate scene ${outline.title}: ${error}`);
        return { success: false, sceneId: null, index };
      }
    }),
  );

  // Collect successful sceneIds in original order
  const sceneIds = results
    .filter(
      (r): r is { success: true; sceneId: string; index: number } =>
        r.success && r.sceneId !== null,
    )
    .sort((a, b) => a.index - b.index)
    .map((r) => r.sceneId);

  return { success: true, data: sceneIds };
}

/**
 * Generate a single scene (two-step process)
 *
 * Step 3.1: Generate content
 * Step 3.2: Generate Actions
 */
async function generateSingleScene(
  outline: SceneOutline,
  api: ReturnType<typeof createStageAPI>,
  aiCall: AICallFn,
): Promise<string | null> {
  // Step 3.1: Generate content
  log.info(`Step 3.1: Generating content for: ${outline.title}`);
  const content = await generateSceneContent(outline, aiCall);
  if (!content) {
    log.error(`Failed to generate content for: ${outline.title}`);
    return null;
  }

  // Step 3.2: Generate Actions
  log.info(`Step 3.2: Generating actions for: ${outline.title}`);
  const actions = await generateSceneActions(outline, content, aiCall);
  log.info(`Generated ${actions.length} actions for: ${outline.title}`);

  // Create complete Scene
  return createSceneWithActions(outline, content, actions, api);
}

/**
 * Step 3.1: Generate content based on outline
 */
export async function generateSceneContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  languageModel?: LanguageModel,
  visionEnabled?: boolean,
  agents?: AgentInfo[],
  options?: SceneContentGenerationOptions,
): Promise<
  | GeneratedSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent
  | null
> {
  const inferredVisualIntent = detectSceneContentVisualIntent(outline);
  outline = sanitizeSceneContentOutline(outline);
  options = mergeSceneContentGenerationOptions(options, inferredVisualIntent);

  // If outline is interactive but missing interactiveConfig, fall back to slide
  if (outline.type === 'interactive' && !outline.interactiveConfig) {
    log.warn(
      `Interactive outline "${outline.title}" missing interactiveConfig, falling back to slide`,
    );
    const fallbackOutline = { ...outline, type: 'slide' as const };
    const content = await generateSlideContent(
      fallbackOutline,
      aiCall,
      assignedImages,
      imageMapping,
      visionEnabled,
      agents,
      options,
    );
    return content;
  }

  switch (outline.type) {
    case 'slide': {
      const content = await generateSlideContent(
        outline,
        aiCall,
        assignedImages,
        imageMapping,
        visionEnabled,
        agents,
        options,
      );
      return content;
    }
    case 'quiz':
      return generateQuizContent(outline, aiCall);
    case 'interactive': {
      const content = await generateInteractiveContent(outline, aiCall, outline.language);
      return content;
    }
    case 'pbl':
      return generatePBLSceneContent(outline, languageModel);
    default:
      return null;
  }
}

/**
 * Check if a string looks like an image ID (e.g., "img_1", "img_2")
 * rather than a base64 data URL or actual URL
 *
 * This function distinguishes between:
 * - Image IDs: "img_1", "img_2", etc. -> returns true
 * - Base64 data URLs: "data:image/..." -> returns false
 * - HTTP URLs: "http://...", "https://..." -> returns false
 * - Relative paths: "/images/..." -> returns false
 */
function isImageIdReference(value: string): boolean {
  if (!value) return false;
  // Exclude real URLs and paths
  if (value.startsWith('data:')) return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  if (value.startsWith('/')) return false; // Relative paths
  // Match image ID format: img_1, img_2, etc.
  return /^img_\d+$/i.test(value);
}

/** Check if a string is a removed AI-generated media placeholder ID. */
function isRemovedGeneratedMediaId(value: string): boolean {
  if (!value) return false;
  return /^gen_(img|vid)_[\w-]+$/i.test(value);
}

/**
 * Resolve image ID references in src field to actual base64 URLs
 *
 * AI generates: { type: "image", src: "img_1", ... }
 * This function replaces: { type: "image", src: "data:image/png;base64,...", ... }
 *
 * Design rationale (Plan B):
 * - Simpler: AI only needs to know one field (src)
 * - Consistent: Generated JSON structure matches final PPTImageElement
 * - Intuitive: src is the image source, first as ID then as actual URL
 * - Less prompt complexity: No need to explain imageId vs src distinction
 */
function resolveImageIds(
  elements: GeneratedSlideData['elements'],
  imageMapping?: ImageMapping,
): GeneratedSlideData['elements'] {
  return elements
    .map((el) => {
      if (el.type === 'image') {
        if (!('src' in el)) {
          log.warn(`Image element missing src, removing element`);
          return null; // Remove invalid image elements
        }
        const src = el.src as string;

        // If src is an image ID reference, replace with actual URL
        if (isImageIdReference(src)) {
          if (!imageMapping || !imageMapping[src]) {
            log.warn(`No mapping for image ID: ${src}, removing element`);
            return null; // Remove invalid image elements
          }
          log.debug(`Resolved image ID "${src}" to base64 URL`);
          return { ...el, src: imageMapping[src] };
        }

        if (isRemovedGeneratedMediaId(src)) {
          log.warn(`Generated image placeholder is no longer supported, removing: ${src}`);
          return null;
        }
      }

      if (el.type === 'video') {
        log.warn('Generated slide content included a video element; removing it');
        return null;
      }

      return el;
    })
    .filter((el): el is NonNullable<typeof el> => el !== null);
}

/**
 * Fix elements with missing required fields
 * Adds default values for fields that AI might not have generated correctly
 */
function fixElementDefaults(
  elements: GeneratedSlideData['elements'],
  assignedImages?: PdfImage[],
): GeneratedSlideData['elements'] {
  return elements.map((el) => {
    // Fix line elements
    if (el.type === 'line') {
      const lineEl = el as Record<string, unknown>;

      // Ensure points field exists with default values
      if (!lineEl.points || !Array.isArray(lineEl.points) || lineEl.points.length !== 2) {
        log.warn(`Line element missing points, adding defaults`);
        lineEl.points = ['', ''] as [string, string]; // Default: no markers on either end
      }

      // Ensure start/end exist
      if (!lineEl.start || !Array.isArray(lineEl.start)) {
        lineEl.start = [el.left ?? 0, el.top ?? 0];
      }
      if (!lineEl.end || !Array.isArray(lineEl.end)) {
        lineEl.end = [(el.left ?? 0) + (el.width ?? 100), (el.top ?? 0) + (el.height ?? 0)];
      }

      // Ensure style exists
      if (!lineEl.style) {
        lineEl.style = 'solid';
      }

      // Ensure color exists
      if (!lineEl.color) {
        lineEl.color = '#333333';
      }

      return lineEl as typeof el;
    }

    // Fix text elements
    if (el.type === 'text') {
      const textEl = el as Record<string, unknown>;

      if (!textEl.defaultFontName) {
        textEl.defaultFontName = DEFAULT_SCREEN_FONT_NAME;
      }
      if (!textEl.defaultColor) {
        textEl.defaultColor = '#333333';
      }
      if (!textEl.content) {
        textEl.content = '';
      }
      if (
        typeof textEl.content === 'string' &&
        hasVisibleTextBoxFill(textEl.fill) &&
        (!hasExplicitTextAlign(textEl.content) || hasCenteredTextAlign(textEl.content)) &&
        shouldAutoCenterBoxText({
          html: textEl.content,
          boxWidth: Number(el.width),
          boxHeight: Number(el.height),
        })
      ) {
        textEl.content = ensureCenteredParagraphText(textEl.content);
      }

      return textEl as typeof el;
    }

    // Fix image elements
    if (el.type === 'image') {
      const imageEl = el as Record<string, unknown>;

      if (imageEl.fixedRatio === undefined) {
        imageEl.fixedRatio = true;
      }

      // Correct dimensions using known aspect ratio (src is still img_id at this point)
      if (assignedImages && typeof imageEl.src === 'string') {
        const imgMeta = assignedImages.find((img) => img.id === imageEl.src);
        if (imgMeta?.width && imgMeta?.height) {
          const knownRatio = imgMeta.width / imgMeta.height;
          const curW = (el.width || 400) as number;
          const curH = (el.height || 300) as number;
          if (Math.abs(curW / curH - knownRatio) / knownRatio > 0.1) {
            // Keep width, correct height
            const newH = Math.round(curW / knownRatio);
            if (newH > 462) {
              // canvas 562.5 - margins 50x2
              const newW = Math.round(462 * knownRatio);
              imageEl.width = newW;
              imageEl.height = 462;
            } else {
              imageEl.height = newH;
            }
          }
        }
      }

      return imageEl as typeof el;
    }

    // Fix shape elements
    if (el.type === 'shape') {
      const shapeEl = el as Record<string, unknown>;

      shapeEl.viewBox = normalizeShapeViewBox(
        shapeEl.viewBox,
        Number(el.width ?? 100),
        Number(el.height ?? 100),
      );
      if (!shapeEl.path) {
        // Default to rectangle
        const w = el.width ?? 100;
        const h = el.height ?? 100;
        shapeEl.path = `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
      }
      if (!shapeEl.fill) {
        shapeEl.fill = '#5b9bd5';
      }
      if (shapeEl.fixedRatio === undefined) {
        shapeEl.fixedRatio = false;
      }
      if (shapeEl.text && typeof shapeEl.text === 'object') {
        const shapeText = shapeEl.text as Record<string, unknown>;
        if (!shapeText.defaultFontName) {
          shapeText.defaultFontName = DEFAULT_SCREEN_FONT_NAME;
        }
        if (!shapeText.defaultColor) {
          shapeText.defaultColor = '#333333';
        }
        if (!shapeText.align) {
          shapeText.align = 'middle';
        }
        if (typeof shapeText.content === 'string') {
          const canAutoCenterText =
            !hasExplicitTextAlign(shapeText.content) || hasCenteredTextAlign(shapeText.content);
          if (
            canAutoCenterText &&
            shouldAutoCenterBoxText({
              html: shapeText.content,
              boxWidth: Number(el.width),
              boxHeight: Number(el.height),
            })
          ) {
            shapeText.align = 'middle';
            shapeText.content = ensureCenteredParagraphText(shapeText.content);
          }
        } else {
          shapeText.content = '';
        }
      }

      return shapeEl as typeof el;
    }

    return el;
  });
}

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 562.5;
const CANVAS_SAFE_MARGIN = 12;
const TEXT_PADDING_X = 20;
const TEXT_PADDING_Y = 20;

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlToText(html: string): string {
  return decodeBasicHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractTextParagraphs(html: string): Array<{ html: string; text: string }> {
  const paragraphMatches = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi));
  const rawParagraphs =
    paragraphMatches.length > 0 ? paragraphMatches.map((match) => match[0]) : [html];

  return rawParagraphs
    .map((paragraphHtml) => ({
      html: paragraphHtml,
      text: stripHtmlToText(paragraphHtml),
    }))
    .filter((paragraph) => paragraph.text.length > 0);
}

function getLargestFontSize(html: string, fallback = 18): number {
  const sizes = Array.from(html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi))
    .map((match) => Number.parseFloat(match[1]))
    .filter((size) => Number.isFinite(size) && size > 0);

  return sizes.length > 0 ? Math.max(...sizes) : fallback;
}

function getTextVisualUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) {
      units += 1;
    } else if (/[a-zA-Z0-9]/.test(char)) {
      units += 0.58;
    } else if (/\s/.test(char)) {
      units += 0.3;
    } else {
      units += 0.7;
    }
  }
  return units;
}

function estimateTextElementHeight(el: GeneratedSlideData['elements'][number]): number | null {
  if (el.type !== 'text' || typeof el.content !== 'string') return null;

  const contentHtml = el.content;
  const width = Number(el.width);
  if (!Number.isFinite(width) || width <= TEXT_PADDING_X) return null;

  const paragraphs = extractTextParagraphs(contentHtml);
  if (paragraphs.length === 0) return TEXT_PADDING_Y;

  const lineHeightRatio =
    typeof el.lineHeight === 'number' && Number.isFinite(el.lineHeight) && el.lineHeight > 0
      ? el.lineHeight
      : 1.5;
  const paragraphSpace =
    typeof el.paragraphSpace === 'number' && Number.isFinite(el.paragraphSpace)
      ? el.paragraphSpace
      : 5;

  const contentHeight = paragraphs.reduce((total, paragraph) => {
    const fontSize = getLargestFontSize(paragraph.html, getLargestFontSize(contentHtml, 18));
    const charsPerLine = Math.max(1, (width - TEXT_PADDING_X) / fontSize);
    const lines = Math.max(1, Math.ceil(getTextVisualUnits(paragraph.text) / charsPerLine));
    return total + lines * fontSize * lineHeightRatio;
  }, 0);

  return Math.ceil(
    contentHeight + TEXT_PADDING_Y + Math.max(0, paragraphs.length - 1) * paragraphSpace,
  );
}

function clampElementToCanvas(el: GeneratedSlideData['elements'][number]) {
  if (Number.isFinite(el.width)) {
    el.width = Math.min(Math.max(1, Number(el.width)), CANVAS_WIDTH - CANVAS_SAFE_MARGIN);
  }
  if (Number.isFinite(el.height)) {
    el.height = Math.min(Math.max(1, Number(el.height)), CANVAS_HEIGHT - CANVAS_SAFE_MARGIN);
  }
  if (Number.isFinite(el.left)) {
    el.left = Math.min(
      Math.max(CANVAS_SAFE_MARGIN, Number(el.left)),
      Math.max(CANVAS_SAFE_MARGIN, CANVAS_WIDTH - CANVAS_SAFE_MARGIN - Number(el.width || 0)),
    );
  }
  if (Number.isFinite(el.top)) {
    el.top = Math.min(
      Math.max(CANVAS_SAFE_MARGIN, Number(el.top)),
      Math.max(CANVAS_SAFE_MARGIN, CANVAS_HEIGHT - CANVAS_SAFE_MARGIN - Number(el.height || 0)),
    );
  }
}

function findContainingShape(
  textEl: GeneratedSlideData['elements'][number],
  elements: GeneratedSlideData['elements'],
) {
  const textLeft = Number(textEl.left);
  const textTop = Number(textEl.top);
  const textRight = textLeft + Number(textEl.width);
  const textBottom = textTop + Number(textEl.height);

  return elements
    .filter((el) => {
      if (el.type !== 'shape') return false;
      const left = Number(el.left);
      const top = Number(el.top);
      const right = left + Number(el.width);
      const bottom = top + Number(el.height);
      if (Number(el.height) < 24 || Number(el.width) < 24) return false;

      return (
        textLeft >= left - 8 &&
        textTop >= top - 8 &&
        textRight <= right + 8 &&
        textBottom >= top &&
        textTop <= bottom + 8
      );
    })
    .sort((a, b) => Number(a.width) * Number(a.height) - Number(b.width) * Number(b.height))[0];
}

function isAutoCenterableOverlayText(
  textEl: GeneratedSlideData['elements'][number],
  containingShape: GeneratedSlideData['elements'][number],
): boolean {
  if (textEl.type !== 'text' || typeof textEl.content !== 'string') return false;
  if (hasExplicitTextAlign(textEl.content) && !hasCenteredTextAlign(textEl.content)) return false;

  return shouldAutoCenterBoxText({
    html: textEl.content,
    boxWidth: Number(containingShape.width),
    boxHeight: Number(containingShape.height),
    textWidth: Number(textEl.width),
  });
}

function shrinkOverlayTextToContentHeight(textEl: GeneratedSlideData['elements'][number]): void {
  const estimatedHeight = estimateTextElementHeight(textEl);
  if (estimatedHeight === null) return;

  const currentHeight = Number(textEl.height);
  if (!Number.isFinite(currentHeight) || estimatedHeight >= currentHeight) return;

  textEl.height = Math.max(24, estimatedHeight);
}

function repairGeneratedTextLayout(
  elements: GeneratedSlideData['elements'],
): GeneratedSlideData['elements'] {
  const repaired = elements.map((el) => ({ ...el }));

  for (const el of repaired) {
    clampElementToCanvas(el);

    const estimatedHeight = estimateTextElementHeight(el);
    if (estimatedHeight === null) continue;

    const currentHeight = Number(el.height);
    const requiredHeight = Math.max(currentHeight, estimatedHeight);
    const maxHeightAtCurrentTop = CANVAS_HEIGHT - CANVAS_SAFE_MARGIN - Number(el.top);

    if (requiredHeight > currentHeight) {
      if (requiredHeight <= maxHeightAtCurrentTop) {
        el.height = requiredHeight;
      } else {
        el.height = Math.min(requiredHeight, CANVAS_HEIGHT - CANVAS_SAFE_MARGIN * 2);
        el.top = Math.max(
          CANVAS_SAFE_MARGIN,
          CANVAS_HEIGHT - CANVAS_SAFE_MARGIN - Number(el.height),
        );
      }
    }
  }

  for (const el of repaired) {
    if (el.type !== 'text') continue;
    const containingShape = findContainingShape(el, repaired);
    if (!containingShape) continue;

    if (isAutoCenterableOverlayText(el, containingShape)) {
      const content = typeof el.content === 'string' ? el.content : '';
      shrinkOverlayTextToContentHeight(el);
      el.left =
        Number(containingShape.left) + (Number(containingShape.width) - Number(el.width)) / 2;
      el.top =
        Number(containingShape.top) + (Number(containingShape.height) - Number(el.height)) / 2;
      el.content = ensureCenteredParagraphText(content);
      clampElementToCanvas(el);
      continue;
    }

    const requiredShapeHeight =
      Number(el.top) - Number(containingShape.top) + Number(el.height) + 16;
    if (requiredShapeHeight > Number(containingShape.height)) {
      containingShape.height = Math.min(
        requiredShapeHeight,
        CANVAS_HEIGHT - CANVAS_SAFE_MARGIN - Number(containingShape.top),
      );
    }

    if (isAutoCenterableOverlayText(el, containingShape)) {
      const content = typeof el.content === 'string' ? el.content : '';
      shrinkOverlayTextToContentHeight(el);
      el.left =
        Number(containingShape.left) + (Number(containingShape.width) - Number(el.width)) / 2;
      el.top =
        Number(containingShape.top) + (Number(containingShape.height) - Number(el.height)) / 2;
      el.content = ensureCenteredParagraphText(content);
      clampElementToCanvas(el);
    }
  }

  return repaired;
}

/**
 * Process LaTeX elements: render latex string to HTML using KaTeX.
 * Fills in html and fixedRatio fields.
 * Elements that fail conversion are removed.
 */
function processLatexElements(
  elements: GeneratedSlideData['elements'],
): GeneratedSlideData['elements'] {
  return elements
    .map((el) => {
      if (el.type !== 'latex') return el;

      const rawLatexStr = el.latex as string | undefined;
      if (!rawLatexStr) {
        log.warn('Latex element missing latex string, removing');
        return null;
      }
      const latexStr = repairMathLatex(rawLatexStr);

      try {
        const html = katex.renderToString(latexStr, {
          throwOnError: false,
          displayMode: true,
          output: 'html',
        });

        return {
          ...el,
          latex: latexStr,
          html,
          fixedRatio: true,
        };
      } catch (err) {
        log.warn(`Failed to render latex "${latexStr}":`, err);
        return null;
      }
    })
    .filter((el): el is NonNullable<typeof el> => el !== null);
}

function buildSlideBackground(
  backgroundData: GeneratedSlideData['background'],
): SlideBackground | undefined {
  if (!backgroundData) return undefined;

  if (backgroundData.type === 'solid' && backgroundData.color) {
    return { type: 'solid', color: backgroundData.color };
  }

  if (backgroundData.type === 'gradient' && backgroundData.gradient) {
    return {
      type: 'gradient',
      gradient: backgroundData.gradient,
    };
  }

  return undefined;
}

export function finalizeGeneratedSlideContent(
  generatedData: GeneratedSlideData,
  outline: SceneOutline,
  assignedImages: PdfImage[] | undefined,
  imageMapping: ImageMapping | undefined,
  visualTheme: SceneContentGenerationOptions['visualTheme'] | undefined,
  layoutVariant: SlideLayoutVariantId | undefined,
  slideLayoutReviewEnabled = false,
): GeneratedSlideContent | null {
  if (!generatedData.elements || !Array.isArray(generatedData.elements)) {
    return null;
  }

  log.debug(`Got ${generatedData.elements.length} elements for: ${outline.title}`);

  const imageElements = generatedData.elements.filter((el) => el.type === 'image');
  if (imageElements.length > 0) {
    log.debug(
      `Image elements before resolution:`,
      imageElements.map((el) => ({
        type: el.type,
        src:
          (el as Record<string, unknown>).src &&
          String((el as Record<string, unknown>).src).substring(0, 50),
      })),
    );
    log.debug(`imageMapping keys:`, imageMapping ? Object.keys(imageMapping).length : '0 keys');
  }

  if (!slideLayoutReviewEnabled) {
    log.info(`Using raw AI slide layout for "${outline.title}"`);

    const latexProcessedElements = processLatexElements(generatedData.elements);
    const resolvedElements = resolveImageIds(latexProcessedElements, imageMapping);
    const processedElements = resolvedElements.map((element) => ({
      ...element,
      id: `${element.type}_${nanoid(8)}`,
    })) as PPTElement[];

    return applyPresentationThemeToSlideContent(
      {
        elements: processedElements,
        background: buildSlideBackground(generatedData.background),
        remark: generatedData.remark || outline.description,
      },
      visualTheme,
    );
  }

  const prepared = prepareReviewedSlideContent(
    generatedData,
    outline,
    assignedImages,
    imageMapping,
    visualTheme,
  );
  if (prepared.content && prepared.issues.length === 0) return prepared.content;

  log.warn(
    `Rejected slide layout for "${outline.title}", using fallback template: ${prepared.issues
      .map((issue) => issue.code)
      .join(', ')}`,
  );
  return buildFallbackSlideContent(
    outline,
    assignedImages,
    imageMapping,
    visualTheme,
    layoutVariant,
  );
}

interface PreparedReviewedSlide {
  content: GeneratedSlideContent | null;
  issues: SlideLayoutQualityIssue[];
}

function prepareReviewedSlideContent(
  generatedData: GeneratedSlideData,
  outline: SceneOutline,
  assignedImages: PdfImage[] | undefined,
  imageMapping: ImageMapping | undefined,
  visualTheme: SceneContentGenerationOptions['visualTheme'] | undefined,
): PreparedReviewedSlide {
  if (!generatedData.elements || !Array.isArray(generatedData.elements)) {
    return {
      content: null,
      issues: [
        {
          code: 'invalid-slide-elements',
          severity: 'critical',
          elementIndexes: [],
          message: 'Slide elements are missing or invalid',
        },
      ],
    };
  }

  const fixedElements = fixElementDefaults(generatedData.elements, assignedImages);
  log.debug(`After element fixing: ${fixedElements.length} elements`);

  const layoutRepairedElements = repairGeneratedTextLayout(fixedElements);
  log.debug(`After text layout repair: ${layoutRepairedElements.length} elements`);

  const preRepairRejectedIssues = detectCriticalSlideLayoutIssues(layoutRepairedElements).filter(
    (issue) => issue.type === 'legacy-task-grid-layout',
  );
  if (preRepairRejectedIssues.length > 0) {
    return {
      content: null,
      issues: preRepairRejectedIssues.map((issue) => ({
        code: issue.type,
        severity: 'critical',
        elementIndexes: [...issue.elementIndexes],
        message: issue.message,
      })),
    };
  }

  const slideLayoutRepairedElements = repairSlideElementLayout(layoutRepairedElements);
  log.debug(`After slide layout repair: ${slideLayoutRepairedElements.length} elements`);

  const latexProcessedElements = processLatexElements(slideLayoutRepairedElements);
  log.debug(`After LaTeX processing: ${latexProcessedElements.length} elements`);

  const layeringRepairedElements = repairGeometryDiagramLayering(latexProcessedElements);
  log.debug(`After diagram layering repair: ${layeringRepairedElements.length} elements`);

  const triadRepairedElements = repairTriadDiagramAlignment(layeringRepairedElements);
  log.debug(`After triad diagram alignment repair: ${triadRepairedElements.length} elements`);

  const resolvedElements = resolveImageIds(triadRepairedElements, imageMapping);
  log.debug(`After image resolution: ${resolvedElements.length} elements`);

  const criticalLayoutIssues = detectCriticalSlideLayoutIssues(resolvedElements);
  if (criticalLayoutIssues.length > 0) {
    return {
      content: null,
      issues: criticalLayoutIssues.map((issue) => ({
        code: issue.type,
        severity: 'critical',
        elementIndexes: [...issue.elementIndexes],
        message: issue.message,
      })),
    };
  }

  const processedElements: PPTElement[] = resolvedElements.map((el) => ({
    ...el,
    id: `${el.type}_${nanoid(8)}`,
    rotate: 0,
  })) as PPTElement[];

  const themedContent = applyPresentationThemeToSlideContent(
    {
      elements: processedElements,
      background: buildSlideBackground(generatedData.background),
      remark: generatedData.remark || outline.description,
    },
    visualTheme,
  );
  const palette = getPresentationPalette(visualTheme);
  const visuallyRepairedElements = repairSlideVisualQuality(themedContent.elements, {
    bodyPanelFill: palette.surfaceAlt,
  });
  const normalizedVisibleElements = normalizeVisibleSlideLayout(visuallyRepairedElements);
  const postThemeCriticalLayoutIssues = detectCriticalSlideLayoutIssues(
    normalizedVisibleElements,
  ).map((issue) => ({
    code: issue.type,
    severity: 'critical' as const,
    elementIndexes: [...issue.elementIndexes],
    message: issue.message,
  }));
  const qualityIssues = detectSlideLayoutQualityIssues(outline, normalizedVisibleElements);
  const issues = [...postThemeCriticalLayoutIssues, ...qualityIssues];

  return {
    content: {
      ...themedContent,
      elements: normalizedVisibleElements,
    },
    issues,
  };
}

function buildLayoutReviewPrompts(
  outline: SceneOutline,
  layoutVariant: SlideLayoutVariantId,
  content: GeneratedSlideContent,
  ruleIssues: SlideLayoutQualityIssue[],
): { system: string; user: string } {
  return {
    system:
      'You are a strict presentation layout reviewer. Evaluate only layout quality and readability. Return one JSON object with approved, summary, and issues. Each issue must contain code, severity (warning or critical), elementIndexes, and message. Reject missing titles, sparse instructional content, poor hierarchy, unbalanced composition, oversized foreground shapes, detached decoration, obscured connectors, and inconsistent alignment. Do not return markdown.',
    user: JSON.stringify({
      task: 'Review this 1000x562.5 classroom slide layout.',
      intendedTitle: outline.title,
      description: outline.description,
      keyPoints: outline.keyPoints,
      layoutVariant,
      ruleIssues,
      elements: JSON.parse(serializeSlideForLayoutReview(content.elements)),
      responseSchema: {
        approved: true,
        summary: 'short conclusion',
        issues: [
          {
            code: 'layout-problem-code',
            severity: 'critical',
            elementIndexes: [0],
            message: 'specific visible problem',
          },
        ],
      },
    }),
  };
}

const LAYOUT_REVIEW_TIMEOUT_MS = 45_000;

async function withLayoutReviewTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${operation} timed out after ${LAYOUT_REVIEW_TIMEOUT_MS}ms`)),
      LAYOUT_REVIEW_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function reviewSlideLayoutWithModel(
  outline: SceneOutline,
  layoutVariant: SlideLayoutVariantId,
  content: GeneratedSlideContent,
  ruleIssues: SlideLayoutQualityIssue[],
  aiCall: AICallFn,
): Promise<SlideLayoutModelReview | null> {
  const prompts = buildLayoutReviewPrompts(outline, layoutVariant, content, ruleIssues);
  try {
    const response = await withLayoutReviewTimeout(
      aiCall(prompts.system, prompts.user),
      'layout model review',
    );
    return parseSlideLayoutModelReview(parseJsonResponse<unknown>(response));
  } catch (error) {
    log.warn(
      `Layout model review failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function requestCorrectedSlideLayout(
  generatedData: GeneratedSlideData,
  outline: SceneOutline,
  layoutVariant: SlideLayoutVariantId,
  issues: SlideLayoutQualityIssue[],
  aiCall: AICallFn,
): Promise<GeneratedSlideData | null> {
  const system =
    'You repair classroom slide layouts. Return only one complete valid slide JSON object with background, elements, and optional remark. Preserve the teaching meaning and visible wording. You may change coordinates, dimensions, grouping, connector geometry, and restrained decoration. Canvas is 1000x562.5. Ensure a clear title, readable hierarchy, balanced spacing, no overlap, no clipping, and no obscured connectors. Do not return markdown.';
  const user = JSON.stringify({
    task: 'Repair this slide once using the reported issues.',
    intendedTitle: outline.title,
    description: outline.description,
    keyPoints: outline.keyPoints,
    layoutVariant,
    issues,
    originalSlide: generatedData,
  });

  try {
    const response = await withLayoutReviewTimeout(aiCall(system, user), 'layout correction');
    const corrected = parseJsonResponse<GeneratedSlideData>(response);
    return isUsableSlideData(corrected) ? corrected : null;
  } catch (error) {
    log.warn(
      `Layout correction failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function finalizeReviewedGeneratedSlideContent(
  generatedData: GeneratedSlideData,
  outline: SceneOutline,
  assignedImages: PdfImage[] | undefined,
  imageMapping: ImageMapping | undefined,
  visualTheme: SceneContentGenerationOptions['visualTheme'] | undefined,
  layoutVariant: SlideLayoutVariantId,
  aiCall: AICallFn,
): Promise<GeneratedSlideContent> {
  let candidateData = generatedData;
  let corrected = false;

  for (;;) {
    const prepared = prepareReviewedSlideContent(
      candidateData,
      outline,
      assignedImages,
      imageMapping,
      visualTheme,
    );
    const criticalRuleIssues = prepared.issues.filter((issue) => issue.severity === 'critical');

    if (!prepared.content || criticalRuleIssues.length > 0) {
      log.warn(
        `Layout rules rejected "${outline.title}": ${
          criticalRuleIssues.map((issue) => issue.code).join(', ') || 'invalid-candidate'
        }`,
      );
      if (!corrected) {
        const correction = await requestCorrectedSlideLayout(
          candidateData,
          outline,
          layoutVariant,
          prepared.issues,
          aiCall,
        );
        if (correction) {
          candidateData = correction;
          corrected = true;
          continue;
        }
      }
      break;
    }

    const review = await reviewSlideLayoutWithModel(
      outline,
      layoutVariant,
      prepared.content,
      prepared.issues,
      aiCall,
    );
    if (review?.approved) {
      log.info(`Layout review approved "${outline.title}"${corrected ? ' after correction' : ''}`);
      return prepared.content;
    }

    const reviewIssues = review?.issues.length
      ? review.issues
      : [
          {
            code: 'layout-review-unavailable',
            severity: 'critical' as const,
            elementIndexes: [],
            message: 'The model layout review did not return a valid approval result',
          },
        ];
    log.warn(
      `Layout model review rejected "${outline.title}": ${reviewIssues
        .map((issue) => issue.code)
        .join(', ')}`,
    );
    if (!corrected) {
      const correction = await requestCorrectedSlideLayout(
        candidateData,
        outline,
        layoutVariant,
        [...prepared.issues, ...reviewIssues],
        aiCall,
      );
      if (correction) {
        candidateData = correction;
        corrected = true;
        continue;
      }
    }
    break;
  }

  log.warn(`Using deterministic fallback after layout review failure: "${outline.title}"`);
  return buildFallbackSlideContent(
    outline,
    assignedImages,
    imageMapping,
    visualTheme,
    layoutVariant,
  );
}

function isUsableSlideData(value: unknown): value is GeneratedSlideData {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as Partial<GeneratedSlideData>).elements)
  );
}

function truncateForPrompt(value: string, maxLength = 2000): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function buildStrictSlideJsonRetryPrompt(
  outline: SceneOutline,
  assignedImagesText: string,
  failureReason: string,
  previousResponse?: string,
  generationConstraints?: string,
  visualThemePrompt?: string,
  layoutVariantPrompt?: string,
): { system: string; user: string } {
  const keyPoints = (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  const previousResponseText = previousResponse
    ? `\nPrevious invalid response:\n${truncateForPrompt(previousResponse)}\n`
    : '';
  const generationConstraintsText = generationConstraints
    ? `\n生成约束 / Generation Constraints:\n${generationConstraints}\n`
    : '';
  const visualThemeText = visualThemePrompt
    ? `\n视觉主题 / Visual Theme:\n${visualThemePrompt}\n`
    : '';
  const layoutVariantText = layoutVariantPrompt
    ? `\n版式方案 / Layout Variant:\n${layoutVariantPrompt}\n`
    : '';

  return {
    system:
      'You generate strict JSON for a classroom slide. Return only one valid JSON object. Do not use Markdown fences, comments, prose, or trailing commas.',
    user: `The previous slide-content generation failed because: ${failureReason}

Regenerate the slide content as valid JSON only.

Required JSON shape:
{
  "background": { "type": "solid", "color": "#ffffff" },
  "elements": [
    {
      "type": "text",
      "left": 60,
      "top": 60,
      "width": 880,
      "height": 52,
      "content": "<p style=\\"font-size: 28px; font-weight: 700;\\">Title</p>",
      "defaultFontName": "Helvetica Now Display",
      "defaultColor": "#111827"
    }
  ],
  "remark": "Brief teacher note"
}

Allowed element types for this retry: text, shape, image, line, latex, chart, table.
Every element must include type, left, top, width, and height.
Use concise visible text. Do not include video elements.
If there are no usable images, do not include image elements.

Outline:
Title: ${outline.title}
Description: ${outline.description || ''}
Key points:
${keyPoints || '-'}
${generationConstraintsText}
${visualThemeText}
${layoutVariantText}

Assigned images:
${assignedImagesText}
${previousResponseText}`,
  };
}

async function retrySlideContentAsStrictJson(
  outline: SceneOutline,
  aiCall: AICallFn,
  assignedImagesText: string,
  visionImages: Array<{ id: string; src: string }> | undefined,
  failureReason: string,
  previousResponse?: string,
  generationConstraints?: string,
  visualThemePrompt?: string,
  layoutVariantPrompt?: string,
): Promise<string | null> {
  const retryPrompt = buildStrictSlideJsonRetryPrompt(
    outline,
    assignedImagesText,
    failureReason,
    previousResponse,
    generationConstraints,
    visualThemePrompt,
    layoutVariantPrompt,
  );

  try {
    return await aiCall(retryPrompt.system, retryPrompt.user, visionImages);
  } catch (error) {
    log.warn(
      `Slide content strict JSON retry failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Generate slide content
 */
async function generateSlideContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  visionEnabled?: boolean,
  agents?: AgentInfo[],
  options?: SceneContentGenerationOptions,
): Promise<GeneratedSlideContent | null> {
  {
    const visualTheme = options?.visualTheme;
    if (isPyramidSlideOutline(outline, options?.visualIntent)) {
      log.info(`Using deterministic pyramid slide template for: ${outline.title}`);
      return applyPresentationThemeToSlideContent(buildPyramidSlideContent(outline), visualTheme);
    }

    if (isIntersectingLinesSlideOutline(outline)) {
      log.info(`Using deterministic intersecting-lines slide template for: ${outline.title}`);
      return applyPresentationThemeToSlideContent(
        buildIntersectingLinesSlideContent(outline),
        visualTheme,
      );
    }

    if (isAngleRelationSlideOutline(outline)) {
      log.info(`Using deterministic angle-relation slide template for: ${outline.title}`);
      return applyPresentationThemeToSlideContent(
        buildAngleRelationSlideContent(outline),
        visualTheme,
      );
    }

    if (isReviewRecallFlowSlideOutline(outline)) {
      log.info(`Using deterministic review-recall-flow slide template for: ${outline.title}`);
      return applyPresentationThemeToSlideContent(
        buildReviewRecallFlowSlideContent(outline),
        visualTheme,
      );
    }

    const lang = outline.language || 'zh-CN';
    let assignedImagesText = '无可用图片，禁止插入任何 image 元素';
    let visionImages: Array<{ id: string; src: string }> | undefined;

    if (assignedImages && assignedImages.length > 0) {
      if (visionEnabled && imageMapping) {
        const withSrc = assignedImages.filter((img) => imageMapping[img.id]);
        const visionSlice = withSrc.slice(0, MAX_VISION_IMAGES);
        const textOnlySlice = withSrc.slice(MAX_VISION_IMAGES);
        const noSrcImages = assignedImages.filter((img) => !imageMapping[img.id]);

        const visionDescriptions = visionSlice.map((img) => formatImagePlaceholder(img, lang));
        const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
          formatImageDescription(img, lang),
        );
        assignedImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

        visionImages = visionSlice.map((img) => ({
          id: img.id,
          src: imageMapping[img.id],
          width: img.width,
          height: img.height,
        }));
      } else {
        assignedImagesText = assignedImages
          .map((img) => formatImageDescription(img, lang))
          .join('\n');
      }
    }

    const teacherContext = formatTeacherPersonaForPrompt(agents);
    const generationConstraints = formatSceneContentGenerationConstraints(
      options?.generationConstraints,
      lang,
    );
    const visualThemePrompt = buildPresentationThemePrompt(visualTheme, lang);
    const layoutVariant = resolveSlideLayoutVariant(
      options?.layoutVariant,
      outline,
      assignedImages,
      imageMapping,
    );
    const layoutVariantPrompt = buildSlideLayoutVariantPrompt(layoutVariant, lang);
    const basePromptVariables = {
      title: outline.title,
      description: outline.description,
      keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      generationConstraints,
      visualTheme: visualThemePrompt,
      layoutVariant: layoutVariantPrompt,
      elements: '（根据要点自动生成）',
      assignedImages: assignedImagesText,
      canvas_width: 1000,
      canvas_height: 562.5,
      teacherContext,
    };

    log.debug(`Generating slide content for: ${outline.title}`);
    if (assignedImages && assignedImages.length > 0) {
      log.debug(`Assigned images: ${assignedImages.map((img) => img.id).join(', ')}`);
    }
    if (visionImages && visionImages.length > 0) {
      log.debug(`Vision images: ${visionImages.map((img) => img.id).join(', ')}`);
    }

    const prompts = buildPrompt(PROMPT_IDS.SLIDE_CONTENT, basePromptVariables);
    if (!prompts) {
      return null;
    }

    let response = '';
    try {
      response = await aiCall(prompts.system, prompts.user, visionImages);
    } catch (error) {
      log.warn(
        `Slide content AI call failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
      );
      const retryResponse = await retrySlideContentAsStrictJson(
        outline,
        aiCall,
        assignedImagesText,
        visionImages,
        error instanceof Error ? error.message : String(error),
        undefined,
        generationConstraints,
        visualThemePrompt,
        layoutVariantPrompt,
      );
      if (!retryResponse) return null;
      response = retryResponse;
    }

    if (!response.trim()) {
      log.warn(`Slide content model returned an empty response for "${outline.title}"`);
      const retryResponse = await retrySlideContentAsStrictJson(
        outline,
        aiCall,
        assignedImagesText,
        visionImages,
        'empty response',
        undefined,
        generationConstraints,
        visualThemePrompt,
        layoutVariantPrompt,
      );
      if (!retryResponse) return null;
      response = retryResponse;
    }

    let generatedData = parseJsonResponse<GeneratedSlideData>(response);
    if (!isUsableSlideData(generatedData)) {
      log.warn(`Slide content model returned invalid slide JSON for "${outline.title}"`);
      const retryResponse = await retrySlideContentAsStrictJson(
        outline,
        aiCall,
        assignedImagesText,
        visionImages,
        'invalid JSON response',
        response,
        generationConstraints,
        visualThemePrompt,
        layoutVariantPrompt,
      );
      if (!retryResponse) return null;
      generatedData = parseJsonResponse<GeneratedSlideData>(retryResponse);
      if (!isUsableSlideData(generatedData)) {
        log.warn(
          `Slide content strict JSON retry returned invalid slide JSON for "${outline.title}"`,
        );
        return null;
      }
    }

    if (options?.slideLayoutReviewEnabled) {
      return await finalizeReviewedGeneratedSlideContent(
        generatedData,
        outline,
        assignedImages,
        imageMapping,
        visualTheme,
        layoutVariant,
        aiCall,
      );
    }

    return finalizeGeneratedSlideContent(
      generatedData,
      outline,
      assignedImages,
      imageMapping,
      visualTheme,
      layoutVariant,
      false,
    );
  }
}

/**
 * Generate quiz content
 */
async function generateQuizContent(
  outline: SceneOutline,
  aiCall: AICallFn,
): Promise<GeneratedQuizContent | null> {
  const quizConfig = outline.quizConfig || {
    questionCount: 3,
    difficulty: 'medium',
    questionTypes: ['single'],
  };

  const prompts = buildPrompt(PROMPT_IDS.QUIZ_CONTENT, {
    title: outline.title,
    description: outline.description,
    keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
    questionCount: quizConfig.questionCount,
    difficulty: quizConfig.difficulty,
    questionTypes: quizConfig.questionTypes.join(', '),
  });

  if (!prompts) {
    return buildFallbackQuizContent(outline);
  }

  log.debug(`Generating quiz content for: ${outline.title}`);
  let response = '';
  try {
    response = await aiCall(prompts.system, prompts.user);
  } catch (error) {
    log.warn(
      `Quiz content AI call failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    const retryResponse = await retryQuizContentAsStrictJson(
      outline,
      quizConfig,
      aiCall,
      error instanceof Error ? error.message : String(error),
    );
    if (!retryResponse) return buildFallbackQuizContent(outline);
    response = retryResponse;
  }

  let generatedQuestions = parseJsonResponse<QuizQuestion[]>(response);

  if (!isUsableQuizQuestions(generatedQuestions)) {
    log.warn(`Quiz content model returned invalid JSON for "${outline.title}"`);
    const retryResponse = await retryQuizContentAsStrictJson(
      outline,
      quizConfig,
      aiCall,
      'invalid JSON response',
      response,
    );
    if (retryResponse) {
      generatedQuestions = parseJsonResponse<QuizQuestion[]>(retryResponse);
    }
    if (!isUsableQuizQuestions(generatedQuestions)) {
      log.warn(`Using fallback quiz content for "${outline.title}"`);
      return buildFallbackQuizContent(outline);
    }
  }

  log.debug(`Got ${generatedQuestions.length} questions for: ${outline.title}`);

  // Ensure each question has an ID and normalize options format
  const questions: QuizQuestion[] = generatedQuestions.map((q) => {
    const isText = q.type === 'short_answer';
    return {
      ...q,
      id: q.id || `q_${nanoid(8)}`,
      options: isText ? undefined : normalizeQuizOptions(q.options),
      answer: isText ? undefined : normalizeQuizAnswer(q as unknown as Record<string, unknown>),
      hasAnswer: isText ? false : true,
    };
  });

  return { questions };
}

function isUsableQuizQuestions(value: unknown): value is QuizQuestion[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (question) =>
        question &&
        typeof question === 'object' &&
        typeof (question as Partial<QuizQuestion>).question === 'string' &&
        ((question as Partial<QuizQuestion>).type === 'short_answer' ||
          Array.isArray((question as Partial<QuizQuestion>).options)),
    )
  );
}

function buildStrictQuizJsonRetryPrompt(
  outline: SceneOutline,
  quizConfig: NonNullable<SceneOutline['quizConfig']>,
  failureReason: string,
  previousResponse?: string,
): { system: string; user: string } {
  const keyPoints = (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  const previousResponseText = previousResponse
    ? `\nPrevious invalid response:\n${truncateForPrompt(previousResponse)}\n`
    : '';

  return {
    system:
      'You generate strict JSON for classroom quiz content. Return only one valid JSON array. Do not use Markdown fences, comments, prose, or trailing commas.',
    user: `The previous quiz-content generation failed because: ${failureReason}

Regenerate the quiz content as valid JSON only.

Required JSON shape:
[
  {
    "id": "q1",
    "type": "single",
    "question": "Question text",
    "options": [
      { "label": "Option A", "value": "A" },
      { "label": "Option B", "value": "B" },
      { "label": "Option C", "value": "C" },
      { "label": "Option D", "value": "D" }
    ],
    "answer": ["A"],
    "analysis": "Why the answer is correct",
    "points": 10
  }
]

Rules:
- Generate ${quizConfig.questionCount} question(s).
- Allowed question types: ${quizConfig.questionTypes.join(', ')}.
- Difficulty: ${quizConfig.difficulty}.
- Every choice question must include 2-4 options and answer values.
- Every question must include analysis and points.
- Use the same language as the outline.

Outline:
Title: ${outline.title}
Description: ${outline.description || ''}
Key points:
${keyPoints || '-'}
${previousResponseText}`,
  };
}

async function retryQuizContentAsStrictJson(
  outline: SceneOutline,
  quizConfig: NonNullable<SceneOutline['quizConfig']>,
  aiCall: AICallFn,
  failureReason: string,
  previousResponse?: string,
): Promise<string | null> {
  const retryPrompt = buildStrictQuizJsonRetryPrompt(
    outline,
    quizConfig,
    failureReason,
    previousResponse,
  );

  try {
    return await aiCall(retryPrompt.system, retryPrompt.user);
  } catch (error) {
    log.warn(
      `Quiz content strict JSON retry failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function buildFallbackQuizContent(outline: SceneOutline): GeneratedQuizContent {
  outline = sanitizeSceneContentOutline(outline);
  const language = outline.language || 'zh-CN';
  const keyPoints = (outline.keyPoints || []).filter((point) => point.trim().length > 0);
  const topic = outline.title || (language === 'en-US' ? 'this topic' : '这个主题');
  const points = keyPoints.length > 0 ? keyPoints.slice(0, 3) : [outline.description || topic];

  const questions: QuizQuestion[] = points.map((point) => {
    const id = `q_${nanoid(8)}`;
    if (language === 'en-US') {
      return {
        id,
        type: 'single',
        question: `Which choice best matches "${topic}"?`,
        options: [
          { value: 'A', label: point },
          { value: 'B', label: 'Ignore the class instructions' },
          { value: 'C', label: 'Act without observing carefully' },
          { value: 'D', label: 'Avoid asking for help when confused' },
        ],
        answer: ['A'],
        analysis: `"${point}" is the key idea for this page.`,
        hasAnswer: true,
        points: 10,
      };
    }

    return {
      id,
      type: 'single',
      question: `关于“${topic}”，下面哪一项更合适？`,
      options: [
        { value: 'A', label: point },
        { value: 'B', label: '不听要求，随意行动' },
        { value: 'C', label: '遇到问题也不告诉老师' },
        { value: 'D', label: '课堂上分心，不认真观察' },
      ],
      answer: ['A'],
      analysis: `“${point}”是这一页需要掌握的重点。`,
      hasAnswer: true,
      points: 10,
    };
  });

  return { questions };
}

/**
 * Normalize quiz options from AI response.
 * AI may generate plain strings ["OptionA", "OptionB"] or QuizOption objects.
 * This normalizes to QuizOption[] format: { value: "A", label: "OptionA" }
 */
function normalizeQuizOptions(
  options: unknown[] | undefined,
): { value: string; label: string }[] | undefined {
  if (!options || !Array.isArray(options)) return undefined;

  return options.map((opt, index) => {
    const letter = String.fromCharCode(65 + index); // A, B, C, D...

    if (typeof opt === 'string') {
      return { value: letter, label: opt };
    }

    if (typeof opt === 'object' && opt !== null) {
      const obj = opt as Record<string, unknown>;
      return {
        value: typeof obj.value === 'string' ? obj.value : letter,
        label: typeof obj.label === 'string' ? obj.label : String(obj.value || obj.text || letter),
      };
    }

    return { value: letter, label: String(opt) };
  });
}

/**
 * Normalize quiz answer from AI response.
 * AI may generate correctAnswer as string or string[], under various field names.
 * This normalizes to string[] format matching option values.
 */
function normalizeQuizAnswer(question: Record<string, unknown>): string[] | undefined {
  // AI might use "correctAnswer", "answer", or "correct_answer"
  const raw =
    question.answer ??
    question.correctAnswer ??
    (question as Record<string, unknown>).correct_answer;
  if (!raw) return undefined;

  if (Array.isArray(raw)) {
    return raw.map(String);
  }
  return [String(raw)];
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildFallbackInteractiveContent(
  outline: SceneOutline,
  language: 'zh-CN' | 'en-US',
): GeneratedInteractiveContent {
  outline = sanitizeSceneContentOutline(outline);
  const title = escapeHtmlText(outline.interactiveConfig?.conceptName || outline.title);
  const description = escapeHtmlText(
    outline.interactiveConfig?.conceptOverview ||
      outline.description ||
      (language === 'en-US'
        ? 'Review the key points and make a quick classroom judgment.'
        : '回顾本页重点，完成一个简单判断。'),
  );
  const points = (outline.keyPoints || []).filter(Boolean).slice(0, 4);
  const correctPoint = escapeHtmlText(
    points[0] || (language === 'en-US' ? 'Follow the key rule' : '按照课堂要求去做'),
  );
  const wrongPoint = escapeHtmlText(
    language === 'en-US' ? 'Ignore the class instruction' : '不听要求，随意行动',
  );
  const heading = language === 'en-US' ? 'Try It' : '试一试';
  const correctLabel = language === 'en-US' ? 'Correct choice' : '正确做法';
  const wrongLabel = language === 'en-US' ? 'Needs improvement' : '还要改进';
  const feedbackCorrect =
    language === 'en-US'
      ? 'Good choice. This matches the key point.'
      : '判断正确，这符合本页重点。';
  const feedbackWrong =
    language === 'en-US' ? 'Try again. Look back at the key point.' : '再想一想，看看本页重点。';

  const html = `<!doctype html>
<html lang="${language === 'en-US' ? 'en' : 'zh-CN'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html,
    body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: ${SCREEN_FONT_STACK};
      color: #111827;
      background: #eef3f0;
    }
    .bingo-interactive-stage {
      width: 100vw;
      height: 100vh;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: clamp(16px, 2.5vh, 30px);
      padding: clamp(24px, 3.8vw, 54px);
      overflow: hidden;
      background:
        radial-gradient(circle at 12% 8%, rgba(52, 211, 153, 0.22), transparent 30%),
        radial-gradient(circle at 88% 16%, rgba(251, 191, 36, 0.2), transparent 30%),
        linear-gradient(135deg, #f8fafc 0%, #eef7f1 54%, #fff7db 100%);
    }
    .stage-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: clamp(14px, 2.2vw, 28px);
      align-items: start;
      min-width: 0;
    }
    .stage-copy {
      min-width: 0;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      border: 1px solid rgba(20, 184, 166, 0.3);
      border-radius: 999px;
      padding: 0 14px;
      background: rgba(240, 253, 250, 0.88);
      color: #0f766e;
      font-size: clamp(13px, 1.25vw, 17px);
      font-weight: 800;
      letter-spacing: 0;
    }
    h1 {
      margin: 12px 0 0;
      font-size: clamp(30px, 4.4vw, 56px);
      line-height: 1.08;
      letter-spacing: 0;
      color: #0f172a;
    }
    p {
      margin: 12px 0 0;
      color: #475569;
      font-size: clamp(16px, 1.7vw, 23px);
      line-height: 1.42;
      max-width: 980px;
    }
    .topic-chip {
      min-width: clamp(120px, 16vw, 220px);
      border: 1px solid rgba(148, 163, 184, 0.34);
      border-radius: 18px;
      padding: 16px 18px;
      background: rgba(255, 255, 255, 0.76);
      color: #334155;
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
      font-size: clamp(15px, 1.4vw, 20px);
      line-height: 1.35;
      font-weight: 750;
    }
    .choices {
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: clamp(18px, 2.6vw, 34px);
    }
    .choice-card {
      width: 100%;
      min-width: 0;
      min-height: 0;
      height: 100%;
      border: 2px solid rgba(148, 163, 184, 0.28);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.88);
      color: #0f172a;
      padding: clamp(24px, 3vw, 42px);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 22px;
      font: inherit;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 20px 48px rgba(15, 23, 42, 0.1);
      transition:
        border-color 140ms ease,
        background 140ms ease,
        transform 140ms ease,
        box-shadow 140ms ease;
    }
    .choice-card:hover,
    .choice-card:focus-visible {
      border-color: rgba(20, 184, 166, 0.58);
      background: #ffffff;
      box-shadow: 0 24px 58px rgba(15, 23, 42, 0.14);
      outline: none;
      transform: translateY(-2px);
    }
    .choice-card.is-selected {
      border-color: #14b8a6;
      background: #f0fdfa;
    }
    .choice-label {
      color: #0f766e;
      font-size: clamp(16px, 1.45vw, 22px);
      font-weight: 850;
      line-height: 1.2;
    }
    .choice-text {
      color: #0f172a;
      font-size: clamp(24px, 3vw, 42px);
      font-weight: 850;
      line-height: 1.18;
    }
    #feedback {
      min-height: clamp(64px, 10vh, 112px);
      border: 1px solid rgba(148, 163, 184, 0.32);
      border-radius: 18px;
      padding: clamp(16px, 2vw, 26px);
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.82);
      color: #334155;
      font-size: clamp(17px, 1.85vw, 25px);
      font-weight: 720;
      line-height: 1.35;
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08);
    }
    @media (max-width: 720px) {
      .bingo-interactive-stage { padding: 20px; gap: 14px; }
      .stage-header { grid-template-columns: 1fr; }
      .topic-chip { display: none; }
      .choices { grid-template-columns: 1fr; }
      h1 { font-size: 28px; }
      .choice-card { min-height: 112px; padding: 20px; }
      .choice-text { font-size: 22px; }
    }
  </style>
</head>
<body>
  <main data-bingo-interactive-root class="bingo-interactive-stage">
    <header class="stage-header">
      <div class="stage-copy">
        <span class="eyebrow">${heading}</span>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      <div class="topic-chip">${language === 'en-US' ? 'Choose the better action' : '选择更合适的做法'}</div>
    </header>
    <section class="choices" aria-label="${heading}">
      <button type="button" class="choice-card" data-ok="true" aria-pressed="false">
        <span class="choice-label">${correctLabel}</span>
        <span class="choice-text">${correctPoint}</span>
      </button>
      <button type="button" class="choice-card" data-ok="false" aria-pressed="false">
        <span class="choice-label">${wrongLabel}</span>
        <span class="choice-text">${wrongPoint}</span>
      </button>
    </section>
    <div id="feedback">${language === 'en-US' ? 'Choose one answer.' : '请选择一个答案。'}</div>
  </main>
  <script>
    const feedback = document.getElementById('feedback');
    document.querySelectorAll('button[data-ok]').forEach((button) => {
      button.addEventListener('click', () => {
        const ok = button.getAttribute('data-ok') === 'true';
        document.querySelectorAll('button[data-ok]').forEach((item) => {
          item.classList.remove('is-selected');
          item.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('is-selected');
        button.setAttribute('aria-pressed', 'true');
        feedback.textContent = ok ? ${JSON.stringify(feedbackCorrect)} : ${JSON.stringify(feedbackWrong)};
        feedback.style.background = ok ? '#dcfce7' : '#fee2e2';
        feedback.style.color = ok ? '#166534' : '#991b1b';
      });
    });
  </script>
</body>
</html>`;

  return { html };
}

function isBasicJudgmentInteractive(outline: SceneOutline): boolean {
  const config = outline.interactiveConfig;
  const haystack = [
    outline.title,
    outline.description,
    config?.conceptName,
    config?.conceptOverview,
    config?.designIdea,
    ...(outline.keyPoints || []),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return [
    '判断',
    '小判断',
    '对错',
    '正确',
    '错误',
    '礼仪',
    '规则',
    '规范',
    '行为',
    '习惯',
    '安全',
    'right or wrong',
    'true or false',
    'correct',
    'incorrect',
    'judge',
  ].some((keyword) => haystack.includes(keyword));
}

/**
 * Generate interactive page content
 * Two AI calls + post-processing:
 * 1. Scientific modeling -> ScientificModel (with fallback)
 * 2. HTML generation with constraints -> post-processed HTML
 */
async function generateInteractiveContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  language: 'zh-CN' | 'en-US' = 'zh-CN',
): Promise<GeneratedInteractiveContent | null> {
  const config = outline.interactiveConfig!;
  const templateGuidance = getInteractiveTemplateGuidance({
    subject: config.subject,
    conceptName: config.conceptName,
    conceptOverview: config.conceptOverview,
    designIdea: config.designIdea,
    keyPoints: outline.keyPoints || [],
  });
  const templateHtml = renderInteractiveTemplate({
    subject: config.subject,
    conceptName: config.conceptName,
    conceptOverview: config.conceptOverview,
    designIdea: config.designIdea,
    keyPoints: outline.keyPoints || [],
    language,
  });

  if (templateHtml) {
    log.info(`Using deterministic interactive template for: ${outline.title}`);
    return { html: templateHtml };
  }

  if (isBasicJudgmentInteractive(outline)) {
    log.info(`Using deterministic judgment interactive template for: ${outline.title}`);
    return buildFallbackInteractiveContent(outline, language);
  }

  // Step 1: Scientific modeling (with fallback on failure)
  let scientificModel: ScientificModel | undefined;
  try {
    const modelPrompts = buildPrompt(PROMPT_IDS.INTERACTIVE_SCIENTIFIC_MODEL, {
      subject: config.subject || '',
      conceptName: config.conceptName,
      conceptOverview: config.conceptOverview,
      keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      designIdea: config.designIdea,
    });

    if (modelPrompts) {
      log.info(`Step 1: Scientific modeling for: ${outline.title}`);
      const modelResponse = await aiCall(modelPrompts.system, modelPrompts.user);
      const parsed = parseJsonResponse<ScientificModel>(modelResponse);
      if (parsed && parsed.core_formulas) {
        scientificModel = parsed;
        log.info(
          `Scientific model: ${parsed.core_formulas.length} formulas, ${parsed.constraints?.length || 0} constraints`,
        );
      }
    }
  } catch (error) {
    log.warn(`Scientific modeling failed, continuing without: ${error}`);
  }

  // Format scientific constraints for HTML generation prompt
  let scientificConstraints = 'No specific scientific constraints available.';
  if (scientificModel) {
    const lines: string[] = [];
    if (scientificModel.core_formulas?.length) {
      lines.push(`Core Formulas: ${scientificModel.core_formulas.join('; ')}`);
    }
    if (scientificModel.mechanism?.length) {
      lines.push(`Mechanisms: ${scientificModel.mechanism.join('; ')}`);
    }
    if (scientificModel.constraints?.length) {
      lines.push(`Must Obey: ${scientificModel.constraints.join('; ')}`);
    }
    if (scientificModel.forbidden_errors?.length) {
      lines.push(`Forbidden Errors: ${scientificModel.forbidden_errors.join('; ')}`);
    }
    scientificConstraints = lines.join('\n');
  }

  // Step 2: HTML generation
  const htmlPrompts = buildPrompt(PROMPT_IDS.INTERACTIVE_HTML, {
    conceptName: config.conceptName,
    subject: config.subject || '',
    conceptOverview: config.conceptOverview,
    keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
    scientificConstraints,
    designIdea: config.designIdea,
    templateGuidance,
    language,
  });

  if (!htmlPrompts) {
    log.error(`Failed to build HTML prompt for: ${outline.title}`);
    return buildFallbackInteractiveContent(outline, language);
  }

  log.info(`Step 2: Generating HTML for: ${outline.title}`);
  let htmlResponse = '';
  try {
    htmlResponse = await aiCall(htmlPrompts.system, htmlPrompts.user);
  } catch (error) {
    log.warn(
      `Interactive HTML generation failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return buildFallbackInteractiveContent(outline, language);
  }
  // Extract HTML from response
  const rawHtml = extractHtml(htmlResponse);
  if (!rawHtml) {
    log.warn(`Failed to extract HTML from response for: ${outline.title}`);
    return buildFallbackInteractiveContent(outline, language);
  }

  // Step 3: Post-process HTML (LaTeX delimiter conversion + KaTeX injection)
  let processedHtml = '';
  try {
    processedHtml = postProcessInteractiveHtml(rawHtml);
    log.info(`Post-processed HTML (${processedHtml.length} chars) for: ${outline.title}`);
  } catch (error) {
    log.warn(
      `Interactive HTML post-processing failed for "${outline.title}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return buildFallbackInteractiveContent(outline, language);
  }

  return {
    html: processedHtml,
    scientificModel,
  };
}

/**
 * Generate PBL project content
 * Uses the agentic loop from lib/pbl/generate-pbl.ts
 */
async function generatePBLSceneContent(
  outline: SceneOutline,
  languageModel?: LanguageModel,
): Promise<GeneratedPBLContent | null> {
  if (!languageModel) {
    log.error('LanguageModel required for PBL generation');
    return null;
  }

  const pblConfig = outline.pblConfig;
  if (!pblConfig) {
    log.error(`PBL outline "${outline.title}" missing pblConfig`);
    return null;
  }

  log.info(`Generating PBL content for: ${outline.title}`);

  try {
    const projectConfig = await generatePBLContent(
      {
        projectTopic: pblConfig.projectTopic,
        projectDescription: pblConfig.projectDescription,
        targetSkills: pblConfig.targetSkills,
        issueCount: pblConfig.issueCount,
        language: pblConfig.language,
      },
      languageModel,
      {
        onProgress: (msg) => log.info(`${msg}`),
      },
    );
    log.info(
      `PBL generated: ${projectConfig.agents.length} agents, ${projectConfig.issueboard.issues.length} issues`,
    );

    return { projectConfig };
  } catch (error) {
    log.error(`Failed:`, error);
    return null;
  }
}

/**
 * Extract HTML document from AI response.
 * Tries to find <!DOCTYPE html>...</html> first, then falls back to code block extraction.
 */
function extractHtml(response: string): string | null {
  // Strategy 1: Find complete HTML document
  const doctypeStart = response.indexOf('<!DOCTYPE html>');
  const htmlTagStart = response.indexOf('<html');
  const start = doctypeStart !== -1 ? doctypeStart : htmlTagStart;

  if (start !== -1) {
    const htmlEnd = response.lastIndexOf('</html>');
    if (htmlEnd !== -1) {
      return response.substring(start, htmlEnd + 7);
    }
  }

  // Strategy 2: Extract from code block
  const codeBlockMatch = response.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const content = codeBlockMatch[1].trim();
    if (content.includes('<html') || content.includes('<!DOCTYPE')) {
      return content;
    }
  }

  // Strategy 3: If response itself looks like HTML
  const trimmed = response.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return trimmed;
  }

  log.error('Could not extract HTML from response');
  log.error('Response preview:', response.substring(0, 200));
  return null;
}

/**
 * Step 3.2: Generate Actions based on content and script
 */
export async function generateSceneActions(
  outline: SceneOutline,
  content:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent,
  aiCall: AICallFn,
  ctx?: SceneGenerationContext,
  agents?: AgentInfo[],
  userProfile?: string,
): Promise<Action[]> {
  outline = sanitizeSceneContentOutline(outline);
  const agentsText = formatAgentsForPrompt(agents);

  if (outline.type === 'slide' && 'elements' in content) {
    // Format element list for AI to select from
    const elementsText = formatElementsForPrompt(content.elements);

    const prompts = buildPrompt(PROMPT_IDS.SLIDE_ACTIONS, {
      title: outline.title,
      keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      description: outline.description,
      elements: elementsText,
      courseContext: buildCourseContext(ctx),
      agents: agentsText,
      userProfile: userProfile || '',
    });

    if (!prompts) {
      return generateDefaultSlideActions(outline, content.elements);
    }

    try {
      const response = await aiCall(prompts.system, prompts.user);
      const actions = parseActionsFromStructuredOutput(response, outline.type);

      if (actions.length > 0) {
        // Validate and fill in Action IDs
        const processedActions = sanitizeGeneratedActions(actions, content.elements, agents);
        return processedActions.length > 0
          ? processedActions
          : generateDefaultSlideActions(outline, content.elements);
      }
    } catch (error) {
      log.warn(
        `Slide actions generation failed for "${outline.title}", using fallback actions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return generateDefaultSlideActions(outline, content.elements);
  }

  if (outline.type === 'quiz' && 'questions' in content) {
    // Format question list for AI reference
    const questionsText = formatQuestionsForPrompt(content.questions);

    const prompts = buildPrompt(PROMPT_IDS.QUIZ_ACTIONS, {
      title: outline.title,
      keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      description: outline.description,
      questions: questionsText,
      courseContext: buildCourseContext(ctx),
      agents: agentsText,
    });

    if (!prompts) {
      return generateDefaultQuizActions(outline);
    }

    try {
      const response = await aiCall(prompts.system, prompts.user);
      const actions = parseActionsFromStructuredOutput(response, outline.type);

      if (actions.length > 0) {
        const processedActions = sanitizeGeneratedActions(actions, [], agents);
        return processedActions.length > 0 ? processedActions : generateDefaultQuizActions(outline);
      }
    } catch (error) {
      log.warn(
        `Quiz actions generation failed for "${outline.title}", using fallback actions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return generateDefaultQuizActions(outline);
  }

  if (outline.type === 'interactive' && 'html' in content) {
    const config = outline.interactiveConfig;
    const agentsText = formatAgentsForPrompt(agents);
    const prompts = buildPrompt(PROMPT_IDS.INTERACTIVE_ACTIONS, {
      title: outline.title,
      keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      description: outline.description,
      conceptName: config?.conceptName || outline.title,
      designIdea: config?.designIdea || '',
      courseContext: buildCourseContext(ctx),
      agents: agentsText,
    });

    if (!prompts) {
      return generateDefaultInteractiveActions(outline);
    }

    try {
      const response = await aiCall(prompts.system, prompts.user);
      const actions = parseActionsFromStructuredOutput(response, outline.type);

      if (actions.length > 0) {
        const processedActions = sanitizeGeneratedActions(actions, [], agents);
        return processedActions.length > 0
          ? processedActions
          : generateDefaultInteractiveActions(outline);
      }
    } catch (error) {
      log.warn(
        `Interactive actions generation failed for "${outline.title}", using fallback actions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return generateDefaultInteractiveActions(outline);
  }

  if (outline.type === 'pbl' && 'projectConfig' in content) {
    const pblConfig = outline.pblConfig;
    const agentsText = formatAgentsForPrompt(agents);
    const prompts = buildPrompt(PROMPT_IDS.PBL_ACTIONS, {
      title: outline.title,
      keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      description: outline.description,
      projectTopic: pblConfig?.projectTopic || outline.title,
      projectDescription: pblConfig?.projectDescription || outline.description,
      courseContext: buildCourseContext(ctx),
      agents: agentsText,
    });

    if (!prompts) {
      return generateDefaultPBLActions(outline);
    }

    try {
      const response = await aiCall(prompts.system, prompts.user);
      const actions = parseActionsFromStructuredOutput(response, outline.type);

      if (actions.length > 0) {
        const processedActions = sanitizeGeneratedActions(actions, [], agents);
        return processedActions.length > 0 ? processedActions : generateDefaultPBLActions(outline);
      }
    } catch (error) {
      log.warn(
        `PBL actions generation failed for "${outline.title}", using fallback actions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return generateDefaultPBLActions(outline);
  }

  return [];
}

/**
 * Generate default PBL Actions (fallback)
 */
function generateDefaultPBLActions(_outline: SceneOutline): Action[] {
  return [
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: 'PBL 项目介绍',
      text: '现在让我们开始一个项目式学习活动。请选择你的角色，查看任务看板，开始协作完成项目。',
    },
  ];
}

/**
 * Format element list for AI to select elementId
 */
function formatElementsForPrompt(elements: PPTElement[]): string {
  return elements
    .map((el) => {
      let summary = '';
      if (el.type === 'text' && 'content' in el) {
        // Extract text content summary (strip HTML tags)
        const textContent = ((el.content as string) || '').replace(/<[^>]*>/g, '').substring(0, 50);
        summary = `Content summary: "${textContent}${textContent.length >= 50 ? '...' : ''}"`;
      } else if (el.type === 'chart' && 'chartType' in el) {
        summary = `Chart type: ${el.chartType}`;
      } else if (el.type === 'image') {
        summary = 'Image element';
      } else if (el.type === 'shape' && 'shapeName' in el) {
        summary = `Shape: ${el.shapeName || 'unknown'}`;
      } else if (el.type === 'latex' && 'latex' in el) {
        summary = `Formula: ${((el.latex as string) || '').substring(0, 30)}`;
      } else {
        summary = `${el.type} element`;
      }
      return `- id: "${el.id}", type: "${el.type}", ${summary}`;
    })
    .join('\n');
}

/**
 * Format question list for AI reference
 */
function formatQuestionsForPrompt(questions: QuizQuestion[]): string {
  return questions
    .map((q, i) => {
      const optionsText = q.options
        ? `Options: ${q.options.map((o) => `${o.value}. ${o.label}`).join(', ')}`
        : '';
      return `Q${i + 1} (${q.type}): ${q.question}\n${optionsText}`;
    })
    .join('\n\n');
}

/**
 * Process and validate Actions
 */
/**
 * Generate default slide Actions (fallback)
 */
function generateDefaultSlideActions(outline: SceneOutline, elements: PPTElement[]): Action[] {
  const actions: Action[] = [];

  // Add spotlight for text elements
  const textElements = elements.filter((el) => el.type === 'text');
  if (textElements.length > 0) {
    actions.push({
      id: `action_${nanoid(8)}`,
      type: 'spotlight',
      title: '聚焦重点',
      elementId: textElements[0].id,
      dimOpacity: DEFAULT_SPOTLIGHT_DIMNESS,
    });
  }

  // Add opening speech based on key points
  const speechText = outline.keyPoints?.length
    ? outline.keyPoints.join('。') + '。'
    : outline.description || outline.title;
  actions.push({
    id: `action_${nanoid(8)}`,
    type: 'speech',
    title: '场景讲解',
    text: speechText,
  });

  return actions;
}

/**
 * Generate default quiz Actions (fallback)
 */
function generateDefaultQuizActions(_outline: SceneOutline): Action[] {
  return [
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: '测验引导',
      text: '现在让我们来做一个小测验，检验一下学习成果。',
    },
  ];
}

/**
 * Generate default interactive Actions (fallback)
 */
function generateDefaultInteractiveActions(_outline: SceneOutline): Action[] {
  return [
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: '交互引导',
      text: '现在让我们通过交互式可视化来探索这个概念。请尝试操作页面中的元素，观察变化。',
    },
  ];
}

/**
 * Create a complete scene with Actions
 */
export function createSceneWithActions(
  outline: SceneOutline,
  content:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent,
  actions: Action[],
  api: ReturnType<typeof createStageAPI>,
  visualTheme?: ColorThemeId,
): string | null {
  if (outline.type === 'slide' && 'elements' in content) {
    // Build complete Slide object
    const defaultTheme: SlideTheme = createSlideTheme(visualTheme);

    const slide: Slide = {
      id: nanoid(),
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: defaultTheme,
      elements: content.elements,
      background: content.background,
    };

    const sceneResult = api.scene.create({
      type: 'slide',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'slide',
        canvas: slide,
      },
      actions,
      learningContext: outline.learningContext,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  if (outline.type === 'quiz' && 'questions' in content) {
    const sceneResult = api.scene.create({
      type: 'quiz',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'quiz',
        questions: content.questions,
      },
      actions,
      learningContext: outline.learningContext,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  if (outline.type === 'interactive' && 'html' in content) {
    const sceneResult = api.scene.create({
      type: 'interactive',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'interactive',
        url: '',
        html: content.html,
      },
      actions,
      learningContext: outline.learningContext,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  if (outline.type === 'pbl' && 'projectConfig' in content) {
    const sceneResult = api.scene.create({
      type: 'pbl',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'pbl',
        projectConfig: content.projectConfig,
      },
      actions,
      learningContext: outline.learningContext,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  return null;
}

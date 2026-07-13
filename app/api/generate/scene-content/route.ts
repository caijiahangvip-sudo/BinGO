/**
 * Scene Content Generation API
 *
 * Generates scene content (slides/quiz/interactive/pbl) from an outline.
 * This is the first half of the two-step scene generation pipeline.
 * Does NOT generate actions - use /api/generate/scene-actions for that.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import {
  applyOutlineFallbacks,
  buildFallbackInteractiveContent,
  buildFallbackQuizContent,
  generateSceneContent,
  buildVisionUserContent,
} from '@/lib/generation/generation-pipeline';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { buildFallbackSlideContent } from '@/lib/generation/slide-content-fallback';
import {
  buildClassroomContentGenerationConstraints,
  sanitizeSceneContentOutline,
} from '@/lib/generation/scene-content-policy';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { buildChineseXinhuaPromptContext } from '@/lib/server/chinese-xinhua';
import { resolveColorThemeId, type ColorThemeId } from '@/lib/theme/color-themes';

const log = createLogger('Scene Content API');

export const maxDuration = 300;

function buildRouteContentFallback(
  outline?: SceneOutline,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  visualTheme?: ColorThemeId,
) {
  if (!outline) return null;
  const safeOutline = sanitizeSceneContentOutline(outline);

  if (safeOutline.type === 'slide') {
    return {
      content: buildFallbackSlideContent(safeOutline, assignedImages, imageMapping, visualTheme),
      warning: 'SLIDE_CONTENT_FALLBACK',
    };
  }

  if (safeOutline.type === 'quiz') {
    return {
      content: buildFallbackQuizContent(safeOutline),
      warning: 'QUIZ_CONTENT_FALLBACK',
    };
  }

  if (safeOutline.type === 'interactive') {
    return {
      content: buildFallbackInteractiveContent(safeOutline, safeOutline.language || 'zh-CN'),
      warning: 'INTERACTIVE_CONTENT_FALLBACK',
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  let outlineTitle: string | undefined;
  let resolvedModelString: string | undefined;
  let fallbackOutline: SceneOutline | undefined;
  let fallbackAssignedImages: PdfImage[] | undefined;
  let fallbackImageMapping: ImageMapping | undefined;
  let fallbackVisualTheme: ColorThemeId | undefined;
  try {
    const body = await req.json();
    const {
      outline: rawOutline,
      allOutlines,
      pdfImages,
      imageMapping,
      stageInfo,
      stageId,
      agents,
      forceClassroomScenes,
      visualTheme: rawVisualTheme,
      slideLayoutReviewEnabled,
    } = body as {
      outline: SceneOutline;
      allOutlines: SceneOutline[];
      pdfImages?: PdfImage[];
      imageMapping?: ImageMapping;
      stageInfo: {
        name: string;
        description?: string;
        language?: string;
        style?: string;
        visualTheme?: ColorThemeId;
      };
      stageId: string;
      agents?: AgentInfo[];
      forceClassroomScenes?: boolean;
      visualTheme?: ColorThemeId;
      slideLayoutReviewEnabled?: boolean;
    };

    // Validate required fields
    if (!rawOutline) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'outline is required');
    }
    if (!allOutlines || allOutlines.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'allOutlines is required and must not be empty',
      );
    }
    if (!stageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required');
    }

    const language = rawOutline.language || (stageInfo?.language as 'zh-CN' | 'en-US') || 'zh-CN';
    const visualTheme = resolveColorThemeId(rawVisualTheme || stageInfo?.visualTheme);
    fallbackVisualTheme = visualTheme;
    const generationConstraints = forceClassroomScenes
      ? buildClassroomContentGenerationConstraints(language)
      : [];

    // Ensure outline has language from stageInfo (fallback for older outlines)
    const outline = sanitizeSceneContentOutline({
      ...rawOutline,
      language,
    });
    fallbackOutline = outline;
    fallbackImageMapping = imageMapping;

    // Model resolution from request headers
    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req);
    outlineTitle = rawOutline?.title;
    resolvedModelString = modelString;

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;
    const dictionaryContext = await buildChineseXinhuaPromptContext({
      text: [
        outline.title,
        outline.description,
        ...(outline.keyPoints || []),
        stageInfo?.name,
        stageInfo?.description,
      ]
        .filter(Boolean)
        .join('\n'),
      language,
      limit: 10,
    });

    // Vision-aware AI call function
    const aiCall = async (
      systemPrompt: string,
      userPrompt: string,
      images?: Array<{ id: string; src: string }>,
    ): Promise<string> => {
      const effectiveSystemPrompt = dictionaryContext
        ? `${systemPrompt}\n\n# Chinese Dictionary References\n${dictionaryContext}`
        : systemPrompt;
      if (images?.length && hasVision) {
        const result = await callLLM(
          {
            model: languageModel,
            system: effectiveSystemPrompt,
            messages: [
              {
                role: 'user' as const,
                content: buildVisionUserContent(userPrompt, images),
              },
            ],
            maxOutputTokens: modelInfo?.outputWindow,
          },
          'scene-content',
        );
        return result.text;
      }
      const result = await callLLM(
        {
          model: languageModel,
          system: effectiveSystemPrompt,
          prompt: userPrompt,
          maxOutputTokens: modelInfo?.outputWindow,
        },
        'scene-content',
      );
      return result.text;
    };

    // Apply fallbacks
    const effectiveOutline = sanitizeSceneContentOutline(
      applyOutlineFallbacks(outline, !!languageModel),
    );

    // Filter images assigned to this outline
    let assignedImages: PdfImage[] | undefined;
    if (
      pdfImages &&
      pdfImages.length > 0 &&
      effectiveOutline.suggestedImageIds &&
      effectiveOutline.suggestedImageIds.length > 0
    ) {
      const suggestedIds = new Set(effectiveOutline.suggestedImageIds);
      assignedImages = pdfImages.filter((img) => suggestedIds.has(img.id));
    }
    fallbackOutline = effectiveOutline;
    fallbackAssignedImages = assignedImages;

    log.info(
      `Generating content: "${effectiveOutline.title}" (${effectiveOutline.type}) [model=${modelString}]`,
    );

    let content = await generateSceneContent(
      effectiveOutline,
      aiCall,
      assignedImages,
      imageMapping,
      effectiveOutline.type === 'pbl' ? languageModel : undefined,
      hasVision,
      agents,
      {
        ...(generationConstraints.length > 0 ? { generationConstraints } : {}),
        visualTheme,
        slideLayoutReviewEnabled: slideLayoutReviewEnabled === true,
      },
    );
    let contentWarning: string | undefined;

    if (!content) {
      log.warn(
        `Using fallback ${effectiveOutline.type} content for "${effectiveOutline.title}" because AI content generation returned no usable output`,
      );
      const fallback = buildRouteContentFallback(
        effectiveOutline,
        assignedImages,
        imageMapping,
        visualTheme,
      );
      if (fallback) {
        content = fallback.content;
        contentWarning = fallback.warning;
      }
    }

    if (!content) {
      log.error(`Failed to generate content for: "${effectiveOutline.title}"`);

      return apiError(
        'GENERATION_FAILED',
        500,
        `Failed to generate content: ${effectiveOutline.title}`,
      );
    }

    log.info(`Content generated successfully: "${effectiveOutline.title}"`);

    return apiSuccess({
      content,
      effectiveOutline,
      ...(contentWarning ? { warning: contentWarning } : {}),
    });
  } catch (error) {
    const fallback = buildRouteContentFallback(
      fallbackOutline,
      fallbackAssignedImages,
      fallbackImageMapping,
      fallbackVisualTheme,
    );
    if (fallback) {
      log.warn(
        `Scene content generation failed for "${fallbackOutline?.title}", returning fallback ${fallbackOutline?.type} content: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return apiSuccess({
        content: fallback.content,
        effectiveOutline: fallbackOutline,
        warning: fallback.warning,
      });
    }

    log.error(
      `Scene content generation failed [scene="${outlineTitle ?? 'unknown'}", model=${resolvedModelString ?? 'unknown'}]:`,
      error,
    );
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

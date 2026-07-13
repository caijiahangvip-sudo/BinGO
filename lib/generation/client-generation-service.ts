'use client';

import { callLLM } from '@/lib/ai/llm';
import { getModel } from '@/lib/ai/providers';
import { createLogger } from '@/lib/logger';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { buildVisionUserContent } from '@/lib/generation/generation-pipeline';
import {
  applyOutlineFallbacks,
  buildCompleteScene,
  generateSceneActions,
  generateSceneContent,
  formatTeacherPersonaForPrompt,
  type AgentInfo,
  type SceneGenerationContext,
} from '@/lib/generation/generation-pipeline';
import { generateSceneOutlinesFromRequirements } from '@/lib/generation/outline-generator';
import type {
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
  UserRequirements,
  ImageMapping,
  PdfImage,
  SceneOutline,
} from '@/lib/types/generation';
import type { SpeechAction } from '@/lib/types/action';
import type { Scene } from '@/lib/types/stage';
import type { ColorThemeId } from '@/lib/theme/color-themes';

const log = createLogger('ClientGenerationService');

function resolveClientModel() {
  const config = getCurrentModelConfig();
  const { model, modelInfo } = getModel({
    providerId: config.providerId,
    modelId: config.modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || undefined,
    providerType: config.providerType,
    requiresApiKey: config.requiresApiKey,
  });

  return {
    model,
    modelInfo,
    modelString: config.modelString,
  };
}

export async function generateSceneOutlinesClient(params: {
  requirements: UserRequirements;
  pdfText?: string;
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  researchContext?: string;
  agents?: AgentInfo[];
}): Promise<{ success: boolean; outlines?: SceneOutline[]; error?: string }> {
  try {
    const { model, modelInfo, modelString } = resolveClientModel();
    const hasVision = !!modelInfo?.capabilities?.vision;
    const aiCall = createAICall('scene-outlines-client', model, modelInfo?.outputWindow, hasVision);

    log.info(
      `Generating outlines on client: "${params.requirements.requirement.substring(0, 50)}" [model=${modelString}]`,
    );

    const result = await generateSceneOutlinesFromRequirements(
      params.requirements,
      params.pdfText,
      params.pdfImages,
      aiCall,
      undefined,
      {
        visionEnabled: hasVision,
        imageMapping: params.imageMapping,
        researchContext: params.researchContext,
        teacherContext: formatTeacherPersonaForPrompt(params.agents),
      },
    );

    if (!result.success || !result.data?.length) {
      return { success: false, error: result.error || 'Failed to generate outlines' };
    }

    return { success: true, outlines: result.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createAICall(
  source: string,
  model: ReturnType<typeof resolveClientModel>['model'],
  outputWindow?: number,
  hasVision?: boolean,
) {
  return async (
    systemPrompt: string,
    userPrompt: string,
    images?: Array<{ id: string; src: string }>,
  ): Promise<string> => {
    if (images?.length && hasVision) {
      const result = await callLLM(
        {
          model,
          system: systemPrompt,
          messages: [
            {
              role: 'user' as const,
              content: buildVisionUserContent(userPrompt, images),
            },
          ],
          maxOutputTokens: outputWindow,
        },
        source,
      );
      return result.text;
    }

    const result = await callLLM(
      {
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: outputWindow,
      },
      source,
    );
    return result.text;
  };
}

export async function generateSceneContentClient(params: {
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
  slideLayoutReviewEnabled?: boolean;
}): Promise<{
  success: boolean;
  content?:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent;
  effectiveOutline?: SceneOutline;
  error?: string;
}> {
  try {
    const { model, modelInfo, modelString } = resolveClientModel();
    const hasVision = !!modelInfo?.capabilities?.vision;
    const aiCall = createAICall('scene-content-client', model, modelInfo?.outputWindow, hasVision);

    const outline: SceneOutline = {
      ...params.outline,
      language:
        params.outline.language || (params.stageInfo?.language as 'zh-CN' | 'en-US') || 'zh-CN',
    };
    const effectiveOutline = applyOutlineFallbacks(outline, true);

    let assignedImages: PdfImage[] | undefined;
    if (
      params.pdfImages &&
      params.pdfImages.length > 0 &&
      effectiveOutline.suggestedImageIds &&
      effectiveOutline.suggestedImageIds.length > 0
    ) {
      const suggestedIds = new Set(effectiveOutline.suggestedImageIds);
      assignedImages = params.pdfImages.filter((img) => suggestedIds.has(img.id));
    }

    log.info(
      `Generating content on client: "${effectiveOutline.title}" (${effectiveOutline.type}) [model=${modelString}]`,
    );

    const content = await generateSceneContent(
      effectiveOutline,
      aiCall,
      assignedImages,
      params.imageMapping,
      effectiveOutline.type === 'pbl' ? model : undefined,
      hasVision,
      params.agents,
      {
        visualTheme: params.stageInfo.visualTheme,
        slideLayoutReviewEnabled: params.slideLayoutReviewEnabled === true,
      },
    );

    if (!content) {
      return { success: false, error: `Failed to generate content: ${effectiveOutline.title}` };
    }

    return { success: true, content, effectiveOutline };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function generateSceneActionsClient(params: {
  outline: SceneOutline;
  allOutlines: SceneOutline[];
  content:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent;
  stageId: string;
  agents?: AgentInfo[];
  previousSpeeches?: string[];
  userProfile?: string;
  visualTheme?: ColorThemeId;
}): Promise<{
  success: boolean;
  scene?: Scene;
  previousSpeeches?: string[];
  error?: string;
}> {
  try {
    const { model, modelInfo, modelString } = resolveClientModel();
    const hasVision = !!modelInfo?.capabilities?.vision;
    const aiCall = createAICall('scene-actions-client', model, modelInfo?.outputWindow, hasVision);

    const allTitles = params.allOutlines.map((o) => o.title);
    const pageIndex = params.allOutlines.findIndex((o) => o.id === params.outline.id);
    const ctx: SceneGenerationContext = {
      pageIndex: (pageIndex >= 0 ? pageIndex : 0) + 1,
      totalPages: params.allOutlines.length,
      allTitles,
      previousSpeeches: params.previousSpeeches ?? [],
    };

    log.info(
      `Generating actions on client: "${params.outline.title}" (${params.outline.type}) [model=${modelString}]`,
    );

    const actions = await generateSceneActions(
      params.outline,
      params.content,
      aiCall,
      ctx,
      params.agents,
      params.userProfile,
    );
    const scene = buildCompleteScene(
      params.outline,
      params.content,
      actions,
      params.stageId,
      params.visualTheme,
    );

    if (!scene) {
      return { success: false, error: `Failed to build scene: ${params.outline.title}` };
    }

    const outputPreviousSpeeches = (scene.actions || [])
      .filter((a): a is SpeechAction => a.type === 'speech')
      .map((a) => a.text);

    return { success: true, scene, previousSpeeches: outputPreviousSpeeches };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

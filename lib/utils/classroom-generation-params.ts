import type { GenerationParams } from '@/lib/hooks/use-scene-generator';
import type { Stage } from '@/lib/types/stage';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useSettingsStore } from '@/lib/store/settings';

const GENERATION_PARAMS_KEY = 'generationParams';
const AUTO_START_FIRST_LECTURE_PREFIX = 'autoStartFirstLecture:';

type SessionGenerationParams = NonNullable<Stage['generationParams']> & {
  stageId?: string;
  autoStartFirstLecture?: boolean;
  bookLessonContext?: Stage['bookLessonContext'];
};

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function storeSessionGenerationParams(
  stageId: string,
  params: NonNullable<Stage['generationParams']>,
): void {
  if (!canUseSessionStorage()) return;
  sessionStorage.setItem(
    GENERATION_PARAMS_KEY,
    JSON.stringify({
      ...params,
      stageId,
    } satisfies SessionGenerationParams),
  );
}

export function markAutoStartFirstLecture(stageId: string): void {
  if (!canUseSessionStorage()) return;
  sessionStorage.setItem(`${AUTO_START_FIRST_LECTURE_PREFIX}${stageId}`, 'true');
}

export function consumeAutoStartFirstLecture(stageId: string): boolean {
  if (!canUseSessionStorage()) return false;

  const key = `${AUTO_START_FIRST_LECTURE_PREFIX}${stageId}`;
  const shouldAutoStart = sessionStorage.getItem(key) === 'true';
  sessionStorage.removeItem(key);
  if (shouldAutoStart) return true;

  const params = readSessionGenerationParams(stageId);
  if (!params?.autoStartFirstLecture) return false;

  sessionStorage.setItem(
    GENERATION_PARAMS_KEY,
    JSON.stringify({
      ...params,
      autoStartFirstLecture: false,
    } satisfies SessionGenerationParams),
  );
  return true;
}

function readSessionGenerationParams(stageId?: string): SessionGenerationParams | null {
  if (!canUseSessionStorage()) return null;

  const raw = sessionStorage.getItem(GENERATION_PARAMS_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SessionGenerationParams;
    if (stageId && parsed.stageId && parsed.stageId !== stageId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function resolveStoredGenerationParams(stage: Stage): SessionGenerationParams {
  return stage.generationParams ?? readSessionGenerationParams(stage.id) ?? {};
}

export async function buildSceneGenerationParams(stage: Stage): Promise<GenerationParams> {
  const params = resolveStoredGenerationParams(stage);
  const slideLayoutReviewEnabled = useSettingsStore.getState().slideLayoutReviewEnabled;
  const storageIds = (params.pdfImages || [])
    .map((img) => img.storageId)
    .filter((id): id is string => Boolean(id));
  const imageMapping = await loadImageMapping(storageIds);

  return {
    pdfImages: params.pdfImages,
    imageMapping,
    stageInfo: {
      name: stage.name || '',
      description: stage.description,
      language: stage.language,
      style: stage.style,
      visualTheme: params.visualTheme || stage.visualTheme,
    },
    agents: params.agents,
    userProfile: params.userProfile,
    forceClassroomScenes: params.forceClassroomScenes || !!stage.bookLessonContext,
    slideLayoutReviewEnabled,
  };
}

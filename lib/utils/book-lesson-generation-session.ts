import { nanoid } from 'nanoid';
import type { SceneOutline, UserRequirements } from '@/lib/types/generation';
import type { ColorThemeId } from '@/lib/theme/color-themes';
import type {
  BookKnowledgePoint,
  BookLearningLanguage,
  BookLearningPlan,
  BookLessonPlan,
} from '@/lib/types/book-learning';

type PdfProviderConfig = { apiKey?: string; baseUrl?: string };

export type BookLessonReviewContext = {
  lessonOrder: number;
  sourceLessonId?: string;
  sourceLessonTitle?: string;
  knowledgePointIds: string[];
  knowledgePoints: Array<{
    id: string;
    title: string;
    summary: string;
    status: BookKnowledgePoint['status'];
  }>;
};

type BuildBookLessonGenerationSessionParams = {
  plan: BookLearningPlan;
  lesson: BookLessonPlan;
  language: BookLearningLanguage;
  userNickname?: string;
  userBio?: string;
  webSearch?: boolean;
  visualTheme?: ColorThemeId;
  pdfProviderId?: string;
  pdfProviderConfig?: PdfProviderConfig;
};

export function getBookLessonKnowledgePoints(
  plan: BookLearningPlan,
  lesson: BookLessonPlan,
): BookKnowledgePoint[] {
  const ids = new Set(lesson.knowledgePointIds);
  return plan.knowledgePoints.filter((point) => ids.has(point.id));
}

function formatKnowledgePoints(points: BookKnowledgePoint[]): string {
  return points
    .map(
      (point, index) =>
        `${index + 1}. ${point.title}${point.chapterTitle ? ` (${point.chapterTitle})` : ''}: ${point.summary}`,
    )
    .join('\n');
}

function formatPreviousLessons(plan: BookLearningPlan, lesson: BookLessonPlan): string {
  return plan.lessons
    .filter((item) => item.order < lesson.order)
    .map((item) => `- ${item.title}: ${item.objective}`)
    .join('\n');
}

function buildBookLessonSourceText(params: {
  plan: BookLearningPlan;
  lesson: BookLessonPlan;
  language: BookLearningLanguage;
}): string {
  const { plan, lesson, language } = params;
  const knowledgePointText = formatKnowledgePoints(getBookLessonKnowledgePoints(plan, lesson));
  const previousLessons = formatPreviousLessons(plan, lesson);
  const reviewText = formatReviewContext(buildBookLessonReviewContext(plan, lesson));

  if (language === 'zh-CN') {
    return [
      `书名：${plan.title}`,
      plan.summary ? `全书概述：${plan.summary}` : '',
      `当前课次：第 ${lesson.order} 节，${lesson.title}`,
      `本节课目标：${lesson.objective}`,
      knowledgePointText ? `本节课知识点：\n${knowledgePointText}` : '',
      previousLessons ? `前序课程进度：\n${previousLessons}` : '',
      reviewText,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return [
    `Book: ${plan.title}`,
    plan.summary ? `Book summary: ${plan.summary}` : '',
    `Current lesson: lesson ${lesson.order}, ${lesson.title}`,
    `Lesson objective: ${lesson.objective}`,
    knowledgePointText ? `Knowledge points:\n${knowledgePointText}` : '',
    previousLessons ? `Previous lesson progress:\n${previousLessons}` : '',
    reviewText,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function getReviewKnowledgePoints(
  plan: BookLearningPlan,
  lesson: BookLessonPlan,
): BookKnowledgePoint[] {
  if (lesson.order <= 1) return [];

  const previousLessons = plan.lessons.filter((item) => item.order < lesson.order);
  const previousKnowledgePointIds = new Set(
    previousLessons.flatMap((item) => item.knowledgePointIds),
  );
  const weakOrReviewPoints = plan.knowledgePoints.filter(
    (point) =>
      previousKnowledgePointIds.has(point.id) &&
      (point.status === 'weak' || point.status === 'review'),
  );
  if (weakOrReviewPoints.length > 0) return weakOrReviewPoints.slice(0, 6);

  const lastPreviousLesson = [...previousLessons].sort((a, b) => b.order - a.order)[0];
  if (!lastPreviousLesson) return [];

  const fallbackIds = new Set(lastPreviousLesson.knowledgePointIds);
  return plan.knowledgePoints.filter((point) => fallbackIds.has(point.id)).slice(0, 4);
}

function buildBookLessonReviewContext(
  plan: BookLearningPlan,
  lesson: BookLessonPlan,
): BookLessonReviewContext | undefined {
  const reviewPoints = getReviewKnowledgePoints(plan, lesson);
  if (reviewPoints.length === 0) return undefined;

  const previousLessons = plan.lessons.filter((item) => item.order < lesson.order);
  const lastPreviousLesson = [...previousLessons].sort((a, b) => b.order - a.order)[0];

  return {
    lessonOrder: lesson.order,
    sourceLessonId: lastPreviousLesson?.id,
    sourceLessonTitle: lastPreviousLesson?.title,
    knowledgePointIds: reviewPoints.map((point) => point.id),
    knowledgePoints: reviewPoints.map((point) => ({
      id: point.id,
      title: point.title,
      summary: point.summary,
      status: point.status,
    })),
  };
}

function formatReviewContext(context: BookLessonReviewContext | undefined): string {
  if (!context) return '';
  const points = context.knowledgePoints
    .map((point, index) => `${index + 1}. ${point.title}: ${point.summary}`)
    .join('\n');
  return [
    'Before the new lesson content, prepend a review course based on the student profile.',
    'The review course must contain at least 3 slide scenes and 1 quiz scene.',
    'The review scenes must come first, then continue into the current lesson.',
    context.sourceLessonTitle ? `Review source lesson: ${context.sourceLessonTitle}` : '',
    'Review knowledge points:',
    points,
  ]
    .filter(Boolean)
    .join('\n');
}

export function prependBookLessonReviewPrelude(
  outlines: SceneOutline[],
  params: {
    language: BookLearningLanguage;
    lessonKnowledgePointIds?: string[];
    reviewContext?: BookLessonReviewContext;
  },
): SceneOutline[] {
  const lessonKnowledgePointIds = params.lessonKnowledgePointIds || [];
  const lessonOutlines = outlines.map((outline, index) => ({
    ...outline,
    order: index + 1,
    learningContext: outline.learningContext ?? {
      section: 'lesson' as const,
      knowledgePointIds: lessonKnowledgePointIds,
    },
  }));

  const review = params.reviewContext;
  if (!review || review.knowledgePointIds.length === 0) return lessonOutlines;
  if (lessonOutlines.some((outline) => outline.learningContext?.section === 'review')) {
    return lessonOutlines;
  }

  const isZh = params.language === 'zh-CN';
  const pointTitles = review.knowledgePoints.map((point) => point.title).join(', ');
  const sourceTitle = review.sourceLessonTitle || (isZh ? '上一章' : 'previous lesson');
  const reviewKeyPoints = review.knowledgePoints.map((point) => point.title).slice(0, 5);
  const fallbackKeyPoints = reviewKeyPoints.length > 0 ? reviewKeyPoints : [sourceTitle];
  const context = {
    section: 'review' as const,
    knowledgePointIds: review.knowledgePointIds,
  };

  const prelude: SceneOutline[] = [
    {
      id: `review_${nanoid(8)}_1`,
      type: 'slide',
      title: isZh ? '复习导入' : 'Review Warm-up',
      description: isZh
        ? `回顾${sourceTitle}中的薄弱知识点，帮助学生重新进入学习状态。`
        : `Review weak points from ${sourceTitle} before starting the new lesson.`,
      keyPoints: [
        isZh
          ? `复习范围：${pointTitles || sourceTitle}`
          : `Review scope: ${pointTitles || sourceTitle}`,
        isZh ? '连接旧知识与新章节目标' : 'Connect prior knowledge to the new lesson goal',
        isZh ? '明确本节课需要先补足的问题' : 'Clarify what needs reinforcement first',
      ],
      teachingObjective: isZh ? '激活上一章关键知识' : 'Reactivate prior knowledge',
      estimatedDuration: 120,
      order: 1,
      language: params.language,
      learningContext: context,
    },
    {
      id: `review_${nanoid(8)}_2`,
      type: 'slide',
      title: isZh ? '关键概念回放' : 'Key Concept Replay',
      description: isZh
        ? '用简洁的结构图重新梳理学生尚未稳固掌握的概念。'
        : 'Use a concise visual structure to revisit concepts that are not yet stable.',
      keyPoints: fallbackKeyPoints.slice(0, 4),
      teachingObjective: isZh ? '补齐概念理解缺口' : 'Close conceptual gaps',
      estimatedDuration: 150,
      order: 2,
      language: params.language,
      learningContext: context,
    },
    {
      id: `review_${nanoid(8)}_3`,
      type: 'slide',
      title: isZh ? '易错点纠偏' : 'Misconception Fix',
      description: isZh
        ? '对上一章中容易混淆或答错的点做对比讲解。'
        : 'Contrast common mistakes with the correct reasoning path.',
      keyPoints: [
        isZh ? '区分相近概念' : 'Separate similar ideas',
        isZh ? '展示正确解题或解释路径' : 'Show the correct reasoning path',
        isZh ? '给出进入新内容前的检查标准' : 'Set the readiness check before new content',
      ],
      teachingObjective: isZh ? '修正易错理解' : 'Correct fragile understanding',
      estimatedDuration: 150,
      order: 3,
      language: params.language,
      learningContext: context,
    },
    {
      id: `review_${nanoid(8)}_4`,
      type: 'quiz',
      title: isZh ? '复习小测' : 'Review Check',
      description: isZh
        ? '通过短测判断学生是否已经准备好进入本章内容。'
        : 'Check whether the student is ready to continue into the new lesson.',
      keyPoints: fallbackKeyPoints.slice(0, 4),
      teachingObjective: isZh ? '检测复习掌握情况' : 'Assess review mastery',
      estimatedDuration: 180,
      order: 4,
      language: params.language,
      learningContext: context,
      quizConfig: {
        questionCount: 3,
        difficulty: 'medium',
        questionTypes: ['single', 'text'],
      },
    },
  ];

  const shiftedLessons = lessonOutlines.map((outline, index) => ({
    ...outline,
    order: index + prelude.length + 1,
    learningContext: outline.learningContext ?? {
      section: 'lesson' as const,
      knowledgePointIds: lessonKnowledgePointIds,
    },
  }));

  return [...prelude, ...shiftedLessons];
}

export function buildBookLessonClassroomRequirement(params: {
  plan: BookLearningPlan;
  lesson: BookLessonPlan;
  language: BookLearningLanguage;
}): string {
  const { plan, lesson, language } = params;
  const knowledgePointText = formatKnowledgePoints(getBookLessonKnowledgePoints(plan, lesson));
  const previousLessons = formatPreviousLessons(plan, lesson);
  const reviewText = formatReviewContext(buildBookLessonReviewContext(plan, lesson));

  if (language === 'zh-CN') {
    return [
      `请像用户在首页直接提问“根据这本 PDF 给我上一节关于「${lesson.title}」的课”一样，走普通课堂生成流程。`,
      `资料来源：上传的 PDF《${plan.title}》。`,
      `当前只生成第 ${lesson.order} 节课：${lesson.title}`,
      `本节课目标：${lesson.objective}`,
      '',
      '这必须是普通互动课堂，不是文档、讲义、学习报告、教案、练习册、长文总结，也不是 60 分钟文本课表。',
      '不要按照“25 分钟讲解 / 5 分钟休息 / 25 分钟练习 / 5 分钟总结”的文档结构生成内容。',
      '',
      '必须生成多个 classroom scene，结构要像普通课堂：',
      '- 先用 slide scene 讲清核心概念；幻灯片必须是视觉页面，文字短、可扫读，不要长段落。',
      '- 至少插入 1 个 quiz scene 做知识检查。',
      '- 如果本节概念适合操作、模拟、可视化或网页实验，加入 1 个 interactive scene。',
      '- 如果本节适合项目探究，可加入 1 个 PBL scene。',
      '- 每个 scene 都应支持老师和课堂角色讲解、提问、互动。',
      '',
      '只覆盖本节课范围，不要生成整本书或完整学习计划。',
      '本节课知识点：',
      knowledgePointText || '无',
      previousLessons ? `前序课程进度：\n${previousLessons}` : '',
      reviewText,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return [
    `Generate this exactly as if the user asked on the homepage: "Teach me a class about ${lesson.title} from this PDF." Use the normal classroom generation flow.`,
    `Source material: uploaded PDF "${plan.title}".`,
    `Current lesson only: lesson ${lesson.order}, ${lesson.title}`,
    `Lesson objective: ${lesson.objective}`,
    '',
    'This must be a normal interactive classroom, not a document, handout, study report, lesson-plan document, worksheet, long-form summary, or 60-minute text schedule.',
    'Do not follow the document structure "25 minutes lecture / 5 minutes break / 25 minutes practice / 5 minutes summary".',
    '',
    'Generate multiple classroom scenes like the normal flow:',
    '- Start with slide scenes that teach the core ideas. Slides must be visual, concise, and scannable, not paragraph-heavy.',
    '- Include at least one quiz scene for knowledge checks.',
    '- Add one interactive scene if the concept benefits from manipulation, simulation, visualization, or a web experiment.',
    '- Add one PBL scene if a project-based exploration is useful.',
    '- Each scene should support teacher/classroom-role explanation, questions, and interaction.',
    '',
    'Cover only this lesson, not the whole book or full learning plan.',
    'Knowledge points for this lesson:',
    knowledgePointText || 'None',
    previousLessons ? `Previous lesson progress:\n${previousLessons}` : '',
    reviewText,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildBookLessonGenerationSession(params: BuildBookLessonGenerationSessionParams) {
  const reviewContext = buildBookLessonReviewContext(params.plan, params.lesson);
  const requirements: UserRequirements = {
    requirement: buildBookLessonClassroomRequirement({
      plan: params.plan,
      lesson: params.lesson,
      language: params.language,
    }),
    language: params.language,
    userNickname: params.userNickname || undefined,
    userBio: params.userBio || undefined,
    webSearch: params.webSearch || undefined,
    visualTheme: params.visualTheme,
  };

  return {
    sessionId: nanoid(),
    requirements,
    pdfText: buildBookLessonSourceText({
      plan: params.plan,
      lesson: params.lesson,
      language: params.language,
    }),
    pdfImages: [],
    imageStorageIds: [],
    pdfFileName: params.plan.fileName,
    pdfProviderId: params.pdfProviderId,
    pdfProviderConfig: params.pdfProviderConfig,
    sceneOutlines: null,
    currentStep: 'generating' as const,
    forceAgentGeneration: true,
    bookLessonContext: {
      planId: params.plan.id,
      lessonId: params.lesson.id,
      lessonOrder: params.lesson.order,
      knowledgePointIds: params.lesson.knowledgePointIds,
      reviewContext,
    },
  };
}

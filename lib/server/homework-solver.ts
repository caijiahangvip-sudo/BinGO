import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { callLLM } from '@/lib/ai/llm';
import { buildVisionUserContent, parseJsonResponse } from '@/lib/generation/generation-pipeline';
import { parsePDF } from '@/lib/pdf/pdf-providers';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFProviderId } from '@/lib/pdf/types';
import { ensureLocalModelServiceRunning } from '@/lib/server/local-model-services';
import { enqueueMineruPdfTask } from '@/lib/server/mineru-task-manager';
import type { ResolvedModel } from '@/lib/server/resolve-model';
import { buildChineseXinhuaPromptContext } from '@/lib/server/chinese-xinhua';
import type { HomeworkLanguage, HomeworkQuestionSolution } from '@/lib/types/homework';
import type { HomeworkSolveProgress, HomeworkSolveResult } from '@/lib/server/homework-solve-types';

export const HOMEWORK_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const HOMEWORK_MAX_PDF_BYTES = 50 * 1024 * 1024;
const MINERU_DEFAULT_PORT = 50002;
const SUPPORTED_HOMEWORK_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface HomeworkSolveUpload {
  file: File;
  fileName: string;
  isPdf: boolean;
  isImage: boolean;
}

export interface HomeworkSolveInput {
  uploads: HomeworkSolveUpload[];
  language: HomeworkLanguage;
  pdfProviderId?: PDFProviderId;
  pdfApiKey?: string;
  pdfBaseUrl?: string;
}

interface GeneratedHomeworkQuestion {
  question?: string;
  answer?: string;
  solution?: string;
  knowledgePoints?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  confidence?: 'low' | 'medium' | 'high';
}

interface GeneratedHomeworkResponse {
  title?: string;
  questions?: GeneratedHomeworkQuestion[];
}

export function parseHomeworkLanguage(value: FormDataEntryValue | null): HomeworkLanguage {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
}

function isSupportedImage(file: File): boolean {
  return SUPPORTED_HOMEWORK_IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name);
}

export function getHomeworkUploads(formData: FormData): HomeworkSolveUpload[] {
  const values = [...formData.getAll('files'), ...formData.getAll('file')];
  const seen = new Set<File>();
  const uploads: HomeworkSolveUpload[] = [];

  for (const value of values) {
    if (!(value instanceof File) || seen.has(value)) continue;
    seen.add(value);
    const fileName = value.name || 'homework';
    const isPdf = value.type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    const isImage = isSupportedImage(value);
    uploads.push({
      file: value,
      fileName,
      isPdf,
      isImage,
    });
  }

  return uploads;
}

export function validateHomeworkUploads(uploads: HomeworkSolveUpload[]): void {
  if (uploads.length === 0) {
    throw new Error('file is required');
  }

  for (const upload of uploads) {
    if (!upload.isPdf && !upload.isImage) {
      throw new Error('Only PDF, PNG, JPEG, WebP, HEIC, and HEIF files are supported');
    }
    if (upload.isPdf && upload.file.size > HOMEWORK_MAX_PDF_BYTES) {
      throw new Error(`PDF file is too large: ${upload.fileName}`);
    }
    if (upload.isImage && upload.file.size > HOMEWORK_MAX_IMAGE_BYTES) {
      throw new Error(`Image file is too large: ${upload.fileName}`);
    }
  }
}

function isHeicImage(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name);
}

async function getVisionImageDataUrl(file: File): Promise<string> {
  const imageBuffer = Buffer.from(await file.arrayBuffer());
  if (!isHeicImage(file)) {
    return `data:${file.type || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`;
  }

  const jpegBuffer = await sharp(imageBuffer)
    .rotate()
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
}

function isMineruUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('MinerU local service is not reachable');
}

function resolveMineruPort(baseUrl?: string): number {
  if (!baseUrl) return MINERU_DEFAULT_PORT;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) {
      const port = Number.parseInt(parsed.port, 10);
      if (Number.isFinite(port) && port > 0) return port;
    }
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return MINERU_DEFAULT_PORT;
  }
}

async function parseHomeworkPdf(params: {
  file: File;
  fileName: string;
  providerId?: PDFProviderId;
  apiKey?: string;
  baseUrl?: string;
  ownerId?: string;
  onProgress?: (progress: HomeworkSolveProgress) => Promise<void> | void;
}): Promise<string> {
  const effectiveProviderId: PDFProviderId =
    params.providerId && params.providerId in PDF_PROVIDERS ? params.providerId : 'mineru-local';
  const config = {
    providerId: effectiveProviderId,
    apiKey: params.apiKey?.trim() || undefined,
    baseUrl: params.baseUrl?.trim() || undefined,
    mode: 'accurate' as const,
    needsImages: false,
    needsCover: false,
    needsMiddleJson: false,
  };
  const buffer = Buffer.from(await params.file.arrayBuffer());

  await params.onProgress?.({
    stage: 'parsing_pdf',
    progress: 20,
    message: `Parsing PDF "${params.fileName}" with ${effectiveProviderId}.`,
  });

  const runParse = async (signal?: AbortSignal): Promise<string> => {
    try {
      const result = await parsePDF(buffer, { ...config, signal });
      await params.onProgress?.({
        stage: 'parsing_pdf',
        progress: 45,
        message: `Finished parsing PDF "${params.fileName}".`,
      });
      return result.text;
    } catch (error) {
      if (effectiveProviderId !== 'mineru-local' || !isMineruUnavailableError(error)) {
        throw error;
      }
      const port = resolveMineruPort(config.baseUrl);
      await params.onProgress?.({
        stage: 'parsing_pdf',
        progress: 24,
        message: `MinerU is not reachable; starting local service on port ${port}.`,
      });
      const serviceResult = await ensureLocalModelServiceRunning('mineru', { port });
      const result = await parsePDF(
        buffer,
        serviceResult?.baseUrl
          ? { ...config, baseUrl: serviceResult.baseUrl, signal }
          : { ...config, signal },
      );
      await params.onProgress?.({
        stage: 'parsing_pdf',
        progress: 45,
        message: `Finished parsing PDF "${params.fileName}".`,
      });
      return result.text;
    }
  };

  if (effectiveProviderId === 'mineru-local') {
    return enqueueMineruPdfTask({
      fileName: params.fileName,
      source: 'homework',
      ownerId: params.ownerId,
      execute: ({ signal }) => runParse(signal),
    });
  }

  return runParse();
}

function buildSystemPrompt(language: HomeworkLanguage): string {
  return language === 'zh-CN'
    ? `你是 Bingo 的作业陪写老师。你的任务是先给出练习题参考答案和解题过程，方便学生自己对答案。
要求：
- 不要只报答案，要写出学生能跟着核对的关键步骤。
- 如果图片或 PDF 中题目不清晰，尽量根据可见信息作答，并把不确定处写在 confidence=low 的题目里。
- 提取每题关联的知识点，供后续用户画像记录。
- 只输出 JSON，不要 Markdown。`
    : `You are Bingo's homework companion. First generate reference answers and solution steps so the student can check their own work.
Requirements:
- Do not only give final answers. Include key steps students can follow.
- If the image or PDF is unclear, answer from visible information and set confidence=low.
- Extract knowledge points for learning profile records.
- Output JSON only, no Markdown.`;
}

function buildUserPrompt(params: {
  language: HomeworkLanguage;
  fileNames: string[];
  pdfSections?: Array<{ fileName: string; text: string }>;
}): string {
  const fileList = params.fileNames.map((name, index) => `${index + 1}. ${name}`).join('\n');
  const pdfText = (params.pdfSections || [])
    .map((section, index) => `--- PDF ${index + 1}: ${section.fileName} ---\n${section.text.slice(0, 60000)}`)
    .join('\n\n');

  if (params.language === 'zh-CN') {
    return `请解析这些练习/作业文件，并按题目顺序生成参考答案。

文件：
${fileList}

${pdfText ? `PDF 文本：\n${pdfText}\n\n` : ''}
输出 JSON 格式：
{
  "title": "这组作业的简短标题",
  "questions": [
    {
      "question": "题目原文或可见题意",
      "answer": "参考答案",
      "solution": "解题过程",
      "knowledgePoints": ["知识点1", "知识点2"],
      "difficulty": "easy|medium|hard",
      "confidence": "low|medium|high"
    }
  ]
}`;
  }

  return `Analyze these homework/practice files and generate reference answers in order.

Files:
${fileList}

${pdfText ? `PDF text:\n${pdfText}\n\n` : ''}
Return JSON:
{
  "title": "Short title",
  "questions": [
    {
      "question": "Original question or visible task",
      "answer": "Reference answer",
      "solution": "Solution steps",
      "knowledgePoints": ["point 1", "point 2"],
      "difficulty": "easy|medium|hard",
      "confidence": "low|medium|high"
    }
  ]
}`;
}

function normalizeQuestions(parsed: GeneratedHomeworkResponse): HomeworkQuestionSolution[] {
  const normalized: HomeworkQuestionSolution[] = [];

  for (const question of parsed.questions || []) {
    const prompt = question.question?.trim() || '';
    const answer = question.answer?.trim() || '';
    const solution = question.solution?.trim() || '';
    if (!prompt || (!answer && !solution)) continue;

    normalized.push({
      id: nanoid(),
      question: prompt,
      answer: answer || solution,
      solution: solution || answer,
      knowledgePoints: Array.isArray(question.knowledgePoints)
        ? question.knowledgePoints
            .filter((point): point is string => typeof point === 'string')
            .map((point) => point.trim())
            .filter(Boolean)
            .slice(0, 6)
        : [],
      difficulty: question.difficulty || 'medium',
      confidence: question.confidence || 'medium',
    });
  }

  return normalized.slice(0, 40);
}

export async function solveHomework(
  input: HomeworkSolveInput,
  resolved: ResolvedModel,
  options: {
    onProgress?: (progress: HomeworkSolveProgress) => Promise<void> | void;
    mineruOwnerId?: string;
  } = {},
): Promise<HomeworkSolveResult> {
  const { uploads, language } = input;
  validateHomeworkUploads(uploads);
  const fileNames = uploads.map((upload) => upload.fileName);
  const pdfSections: Array<{ fileName: string; text: string }> = [];
  const visionImages: Array<{ id: string; src: string }> = [];
  const hasVision = !!resolved.modelInfo?.capabilities?.vision;
  let messages:
    | Array<{
        role: 'user';
        content: ReturnType<typeof buildVisionUserContent>;
      }>
    | undefined;

  await options.onProgress?.({
    stage: 'validating',
    progress: 10,
    message: `Validated ${uploads.length} uploaded file${uploads.length === 1 ? '' : 's'}.`,
  });

  for (const [index, upload] of uploads.entries()) {
    if (upload.isPdf) {
      const text = await parseHomeworkPdf({
        file: upload.file,
        fileName: upload.fileName,
        providerId: input.pdfProviderId,
        apiKey: input.pdfApiKey,
        baseUrl: input.pdfBaseUrl,
        ownerId: options.mineruOwnerId,
        onProgress: options.onProgress,
      });
      if (!text.trim()) {
        throw new Error(`Failed to extract text from the PDF: ${upload.fileName}`);
      }
      pdfSections.push({ fileName: upload.fileName, text });
      continue;
    }

    if (!hasVision) {
      throw new Error(
        language === 'zh-CN'
          ? '当前模型不支持图片识别，请切换到支持视觉的模型，或上传 PDF。'
          : 'The selected model does not support image understanding. Use a vision model or upload a PDF.',
      );
    }
    await options.onProgress?.({
      stage: 'preparing_images',
      progress: 30,
      message: `Preparing image "${upload.fileName}" for vision model input.`,
    });
    const dataUrl = await getVisionImageDataUrl(upload.file);
    visionImages.push({ id: `homework_image_${index + 1}`, src: dataUrl });
  }

  if (visionImages.length > 0) {
    messages = [
      {
        role: 'user',
        content: buildVisionUserContent(
          buildUserPrompt({ language, fileNames, pdfSections }),
          visionImages,
        ),
      },
    ];
  }

  await options.onProgress?.({
    stage: 'dictionary_lookup',
    progress: 55,
    message: 'Looking up Chinese dictionary context.',
  });
  const dictionaryContext = await buildChineseXinhuaPromptContext({
    text: [fileNames.join('\n'), ...pdfSections.map((section) => section.text.slice(0, 12000))].join(
      '\n',
    ),
    language,
    limit: 10,
  });
  const systemPrompt = dictionaryContext
    ? `${buildSystemPrompt(language)}\n\n# Chinese Dictionary References\n${dictionaryContext}`
    : buildSystemPrompt(language);

  await options.onProgress?.({
    stage: 'generating_answers',
    progress: 70,
    message: `Generating homework answers with ${resolved.modelString}.`,
  });
  const result = await callLLM(
    {
      model: resolved.model,
      system: systemPrompt,
      ...(messages ? { messages } : { prompt: buildUserPrompt({ language, fileNames, pdfSections }) }),
      maxOutputTokens: resolved.modelInfo?.outputWindow,
    },
    'homework-solve',
  );

  await options.onProgress?.({
    stage: 'parsing_result',
    progress: 88,
    message: 'Parsing generated answer JSON.',
  });
  const parsed = parseJsonResponse<GeneratedHomeworkResponse>(result.text);
  const questions = parsed ? normalizeQuestions(parsed) : [];
  if (questions.length === 0) {
    throw new Error('Failed to parse homework answers');
  }

  return {
    title: parsed?.title?.trim() || uploads[0]?.fileName.replace(/\.[^.]+$/, '') || 'homework',
    fileName: fileNames.join(', '),
    fileType: uploads.some((upload) => upload.isPdf) ? 'pdf' : 'image',
    files: uploads.map((upload) => ({
      name: upload.fileName,
      type: upload.isPdf ? 'pdf' : 'image',
      size: upload.file.size,
    })),
    language,
    questions,
    model: resolved.modelString,
  };
}

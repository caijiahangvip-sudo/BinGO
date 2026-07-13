'use client';

import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Check, FileImage, Loader2, Upload, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useStageStore } from '@/lib/store';
import type { Scene, Stage } from '@/lib/types/stage';
import { cn } from '@/lib/utils';
import { getModelApiHeaders } from '@/lib/utils/model-config';

type InitialStage = 'Debate_Flow' | 'wait_for_user_teaching';

export interface BingoVisionAgent {
  id?: string;
  name: string;
  role?: string;
  initialViewpoint: string;
  openingLine?: string;
  guidance?: string[];
  conflictPoint?: string;
}

export interface BingoVisionScriptStep {
  speaker: string;
  intent?: string;
  message: string;
}

export interface BingoVisionConfig {
  discussionTopic: string;
  initialStage: InitialStage;
  extractedMarkdown: string;
  agents: BingoVisionAgent[];
  teacherGuide?: string[];
  scriptFlow?: BingoVisionScriptStep[];
}

interface QuestionVisionSuccessResponse {
  success: true;
  config: BingoVisionConfig;
}

interface QuestionVisionErrorResponse {
  success: false;
  error: string;
  errorCode?: string;
  details?: string;
}

type QuestionVisionResponse = QuestionVisionSuccessResponse | QuestionVisionErrorResponse;

interface ImageUploaderProps {
  className?: string;
  onGenerated?: (config: BingoVisionConfig, stage: Stage, scenes: Scene[]) => void;
}

const MAX_WIDTH = 1200;
const JPEG_QUALITY = 0.86;

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function markdownToHtml(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />');
}

function buildInteractiveHtml(config: BingoVisionConfig): string {
  const agents = config.agents
    .map(
      (agent) => `
        <article class="agent">
          <div class="agent-name">${escapeHtml(agent.name)}</div>
          <div class="agent-role">${escapeHtml(agent.role || '')}</div>
          <p>${escapeHtml(agent.openingLine || agent.initialViewpoint)}</p>
          ${
            agent.conflictPoint
              ? `<p class="conflict">分歧点：${escapeHtml(agent.conflictPoint)}</p>`
              : ''
          }
        </article>`,
    )
    .join('');

  const scriptFlow = (config.scriptFlow || [])
    .map(
      (step) => `
        <li>
          <strong>${escapeHtml(step.speaker)}</strong>
          ${step.intent ? `<span>${escapeHtml(step.intent)}</span>` : ''}
          <p>${escapeHtml(step.message)}</p>
        </li>`,
    )
    .join('');

  const teacherGuide = (config.teacherGuide || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(config.discussionTopic)}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, "Microsoft YaHei", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f7f7f4; color: #1e293b; }
      main { min-height: 100vh; padding: 32px; display: grid; gap: 24px; }
      .header { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
      h1 { margin: 0; font-size: 28px; line-height: 1.25; letter-spacing: 0; }
      h2 { margin: 0 0 12px; font-size: 18px; }
      h3 { margin: 16px 0 8px; font-size: 16px; }
      .badge { border: 1px solid #cbd5e1; border-radius: 999px; padding: 6px 10px; background: white; font-size: 13px; white-space: nowrap; }
      .grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr); gap: 20px; }
      section, .agent { border: 1px solid #d7ddd7; border-radius: 8px; background: rgba(255,255,255,0.86); padding: 18px; box-shadow: 0 10px 32px rgba(15, 23, 42, 0.06); }
      .question { line-height: 1.7; }
      .agents { display: grid; gap: 14px; }
      .agent-name { font-weight: 700; }
      .agent-role { color: #64748b; font-size: 13px; margin-top: 2px; }
      .conflict { color: #9a3412; background: #fff7ed; border-radius: 6px; padding: 10px; }
      ol, ul { padding-left: 22px; }
      li { margin: 8px 0; }
      li span { color: #64748b; margin-left: 8px; font-size: 13px; }
      @media (max-width: 820px) {
        main { padding: 20px; }
        .header { display: grid; }
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="header">
        <h1>${escapeHtml(config.discussionTopic)}</h1>
        <div class="badge">${escapeHtml(config.initialStage)}</div>
      </div>
      <div class="grid">
        <section>
          <h2>题目校对稿</h2>
          <div class="question">${markdownToHtml(config.extractedMarkdown)}</div>
        </section>
        <section>
          <h2>Agent 观点冲突</h2>
          <div class="agents">${agents}</div>
        </section>
      </div>
      ${scriptFlow ? `<section><h2>互动流程</h2><ol>${scriptFlow}</ol></section>` : ''}
      ${teacherGuide ? `<section><h2>引导要点</h2><ul>${teacherGuide}</ul></section>` : ''}
    </main>
  </body>
</html>`;
}

function normalizeConfigForStore(config: BingoVisionConfig): BingoVisionConfig {
  const agents = Array.isArray(config.agents) ? [...config.agents] : [];
  while (agents.length < 2) {
    const index = agents.length;
    agents.push({
      id: `agent-${index + 1}`,
      name: index === 0 ? 'Agent A' : 'Agent B',
      role: index === 0 ? '直觉解法提出者' : '严谨推理挑战者',
      initialViewpoint: index === 0 ? '先给出一种直接解法。' : '检查直接解法中的条件和逻辑漏洞。',
      openingLine: index === 0 ? '我先用最直接的思路试一下。' : '我想先核对这个推法是否成立。',
    });
  }

  return {
    ...config,
    discussionTopic: config.discussionTopic.trim() || '拍照互动课',
    initialStage:
      config.initialStage === 'wait_for_user_teaching' ? 'wait_for_user_teaching' : 'Debate_Flow',
    extractedMarkdown: config.extractedMarkdown.trim(),
    agents: agents.slice(0, 4).map((agent, index) => ({
      ...agent,
      id: agent.id || `vision-agent-${index + 1}`,
      name: agent.name || (index === 0 ? 'Agent A' : 'Agent B'),
      initialViewpoint: agent.initialViewpoint || '提出一种解题观点。',
    })),
  };
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = dataUrl;
  });
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('图片读取失败'));
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }

  const originalDataUrl = await fileToDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const scale = image.naturalWidth > MAX_WIDTH ? MAX_WIDTH / image.naturalWidth : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前浏览器不支持 Canvas 图片压缩');
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function parseConfigText(value: string): BingoVisionConfig {
  const parsed = JSON.parse(value) as Partial<BingoVisionConfig>;
  if (
    !parsed ||
    typeof parsed.discussionTopic !== 'string' ||
    typeof parsed.extractedMarkdown !== 'string' ||
    !Array.isArray(parsed.agents)
  ) {
    throw new Error('JSON 必须包含 discussionTopic、extractedMarkdown 和 agents');
  }

  return normalizeConfigForStore(parsed as BingoVisionConfig);
}

export function ImageUploader({ className, onGenerated }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [configText, setConfigText] = useState('');
  const [markdownText, setMarkdownText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const setStage = useStageStore((state) => state.setStage);
  const setScenes = useStageStore((state) => state.setScenes);
  const setCurrentSceneId = useStageStore((state) => state.setCurrentSceneId);

  const currentConfig = useMemo(() => {
    if (!configText.trim()) return null;
    try {
      return parseConfigText(configText);
    } catch {
      return null;
    }
  }, [configText]);

  async function handleFile(file: File) {
    setError(null);
    setGeneratedMessage(null);
    setIsLoading(true);
    setFileName(file.name);

    try {
      const imageDataUrl = await compressImage(file);
      setPreviewDataUrl(imageDataUrl);

      const response = await fetch('/api/question-vision', {
        method: 'POST',
        headers: getModelApiHeaders(),
        body: JSON.stringify({ imageDataUrl, fileName: file.name }),
      });
      const data = (await response.json()) as QuestionVisionResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.success ? '视觉模型处理失败' : data.error);
      }

      const normalized = normalizeConfigForStore(data.config);
      setMarkdownText(normalized.extractedMarkdown);
      setConfigText(JSON.stringify(normalized, null, 2));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '图片处理失败');
    } finally {
      setIsLoading(false);
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function handleMarkdownChange(value: string) {
    setMarkdownText(value);
    try {
      const config = parseConfigText(configText);
      setConfigText(JSON.stringify({ ...config, extractedMarkdown: value }, null, 2));
      setError(null);
    } catch {
      setConfigText((previous) => previous);
    }
  }

  function handleGenerateClassroom() {
    setError(null);
    setGeneratedMessage(null);

    try {
      const config = parseConfigText(configText);
      const finalConfig = normalizeConfigForStore({
        ...config,
        extractedMarkdown: markdownText.trim() || config.extractedMarkdown,
      });
      const now = Date.now();
      const stageId = createId('stage');
      const sceneId = createId('scene');
      const agentIds = finalConfig.agents.map(
        (agent, index) => agent.id || `vision-agent-${index + 1}`,
      );
      const stage: Stage = {
        id: stageId,
        name: finalConfig.discussionTopic,
        description: finalConfig.extractedMarkdown.slice(0, 280),
        createdAt: now,
        updatedAt: now,
        agentIds,
        generatedAgentConfigs: finalConfig.agents.map((agent, index) => ({
          id: agentIds[index],
          name: agent.name,
          role: agent.role || '互动课讨论 Agent',
          persona: agent.initialViewpoint,
          avatar: index === 0 ? 'A' : 'B',
          color: index === 0 ? '#2563eb' : '#b45309',
          priority: index + 1,
        })),
      };
      const scene: Scene = {
        id: sceneId,
        stageId,
        type: 'interactive',
        title: finalConfig.discussionTopic,
        order: 0,
        content: {
          type: 'interactive',
          url: 'about:blank',
          html: buildInteractiveHtml(finalConfig),
        },
        multiAgent: {
          enabled: true,
          agentIds,
          directorPrompt: [
            `围绕“${finalConfig.discussionTopic}”组织互动讨论。`,
            '先让 Agent A 和 Agent B 暴露不同解题思路，再追问学生判断哪一步成立。',
            `题目 Markdown：\n${finalConfig.extractedMarkdown}`,
          ].join('\n\n'),
        },
        createdAt: now,
        updatedAt: now,
      };

      setStage(stage);
      setScenes([scene]);
      setCurrentSceneId(sceneId);
      onGenerated?.(finalConfig, stage, [scene]);
      setGeneratedMessage('已生成互动课堂并写入当前课堂状态');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成互动课堂失败');
    }
  }

  return (
    <div className={cn('grid gap-4', className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleInputChange}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/25 px-6 py-8 text-center transition-colors',
          isDragging && 'border-primary bg-primary/5',
          isLoading && 'pointer-events-none opacity-70',
        )}
      >
        <div className="flex size-12 items-center justify-center rounded-md border bg-background">
          {isLoading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-medium">拖入题目图片，或点击上传</p>
          <p className="text-xs text-muted-foreground">
            浏览器会先压缩到最长边 {MAX_WIDTH}px，再发送给视觉模型
          </p>
        </div>
        {fileName ? (
          <div className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
            <FileImage className="size-3.5" />
            <span className="max-w-56 truncate">{fileName}</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <X className="size-4" />
          <AlertTitle>处理失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {generatedMessage ? (
        <Alert>
          <Check className="size-4" />
          <AlertTitle>已生成</AlertTitle>
          <AlertDescription>{generatedMessage}</AlertDescription>
        </Alert>
      ) : null}

      {previewDataUrl || configText ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.55fr)_minmax(0,1fr)]">
          {previewDataUrl ? (
            <div className="overflow-hidden rounded-lg border bg-background">
              <img
                src={previewDataUrl}
                alt="上传题目预览"
                className="h-auto w-full object-contain"
              />
            </div>
          ) : null}

          <div className="grid gap-3">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor="question-markdown">
                  OCR Markdown
                </label>
                {currentConfig ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {currentConfig.discussionTopic}
                  </span>
                ) : null}
              </div>
              <Textarea
                id="question-markdown"
                value={markdownText}
                onChange={(event) => handleMarkdownChange(event.target.value)}
                placeholder="模型识别出的题目 Markdown 会显示在这里"
                className="min-h-36 font-mono text-sm"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="bingo-config-json">
                BinGo 互动课 JSON
              </label>
              <Textarea
                id="bingo-config-json"
                value={configText}
                onChange={(event) => {
                  setConfigText(event.target.value);
                  setGeneratedMessage(null);
                }}
                placeholder="视觉模型生成的互动课 JSON 会显示在这里"
                className="min-h-64 font-mono text-sm"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!configText || isLoading}
                onClick={() => {
                  setConfigText('');
                  setMarkdownText('');
                  setPreviewDataUrl(null);
                  setFileName(null);
                  setError(null);
                  setGeneratedMessage(null);
                }}
              >
                清空
              </Button>
              <Button
                type="button"
                disabled={!configText || isLoading}
                onClick={handleGenerateClassroom}
              >
                <Check className="size-4" />
                生成互动课堂
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ImageUploader;

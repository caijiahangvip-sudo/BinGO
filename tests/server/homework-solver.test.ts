import { beforeEach, describe, expect, it, vi } from 'vitest';

const callLLMMock = vi.hoisted(() => vi.fn());
const sharpMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/llm', () => ({
  callLLM: callLLMMock,
}));

vi.mock('@/lib/server/chinese-xinhua', () => ({
  buildChineseXinhuaPromptContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('sharp', () => ({
  default: sharpMock,
}));

describe('homework solver uploads', () => {
  beforeEach(() => {
    vi.resetModules();
    callLLMMock.mockReset();
    callLLMMock.mockResolvedValue({
      text: JSON.stringify({
        title: 'HEIC homework',
        questions: [
          {
            question: '1 + 1',
            answer: '2',
            solution: 'Add the numbers.',
            knowledgePoints: ['addition'],
            difficulty: 'easy',
            confidence: 'high',
          },
        ],
      }),
    });
    sharpMock.mockReset();
    sharpMock.mockReturnValue({
      rotate: () => ({
        jpeg: () => ({
          toBuffer: async () => Buffer.from('converted-jpeg'),
        }),
      }),
    });
  });

  it('accepts HEIC and HEIF homework image uploads', async () => {
    const { getHomeworkUploads, validateHomeworkUploads } = await import(
      '@/lib/server/homework-solver'
    );
    const formData = new FormData();
    formData.append('files', new File(['heic-bytes'], 'photo.heic', { type: 'image/heic' }));
    formData.append('files', new File(['heif-bytes'], 'photo.heif', { type: 'image/heif' }));

    const uploads = getHomeworkUploads(formData);

    expect(uploads).toHaveLength(2);
    expect(uploads.every((upload) => upload.isImage)).toBe(true);
    expect(() => validateHomeworkUploads(uploads)).not.toThrow();
  }, 15_000);

  it('converts HEIC images to JPEG before sending them to the vision model', async () => {
    const { solveHomework } = await import('@/lib/server/homework-solver');

    await solveHomework(
      {
        uploads: [
          {
            file: new File(['heic-bytes'], 'worksheet.heic', { type: 'image/heic' }),
            fileName: 'worksheet.heic',
            isPdf: false,
            isImage: true,
          },
        ],
        language: 'zh-CN',
      },
      {
        model: 'vision-model',
        modelString: 'vision-model',
        apiKey: '',
        modelInfo: {
          id: 'vision-model',
          name: 'Vision Model',
          capabilities: { vision: true },
        },
      },
    );

    expect(sharpMock).toHaveBeenCalled();
    const params = callLLMMock.mock.calls[0]?.[0] as {
      messages?: Array<{
        content: Array<{ type: string; image?: string; mimeType?: string }>;
      }>;
    };
    const imagePart = params.messages?.[0]?.content.find((part) => part.type === 'image');
    expect(imagePart?.mimeType).toBe('image/jpeg');
    expect(imagePart?.image).toBe(Buffer.from('converted-jpeg').toString('base64'));
  }, 15_000);
});

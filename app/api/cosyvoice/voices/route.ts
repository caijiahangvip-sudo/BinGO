import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export const runtime = 'nodejs';

const VOICE_DIR = path.join(process.cwd(), 'data', 'cosyvoice-voices');
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function getAudioExtension(file: File) {
  const extension = path.extname(file.name || '').toLowerCase();
  if (['.wav', '.mp3', '.m4a', '.webm', '.ogg', '.flac'].includes(extension)) {
    return extension;
  }
  if (file.type.includes('wav')) return '.wav';
  if (file.type.includes('mpeg') || file.type.includes('mp3')) return '.mp3';
  if (file.type.includes('webm')) return '.webm';
  if (file.type.includes('ogg')) return '.ogg';
  if (file.type.includes('flac')) return '.flac';
  return '.wav';
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const name = String(formData.get('name') || '').trim();
    const promptText = String(formData.get('promptText') || '').trim();
    const audio = formData.get('audio');

    if (!name) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Voice name is required');
    }
    if (!promptText) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Prompt text is required');
    }
    if (!(audio instanceof File) || audio.size === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Prompt audio is required');
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return apiError('INVALID_REQUEST', 400, 'Prompt audio is too large');
    }

    await fs.promises.mkdir(VOICE_DIR, { recursive: true });

    const id = `cosyvoice_clone_${nanoid(10)}`;
    const fileName = `${id}-${sanitizeFileName(name) || 'voice'}${getAudioExtension(audio)}`;
    const filePath = path.join(VOICE_DIR, fileName);
    const buffer = Buffer.from(await audio.arrayBuffer());
    await fs.promises.writeFile(filePath, buffer);

    return apiSuccess({
      voice: {
        id,
        name,
        promptText,
        promptAudioPath: filePath,
        createdAt: Date.now(),
        audioSize: buffer.byteLength,
      },
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

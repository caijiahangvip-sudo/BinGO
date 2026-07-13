const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  flac: 'audio/flac',
  pcm: 'audio/wav',
};

export function normalizeAudioFormat(format?: string | null): string {
  const cleaned = (format || 'mp3')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .split(';')[0]
    .trim();

  if (!cleaned) return 'mp3';
  if (cleaned === 'x-wav') return 'wav';
  if (cleaned === 'mpeg3') return 'mp3';
  return cleaned;
}

export function getAudioMimeType(format?: string | null): string {
  const normalized = normalizeAudioFormat(format);
  return AUDIO_MIME_TYPES[normalized] || `audio/${normalized}`;
}

export function createAudioBlob(bytes: Uint8Array, format?: string | null): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: getAudioMimeType(format) });
}

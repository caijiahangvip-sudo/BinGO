/**
 * Client-side audio conversion to PCM16 WAV (16kHz mono by default).
 *
 * Some ASR providers (e.g. Doubao Seed-ASR) require raw PCM16 input and
 * cannot decode webm/opus recordings. This helper decodes any browser
 * recording with WebAudio and re-encodes it as a PCM16 WAV blob before
 * upload. Browser/Tauri renderer only.
 */

/**
 * Decode an audio blob (webm/opus/mp3/wav/...) and return a PCM16 WAV blob
 * at the given sample rate, downmixed to mono.
 */
export async function convertToPcm16WavBlob(blob: Blob, sampleRate = 16000): Promise<Blob> {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('WebAudio is not available in this environment');
  }

  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContextCtor();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const offline = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return encodePcm16Wav(rendered.getChannelData(0), sampleRate);
  } finally {
    void audioCtx.close().catch(() => undefined);
  }
}

/**
 * Encode mono float samples (-1..1) as a PCM16 WAV blob.
 */
export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

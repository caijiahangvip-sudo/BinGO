/**
 * ASR (Automatic Speech Recognition) Provider Implementation
 *
 * Factory pattern for routing ASR requests to appropriate provider implementations.
 * Follows the same architecture as lib/ai/providers.ts for consistency.
 *
 * Currently Supported Providers:
 * - OpenAI Whisper: https://platform.openai.com/docs/guides/speech-to-text
 * - Browser Native: Web Speech API (https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
 * - Qwen ASR: https://bailian.console.aliyun.com/
 *
 * HOW TO ADD A NEW PROVIDER:
 *
 * 1. Add provider ID to ASRProviderId in lib/audio/types.ts
 *    Example: | 'assemblyai-asr'
 *
 * 2. Add provider configuration to lib/audio/constants.ts
 *    Example:
 *    'assemblyai-asr': {
 *      id: 'assemblyai-asr',
 *      name: 'AssemblyAI',
 *      requiresApiKey: true,
 *      defaultBaseUrl: 'https://api.assemblyai.com/v2',
 *      icon: '/assemblyai.svg',
 *      supportedLanguages: ['en', 'es', 'fr', 'de', 'auto'],
 *      supportedFormats: ['mp3', 'wav', 'flac', 'm4a']
 *    }
 *
 * 3. Implement provider function in this file
 *    Pattern: async function transcribeXxxASR(config, audioBuffer): Promise<ASRTranscriptionResult>
 *    - Handle Buffer/Blob conversion (see helper patterns below)
 *    - Build API request with audio data (FormData or base64)
 *    - Handle API authentication (apiKey, headers)
 *    - Convert language codes if needed
 *    - Return { text: string }
 *
 *    Example:
 *    async function transcribeAssemblyAIASR(
 *      config: ASRModelConfig,
 *      audioBuffer: Buffer | Blob
 *    ): Promise<ASRTranscriptionResult> {
 *      const baseUrl = config.baseUrl || ASR_PROVIDERS['assemblyai-asr'].defaultBaseUrl;
 *
 *      // Step 1: Upload audio file
 *      let blob: Blob;
 *      if (audioBuffer instanceof Buffer) {
 *        blob = new Blob([audioBuffer.buffer.slice(
 *          audioBuffer.byteOffset,
 *          audioBuffer.byteOffset + audioBuffer.byteLength
 *        ) as ArrayBuffer], { type: 'audio/webm' });
 *      } else {
 *        blob = audioBuffer;
 *      }
 *
 *      const uploadResponse = await fetch(`${baseUrl}/upload`, {
 *        method: 'POST',
 *        headers: {
 *          'authorization': config.apiKey!,
 *        },
 *        body: blob,
 *      });
 *
 *      if (!uploadResponse.ok) {
 *        throw new Error(`AssemblyAI upload error: ${uploadResponse.statusText}`);
 *      }
 *
 *      const { upload_url } = await uploadResponse.json();
 *
 *      // Step 2: Request transcription
 *      const transcriptResponse = await fetch(`${baseUrl}/transcript`, {
 *        method: 'POST',
 *        headers: {
 *          'authorization': config.apiKey!,
 *          'Content-Type': 'application/json',
 *        },
 *        body: JSON.stringify({
 *          audio_url: upload_url,
 *          language_code: config.language === 'auto' ? undefined : config.language,
 *        }),
 *      });
 *
 *      const { id } = await transcriptResponse.json();
 *
 *      // Step 3: Poll for completion
 *      while (true) {
 *        const statusResponse = await fetch(`${baseUrl}/transcript/${id}`, {
 *          headers: { 'authorization': config.apiKey! },
 *        });
 *        const result = await statusResponse.json();
 *
 *        if (result.status === 'completed') {
 *          return { text: result.text || '' };
 *        } else if (result.status === 'error') {
 *          throw new Error(`AssemblyAI error: ${result.error}`);
 *        }
 *
 *        await new Promise(resolve => setTimeout(resolve, 1000));
 *      }
 *    }
 *
 * 4. Add case to transcribeAudio() switch statement
 *    case 'assemblyai-asr':
 *      return await transcribeAssemblyAIASR(config, audioBuffer);
 *
 * 5. Add i18n translations in lib/i18n.ts
 *    providerAssemblyAIASR: { zh: 'AssemblyAI 语音识别', en: 'AssemblyAI ASR' }
 *
 * Buffer/Blob Conversion Patterns:
 *
 * Pattern 1: Buffer to Blob (for FormData)
 *   const blob = new Blob([
 *     audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer
 *   ], { type: 'audio/webm' });
 *
 * Pattern 2: Buffer to base64 (for JSON API)
 *   let base64Audio: string;
 *   if (audioBuffer instanceof Buffer) {
 *     base64Audio = audioBuffer.toString('base64');
 *   } else {
 *     const arrayBuffer = await audioBuffer.arrayBuffer();
 *     base64Audio = Buffer.from(arrayBuffer).toString('base64');
 *   }
 *
 * Pattern 3: Buffer/Blob to File (for Vercel AI SDK)
 *   let audioFile: File;
 *   if (audioBuffer instanceof Buffer) {
 *     const arrayBuffer = audioBuffer.buffer.slice(...) as ArrayBuffer;
 *     const blob = new Blob([arrayBuffer], { type: 'audio/webm' });
 *     audioFile = new File([blob], 'audio.webm', { type: 'audio/webm' });
 *   } else {
 *     audioFile = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
 *   }
 *
 * Error Handling Patterns:
 * - Always validate API key if requiresApiKey is true
 * - Throw descriptive errors for API failures
 * - Include response.statusText or error messages from API
 * - For client-only providers (browser-native), throw error directing to client-side usage
 * - Handle polling/async APIs with proper timeout and error checking
 *
 * API Call Patterns:
 * - Vercel AI SDK: Use createOpenAI + transcribe (OpenAI, compatible providers)
 * - FormData: For providers expecting multipart/form-data (most providers)
 * - Base64: For providers expecting JSON with base64 audio (Qwen, DashScope)
 * - Upload + Poll: For async providers (AssemblyAI, Deepgram batch)
 */

import { createOpenAI } from '@ai-sdk/openai';
import { experimental_transcribe as transcribe } from 'ai';
import { randomUUID } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import type { ASRModelConfig } from './types';
import { ASR_PROVIDERS } from './constants';
import { stripEndpointPath } from '@/lib/utils/api-url';
import { resolveEndpointUrl } from '@/lib/utils/api-url';

/**
 * Result of ASR transcription
 */
export interface ASRTranscriptionResult {
  text: string;
}

/**
 * Transcribe audio using specified ASR provider
 */
export async function transcribeAudio(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const provider = ASR_PROVIDERS[config.providerId];
  if (!provider) {
    throw new Error(`Unknown ASR provider: ${config.providerId}`);
  }

  // Validate API key if required
  if (provider.requiresApiKey && !config.apiKey) {
    throw new Error(`API key required for ASR provider: ${config.providerId}`);
  }

  switch (config.providerId) {
    case 'openai-whisper':
      return await transcribeOpenAIWhisper(config, audioBuffer);

    case 'browser-native':
      throw new Error('Browser Native ASR must be handled client-side using useBrowserASR hook');

    case 'qwen-asr':
      return await transcribeQwenASR(config, audioBuffer);

    case 'sensevoice-asr':
      return await transcribeSenseVoiceASR(config, audioBuffer);

    case 'doubao-asr':
      return await transcribeDoubaoASR(config, audioBuffer);

    default:
      throw new Error(`Unsupported ASR provider: ${config.providerId}`);
  }
}

// ---------------------------------------------------------------------------
// Doubao ASR (Volcengine Seed-ASR via Agent Plan gateway)
// ---------------------------------------------------------------------------

const DOUBAO_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration';
const DOUBAO_ASR_SAMPLE_RATE = 16000;
const DOUBAO_ASR_SEGMENT_DURATION_MS = 200;
const DOUBAO_ASR_TIMEOUT_MS = 120_000;

// Binary protocol header nibble values (Volcengine SAUC protocol)
const DOUBAO_MSG_TYPE_FULL_CLIENT_REQUEST = 0b0001;
const DOUBAO_MSG_TYPE_AUDIO_ONLY_REQUEST = 0b0010;
const DOUBAO_MSG_TYPE_FULL_SERVER_RESPONSE = 0b1001;
const DOUBAO_MSG_TYPE_ERROR_RESPONSE = 0b1111;
const DOUBAO_FLAG_POS_SEQUENCE = 0b0001;
const DOUBAO_FLAG_NEG_WITH_SEQUENCE = 0b0011;
const DOUBAO_SERIALIZATION_JSON = 0b0001;
const DOUBAO_COMPRESSION_GZIP = 0b0001;

function doubaoAsrHeader(messageType: number, flags: number): Buffer {
  return Buffer.from([
    (0b0001 << 4) | 1, // protocol version 1, 4-byte header
    (messageType << 4) | flags,
    (DOUBAO_SERIALIZATION_JSON << 4) | DOUBAO_COMPRESSION_GZIP,
    0x00,
  ]);
}

function doubaoAsrFullClientRequest(seq: number): Buffer {
  const payload = Buffer.from(
    JSON.stringify({
      user: { uid: 'bingo' },
      audio: { format: 'wav', codec: 'raw', rate: DOUBAO_ASR_SAMPLE_RATE, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_ddc: true,
        show_utterances: true,
        enable_nonstream: false,
      },
    }),
    'utf-8',
  );
  const compressed = gzipSync(payload);
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeInt32BE(seq, 0);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(compressed.length, 0);
  return Buffer.concat([
    doubaoAsrHeader(DOUBAO_MSG_TYPE_FULL_CLIENT_REQUEST, DOUBAO_FLAG_POS_SEQUENCE),
    seqBuf,
    sizeBuf,
    compressed,
  ]);
}

function doubaoAsrAudioRequest(seq: number, segment: Buffer, isLast: boolean): Buffer {
  const compressed = gzipSync(segment);
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeInt32BE(isLast ? -seq : seq, 0);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(compressed.length, 0);
  return Buffer.concat([
    doubaoAsrHeader(
      DOUBAO_MSG_TYPE_AUDIO_ONLY_REQUEST,
      isLast ? DOUBAO_FLAG_NEG_WITH_SEQUENCE : DOUBAO_FLAG_POS_SEQUENCE,
    ),
    seqBuf,
    sizeBuf,
    compressed,
  ]);
}

interface DoubaoAsrServerResponse {
  code: number;
  isLastPackage: boolean;
  payloadMsg?: {
    result?: {
      text?: string;
      utterances?: Array<{ text?: string }>;
    };
  };
}

function parseDoubaoAsrResponse(msg: Buffer): DoubaoAsrServerResponse {
  const headerSize = (msg[0] & 0x0f) * 4;
  const messageType = msg[1] >> 4;
  const flags = msg[1] & 0x0f;
  const serialization = msg[2] >> 4;
  const compression = msg[2] & 0x0f;

  let payload = msg.subarray(headerSize);
  const response: DoubaoAsrServerResponse = { code: 0, isLastPackage: false };

  if (flags & 0x01) payload = payload.subarray(4); // payload sequence
  if (flags & 0x02) response.isLastPackage = true;
  if (flags & 0x04) payload = payload.subarray(4); // event

  if (messageType === DOUBAO_MSG_TYPE_FULL_SERVER_RESPONSE) {
    payload = payload.subarray(4); // payload size
  } else if (messageType === DOUBAO_MSG_TYPE_ERROR_RESPONSE) {
    response.code = payload.readInt32BE(0);
    payload = payload.subarray(8); // code + payload size
  }

  if (payload.length === 0) return response;

  if (compression === DOUBAO_COMPRESSION_GZIP) {
    try {
      payload = gunzipSync(payload);
    } catch {
      return response;
    }
  }

  if (serialization === DOUBAO_SERIALIZATION_JSON) {
    try {
      response.payloadMsg = JSON.parse(payload.toString('utf-8'));
    } catch {
      // Ignore malformed payloads
    }
  }

  return response;
}

/**
 * Doubao Seed-ASR one-shot transcription (bigmodel_nostream).
 *
 * Streams gzip-framed PCM16 16kHz mono WAV audio over WebSocket and resolves
 * with the final transcription. Audio must already be PCM16 16kHz mono WAV —
 * clients convert webm/opus recordings via convertToPcm16WavBlob() before
 * uploading to /api/transcription.
 */
async function transcribeDoubaoASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const rawBaseUrl = (
    config.baseUrl || ASR_PROVIDERS['doubao-asr'].defaultBaseUrl || ''
  ).trim();
  const wsUrl = /\/bigmodel_(no)?stream$/.test(rawBaseUrl)
    ? rawBaseUrl
    : `${rawBaseUrl.replace(/\/+$/, '')}/bigmodel_nostream`;

  let wavBuffer: Buffer;
  if (audioBuffer instanceof Buffer) {
    wavBuffer = audioBuffer;
  } else if (audioBuffer instanceof Blob) {
    wavBuffer = Buffer.from(await audioBuffer.arrayBuffer());
  } else {
    throw new Error('Invalid audio buffer type');
  }

  if (
    wavBuffer.length < 44 ||
    wavBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
    wavBuffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error(
      'Doubao ASR requires WAV audio (PCM16, 16kHz, mono). Convert webm/opus recordings to PCM16 WAV before upload.',
    );
  }

  const requestId = randomUUID();
  // Node 22's native WebSocket (undici) accepts an init bag with headers.
  const ws = new (WebSocket as unknown as new (
    url: string,
    init?: { headers: Record<string, string> },
  ) => WebSocket)(wsUrl, {
    headers: {
      'X-Api-Key': config.apiKey!,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
      'X-Api-Connect-Id': requestId,
      'X-Api-Sequence': '-1',
    },
  });
  ws.binaryType = 'arraybuffer';

  return new Promise<ASRTranscriptionResult>((resolve, reject) => {
    let settled = false;
    let audioSent = false;
    let finalText = '';

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
      callback();
    };
    const fail = (error: Error) => finish(() => reject(error));
    const succeed = () => finish(() => resolve({ text: finalText }));

    const timer = setTimeout(() => {
      fail(new Error('Doubao ASR timed out waiting for the final result'));
    }, DOUBAO_ASR_TIMEOUT_MS);

    const sendAudio = () => {
      const segmentSize =
        ((DOUBAO_ASR_SAMPLE_RATE * 2 * DOUBAO_ASR_SEGMENT_DURATION_MS) / 1000) | 0;
      let seq = 2; // seq 1 was the full client request
      for (let offset = 0; offset < wavBuffer.length; offset += segmentSize) {
        const end = Math.min(offset + segmentSize, wavBuffer.length);
        const isLast = end >= wavBuffer.length;
        ws.send(doubaoAsrAudioRequest(seq, wavBuffer.subarray(offset, end), isLast));
        if (!isLast) seq += 1;
      }
    };

    ws.onopen = () => {
      ws.send(doubaoAsrFullClientRequest(1));
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data === 'string') return;
      const msg = Buffer.from(data as ArrayBuffer);

      let response: DoubaoAsrServerResponse;
      try {
        response = parseDoubaoAsrResponse(msg);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (response.code !== 0) {
        const detail = response.payloadMsg ? ` ${JSON.stringify(response.payloadMsg)}` : '';
        fail(new Error(`Doubao ASR error (code ${response.code})${detail}`));
        return;
      }

      const resultText = response.payloadMsg?.result?.text;
      if (typeof resultText === 'string' && resultText) {
        // bigmodel_nostream returns a single refined result; keep the latest.
        finalText = resultText;
      }

      if (response.isLastPackage) {
        succeed();
        return;
      }

      if (!audioSent) {
        // Handshake ack for the full client request — start streaming audio.
        audioSent = true;
        sendAudio();
      }
    };

    ws.onerror = () => {
      fail(new Error('Doubao ASR WebSocket connection error'));
    };

    ws.onclose = (event: CloseEvent) => {
      if (settled) return;
      if (finalText) {
        succeed();
      } else {
        fail(new Error(`Doubao ASR WebSocket closed unexpectedly (code ${event.code})`));
      }
    };
  });
}

/**
 * SenseVoice implementation (local FastAPI service).
 */
async function transcribeSenseVoiceASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const endpointUrl = resolveEndpointUrl(
    config.baseUrl,
    ASR_PROVIDERS['sensevoice-asr'].defaultBaseUrl,
    '/transcribe',
  );

  let audioBlob: Blob;
  if (audioBuffer instanceof Buffer) {
    audioBlob = new Blob(
      [
        audioBuffer.buffer.slice(
          audioBuffer.byteOffset,
          audioBuffer.byteOffset + audioBuffer.byteLength,
        ) as ArrayBuffer,
      ],
      { type: 'audio/webm' },
    );
  } else if (audioBuffer instanceof Blob) {
    audioBlob = audioBuffer;
  } else {
    throw new Error('Invalid audio buffer type');
  }

  const formData = new FormData();
  formData.set('audio', audioBlob, 'audio.webm');
  formData.set('model', config.modelId || ASR_PROVIDERS['sensevoice-asr'].defaultModelId);
  formData.set('language', config.language || 'auto');

  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      body: formData,
    });
  } catch (error) {
    const baseUrl =
      (config.baseUrl || ASR_PROVIDERS['sensevoice-asr'].defaultBaseUrl || '').trim() ||
      'http://localhost:50001';
    throw new Error(
      `SenseVoice local service is not reachable at ${baseUrl}. Start scripts/sensevoice-local-server.ps1 first. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`SenseVoice local ASR API error: ${errorText || response.statusText}`);
  }

  const data = await response.json();
  const text =
    typeof data?.text === 'string'
      ? data.text
      : typeof data?.result === 'string'
        ? data.result
        : typeof data?.transcript === 'string'
          ? data.transcript
          : '';
  return { text };
}

/**
 * OpenAI Whisper implementation (using Vercel AI SDK)
 */
async function transcribeOpenAIWhisper(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const openai = createOpenAI({
    apiKey: config.apiKey!,
    baseURL:
      stripEndpointPath(config.baseUrl, ['/audio/transcriptions']) ||
      ASR_PROVIDERS['openai-whisper'].defaultBaseUrl,
  });

  // Convert to Buffer or Uint8Array (which is required by the AI SDK)
  let audioData: Buffer | Uint8Array;
  if (audioBuffer instanceof Buffer) {
    audioData = audioBuffer;
  } else if (audioBuffer instanceof Blob) {
    const arrayBuffer = await audioBuffer.arrayBuffer();
    audioData = new Uint8Array(arrayBuffer);
  } else {
    throw new Error('Invalid audio buffer type');
  }

  try {
    const result = await transcribe({
      model: openai.transcription(config.modelId || 'gpt-4o-mini-transcribe'),
      audio: audioData,
      providerOptions: {
        openai: {
          language: config.language === 'auto' ? undefined : config.language,
        },
      },
    });

    return { text: result.text || '' };
  } catch (error: unknown) {
    // Short/silent audio may cause the SDK to throw - treat as empty transcription
    const errMsg = error instanceof Error ? error.message : '';
    if (errMsg.includes('empty') || errMsg.includes('too short')) {
      return { text: '' };
    }
    throw error;
  }
}

/**
 * Qwen ASR implementation (DashScope API - Qwen3 ASR Flash)
 */
async function transcribeQwenASR(
  config: ASRModelConfig,
  audioBuffer: Buffer | Blob,
): Promise<ASRTranscriptionResult> {
  const baseUrl = config.baseUrl || ASR_PROVIDERS['qwen-asr'].defaultBaseUrl;

  // Convert audio to base64
  let base64Audio: string;
  if (audioBuffer instanceof Buffer) {
    base64Audio = audioBuffer.toString('base64');
  } else if (audioBuffer instanceof Blob) {
    const arrayBuffer = await audioBuffer.arrayBuffer();
    base64Audio = Buffer.from(arrayBuffer).toString('base64');
  } else {
    throw new Error('Invalid audio buffer type');
  }

  // Build request body
  const requestBody: Record<string, unknown> = {
    model: config.modelId || 'qwen3-asr-flash',
    input: {
      messages: [
        {
          role: 'user',
          content: [
            {
              audio: `data:audio/wav;base64,${base64Audio}`,
            },
          ],
        },
      ],
    },
  };

  // Add language parameter in asr_options if specified (optional - improves accuracy for known languages)
  // If language is uncertain or mixed, don't specify (auto-detect)
  if (config.language && config.language !== 'auto') {
    requestBody.parameters = {
      asr_options: {
        language: config.language,
      },
    };
  }

  const response = await fetch(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-DashScope-Audio-Format': 'wav',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    // "The audio is empty" - treat as no speech detected
    if (errorText.includes('audio is empty') || errorText.includes('InvalidParameter')) {
      return { text: '' };
    }
    throw new Error(`Qwen ASR API error: ${errorText}`);
  }

  const data = await response.json();

  // Check for transcription result in response
  // Qwen3 ASR returns OpenAI-compatible format:
  // { output: { choices: [{ message: { content: [{ text: "transcribed text" }] } }] } }
  if (
    !data.output?.choices ||
    !Array.isArray(data.output.choices) ||
    data.output.choices.length === 0
  ) {
    throw new Error(`Qwen ASR error: No choices in response. Response: ${JSON.stringify(data)}`);
  }

  const firstChoice = data.output.choices[0];
  const messageContent = firstChoice?.message?.content;

  if (!Array.isArray(messageContent) || messageContent.length === 0) {
    // Empty content typically means audio was too short or contained no speech
    return { text: '' };
  }

  // Extract text from first content item
  const transcribedText = messageContent[0]?.text || '';
  return { text: transcribedText };
}

/**
 * Get current ASR configuration from settings store
 * Note: This function should only be called in browser context
 */
export async function getCurrentASRConfig(): Promise<ASRModelConfig> {
  if (typeof window === 'undefined') {
    throw new Error('getCurrentASRConfig() can only be called in browser context');
  }

  // Lazy import to avoid circular dependency
  const { useSettingsStore } = await import('@/lib/store/settings');
  const { asrProviderId, asrLanguage, asrProvidersConfig } = useSettingsStore.getState();

  const providerConfig = asrProvidersConfig?.[asrProviderId];

  return {
    providerId: asrProviderId,
    modelId: providerConfig?.modelId || ASR_PROVIDERS[asrProviderId]?.defaultModelId || '',
    apiKey: providerConfig?.apiKey,
    baseUrl: providerConfig?.baseUrl,
    language: asrLanguage,
  };
}

// Re-export from constants for convenience
export { getAllASRProviders, getASRProvider, getASRSupportedLanguages } from './constants';

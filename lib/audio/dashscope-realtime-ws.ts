/**
 * Minimal WebSocket client for DashScope realtime TTS (Qwen-Audio-TTS / CosyVoice).
 *
 * These models only expose a WebSocket "run-task / continue-task / finish-task"
 * protocol (see https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide),
 * and the handshake must carry an `Authorization: bearer <key>` header. Neither
 * the WHATWG `WebSocket` (Node global / undici) nor a plain `fetch` can set that
 * header, so this module implements just enough of RFC 6455 over `node:tls` to
 * drive the protocol — with zero new dependencies (keeps the CI `--frozen-lockfile`
 * build and the Tauri standalone bundle untouched).
 *
 * Only the client→server direction is masked, per the RFC; server frames arrive
 * unmasked. Fragmented messages are reassembled, and ping frames are answered
 * with pong automatically.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect, type TLSSocket } from 'node:tls';
import { connect as netConnect, type Socket as NetSocket } from 'node:net';

export interface DashScopeRealtimeTTSOptions {
  /** WebSocket endpoint, e.g. wss://dashscope.aliyuncs.com/api-ws/v1/inference */
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  text: string;
  /** Output audio format requested from the service. */
  format?: 'mp3' | 'wav' | 'pcm';
  sampleRate?: number;
  /** Speech-rate multiplier (0.5–2.0). */
  rate?: number;
  timeoutMs?: number;
}

export interface DashScopeRealtimeTTSResult {
  audio: Uint8Array;
  format: string;
}

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

function encodeFrame(opcode: number, data: Buffer): Buffer {
  const len = data.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len; // client frames are always masked
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode

  const maskKey = randomBytes(4);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) {
    masked[i] = data[i] ^ maskKey[i % 4];
  }
  return Buffer.concat([header, maskKey, masked]);
}

/**
 * Drives a single DashScope realtime TTS task over a WebSocket and resolves with
 * the concatenated audio once the service reports `task-finished`.
 */
export function dashscopeRealtimeTTS(
  options: DashScopeRealtimeTTSOptions,
): Promise<DashScopeRealtimeTTSResult> {
  return new Promise<DashScopeRealtimeTTSResult>((resolve, reject) => {
    const {
      url,
      apiKey,
      model,
      voice,
      text,
      format = 'mp3',
      sampleRate = 24000,
      rate = 1,
      timeoutMs = 90_000,
    } = options;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Qwen Audio TTS: invalid WebSocket URL "${url}"`));
      return;
    }
    const isSecure = parsed.protocol === 'wss:';
    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : isSecure ? 443 : 80;
    const path = `${parsed.pathname || '/'}${parsed.search || ''}`;

    if (!apiKey) {
      reject(new Error('Qwen Audio TTS requires a DashScope API key (sk-...).'));
      return;
    }

    const socket: TLSSocket | NetSocket = isSecure
      ? connect({
          host,
          port,
          servername: host,
          rejectUnauthorized: true,
        })
      : netConnect({ host, port });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Qwen Audio TTS timed out waiting for audio.')));
    }, timeoutMs);

    const fail = (error: unknown) =>
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));

    socket.on('error', fail);

    // ---- Handshake -------------------------------------------------------
    const wsKey = randomBytes(16).toString('base64');
    const request = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${wsKey}`,
      'Sec-WebSocket-Version: 13',
      `Authorization: bearer ${apiKey}`,
      'X-DashScope-DataInspection: enable',
      '',
      '',
    ].join('\r\n');

    let buffer = Buffer.alloc(0);
    let handshakeDone = false;

    // Frame reassembly state
    const audioChunks: Buffer[] = [];
    let messageOpcode = -1;
    let messageChunks: Buffer[] = [];
    let taskStarted = false;
    const taskId = randomUUID();

    const sendJson = (obj: unknown) => {
      socket.write(encodeFrame(OP_TEXT, Buffer.from(JSON.stringify(obj), 'utf-8')));
    };

    const sendRunTask = () => {
      sendJson({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model,
          parameters: {
            text_type: 'PlainText',
            voice,
            format,
            sample_rate: sampleRate,
            volume: 50,
            rate,
            pitch: 1,
            enable_ssml: false,
          },
          input: {},
        },
      });
    };

    const sendText = () => {
      sendJson({
        header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: { text } },
      });
      sendJson({
        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: {} },
      });
    };

    const handleTextMessage = (raw: string) => {
      let msg: {
        header?: { event?: string; error_message?: string; error_code?: string };
      };
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // ignore non-JSON text frames
      }
      const event = msg.header?.event;
      if (event === 'task-started') {
        if (!taskStarted) {
          taskStarted = true;
          sendText();
        }
      } else if (event === 'task-finished') {
        const total = audioChunks.reduce((sum, c) => sum + c.length, 0);
        if (total === 0) {
          fail(new Error('Qwen Audio TTS returned no audio data.'));
          return;
        }
        const combined = Buffer.concat(audioChunks);
        finish(() =>
          resolve({
            audio: new Uint8Array(combined.buffer, combined.byteOffset, combined.length),
            format,
          }),
        );
      } else if (event === 'task-failed') {
        fail(
          new Error(
            `Qwen Audio TTS failed: ${msg.header?.error_message || msg.header?.error_code || 'unknown error'}`,
          ),
        );
      }
    };

    const deliverMessage = (opcode: number, chunks: Buffer[]) => {
      if (opcode === OP_BINARY) {
        audioChunks.push(...chunks);
      } else if (opcode === OP_TEXT) {
        handleTextMessage(Buffer.concat(chunks).toString('utf-8'));
      }
    };

    /** Extract as many complete frames as possible from `buffer`. */
    const pumpFrames = () => {
      for (;;) {
        if (buffer.length < 2) return;
        const fin = (buffer[0] & 0x80) !== 0;
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let len = buffer[1] & 0x7f;
        let offset = 2;

        if (len === 126) {
          if (buffer.length < offset + 2) return;
          len = buffer.readUInt16BE(offset);
          offset += 2;
        } else if (len === 127) {
          if (buffer.length < offset + 8) return;
          len = Number(buffer.readBigUInt64BE(offset));
          offset += 8;
        }

        let maskKey: Buffer | null = null;
        if (masked) {
          if (buffer.length < offset + 4) return;
          maskKey = buffer.subarray(offset, offset + 4);
          offset += 4;
        }
        if (buffer.length < offset + len) return;

        let payload = buffer.subarray(offset, offset + len);
        if (maskKey) {
          const unmasked = Buffer.allocUnsafe(len);
          for (let i = 0; i < len; i += 1) {
            unmasked[i] = payload[i] ^ maskKey[i % 4];
          }
          payload = unmasked;
        }
        buffer = buffer.subarray(offset + len);

        if (opcode === OP_PING) {
          socket.write(encodeFrame(OP_PONG, payload));
          continue;
        }
        if (opcode === OP_PONG) continue;
        if (opcode === OP_CLOSE) {
          // Server closed; if we already have audio, treat as finished.
          if (!settled) {
            const total = audioChunks.reduce((sum, c) => sum + c.length, 0);
            if (total > 0) {
              const combined = Buffer.concat(audioChunks);
              finish(() =>
                resolve({
                  audio: new Uint8Array(combined.buffer, combined.byteOffset, combined.length),
                  format,
                }),
              );
            } else {
              fail(new Error('Qwen Audio TTS connection closed before audio was produced.'));
            }
          }
          return;
        }

        if (opcode === OP_CONT) {
          messageChunks.push(payload);
        } else {
          // Start of a new (possibly fragmented) message.
          messageOpcode = opcode;
          messageChunks = [payload];
        }
        if (fin && messageOpcode !== -1) {
          deliverMessage(messageOpcode, messageChunks);
          messageOpcode = -1;
          messageChunks = [];
        }
      }
    };

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeDone) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const head = buffer.subarray(0, headerEnd).toString('utf-8');
        buffer = buffer.subarray(headerEnd + 4);
        handshakeDone = true;

        const expectedAccept = createHash('sha1')
          .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64');
        const statusLine = head.split('\r\n')[0] || '';
        const acceptMatch = /Sec-WebSocket-Accept:\s*(.+)/i.exec(head);
        if (!/HTTP\/1\.1\s+101/.test(statusLine)) {
          fail(new Error(`Qwen Audio TTS handshake failed: ${statusLine || 'no status line'}`));
          return;
        }
        if (acceptMatch && acceptMatch[1].trim() !== expectedAccept) {
          fail(new Error('Qwen Audio TTS handshake failed: invalid Sec-WebSocket-Accept.'));
          return;
        }

        sendRunTask();
      }

      pumpFrames();
    });

    socket.on('connect', () => {
      socket.write(request);
    });
  });
}

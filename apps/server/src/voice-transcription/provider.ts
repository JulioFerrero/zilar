// The OpenAI-compatible transcription port (T-0170). One function posts
// audio to `POST {baseUrl}/audio/transcriptions` (multipart `file` +
// `model`, optional bearer key) and answers the transcript text plus the
// detected language. The provider's response shape is validated with zod;
// the error body is never forwarded — the caller maps every failure to a
// fixed 502 `transcription_failed`.
//
// `fetchFn` is injected so tests use a fake provider, never a real
// endpoint or key.

import { z } from 'zod';

const transcriptionResponseSchema = z
  .object({
    text: z.string(),
    language: z.string().optional(),
  })
  .catchall(z.unknown());

export interface TranscriptionResult {
  text: string;
  language: string | null;
}

export interface TranscribeInput {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  audio: Uint8Array;
  filename: string;
  mime: string;
}

export class TranscriptionProviderError extends Error {
  constructor(message = 'The transcription provider failed') {
    super(message);
    this.name = 'TranscriptionProviderError';
  }
}

export type TranscriptionFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal: AbortSignal },
) => Promise<Response>;

const PROVIDER_TIMEOUT_MS = 60_000;

/** Builds `POST {baseUrl}/audio/transcriptions` with no double slash. */
export function transcriptionEndpointFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
}

export async function transcribeAudio(
  input: TranscribeInput,
  fetchFn: TranscriptionFetch = defaultFetch,
): Promise<TranscriptionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (input.apiKey !== null && input.apiKey !== '') {
      headers['authorization'] = `Bearer ${input.apiKey}`;
    }
    const form = new FormData();
    form.append('model', input.model);
    form.append('file', new Blob([input.audio], { type: input.mime }), input.filename);
    let response: Response;
    try {
      response = await fetchFn(transcriptionEndpointFor(input.baseUrl), {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      });
    } catch {
      throw new TranscriptionProviderError();
    }
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new TranscriptionProviderError();
    }
    const parsed = transcriptionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new TranscriptionProviderError();
    }
    // Empty text is a valid answer (silence transcribes to nothing): the
    // verify call proves the endpoint works either way, and a real message
    // with no speech honestly has no words.
    return { text: parsed.data.text.trim(), language: parsed.data.language ?? null };
  } finally {
    clearTimeout(timer);
  }
}

function defaultFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal: AbortSignal },
): Promise<Response> {
  return fetch(url, init);
}

/**
 * A 1-second silent WAV (16 kHz mono 16-bit, a few KB) built in memory.
 * The PUT verifies the endpoint by sending this instead of real audio: a
 * test request is not possible without audio, and silence transcribes (or
 * rejects) exactly like any other clip.
 */
export function silentVerificationWav(): Uint8Array {
  const sampleRate = 16_000;
  const samples = sampleRate;
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

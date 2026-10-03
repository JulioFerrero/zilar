import { z } from 'zod';

import { normalizeWhistleLanguage } from './model';

/** The JSON the native side resolves per chunk (`needle_transcribe` fields). */
export const WhistleRawResultSchema = z.object({
  text: z.string(),
  language: z.string(),
  ttftMs: z.number(),
  decodeTps: z.number(),
  audioMs: z.number(),
});

export type WhistleRawResult = z.infer<typeof WhistleRawResultSchema>;

/** One finished on-device transcription, as the dev screen shows it. */
export const WhistleTranscriptSchema = z.object({
  text: z.string(),
  language: z.string(),
  ttftMs: z.number(),
  decodeTps: z.number(),
  audioMs: z.number(),
  wallMs: z.number(),
});

export type WhistleTranscript = z.infer<typeof WhistleTranscriptSchema>;

export class WhistleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WhistleError';
    this.code = code;
  }
}

/**
 * Validates one native result at the JSON boundary (T-0177): unknown fields
 * are stripped, a missing `text` rejects with `bad_result`, never a crash.
 * The language falls back to auto-detect (empty) when the engine reports an
 * unsupported tag.
 */
export function parseWhistleResult(raw: unknown): WhistleRawResult {
  const parsed = WhistleRawResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WhistleError('bad_result', 'The transcription result was malformed');
  }
  const language = normalizeWhistleLanguage(parsed.data.language) ?? '';
  return { ...parsed.data, language };
}

/** Maps a native rejection code to the fixed error the screen shows. */
export function whistleErrorFor(error: unknown): WhistleError {
  if (error instanceof WhistleError) {
    return error;
  }
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  if (code === 'unavailable') {
    return new WhistleError('unavailable', 'On-device transcription needs Android arm64');
  }
  if (code === 'model_missing') {
    return new WhistleError('model_missing', 'Download the Whistle model first');
  }
  if (code === 'not_audio') {
    return new WhistleError('not_audio', 'That file could not be read as audio');
  }
  if (code === 'bad_checksum') {
    return new WhistleError('bad_checksum', 'The model download was corrupted, try again');
  }
  if (code === 'transcribe_failed' || code === 'load_failed') {
    const message =
      error !== null && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
    return new WhistleError(code, message === '' ? 'The transcription failed' : message);
  }
  return new WhistleError('transcribe_failed', 'The transcription failed');
}

import { Exit, Schema } from 'effect';

import { normalizeWhistleLanguage } from './model';

/** The JSON the native side resolves per chunk (`needle_transcribe` fields). */
export const WhistleRawResultSchema = Schema.Struct({
  text: Schema.String,
  language: Schema.String,
  ttftMs: Schema.Number,
  decodeTps: Schema.Number,
  audioMs: Schema.Number,
});

export type WhistleRawResult = typeof WhistleRawResultSchema.Type;

/** One finished on-device transcription, as the dev screen shows it. */
export const WhistleTranscriptSchema = Schema.Struct({
  text: Schema.String,
  language: Schema.String,
  ttftMs: Schema.Number,
  decodeTps: Schema.Number,
  audioMs: Schema.Number,
  wallMs: Schema.Number,
});

export type WhistleTranscript = typeof WhistleTranscriptSchema.Type;

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
  const parsed = Schema.decodeUnknownExit(WhistleRawResultSchema)(raw);
  if (!Exit.isSuccess(parsed)) {
    throw new WhistleError('bad_result', 'The transcription result was malformed');
  }
  const language = normalizeWhistleLanguage(parsed.value.language) ?? '';
  return { ...parsed.value, language };
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
  if (code === 'too_long') {
    return new WhistleError('too_long', 'That recording is too long to transcribe on the device');
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

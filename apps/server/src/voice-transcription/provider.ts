// The OpenAI-compatible transcription port (T-0170, Effect conversion by
// T-0492). One function posts audio to
// `POST {baseUrl}/audio/transcriptions` (multipart `file` + `model`,
// optional bearer key) and answers the transcript text plus the detected
// language. The provider's response shape is validated with Effect Schema
// (`transcriptionResponseSchema`); the error
// body is never forwarded — the caller maps each failure kind to a fixed
// answer (`rejected` vs `unreachable`, never the provider's body).
//
// The call runs on Effect inside (typed errors, timeout via interruption);
// `transcribeAudio` is the Promise edge and throws the same
// `TranscriptionProviderError` as before. `fetchFn` is injected so tests
// use a fake provider, never a real endpoint or key.

import { Data, Duration, Effect, Exit, Schema, type Effect as EffectType } from 'effect';

const transcriptionResponseSchema = Schema.Struct({
  text: Schema.String,
  language: Schema.optional(Schema.String),
});

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

export type TranscriptionFailureKind = 'unreachable' | 'rejected';

export class TranscriptionProviderError extends Error {
  readonly kind: TranscriptionFailureKind;
  constructor(kind: TranscriptionFailureKind, message = 'The transcription provider failed') {
    super(message);
    this.name = 'TranscriptionProviderError';
    this.kind = kind;
  }
}

export type TranscriptionFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal: AbortSignal },
) => Promise<Response>;

const PROVIDER_TIMEOUT_MS = 60_000;

/** The provider was never reached (transport, DNS or the timeout). */
class ProviderUnreachable extends Data.TaggedError('ProviderUnreachable') {}

/** The provider answered but refused, or its body did not parse. */
class ProviderRejected extends Data.TaggedError('ProviderRejected') {}

/** Builds `POST {baseUrl}/audio/transcriptions` with no double slash. */
export function transcriptionEndpointFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
}

const transcribeAudioEffect = Effect.fnUntraced(function* (
  input: TranscribeInput,
  fetchFn: TranscriptionFetch,
): EffectType.fn.Return<TranscriptionResult, ProviderUnreachable | ProviderRejected> {
  const headers: Record<string, string> = {};
  if (input.apiKey !== null && input.apiKey !== '') {
    headers['authorization'] = `Bearer ${input.apiKey}`;
  }
  const form = new FormData();
  form.append('model', input.model);
  form.append('file', new Blob([input.audio], { type: input.mime }), input.filename);
  // `Effect.tryPromise` hands the fetch an `AbortSignal` that fires when the
  // effect is interrupted; `timeoutOrElse` interrupts the source on expiry
  // and keeps only the typed error (no `Cause.TimeoutError`).
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchFn(transcriptionEndpointFor(input.baseUrl), {
        method: 'POST',
        headers,
        body: form,
        signal,
      }),
    catch: () => new ProviderUnreachable(),
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(PROVIDER_TIMEOUT_MS),
      orElse: () => Effect.fail(new ProviderUnreachable()),
    }),
  );
  const raw: unknown = yield* Effect.promise(() => response.json().catch(() => null));
  if (!response.ok) {
    // The endpoint answered, but refused (bad key, bad model, 5xx).
    return yield* new ProviderRejected();
  }
  const parsed = Schema.decodeUnknownExit(transcriptionResponseSchema)(raw);
  if (!Exit.isSuccess(parsed)) {
    return yield* new ProviderRejected();
  }
  // Empty text is a valid answer (silence transcribes to nothing): the
  // verify call proves the endpoint works either way, and a real message
  // with no speech honestly has no words.
  return { text: parsed.value.text.trim(), language: parsed.value.language ?? null };
});

export async function transcribeAudio(
  input: TranscribeInput,
  fetchFn: TranscriptionFetch = defaultFetch,
): Promise<TranscriptionResult> {
  return Effect.runPromise(
    transcribeAudioEffect(input, fetchFn).pipe(
      Effect.catchTags({
        ProviderUnreachable: () => Effect.fail(new TranscriptionProviderError('unreachable')),
        ProviderRejected: () => Effect.fail(new TranscriptionProviderError('rejected')),
      }),
    ),
  );
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

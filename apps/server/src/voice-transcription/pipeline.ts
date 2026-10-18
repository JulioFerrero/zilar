// The transcript pipeline: fetch the audio with a timeout and size cap, call the provider
// with a timeout, single-flight per URL hash, re-check and insert, and map errors. Errors
// are typed, and the network's or provider's text never leaves this module.

import { Cause, Data, Duration, Effect, Stream, type Effect as EffectType } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { defaultInternalFetch, type InternalFetchResponse } from '../files/internal-fetch';
import { readCapped } from '../http/read-capped';
import { transcribeAudio, TranscriptionProviderError, type TranscriptionFetch } from './provider';
import type { VoiceTranscriptionSettings } from './settings';

export const VOICE_TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_FETCH_TIMEOUT_MS = 20_000;
const VOICE_PROVIDER_TIMEOUT_MS = 60_000;

export interface FetchedAudio {
  body: Uint8Array;
  contentType: string;
}

export interface AudioFetchInit {
  host: string;
}

export type AudioFetcher = (url: string, init: AudioFetchInit) => Promise<FetchedAudio>;

export type Transcriber = (input: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  audio: Uint8Array;
  filename: string;
  mime: string;
}) => Promise<{ text: string; language: string | null }>;

export class AudioUnavailable extends Data.TaggedError('AudioUnavailable') {}

export class VoiceTooLarge extends Data.TaggedError('VoiceTooLarge') {}

export class NotAudio extends Data.TaggedError('NotAudio') {}

export class TranscriptionFailed extends Data.TaggedError('TranscriptionFailed') {}

export type TranscriptPipelineError =
  AudioUnavailable | VoiceTooLarge | NotAudio | TranscriptionFailed;

export function transcriptErrorToHttp(error: TranscriptPipelineError): HttpError {
  switch (error._tag) {
    case 'AudioUnavailable':
      return new HttpError(
        502,
        'audio_unavailable',
        'The voice file could not be read, try again later',
      );
    case 'VoiceTooLarge':
      return new HttpError(413, 'voice_too_large', 'The recording is too large');
    case 'NotAudio':
      return new HttpError(422, 'not_audio', 'The file is not a supported recording');
    case 'TranscriptionFailed':
      return new HttpError(
        502,
        'transcription_failed',
        'The transcription service failed, try again later',
      );
  }
}

function isAudioContentType(contentType: string): boolean {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime.startsWith('audio/') || mime === 'video/mp4' || mime === 'application/octet-stream';
}

export interface FetchAndTranscribeInput {
  db: ServerDatabase;
  urlHash: string;
  internalUrl: string;
  uploadHost: string;
  settings: VoiceTranscriptionSettings;
  fetchAudio: AudioFetcher;
  transcribe: Transcriber;
}

const fetchAudioEffect = Effect.fnUntraced(function* (
  fetchAudio: AudioFetcher,
  internalUrl: string,
  uploadHost: string,
): EffectType.fn.Return<FetchedAudio, AudioUnavailable | VoiceTooLarge> {
  const fetched = yield* Effect.tryPromise({
    try: () => fetchAudio(internalUrl, { host: uploadHost }),
    catch: (error) => (error instanceof VoiceTooLarge ? error : new AudioUnavailable()),
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(VOICE_FETCH_TIMEOUT_MS),
      orElse: () => Effect.fail(new AudioUnavailable()),
    }),
  );
  return fetched;
});

const checkAudioEffect = Effect.fnUntraced(function* (
  audio: FetchedAudio,
): EffectType.fn.Return<FetchedAudio, VoiceTooLarge | NotAudio> {
  if (audio.body.byteLength > VOICE_TRANSCRIPT_MAX_BYTES) {
    return yield* new VoiceTooLarge();
  }
  if (audio.body.byteLength === 0 || !isAudioContentType(audio.contentType)) {
    return yield* new NotAudio();
  }
  return audio;
});

const transcribeEffect = Effect.fnUntraced(function* (
  transcribe: Transcriber,
  input: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    audio: Uint8Array;
    filename: string;
    mime: string;
  },
): EffectType.fn.Return<{ text: string; language: string | null }, TranscriptionFailed> {
  // A non-provider throw rejects the boundary promise with the original error, unwrapped,
  // like an unexpected throw in a plain `await`.
  const result = yield* Effect.promise(() => transcribe(input)).pipe(
    Effect.catchCause((cause) => {
      const failure = Cause.squash(cause);
      if (failure instanceof TranscriptionProviderError) {
        return Effect.fail(new TranscriptionFailed());
      }
      return Effect.die(failure);
    }),
    Effect.timeoutOrElse({
      duration: Duration.millis(VOICE_PROVIDER_TIMEOUT_MS),
      orElse: () => Effect.fail(new TranscriptionFailed()),
    }),
  );
  return result;
});

// `awaitSql` runs an effect/sql program; a SQL failure rejects the boundary promise
// unwrapped, exactly as a plain `await` would.
const awaitSql = <A>(
  db: ServerDatabase,
  effect: EffectType.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): EffectType.Effect<A, never, never> => Effect.promise(() => runSql(db, effect));

const storeTranscriptEffect = Effect.fnUntraced(function* (
  db: ServerDatabase,
  urlHash: string,
  result: { text: string; language: string | null },
): EffectType.fn.Return<string, never> {
  yield* awaitSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'voice-transcript:' + urlHash}))`;
          const cached = yield* sql<{ text: string }>`SELECT text FROM voice_transcripts
            WHERE url_hash = ${urlHash} LIMIT 1`;
          if (cached.length > 0) return;
          yield* sql`INSERT INTO voice_transcripts (url_hash, text, language)
            VALUES (${urlHash}, ${result.text}, ${result.language})
            ON CONFLICT (url_hash) DO NOTHING`;
        }),
      );
    }),
  );
  const stored = yield* awaitSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ text: string }>`SELECT text FROM voice_transcripts
        WHERE url_hash = ${urlHash} LIMIT 1`;
    }),
  );
  return stored[0]?.text ?? result.text;
});

const fetchAndTranscribeEffect = Effect.fnUntraced(function* (
  input: FetchAndTranscribeInput,
): EffectType.fn.Return<string, TranscriptPipelineError> {
  const audio = yield* fetchAudioEffect(input.fetchAudio, input.internalUrl, input.uploadHost);
  yield* checkAudioEffect(audio);
  const result = yield* transcribeEffect(input.transcribe, {
    baseUrl: input.settings.baseUrl,
    apiKey: input.settings.apiKey,
    model: input.settings.model,
    audio: audio.body,
    filename: 'voice.m4a',
    mime: audio.contentType,
  });
  return yield* storeTranscriptEffect(input.db, input.urlHash, result);
});

/**
 * No transaction is held across the network: only the re-check + insert runs in one under
 * an advisory lock on the hash, and `onConflictDoNothing` covers the last overlap. Fetch
 * failures are a fixed 502, size and type refusals keep 413/422, and a provider refusal is
 * a fixed 502 `transcription_failed`.
 */
export const fetchAndTranscribeAsEffect = (
  input: FetchAndTranscribeInput,
): EffectType.Effect<string, HttpError, never> =>
  fetchAndTranscribeEffect(input).pipe(
    Effect.catchTags({
      AudioUnavailable: (error: AudioUnavailable) => Effect.fail(transcriptErrorToHttp(error)),
      VoiceTooLarge: (error: VoiceTooLarge) => Effect.fail(transcriptErrorToHttp(error)),
      NotAudio: (error: NotAudio) => Effect.fail(transcriptErrorToHttp(error)),
      TranscriptionFailed: (error: TranscriptionFailed) =>
        Effect.fail(transcriptErrorToHttp(error)),
    }),
  );

export function fetchAndTranscribe(input: FetchAndTranscribeInput): Promise<string> {
  return Effect.runPromise(fetchAndTranscribeAsEffect(input));
}

export interface TranscriptionInFlight {
  run: (key: string, start: () => Promise<string>) => Promise<string>;
  size: () => number;
}

/**
 * Single-flight per URL hash, so simultaneous taps share one call instead of
 * double-billing. An entry is removed in `finally`, so a failure never poisons the next
 * tap; the DB row is the durable cache.
 */
export function shareInFlight(): TranscriptionInFlight {
  const inFlight = new Map<string, Promise<string>>();
  return {
    run: (key, start) => {
      const existing = inFlight.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const shared = start();
      inFlight.set(key, shared);
      // `.then` with both handlers, not `.finally`: the derived promise resolves either way,
      // so a failed share never surfaces as an unhandled rejection.
      const cleanup = (): void => {
        if (inFlight.get(key) === shared) {
          inFlight.delete(key);
        }
      };
      void shared.then(cleanup, cleanup);
      return shared;
    },
    size: () => inFlight.size,
  };
}

// The internal download leg: same path on ejabberd's API base, 10 MB cap, 20 s timeout.
// The declared length is checked before the body, which streams through `readCapped`, so
// an over-cap upload is never buffered whole. Every fetch failure is a fixed 502, never
// the network's text; the bytes are never logged.
export async function defaultAudioFetcher(
  url: string,
  init: AudioFetchInit,
): Promise<FetchedAudio> {
  let response: InternalFetchResponse;
  try {
    response = await defaultInternalFetch(url, {
      host: init.host,
      signal: AbortSignal.timeout(VOICE_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new AudioUnavailableError();
  }
  if (response.status < 200 || response.status >= 300) {
    await response.body.cancel().catch(() => {});
    throw new AudioUnavailableError();
  }
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > VOICE_TRANSCRIPT_MAX_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new VoiceTooLarge();
  }
  const capped = await Effect.runPromise(
    readCapped(
      Stream.fromReadableStream({
        evaluate: () => response.body,
        onError: () => new AudioUnavailableError(),
      }),
      VOICE_TRANSCRIPT_MAX_BYTES,
    ),
  ).catch(() => {
    throw new AudioUnavailableError();
  });
  if (capped === undefined) {
    throw new VoiceTooLarge();
  }
  return { body: capped, contentType };
}

/** The audio fetch failed: fixed 502, never the network's text and never a bare 500. */
export class AudioUnavailableError extends Error {
  constructor() {
    super('The voice file could not be fetched');
    this.name = 'AudioUnavailableError';
  }
}

const defaultTranscriptionFetch: TranscriptionFetch = (url, init) => fetch(url, init);

export function defaultTranscriber(): Transcriber {
  return (input) => transcribeAudio(input, defaultTranscriptionFetch);
}

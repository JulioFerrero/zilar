// The transcript pipeline as Effect code (T-0173). This module owns the
// logic between the HTTP handlers and the database: fetch the audio with a
// timeout and size cap, call the provider with a timeout, single-flight per
// URL hash, cache re-check and insert, the fixed error mapping.
//
// The Effect HttpApi handlers in `api.ts` call this module, and they validate
// input with Effect Schema. Everything here runs through `Effect.runPromise`
// at the edge, so callers see plain `Promise`s.
//
// Errors are typed (`Data.TaggedError`): `AudioUnavailable` (fetch leg
// failed), `VoiceTooLarge`, `NotAudio`, `TranscriptionFailed` (provider
// refused). The `Promise` boundary maps each to the same fixed `HttpError`
// answers the old code threw — the network's or provider's text never
// leaves this module.

import { Cause, Data, Duration, Effect, type Effect as EffectType } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { transcribeAudio, TranscriptionProviderError, type TranscriptionFetch } from './provider';
import type { VoiceTranscriptionSettings } from './settings';

export const VOICE_TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_FETCH_TIMEOUT_MS = 20_000;
const VOICE_PROVIDER_TIMEOUT_MS = 60_000;

export interface FetchedAudio {
  body: Uint8Array;
  contentType: string;
}

export type AudioFetcher = (url: string) => Promise<FetchedAudio>;

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

/** Maps a typed pipeline error to its fixed HTTP answer. */
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
  settings: VoiceTranscriptionSettings;
  fetchAudio: AudioFetcher;
  transcribe: Transcriber;
}

const fetchAudioEffect = Effect.fnUntraced(function* (
  fetchAudio: AudioFetcher,
  internalUrl: string,
): EffectType.fn.Return<FetchedAudio, AudioUnavailable> {
  const fetched = yield* Effect.tryPromise({
    try: () => fetchAudio(internalUrl),
    catch: () => new AudioUnavailable(),
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
  // A non-provider throw (bug in an injected fake, realistically) rejects
  // the boundary promise with the original error, identical and unwrapped —
  // like an unexpected throw in the old `await`. A provider refusal becomes
  // the typed `TranscriptionFailed`.
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

// `awaitSql` runs an effect/sql program on the database's registered runtime.
// A SQL failure rejects the runtime promise with the original error, and
// `Effect.promise` turns that rejection into a defect, so a DB failure rejects
// the boundary promise unwrapped, exactly as a plain `await` would.
const awaitSql = <A>(
  db: ServerDatabase,
  effect: EffectType.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): EffectType.Effect<A, never, never> => Effect.promise(() => sqlRuntimeFor(db).runPromise(effect));

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
  const audio = yield* fetchAudioEffect(input.fetchAudio, input.internalUrl);
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
 * Fetches the audio and transcribes it, then stores the result — with no
 * transaction held across the network. Only the re-check + insert runs in
 * one transaction under an advisory lock on the hash (a duplicate that won
 * the race reads the winner's row; `onConflictDoNothing` covers the last
 * overlap). Fetch-leg failures (ejabberd down, slow, refusing) surface as
 * fixed 502 `audio_unavailable`; size and content-type refusals keep their
 * 413/422; a provider refusal answers fixed 502 `transcription_failed`.
 *
 * The Effect form: typed pipeline errors become the same fixed `HttpError`s
 * the old code threw; defects (DB down) stay defects and reject unchanged.
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

/** The `Promise` boundary over `fetchAndTranscribeAsEffect`, for the handlers. */
export function fetchAndTranscribe(input: FetchAndTranscribeInput): Promise<string> {
  return Effect.runPromise(fetchAndTranscribeAsEffect(input));
}

export interface TranscriptionInFlight {
  /** Runs `start` once per key; concurrent callers share the same promise. */
  run: (key: string, start: () => Promise<string>) => Promise<string>;
  /** How many keys are currently in flight (tests assert cleanup). */
  size: () => number;
}

/**
 * Single-flight per URL hash: two simultaneous taps on the same voice
 * message share one fetch + provider call instead of double-billing. The
 * entry is removed in `finally`, so a failure — or an interrupted request
 * whose waiter goes away — never poisons the next tap. The DB row
 * (re-checked under the lock at insert time) is the durable cache; this map
 * only dedupes the overlap window.
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
      // `.then` with both handlers (not `.finally`): the derived promise
      // resolves either way, so a failed share never surfaces as an
      // unhandled rejection — the awaiting requests already mapped it.
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

// The internal download leg: same path on ejabberd's API base, 10 MB cap,
// 20 s timeout. Every fetch-leg failure (transport, abort, non-OK, unreadable
// body) surfaces as `AudioUnavailableError` — the route maps it to a fixed
// 502, never a bare 500 and never the network's error text. The content type
// gates the provider call (`not_audio` without one); the bytes are never
// logged.
export async function defaultAudioFetcher(url: string): Promise<FetchedAudio> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch {
      throw new AudioUnavailableError();
    }
    if (!response.ok) {
      throw new AudioUnavailableError();
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const buffer = await response.arrayBuffer().catch(() => null);
    if (buffer === null) {
      throw new AudioUnavailableError();
    }
    return { body: new Uint8Array(buffer), contentType };
  } finally {
    clearTimeout(timer);
  }
}

/** The audio-fetch leg failed (ejabberd down, slow, or refusing): fixed
 * 502, never the network's error text and never a bare 500. */
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

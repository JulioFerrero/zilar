/**
 * Audio and text never leave the phone, and the cached download is always deleted.
 */

import { Effect } from 'effect';

import type { WhistlePort } from './whistle-port';
import type { WhistleTranscript } from './whistle-port-types';

export const TRANSCRIBE_UNAVAILABLE_MESSAGE =
  'On-device transcription is not available on this phone.';
export const TRANSCRIBE_DOWNLOAD_FAILED_MESSAGE = 'Could not download the model. Try again.';
export const TRANSCRIBE_TOO_LONG_MESSAGE =
  'That recording is too long to transcribe on the device.';
export const TRANSCRIBE_EMPTY_MESSAGE = 'Nothing heard in that voice note.';
export const TRANSCRIBE_FAILED_MESSAGE = 'Could not transcribe that voice note. Try again.';

export type TranscribePhase =
  { kind: 'downloading'; fraction: number } | { kind: 'loading' } | { kind: 'transcribing' };

export interface VoiceTranscribeSource {
  localUri?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
}

export interface TranscribeFileDeps {
  downloadUrl: (
    url: string,
    headers: Record<string, string> | undefined,
    onPhase: (phase: TranscribePhase) => void,
  ) => Promise<string>;
  deleteCache: (uri: string) => Promise<void>;
}

export class TranscribeTooLargeError extends Error {
  constructor() {
    super('voice too large for on-device transcription');
    this.name = 'TranscribeTooLargeError';
  }
}

/**
 * Aborts once the written or the reported total bytes pass `VOICE_MAX_BYTES`, the same guard as the attachment opener.
 */
export function transcribeDownloadOverCap(
  progress: { bytesWritten: number; totalBytes: number },
  capBytes: number,
): boolean {
  return progress.totalBytes > capBytes || progress.bytesWritten > capBytes;
}

export interface TranscribeVoiceNoteInput {
  port: WhistlePort;
  source: VoiceTranscribeSource;
  audioMs?: number | undefined;
  language?: string | undefined;
  onPhase?: ((phase: TranscribePhase) => void) | undefined;
  confirmDownload?: (() => Promise<boolean>) | undefined;
  files?: TranscribeFileDeps | undefined;
}

export type TranscribeVoiceNoteResult =
  | { status: 'done'; transcript: WhistleTranscript }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/**
 * The flow must never download the model without the user's yes: the run stops with `cancelled` unless the sheet confirmed it, and a stale yes re-opens the sheet.
 */
export function consumeTranscribeConsent(
  consent: { confirmed: boolean },
  reopen: () => void,
): boolean {
  if (consent.confirmed) {
    consent.confirmed = false;
    return true;
  }
  reopen();
  return false;
}

function phaseOf(input: TranscribeVoiceNoteInput): (phase: TranscribePhase) => void {
  return (phase) => input.onPhase?.(phase);
}

function errorMessageOf(error: unknown): string {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  if (code === 'unavailable') {
    return TRANSCRIBE_UNAVAILABLE_MESSAGE;
  }
  if (code === 'download_failed' || code === 'bad_checksum') {
    return TRANSCRIBE_DOWNLOAD_FAILED_MESSAGE;
  }
  if (code === 'too_long') {
    return TRANSCRIBE_TOO_LONG_MESSAGE;
  }
  if (code === 'model_missing') {
    return TRANSCRIBE_DOWNLOAD_FAILED_MESSAGE;
  }
  return TRANSCRIBE_FAILED_MESSAGE;
}

const defaultFiles: Effect.Effect<TranscribeFileDeps> = Effect.gen(function* () {
  const { File, Paths } = yield* Effect.promise(() => import('expo-file-system'));
  const { VOICE_MAX_BYTES } = yield* Effect.promise(() => import('./voice'));
  return {
    downloadUrl: (url, headers) =>
      Effect.runPromise(
        Effect.suspend(() => {
          const destination = new File(
            Paths.cache,
            `voice-transcribe-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.m4a`,
          );
          const controller = new AbortController();
          return Effect.tryPromise({
            try: () =>
              File.downloadFileAsync(url, destination, {
                idempotent: true,
                ...(headers === undefined ? {} : { headers }),
                signal: controller.signal,
                onProgress: (progress) => {
                  if (transcribeDownloadOverCap(progress, VOICE_MAX_BYTES)) {
                    controller.abort();
                  }
                },
              }),
            catch: (error) => error,
          }).pipe(
            Effect.map((downloaded) => downloaded.uri),
            Effect.catch((error) =>
              Effect.suspend(() => {
                if (destination.exists) {
                  destination.delete();
                }
                return Effect.fail(
                  error instanceof Error && error.name === 'AbortError'
                    ? new TranscribeTooLargeError()
                    : error,
                );
              }),
            ),
          );
        }),
      ),
    deleteCache: (uri) =>
      Effect.runPromise(Effect.try(() => new File(uri).delete()).pipe(Effect.ignore)),
  };
});

function destinationName(id: string): string {
  return `voice-transcribe-${id}.m4a`;
}

export function transcribeCacheName(id: string): string {
  return destinationName(sanitizeId(id));
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'note';
}

/**
 * A served URL is downloaded to the cache with its headers, and the cached file is always deleted; an empty text resolves to the "nothing heard" error.
 */
export function transcribeVoiceNote(
  input: TranscribeVoiceNoteInput,
): Promise<TranscribeVoiceNoteResult> {
  return Effect.runPromise(transcribeVoiceNoteEffect(input));
}

type EarlyResult = Exclude<TranscribeVoiceNoteResult, { status: 'done' }>;

const stopWith = (message: string): Effect.Effect<never, EarlyResult> =>
  Effect.fail({ status: 'error', message });

export const transcribeVoiceNoteEffect = (
  input: TranscribeVoiceNoteInput,
): Effect.Effect<TranscribeVoiceNoteResult> =>
  Effect.suspend(() => {
    const { port } = input;
    const onPhase = phaseOf(input);
    const filesOf = input.files === undefined ? defaultFiles : Effect.succeed(input.files);
    let cachedUri: string | undefined;

    const run = Effect.gen(function* () {
      if (!(yield* Effect.sync(() => port.isAvailable()))) {
        return yield* stopWith(TRANSCRIBE_UNAVAILABLE_MESSAGE);
      }
      const status = yield* Effect.tryPromise({
        try: () => port.modelStatus(),
        catch: (): EarlyResult => ({ status: 'error', message: TRANSCRIBE_FAILED_MESSAGE }),
      });
      if (status !== 'ready') {
        const confirmed = yield* Effect.suspend(() => {
          const asking = input.confirmDownload?.();
          return asking === undefined ? Effect.succeed(true) : Effect.promise(() => asking);
        });
        if (!confirmed) {
          return yield* Effect.fail<EarlyResult>({ status: 'cancelled' });
        }
        const failed = (error: unknown): EarlyResult => ({
          status: 'error',
          message: errorMessageOf(error),
        });
        yield* Effect.tryPromise({
          try: () => port.downloadModel((fraction) => onPhase({ kind: 'downloading', fraction })),
          catch: failed,
        });
        yield* Effect.try({ try: () => onPhase({ kind: 'loading' }), catch: failed });
        yield* Effect.tryPromise({ try: () => port.loadModel(), catch: failed });
      }
      let fileUri = input.source.localUri;
      if (fileUri === undefined || fileUri === '') {
        const url = input.source.url;
        if (url === undefined || url === '') {
          return yield* stopWith(TRANSCRIBE_FAILED_MESSAGE);
        }
        const files = yield* filesOf;
        cachedUri = yield* Effect.tryPromise({
          try: () => files.downloadUrl(url, input.source.headers, onPhase),
          catch: (error): EarlyResult => ({
            status: 'error',
            message:
              error instanceof TranscribeTooLargeError
                ? TRANSCRIBE_TOO_LONG_MESSAGE
                : TRANSCRIBE_FAILED_MESSAGE,
          }),
        });
        fileUri = cachedUri;
      }
      yield* Effect.sync(() => onPhase({ kind: 'transcribing' }));
      const uri = fileUri;
      const transcript = yield* Effect.tryPromise({
        try: () =>
          port.transcribe(uri, {
            ...(input.language === undefined ? {} : { language: input.language }),
            ...(input.audioMs === undefined ? {} : { audioMs: input.audioMs }),
          }),
        catch: (error): EarlyResult => ({ status: 'error', message: errorMessageOf(error) }),
      });
      if (transcript.text.trim() === '') {
        return yield* stopWith(TRANSCRIBE_EMPTY_MESSAGE);
      }
      return { status: 'done', transcript } satisfies TranscribeVoiceNoteResult;
    });

    const deleteCached = Effect.suspend(() => {
      const cached = cachedUri;
      return cached === undefined
        ? Effect.void
        : filesOf.pipe(
            Effect.flatMap((files) => Effect.promise(() => files.deleteCache(cached))),
            Effect.catchCause(() => Effect.void),
          );
    });

    return run.pipe(
      Effect.catch((early) => Effect.succeed<TranscribeVoiceNoteResult>(early)),
      Effect.ensuring(deleteCached),
    );
  });

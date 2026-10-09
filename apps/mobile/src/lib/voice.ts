/**
 * Voice message helpers (T-0154), the mobile twin of `apps/web/src/lib/voice.ts`.
 *
 * The web flow records in the browser (WebM/ogg), converts through
 * `POST /api/voice`, uploads the AAC/M4A bytes through XEP-0363, and sends a
 * `voice` payload. On mobile `expo-audio` records M4A/AAC directly, so the
 * conversion call is skipped when the file already is M4A/AAC — but on
 * Android the preset can still produce another container, and then the
 * conversion call is needed exactly as on web.
 */

import type { UploadSlot } from '@zilar/xmpp-core';
import { Effect } from 'effect';

/** Hard cap on a recording, matching the server's `POST /api/voice` limit. */
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
/** Recordings shorter than this are treated as an accidental tap. */
export const VOICE_MIN_MS = 1000;
/** The server refuses recordings longer than five minutes (`VOICE_MAX_*`). */
export const VOICE_MAX_DURATION_MS = 5 * 60 * 1000;
/** The name sent to the upload service; the container is always M4A. */
export const VOICE_FILENAME = 'voice.m4a';
export const VOICE_MIME = 'audio/mp4';

export class VoiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
  }
}

/** Whether the recorded file is already AAC/M4A and needs no conversion. */
export function isAlreadyConverted(input: { uri: string; mimeType?: string }): boolean {
  const mime = (input.mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (mime === 'audio/mp4' || mime === 'audio/aac' || mime === 'audio/x-m4a') {
    return true;
  }
  const extension = input.uri.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  return extension === 'm4a' || extension === 'aac';
}

/**
 * The banner copy for a send-boundary refusal (finding 4, round 3): named
 * per `VoiceError.code`, so an empty or too-short programmatic send never
 * reports the "too long" copy.
 */
export function voiceSendRefusalMessage(error: unknown): string {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : '';
  if (code === 'voice_empty') {
    return 'That recording is empty.';
  }
  if (code === 'voice_too_short') {
    return 'That recording is too short.';
  }
  return 'That recording is too long to send.';
}

/** A finished recording, ready to be converted (or not) and uploaded. */
export interface RecordedVoice {
  uri: string;
  mimeType: string;
  /** Byte size of the recorded file. */
  size: number;
  durationMs: number;
}

/**
 * Refuses a recording that breaks the send limits, before any request
 * (finding 1, review round 2): the already-converted skip branch must not
 * bypass the size/duration guards, and the composer is not the only caller.
 * Empty/too-large carry the server's `voice_*` codes so the store maps them
 * to the matching fixed failure reason; the sub-1s floor and the 5-min cap
 * reuse the same codes the recorder path reports.
 */
export function validateRecording(recording: Pick<RecordedVoice, 'size' | 'durationMs'>): void {
  Effect.runSync(validateRecordingEffect(recording));
}

/** The same guard as an Effect: a refusal fails with the `VoiceError`. */
export function validateRecordingEffect(
  recording: Pick<RecordedVoice, 'size' | 'durationMs'>,
): Effect.Effect<void, VoiceError> {
  if (recording.size === 0) {
    return Effect.fail(new VoiceError('voice_empty', 'The recording is empty'));
  }
  if (recording.size > VOICE_MAX_BYTES) {
    return Effect.fail(new VoiceError('voice_too_large', 'The recording is too long to send'));
  }
  if (recording.durationMs < VOICE_MIN_MS) {
    return Effect.fail(new VoiceError('voice_too_short', 'The recording is too short'));
  }
  if (recording.durationMs > VOICE_MAX_DURATION_MS) {
    return Effect.fail(new VoiceError('voice_too_long', 'The recording is too long'));
  }
  return Effect.void;
}

/** The converted bytes plus the server-measured duration, like web. */
export interface ConvertedVoice {
  /** The AAC/M4A bytes produced by the server (or the local file). */
  uri: string;
  mimeType: string;
  size: number;
  /** The duration `ffprobe` measured, never the duration the client claimed. */
  durationMs: number;
}

// A non-JSON error body falls through to a generic code.
const errorCode = (response: Response): Effect.Effect<string> =>
  Effect.tryPromise(() => response.json() as Promise<{ error?: { code?: string } } | null>).pipe(
    Effect.map((body) =>
      typeof body?.error?.code === 'string' ? body.error.code : 'voice_failed',
    ),
    Effect.orElseSucceed(() => 'voice_failed'),
  );

/**
 * Sends a recording to the server and gets back AAC/M4A plus its duration.
 * Mirrors web's `convertVoice`: the file must already sit on disk (the
 * recorder's URI), so the bytes are read with `expo-file-system` (the same
 * `new File(uri)` pattern `attachment-native.ts` uses — RN `fetch` does not
 * serve `file://` URIs) and POSTed with the session bearer. The duration
 * header is authoritative, like on web.
 */
export function convertVoice(
  file: { uri: string; mimeType: string; size: number; durationMs: number },
  options?: ConvertVoiceOptions,
): Promise<ConvertedVoice> {
  return Effect.runPromise(convertVoiceEffect(file, options));
}

export interface ConvertVoiceOptions {
  apiUrl?: string;
  getToken?: () => Promise<string | undefined>;
  fetchFn?: typeof fetch;
  /** Reads the recorded bytes; production reads the device file. */
  readFile?: ((uri: string) => Promise<Uint8Array>) | undefined;
}

/** `convertVoice` as an Effect: every refusal fails with a `VoiceError`. */
export const convertVoiceEffect = (
  file: { uri: string; mimeType: string; size: number; durationMs: number },
  options?: ConvertVoiceOptions,
): Effect.Effect<ConvertedVoice, VoiceError> =>
  Effect.gen(function* () {
    const fetchFn = options?.fetchFn ?? fetch;
    yield* validateRecordingEffect({ size: file.size, durationMs: file.durationMs });
    const apiUrl = options?.apiUrl;
    // A rejected token read is "no token", like a missing one.
    const token = yield* Effect.suspend(() => {
      const pending = options?.getToken?.();
      return pending === undefined
        ? Effect.succeed(undefined)
        : Effect.promise(() => pending).pipe(Effect.catchDefect(() => Effect.succeed(undefined)));
    });
    if (apiUrl === undefined || token === undefined) {
      return yield* Effect.fail(new VoiceError('network_error', 'Could not reach the server'));
    }
    const readFile = options?.readFile;
    const unreadable = () => new VoiceError('voice_failed', 'Could not read the recording');
    const bytes = yield* readFile !== undefined
      ? Effect.tryPromise({ try: () => readFile(file.uri), catch: unreadable })
      : readDeviceFile(file.uri).pipe(Effect.mapError(unreadable));
    yield* validateBytes(bytes);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchFn(`${apiUrl}/api/voice`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': file.mimeType === '' ? 'application/octet-stream' : file.mimeType,
          },
          // The exact bytes, even when `readFile` returns a view over a larger
          // buffer (finding 6, round 3): `buffer` alone would over-post.
          body: voicePostBody(bytes),
        }),
      catch: () => new VoiceError('network_error', 'Could not reach the server'),
    });

    if (!response.ok) {
      const code = yield* errorCode(response);
      return yield* Effect.fail(new VoiceError(code, 'The server could not convert the recording'));
    }

    const durationMs = Number(response.headers.get('x-zilar-duration-ms'));
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return yield* Effect.fail(new VoiceError('invalid_response', 'The server sent no duration'));
    }
    const audio = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
    yield* validateRecordingEffect({ size: audio.byteLength, durationMs });
    return { uri: file.uri, mimeType: VOICE_MIME, size: audio.byteLength, durationMs };
  });

/** Refuses the bytes read from the device before they are posted. */
function validateBytes(bytes: Uint8Array): Effect.Effect<void, VoiceError> {
  if (bytes.byteLength === 0) {
    return Effect.fail(new VoiceError('voice_empty', 'The recording is empty'));
  }
  if (bytes.byteLength > VOICE_MAX_BYTES) {
    return Effect.fail(new VoiceError('voice_too_large', 'The recording is too long to send'));
  }
  return Effect.void;
}

/** Reads a recorded device file, the way the attachment uploader does. */
const readDeviceFile = (uri: string): Effect.Effect<Uint8Array, unknown> =>
  Effect.tryPromise(() => import('expo-file-system')).pipe(
    Effect.flatMap(({ File }) => Effect.tryPromise(() => new File(uri).bytes())),
  );

/**
 * The exact POST body for recorded bytes (finding 6, round 3): a full-buffer
 * view passes through untouched, while a view over a larger buffer is
 * copied down to its own bytes — `buffer` alone would over-post.
 */
export function voicePostBody(bytes: Uint8Array): BodyInit {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes as unknown as BodyInit;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

/** Anything that can hand out a XEP-0363 upload slot. */
export interface UploadSlotRequester {
  requestUploadSlot(request: {
    filename: string;
    size: number;
    contentType: string;
  }): Promise<UploadSlot>;
}

/** Anything that can PUT the converted file to the slot, like the seamed uploader. */
export interface VoiceUploader {
  upload(
    file: { uri: string; mimeType: string },
    slot: { putUrl: string; headers: Record<string, string> },
    onProgress?: (fraction: number) => void,
    messageId?: string,
  ): Promise<void>;
}

/** PUTs the converted bytes to the slot and returns the download URL. */
export function uploadVoice(
  requester: UploadSlotRequester,
  uploader: VoiceUploader,
  audio: { uri: string; mimeType: string; size: number },
  onProgress?: (fraction: number) => void,
  messageId?: string,
): Promise<string> {
  return Effect.runPromise(uploadVoiceEffect(requester, uploader, audio, onProgress, messageId));
}

/** `uploadVoice` as an Effect: a user cancel keeps its own error, the rest is `upload_failed`. */
export const uploadVoiceEffect = (
  requester: UploadSlotRequester,
  uploader: VoiceUploader,
  audio: { uri: string; mimeType: string; size: number },
  onProgress?: (fraction: number) => void,
  messageId?: string,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const slot = yield* Effect.promise(() =>
      requester.requestUploadSlot({
        filename: VOICE_FILENAME,
        size: audio.size,
        contentType: VOICE_MIME,
      }),
    );
    yield* Effect.tryPromise({
      try: () =>
        uploader.upload(
          { uri: audio.uri, mimeType: VOICE_MIME },
          { putUrl: slot.putUrl, headers: slot.headers },
          onProgress,
          messageId,
        ),
      catch: (error) =>
        error instanceof Error && error.message === 'cancelled'
          ? error
          : new VoiceError('upload_failed', 'Could not upload the recording'),
    });
    return slot.getUrl;
  });

/** The three steps the store needs; injected in tests. */
export interface VoicePort {
  convert: (recording: RecordedVoice) => Promise<ConvertedVoice>;
  upload: (
    requester: UploadSlotRequester,
    audio: ConvertedVoice,
    onProgress?: (fraction: number) => void,
    messageId?: string,
  ) => Promise<string>;
}

/** Builds the store's voice port from the API origin, the token and the PUT seam. */
export function createVoicePort(options: {
  apiUrl: string;
  getToken: () => Promise<string | undefined>;
  uploader: VoiceUploader;
  fetchFn?: typeof fetch;
  readFile?: ((uri: string) => Promise<Uint8Array>) | undefined;
}): VoicePort {
  return {
    convert: (recording) =>
      Effect.runPromise(
        Effect.gen(function* () {
          // The send boundary (finding 1): the skip branch enforces the same
          // size/duration limits as the conversion path, so an over-limit m4a
          // never reaches the upload slot or the PUT.
          yield* validateRecordingEffect(recording);
          if (isAlreadyConverted(recording)) {
            return {
              uri: recording.uri,
              mimeType: VOICE_MIME,
              size: recording.size,
              durationMs: recording.durationMs,
            };
          }
          return yield* convertVoiceEffect(recording, {
            apiUrl: options.apiUrl,
            getToken: options.getToken,
            fetchFn: options.fetchFn,
            readFile: options.readFile,
          });
        }),
      ),
    upload: (requester, audio, onProgress, messageId) =>
      uploadVoice(requester, options.uploader, audio, onProgress, messageId),
  };
}

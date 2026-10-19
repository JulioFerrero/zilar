/**
 * Web records WebM/ogg and converts through `POST /api/voice`; `expo-audio` records M4A/AAC directly, so the call is skipped for that — but an Android preset may still produce another container, and then it is needed as on web.
 */

import { Effect } from 'effect';
import type { UploadSlotRequester } from '@zilar/client-core';

export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MIN_MS = 1000;
export const VOICE_MAX_DURATION_MS = 5 * 60 * 1000;
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

export function isAlreadyConverted(input: { uri: string; mimeType?: string }): boolean {
  const mime = (input.mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (mime === 'audio/mp4' || mime === 'audio/aac' || mime === 'audio/x-m4a') {
    return true;
  }
  const extension = input.uri.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  return extension === 'm4a' || extension === 'aac';
}

/**
 * Named per `VoiceError.code`, so an empty or too-short send never reports the "too long" copy.
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

export interface RecordedVoice {
  uri: string;
  mimeType: string;
  size: number;
  durationMs: number;
}

/**
 * The already-converted skip branch must not bypass the size and duration guards, and the composer is not the only caller. The codes are the server's `voice_*`, so the store maps them to fixed failure reasons.
 */
export function validateRecording(recording: Pick<RecordedVoice, 'size' | 'durationMs'>): void {
  Effect.runSync(validateRecordingEffect(recording));
}

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

export interface ConvertedVoice {
  uri: string;
  mimeType: string;
  size: number;
  durationMs: number;
}

const errorCode = (response: Response): Effect.Effect<string> =>
  Effect.tryPromise(() => response.json() as Promise<{ error?: { code?: string } } | null>).pipe(
    Effect.map((body) =>
      typeof body?.error?.code === 'string' ? body.error.code : 'voice_failed',
    ),
    Effect.orElseSucceed(() => 'voice_failed'),
  );

/**
 * RN `fetch` does not serve `file://` URIs, so the bytes are read with `expo-file-system`. The duration header is authoritative, like on web.
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
  readFile?: ((uri: string) => Promise<Uint8Array>) | undefined;
}

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
          // The exact bytes even when `readFile` returns a view over a larger buffer: `buffer` alone would over-post.
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

function validateBytes(bytes: Uint8Array): Effect.Effect<void, VoiceError> {
  if (bytes.byteLength === 0) {
    return Effect.fail(new VoiceError('voice_empty', 'The recording is empty'));
  }
  if (bytes.byteLength > VOICE_MAX_BYTES) {
    return Effect.fail(new VoiceError('voice_too_large', 'The recording is too long to send'));
  }
  return Effect.void;
}

const readDeviceFile = (uri: string): Effect.Effect<Uint8Array, unknown> =>
  Effect.tryPromise(() => import('expo-file-system')).pipe(
    Effect.flatMap(({ File }) => Effect.tryPromise(() => new File(uri).bytes())),
  );

/**
 * A view over a larger buffer is copied down to its own bytes; `buffer` alone would over-post.
 */
export function voicePostBody(bytes: Uint8Array): BodyInit {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes as unknown as BodyInit;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export interface VoiceUploader {
  upload(
    file: { uri: string; mimeType: string },
    slot: { putUrl: string; headers: Record<string, string> },
    onProgress?: (fraction: number) => void,
    messageId?: string,
  ): Promise<void>;
}

export function uploadVoice(
  requester: UploadSlotRequester,
  uploader: VoiceUploader,
  audio: { uri: string; mimeType: string; size: number },
  onProgress?: (fraction: number) => void,
  messageId?: string,
): Promise<string> {
  return Effect.runPromise(uploadVoiceEffect(requester, uploader, audio, onProgress, messageId));
}

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

export interface VoicePort {
  convert: (recording: RecordedVoice) => Promise<ConvertedVoice>;
  upload: (
    requester: UploadSlotRequester,
    audio: ConvertedVoice,
    onProgress?: (fraction: number) => void,
    messageId?: string,
  ) => Promise<string>;
}

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
          // The skip branch enforces the same limits as the conversion path, so an over-limit m4a never reaches the upload slot.
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

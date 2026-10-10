import type { UploadSlot } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { runWeb } from '@/lib/effect/runtime';
import { API_BASE } from '../api';
import { VOICE_FILENAME, VOICE_MAX_BYTES, VOICE_MIME, VoiceError } from './recorder';

/** Runs an Effect thunk as a Promise; the shared body of the voice wrappers. */
export const promiseOf = <A, E>(
  effect: () => Effect.Effect<A, E, HttpClient.HttpClient>,
): Promise<A> => runWeb(effect());

export interface ConvertedVoice {
  /** The AAC/M4A bytes produced by the server. */
  audio: Blob;
  /** The duration `ffprobe` measured, never the duration the client claimed. */
  durationMs: number;
}

// The code in a JSON error body, or a generic one for anything else.
function errorCodeOf(body: unknown): string {
  const code = (body as { error?: { code?: unknown } | null } | null)?.error?.code;
  return typeof code === 'string' ? code : 'voice_failed';
}

// A non-JSON error body falls through to the generic code.
const errorCode = (response: Response): Effect.Effect<string> =>
  Effect.tryPromise(() => response.json() as PromiseLike<unknown>).pipe(
    Effect.map(errorCodeOf),
    Effect.orElseSucceed(() => 'voice_failed'),
  );

/** Sends a recording to the server and gets back AAC/M4A plus its duration. */
export function convertVoice(blob: Blob, fetchFn: typeof fetch = fetch): Promise<ConvertedVoice> {
  return promiseOf(() => convertVoiceEffect(blob, fetchFn));
}

export const convertVoiceEffect = Effect.fnUntraced(function* (
  blob: Blob,
  fetchFn: typeof fetch,
): Effect.fn.Return<ConvertedVoice, VoiceError> {
  if (blob.size === 0) {
    return yield* Effect.fail(new VoiceError('voice_empty', 'The recording is empty'));
  }
  if (blob.size > VOICE_MAX_BYTES) {
    return yield* Effect.fail(
      new VoiceError('voice_too_large', 'The recording is too long to send'),
    );
  }

  const response = yield* Effect.tryPromise({
    try: () =>
      fetchFn(`${API_BASE}/voice`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': blob.type === '' ? 'application/octet-stream' : blob.type },
        body: blob,
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
  const audio = yield* Effect.promise(() => response.blob());
  return { audio: new Blob([audio], { type: VOICE_MIME }), durationMs };
});

/** Anything that can hand out a XEP-0363 upload slot. */
export interface UploadSlotRequester {
  requestUploadSlot(request: {
    filename: string;
    size: number;
    contentType: string;
  }): Promise<UploadSlot>;
}

/** PUTs the converted bytes to the slot and returns the download URL. */
export function uploadVoice(
  requester: UploadSlotRequester,
  audio: Blob,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  return promiseOf(() => uploadVoiceEffect(requester, audio, fetchFn));
}

// A rejection from `requestUploadSlot` is a defect, so the caller sees the
// original error; only the PUT failures become a `VoiceError`.
export const uploadVoiceEffect = Effect.fnUntraced(function* (
  requester: UploadSlotRequester,
  audio: Blob,
  fetchFn: typeof fetch,
): Effect.fn.Return<string, VoiceError> {
  const slot = yield* Effect.promise(() =>
    requester.requestUploadSlot({
      filename: VOICE_FILENAME,
      size: audio.size,
      contentType: VOICE_MIME,
    }),
  );

  const response = yield* Effect.tryPromise({
    try: () =>
      fetchFn(slot.putUrl, {
        method: 'PUT',
        headers: { 'content-type': VOICE_MIME, ...slot.headers },
        body: audio,
      }),
    catch: () => new VoiceError('upload_failed', 'Could not upload the recording'),
  });
  if (!response.ok) {
    return yield* Effect.fail(
      new VoiceError('upload_failed', 'The upload service refused the recording'),
    );
  }
  return slot.getUrl;
});

/** The three steps the store needs; injected in tests. */
export interface VoicePort {
  convert: (blob: Blob) => Promise<ConvertedVoice>;
  upload: (requester: UploadSlotRequester, audio: Blob) => Promise<string>;
}

export const defaultVoicePort: VoicePort = {
  convert: (blob) => convertVoice(blob),
  upload: (requester, audio) => uploadVoice(requester, audio),
};

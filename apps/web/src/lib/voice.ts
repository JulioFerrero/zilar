import type { UploadSlot } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';
import { API_BASE } from './api';

/** Hard cap on a recording, matching the server's `POST /api/voice` limit. */
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
/** Recordings shorter than this are treated as an accidental tap. */
export const VOICE_MIN_MS = 500;
/** The name sent to the upload service; the container is always M4A. */
export const VOICE_FILENAME = 'voice.m4a';
export const VOICE_MIME = 'audio/mp4';
export const WAVEFORM_BUCKETS = 40;

export class VoiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
  }
}

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  // Safari and iOS support neither WebM nor Ogg; they record AAC/M4A.
  'audio/mp4',
];

export function isVoiceRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices !== undefined &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/** The container the browser will actually produce, if it will say. */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined;
  }
  return RECORDER_MIME_TYPES.find((mime) => MediaRecorder.isTypeSupported(mime));
}

export interface RecordedVoice {
  blob: Blob;
  /** The container the browser produced, e.g. `audio/webm` or `audio/mp4`. */
  mimeType: string;
  durationMs: number;
}

/**
 * A thin wrapper around `MediaRecorder` that stops the microphone tracks and
 * reports how long the user held the button.
 */
export class VoiceRecorder {
  readonly #recorder: MediaRecorder;
  readonly #stream: MediaStream;
  readonly #chunks: Blob[] = [];
  readonly #startedAt: number;
  #stopPromise: Promise<RecordedVoice> | undefined;

  private constructor(recorder: MediaRecorder, stream: MediaStream) {
    this.#recorder = recorder;
    this.#stream = stream;
    this.#startedAt = Date.now();
    this.#recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.#chunks.push(event.data);
      }
    };
    this.#recorder.start(250);
  }

  static start(mimeType?: string): Promise<VoiceRecorder> {
    return runWeb(VoiceRecorder.startEffect(mimeType));
  }

  static readonly startEffect = Effect.fnUntraced(function* (
    mimeType?: string,
  ): Effect.fn.Return<VoiceRecorder, VoiceError> {
    if (!isVoiceRecordingSupported()) {
      return yield* Effect.fail(
        new VoiceError('voice_unsupported', 'This browser cannot record audio'),
      );
    }
    const stream = yield* Effect.tryPromise({
      try: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      catch: voiceErrorFromGetUserMedia,
    });
    const preferred = mimeType ?? pickRecorderMime();
    // Some browsers reject an explicit mime; the second try lets the browser choose.
    const recorder = yield* Effect.firstSuccessOf([
      Effect.try(
        () =>
          new MediaRecorder(stream, preferred === undefined ? undefined : { mimeType: preferred }),
      ),
      Effect.try(() => new MediaRecorder(stream)),
    ]).pipe(
      // Never leave the microphone open (the browser's recording indicator)
      // when no recorder can be built.
      Effect.tapError(() =>
        Effect.sync(() => {
          for (const track of stream.getTracks()) {
            track.stop();
          }
        }),
      ),
      Effect.mapError(
        () => new VoiceError('voice_unsupported', 'This browser cannot record audio'),
      ),
    );
    return yield* Effect.sync(() => new VoiceRecorder(recorder, stream));
  });

  get durationMs(): number {
    return Date.now() - this.#startedAt;
  }

  get mimeType(): string {
    return this.#recorder.mimeType;
  }

  stop(): Promise<RecordedVoice> {
    if (this.#stopPromise !== undefined) {
      return this.#stopPromise;
    }
    this.#stopPromise = runWeb(
      Effect.callback<RecordedVoice>((resume) => {
        this.#recorder.onstop = () => {
          const type = this.#recorder.mimeType === '' ? 'audio/webm' : this.#recorder.mimeType;
          resume(
            Effect.succeed({
              blob: new Blob(this.#chunks, { type }),
              mimeType: type,
              durationMs: this.durationMs,
            }),
          );
          this.#release();
        };
        this.#recorder.stop();
      }),
    );
    return this.#stopPromise;
  }

  cancel(): void {
    // Stopping an already-stopped recorder is not an error here.
    Effect.runSync(
      Effect.try(() => {
        this.#recorder.onstop = null;
        this.#recorder.stop();
      }).pipe(Effect.orElseSucceed(() => undefined)),
    );
    this.#release();
  }

  #release(): void {
    for (const track of this.#stream.getTracks()) {
      track.stop();
    }
  }
}

/**
 * Maps a `getUserMedia` rejection to a `VoiceError` the composer can show.
 * The `DOMException` name tells the cases apart: a denial is actionable
 * (the user blocked the microphone), a missing device is not.
 */
export function voiceErrorFromGetUserMedia(error: unknown): VoiceError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new VoiceError('voice_no_microphone', 'No microphone was found.');
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new VoiceError(
      'voice_blocked',
      "Microphone access is blocked. Allow it in the browser's site settings.",
    );
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new VoiceError('voice_unavailable', 'The microphone is busy. Try again.');
  }
  return new VoiceError('voice_unavailable', 'Microphone unavailable');
}

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
  return runWeb(convertVoiceEffect(blob, fetchFn));
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
  return runWeb(uploadVoiceEffect(requester, audio, fetchFn));
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

/**
 * Peak buckets for the bubble. Decoding uses `AudioContext`; any failure (or a
 * browser without it, like jsdom) falls back to a quiet flat waveform.
 */
export function computeWaveform(blob: Blob, buckets = WAVEFORM_BUCKETS): Promise<number[]> {
  return runWeb(computeWaveformEffect(blob, buckets));
}

function peaksOf(decoded: AudioBuffer, buckets: number): number[] {
  const channel = decoded.getChannelData(0);
  const perBucket = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * perBucket;
    const end = Math.min(channel.length, start + perBucket);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(channel[index] ?? 0);
      if (value > peak) {
        peak = value;
      }
    }
    peaks.push(Math.min(255, Math.round(peak * 255)));
  }
  return peaks;
}

export const computeWaveformEffect = (
  blob: Blob,
  buckets = WAVEFORM_BUCKETS,
): Effect.Effect<number[]> =>
  Effect.suspend(() => {
    const fallback = Array.from({ length: buckets }, () => 12);
    const AudioContextCtor = typeof AudioContext === 'undefined' ? undefined : AudioContext;
    if (AudioContextCtor === undefined) {
      return Effect.succeed(fallback);
    }
    // The context is closed after every outcome; a failed close is ignored.
    return Effect.acquireUseRelease(
      Effect.try(() => new AudioContextCtor()),
      (context) =>
        Effect.gen(function* () {
          const bytes = yield* Effect.tryPromise(() => blob.arrayBuffer());
          const decoded = yield* Effect.tryPromise(() => context.decodeAudioData(bytes));
          return yield* Effect.try(() => peaksOf(decoded, buckets));
        }),
      (context) =>
        Effect.suspend(() => {
          const closing = context.close();
          return Effect.tryPromise(() => closing).pipe(Effect.ignore);
        }),
    ).pipe(Effect.orElseSucceed(() => fallback));
  });

/**
 * A short synthesized tone as a WAV data URI. Mock chats use it so their voice
 * bubbles are genuinely playable without shipping an audio asset.
 */
export function sampleVoiceDataUrl(durationMs = 900): string {
  const sampleRate = 8000;
  // A placeholder tone does not need to match the label; two seconds is plenty.
  const cappedMs = Math.min(Math.max(1, durationMs), 2000);
  const samples = Math.max(1, Math.round((sampleRate * cappedMs) / 1000));
  const data = new Uint8Array(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 200, (samples - index) / 200);
    const value = Math.round(Math.sin((index / sampleRate) * 2 * Math.PI * 440) * 9000 * fade);
    data[index * 2] = value & 0xff;
    data[index * 2 + 1] = (value >> 8) & 0xff;
  }
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  writeAscii(header, 0, 'RIFF');
  view.setUint32(4, 36 + data.length, true);
  writeAscii(header, 8, 'WAVE');
  writeAscii(header, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(header, 36, 'data');
  view.setUint32(40, data.length, true);

  const bytes = new Uint8Array(header.length + data.length);
  bytes.set(header, 0);
  bytes.set(data, header.length);
  return `data:audio/wav;base64,${base64(bytes)}`;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    target[offset + index] = text.charCodeAt(index);
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

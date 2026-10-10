import { Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';

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

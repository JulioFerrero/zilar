import { Effect, Semaphore } from 'effect';

import { planQuietCutChunks } from './chunks';
import { normalizeWhistleLanguage } from './model';
import { parseWhistleResult, WhistleError, whistleErrorFor } from './result';
import type { WhistleTranscript } from './result';
import { getNativeModule } from './ZilarWhistleModule';

/** True on Android arm64 where the native module is linked, false elsewhere. */
export function isAvailable(): boolean {
  return Effect.runSync(isAvailableEffect());
}

const isAvailableEffect = (): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const native = getNativeModule();
    if (native === null) {
      return false;
    }
    return yield* Effect.try({ try: () => native.isAvailable(), catch: () => false }).pipe(
      Effect.orElseSucceed(() => false),
    );
  });

/**
 * One transcription at a time: the engine holds a single process-global
 * model, so a second call waits for the first instead of racing it. The
 * permit always releases — on success AND on failure — so a failed call can
 * never hang later ones.
 */
const transcribeGate = Semaphore.makeUnsafe(1);

export interface TranscribeOptions {
  language?: string | undefined;
  /**
   * Known audio length in ms (voice pipeline duration). Lets JS plan the
   * chunks with the tested `planQuietCutChunks` WITHOUT decoding first; the
   * native side only slices those ranges. Omit when unknown: the native
   * side transcribes the whole clip as one chunk.
   */
  audioMs?: number | undefined;
  /**
   * Reads the absolute sample amplitude at an index for the quiet-cut plan.
   * Production passes undefined: long clips then fetch the real envelope
   * from the native decoder, falling back to even 28 s windows when that
   * fails; tests inject fakes. Kept out of the hot path: only used for
   * long clips.
   */
  amplitudes?: ((sample: number) => number) | undefined;
}

/**
 * Transcribes an audio file on the device (m4a/AAC as the app records, also
 * wav). JS plans the chunks with the tested `planQuietCutChunks` and the
 * native side only decodes and transcribes those (startMs, endMs) ranges;
 * texts join with a single space. Empty/silent audio resolves with an empty
 * text. `wallMs` covers the whole call including decode; `audioMs` is the
 * decoded audio length.
 */
export function transcribe(
  fileUri: string,
  options?: TranscribeOptions,
): Promise<WhistleTranscript> {
  return Effect.runPromise(transcribeGate.withPermits(1)(runTranscribeEffect(fileUri, options)));
}

const runTranscribeEffect = (fileUri: string, options?: TranscribeOptions) =>
  Effect.gen(function* () {
    const native = getNativeModule();
    if (native === null || !(yield* isAvailableEffect())) {
      return yield* Effect.fail(
        new WhistleError('unavailable', 'On-device transcription needs Android arm64'),
      );
    }
    if (fileUri === '') {
      return yield* Effect.fail(
        new WhistleError('not_audio', 'That file could not be read as audio'),
      );
    }
    const localPath = toLocalPath(fileUri);
    const started = Date.now();
    const language = normalizeWhistleLanguage(options?.language);
    const ranges = yield* planRangesEffect(localPath, options);
    const raw = yield* Effect.tryPromise({
      try: () =>
        ranges === null
          ? native.transcribeFile(localPath, language)
          : native.transcribeRanges(localPath, ranges, language),
      catch: (error) => whistleErrorFor(error),
    });
    const parsed = yield* Effect.try({
      try: () => parseWhistleResult(raw),
      catch: (error) => whistleErrorFor(error),
    });
    return {
      text: parsed.text,
      language: parsed.language,
      ttftMs: parsed.ttftMs,
      decodeTps: parsed.decodeTps,
      audioMs: parsed.audioMs,
      wallMs: Math.max(0, Date.now() - started),
    };
  });

/** Strips the `file://` scheme the recorder URIs carry for the native side. */
export function toLocalPath(fileUri: string): string {
  return fileUri.startsWith('file://') ? fileUri.slice('file://'.length) : fileUri;
}

type PlannedRanges = Array<[number, number]> | null;

/**
 * Plans the native (startMs, endMs) ranges with the tested quiet-cut planner
 * (finding 6): the native side only slices these, it never splits itself.
 * Returns null when the length is unknown or fits one chunk — the native
 * side then transcribes the whole clip as a single chunk.
 *
 * For long clips without caller-provided `amplitudes`, fetches the real
 * amplitude envelope from the native decoder first so cuts land in pauses;
 * an envelope failure falls back to even 28 s windows — never fails the
 * transcription. Short clips never touch the native envelope.
 */
export function planRangesMs(
  localPathOrOptions?: string | TranscribeOptions,
  maybeOptions?: TranscribeOptions,
): Promise<Array<[number, number]> | null> {
  const localPath = typeof localPathOrOptions === 'string' ? localPathOrOptions : undefined;
  const options = typeof localPathOrOptions === 'string' ? maybeOptions : localPathOrOptions;
  return Effect.runPromise(planRangesEffect(localPath, options));
}

const planRangesEffect = (
  localPath: string | undefined,
  options?: TranscribeOptions,
): Effect.Effect<PlannedRanges> =>
  Effect.gen(function* () {
    const audioMs = options?.audioMs ?? 0;
    if (!Number.isFinite(audioMs) || audioMs <= 28_000) {
      return null;
    }
    const totalSamples = Math.floor((audioMs * 16000) / 1000);
    if (totalSamples <= 0) {
      return null;
    }
    const amplitudes = options?.amplitudes ?? (yield* envelopeAmplitudesEffect(localPath));
    const chunks = planQuietCutChunks(totalSamples, amplitudes);
    if (chunks.length <= 1) {
      return null;
    }
    return chunks.map((chunk): [number, number] => [
      (chunk.start * 1000) / 16000,
      (chunk.end * 1000) / 16000,
    ]);
  });

/**
 * Reads the native 10 ms amplitude envelope (one mean absolute amplitude per
 * 160 samples) and adapts it to the planner's per-sample function. Returns
 * the even-window fallback (`() => 1`) when there is no local path or the
 * native call fails.
 */
const envelopeAmplitudesEffect = (
  localPath: string | undefined,
): Effect.Effect<(sample: number) => number> =>
  Effect.gen(function* () {
    const fallback = (): number => 1;
    if (localPath === undefined || localPath === '') {
      return fallback;
    }
    const native = getNativeModule();
    if (native === null) {
      return fallback;
    }
    const envelope = yield* Effect.tryPromise({
      try: () => native.amplitudeEnvelope(localPath),
      catch: () => 'unreadable' as const,
    }).pipe(Effect.orElseSucceed(() => [] as number[]));
    if (!Array.isArray(envelope) || envelope.length === 0) {
      return fallback;
    }
    return (sample: number): number => envelope[Math.floor(sample / 160)] ?? 0;
  });

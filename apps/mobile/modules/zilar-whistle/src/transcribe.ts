import { planQuietCutChunks } from './chunks';
import { normalizeWhistleLanguage } from './model';
import { parseWhistleResult, WhistleError, whistleErrorFor } from './result';
import type { WhistleTranscript } from './result';
import { getNativeModule } from './ZilarWhistleModule';

/** True on Android arm64 where the native module is linked, false elsewhere. */
export function isAvailable(): boolean {
  const native = getNativeModule();
  if (native === null) {
    return false;
  }
  try {
    return native.isAvailable();
  } catch {
    return false;
  }
}

/**
 * One transcription at a time: the engine holds a single process-global
 * model, so a second call waits for the first instead of racing it. The
 * guard always clears — on success AND on failure — so a failed call can
 * never hang later ones.
 */
let inFlight: Promise<WhistleTranscript> | undefined;

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
  if (inFlight !== undefined) {
    const previous = inFlight;
    const next = previous.then(
      () => runTranscribe(fileUri, options),
      () => runTranscribe(fileUri, options),
    );
    inFlight = next;
    return next;
  }
  const current = runTranscribe(fileUri, options);
  inFlight = current;
  // Clears on success and on failure alike: a rejection must release the
  // guard, or every later call would hang behind the failed one. Queued
  // followers replace `inFlight` with their own chained promise, so this
  // only clears when nothing followed.
  const release = () => {
    if (inFlight === current) {
      inFlight = undefined;
    }
  };
  void current.then(release, release);
  return current;
}

async function runTranscribe(
  fileUri: string,
  options?: TranscribeOptions,
): Promise<WhistleTranscript> {
  const native = getNativeModule();
  if (native === null || !isAvailable()) {
    throw new WhistleError('unavailable', 'On-device transcription needs Android arm64');
  }
  if (fileUri === '') {
    throw new WhistleError('not_audio', 'That file could not be read as audio');
  }
  const localPath = toLocalPath(fileUri);
  const started = Date.now();
  const language = normalizeWhistleLanguage(options?.language);
  const ranges = await planRangesMs(localPath, options);
  let raw: Record<string, unknown>;
  try {
    raw =
      ranges === null
        ? await native.transcribeFile(localPath, language)
        : await native.transcribeRanges(localPath, ranges, language);
  } catch (error) {
    throw whistleErrorFor(error);
  }
  const parsed = parseWhistleResult(raw);
  return {
    text: parsed.text,
    language: parsed.language,
    ttftMs: parsed.ttftMs,
    decodeTps: parsed.decodeTps,
    audioMs: parsed.audioMs,
    wallMs: Math.max(0, Date.now() - started),
  };
}

/** Strips the `file://` scheme the recorder URIs carry for the native side. */
export function toLocalPath(fileUri: string): string {
  return fileUri.startsWith('file://') ? fileUri.slice('file://'.length) : fileUri;
}

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
  return planRanges(localPath, options);
}

async function planRanges(
  localPath: string | undefined,
  options?: TranscribeOptions,
): Promise<Array<[number, number]> | null> {
  const audioMs = options?.audioMs ?? 0;
  if (!Number.isFinite(audioMs) || audioMs <= 28_000) {
    return null;
  }
  const totalSamples = Math.floor((audioMs * 16000) / 1000);
  if (totalSamples <= 0) {
    return null;
  }
  const amplitudes = options?.amplitudes ?? (await envelopeAmplitudes(localPath));
  const chunks = planQuietCutChunks(totalSamples, amplitudes);
  if (chunks.length <= 1) {
    return null;
  }
  return chunks.map((chunk): [number, number] => [
    (chunk.start * 1000) / 16000,
    (chunk.end * 1000) / 16000,
  ]);
}

/**
 * Reads the native 10 ms amplitude envelope (one mean absolute amplitude per
 * 160 samples) and adapts it to the planner's per-sample function. Returns
 * the even-window fallback (`() => 1`) when there is no local path or the
 * native call fails.
 */
async function envelopeAmplitudes(
  localPath: string | undefined,
): Promise<(sample: number) => number> {
  const fallback = (): number => 1;
  if (localPath === undefined || localPath === '') {
    return fallback;
  }
  const native = getNativeModule();
  if (native === null) {
    return fallback;
  }
  try {
    const envelope = await native.amplitudeEnvelope(localPath);
    if (!Array.isArray(envelope) || envelope.length === 0) {
      return fallback;
    }
    return (sample: number): number => envelope[Math.floor(sample / 160)] ?? 0;
  } catch {
    return fallback;
  }
}

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
 * model, so a second call waits for the first instead of racing it.
 */
let inFlight: Promise<WhistleTranscript> | undefined;

export interface TranscribeOptions {
  language?: string | undefined;
}

/**
 * Transcribes an audio file on the device (m4a/AAC as the app records, also
 * wav). The native side decodes to 16 kHz mono, splits audio longer than
 * 30 s into quiet-cut chunks and joins their texts with a single space.
 * Empty/silent audio resolves with an empty text. `wallMs` covers the whole
 * call including decode; `audioMs` is the decoded audio length.
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
  void current.then(clearIfCurrent(current), clearIfCurrent(current));
  return current;
}

function clearIfCurrent(current: Promise<WhistleTranscript>): () => void {
  return () => {
    if (inFlight === current) {
      inFlight = undefined;
    }
  };
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
  let raw: Record<string, unknown>;
  try {
    raw = await native.transcribeFile(localPath, normalizeWhistleLanguage(options?.language));
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

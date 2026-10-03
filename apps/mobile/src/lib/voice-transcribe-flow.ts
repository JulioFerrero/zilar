/**
 * The on-device transcription flow for a voice note (T-0179): pure logic
 * with injected seams, no React. The bubble drives this, shows the phases,
 * and persists the text through `voice-transcripts.ts`. Audio and text never
 * leave the phone; the cached download is always deleted.
 */

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
  /** A local file that is already on the phone. */
  localUri?: string | undefined;
  /** A served URL that must be downloaded first, with headers when needed. */
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
}

/** The file seam: tests inject a fake, production uses `expo-file-system`. */
export interface TranscribeFileDeps {
  downloadUrl: (
    url: string,
    headers: Record<string, string> | undefined,
    onPhase: (phase: TranscribePhase) => void,
  ) => Promise<string>;
  deleteCache: (uri: string) => Promise<void>;
}

export interface TranscribeVoiceNoteInput {
  port: WhistlePort;
  source: VoiceTranscribeSource;
  audioMs?: number | undefined;
  language?: string | undefined;
  onPhase?: ((phase: TranscribePhase) => void) | undefined;
  /** Asks the user before the one-time model download; false cancels. */
  confirmDownload?: (() => Promise<boolean>) | undefined;
  files?: TranscribeFileDeps | undefined;
}

export type TranscribeVoiceNoteResult =
  | { status: 'done'; transcript: WhistleTranscript }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

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

async function defaultFiles(): Promise<TranscribeFileDeps> {
  const { File, Paths } = await import('expo-file-system');
  return {
    downloadUrl: async (url, headers) => {
      const destination = new File(
        Paths.cache,
        `voice-transcribe-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.m4a`,
      );
      const downloaded = await File.downloadFileAsync(url, destination, {
        idempotent: true,
        ...(headers === undefined ? {} : { headers }),
      });
      return downloaded.uri;
    },
    deleteCache: async (uri) => {
      try {
        new File(uri).delete();
      } catch {
        // The cache must never block the result.
      }
    },
  };
}

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
 * Transcribes one voice note on the device. When the model is missing the
 * `confirmDownload` callback runs first (no callback means proceed); a
 * `false` answer stops with `cancelled`. A served URL is downloaded to the
 * cache with its headers and the cached file is always deleted, on success
 * and on failure. An empty text resolves to the "nothing heard" error.
 */
export async function transcribeVoiceNote(
  input: TranscribeVoiceNoteInput,
): Promise<TranscribeVoiceNoteResult> {
  const { port } = input;
  const onPhase = phaseOf(input);
  let cachedUri: string | undefined;
  try {
    if (!port.isAvailable()) {
      return { status: 'error', message: TRANSCRIBE_UNAVAILABLE_MESSAGE };
    }
    let status: string;
    try {
      status = await port.modelStatus();
    } catch {
      return { status: 'error', message: TRANSCRIBE_FAILED_MESSAGE };
    }
    if (status !== 'ready') {
      const confirmed = (await input.confirmDownload?.()) ?? true;
      if (!confirmed) {
        return { status: 'cancelled' };
      }
      try {
        await port.downloadModel((fraction) => onPhase({ kind: 'downloading', fraction }));
        onPhase({ kind: 'loading' });
        await port.loadModel();
      } catch (error) {
        return { status: 'error', message: errorMessageOf(error) };
      }
    }
    let fileUri = input.source.localUri;
    if (fileUri === undefined || fileUri === '') {
      const url = input.source.url;
      if (url === undefined || url === '') {
        return { status: 'error', message: TRANSCRIBE_FAILED_MESSAGE };
      }
      const files = input.files ?? (await defaultFiles());
      try {
        cachedUri = await files.downloadUrl(url, input.source.headers, onPhase);
      } catch {
        return { status: 'error', message: TRANSCRIBE_FAILED_MESSAGE };
      }
      fileUri = cachedUri;
    }
    onPhase({ kind: 'transcribing' });
    let transcript: WhistleTranscript;
    try {
      transcript = await port.transcribe(fileUri, {
        ...(input.language === undefined ? {} : { language: input.language }),
        ...(input.audioMs === undefined ? {} : { audioMs: input.audioMs }),
      });
    } catch (error) {
      return { status: 'error', message: errorMessageOf(error) };
    }
    if (transcript.text.trim() === '') {
      return { status: 'error', message: TRANSCRIBE_EMPTY_MESSAGE };
    }
    return { status: 'done', transcript };
  } finally {
    if (cachedUri !== undefined) {
      const cached = cachedUri;
      try {
        const files = input.files ?? (await defaultFiles());
        await files.deleteCache(cached);
      } catch {
        // The cache must never block the result.
      }
    }
  }
}

import type { UploadSlot } from '@zilar/xmpp-core';
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

  static async start(mimeType?: string): Promise<VoiceRecorder> {
    if (!isVoiceRecordingSupported()) {
      throw new VoiceError('voice_unsupported', 'This browser cannot record audio');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      throw voiceErrorFromGetUserMedia(error);
    }
    const preferred = mimeType ?? pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        preferred === undefined ? undefined : { mimeType: preferred },
      );
    } catch {
      // Some browsers reject an explicit mime; let the browser choose.
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        // Never leave the microphone open (the browser's recording
        // indicator) when no recorder can be built.
        for (const track of stream.getTracks()) {
          track.stop();
        }
        throw new VoiceError('voice_unsupported', 'This browser cannot record audio');
      }
    }
    return new VoiceRecorder(recorder, stream);
  }

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
    this.#stopPromise = new Promise<RecordedVoice>((resolve) => {
      this.#recorder.onstop = () => {
        const type = this.#recorder.mimeType === '' ? 'audio/webm' : this.#recorder.mimeType;
        resolve({
          blob: new Blob(this.#chunks, { type }),
          mimeType: type,
          durationMs: this.durationMs,
        });
        this.#release();
      };
      this.#recorder.stop();
    });
    return this.#stopPromise;
  }

  cancel(): void {
    try {
      this.#recorder.onstop = null;
      this.#recorder.stop();
    } catch {
      // Stopping an already-stopped recorder is not an error here.
    }
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

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    if (typeof body.error?.code === 'string') {
      return body.error.code;
    }
  } catch {
    // A non-JSON error body falls through to a generic code.
  }
  return 'voice_failed';
}

/** Sends a recording to the server and gets back AAC/M4A plus its duration. */
export async function convertVoice(
  blob: Blob,
  fetchFn: typeof fetch = fetch,
): Promise<ConvertedVoice> {
  if (blob.size === 0) {
    throw new VoiceError('voice_empty', 'The recording is empty');
  }
  if (blob.size > VOICE_MAX_BYTES) {
    throw new VoiceError('voice_too_large', 'The recording is too long to send');
  }

  let response: Response;
  try {
    response = await fetchFn(`${API_BASE}/voice`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': blob.type === '' ? 'application/octet-stream' : blob.type },
      body: blob,
    });
  } catch {
    throw new VoiceError('network_error', 'Could not reach the server');
  }

  if (!response.ok) {
    throw new VoiceError(await errorCode(response), 'The server could not convert the recording');
  }

  const durationMs = Number(response.headers.get('x-zilar-duration-ms'));
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new VoiceError('invalid_response', 'The server sent no duration');
  }
  const audio = await response.blob();
  return { audio: new Blob([audio], { type: VOICE_MIME }), durationMs };
}

/** Anything that can hand out a XEP-0363 upload slot. */
export interface UploadSlotRequester {
  requestUploadSlot(request: {
    filename: string;
    size: number;
    contentType: string;
  }): Promise<UploadSlot>;
}

/** PUTs the converted bytes to the slot and returns the download URL. */
export async function uploadVoice(
  requester: UploadSlotRequester,
  audio: Blob,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const slot = await requester.requestUploadSlot({
    filename: VOICE_FILENAME,
    size: audio.size,
    contentType: VOICE_MIME,
  });

  let response: Response;
  try {
    response = await fetchFn(slot.putUrl, {
      method: 'PUT',
      headers: { 'content-type': VOICE_MIME, ...slot.headers },
      body: audio,
    });
  } catch {
    throw new VoiceError('upload_failed', 'Could not upload the recording');
  }
  if (!response.ok) {
    throw new VoiceError('upload_failed', 'The upload service refused the recording');
  }
  return slot.getUrl;
}

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
export async function computeWaveform(blob: Blob, buckets = WAVEFORM_BUCKETS): Promise<number[]> {
  const fallback = Array.from({ length: buckets }, () => 12);
  const AudioContextCtor = typeof AudioContext === 'undefined' ? undefined : AudioContext;
  if (AudioContextCtor === undefined) {
    return fallback;
  }

  let context: AudioContext | undefined;
  try {
    context = new AudioContextCtor();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
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
  } catch {
    return fallback;
  } finally {
    await context?.close().catch(() => {});
  }
}

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

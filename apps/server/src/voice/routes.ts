import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import { HttpError } from '../errors';
import { NotAudioError, createFfmpegEngine, type VoiceEngine } from './engine';

/** Hard cap on the uploaded recording, enforced while reading the body. */
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
/** Recordings shorter than a blink or longer than five minutes are rejected. */
export const VOICE_MAX_DURATION_MS = 5 * 60 * 1000;

export interface VoiceRoutesDependencies {
  auth: Auth;
  /** Defaults to the real ffmpeg engine; tests inject a fake. */
  engine?: VoiceEngine;
  maxBytes?: number;
}

/**
 * `POST /api/voice` takes a browser recording, converts it to AAC/M4A and
 * answers with the converted bytes plus the duration `ffprobe` measured. The
 * client then uploads those bytes through XEP-0363; the download url never
 * travels through this route.
 */
export function createVoiceRoutes({
  auth,
  engine = createFfmpegEngine(),
  maxBytes = VOICE_MAX_BYTES,
}: VoiceRoutesDependencies): Hono {
  const routes = new Hono();

  routes.post('/voice', async (c) => {
    await requireSession(auth, c.req.raw.headers);

    const declared = Number(c.req.header('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new HttpError(413, 'voice_too_large', 'The recording is too large');
    }

    const bytes = await readCapped(c.req.raw.body, maxBytes);
    if (bytes === undefined) {
      throw new HttpError(413, 'voice_too_large', 'The recording is too large');
    }
    if (bytes.byteLength === 0) {
      throw new HttpError(400, 'voice_empty', 'The recording is empty');
    }

    const dir = await mkdtemp(join(tmpdir(), 'zilar-voice-'));
    const inputPath = join(dir, 'input.bin');
    const outputPath = join(dir, 'output.m4a');

    try {
      await writeFile(inputPath, bytes);

      let inputDurationMs: number | undefined;
      try {
        const probed = await engine.probe(inputPath);
        inputDurationMs = probed.durationMs;
      } catch (error) {
        if (error instanceof NotAudioError) {
          throw new HttpError(415, 'voice_not_audio', 'The upload is not a supported recording');
        }
        throw error;
      }

      if (inputDurationMs !== undefined && inputDurationMs > VOICE_MAX_DURATION_MS) {
        throw new HttpError(422, 'voice_too_long', 'The recording is too long');
      }

      await engine.convert(inputPath, outputPath);

      // The converted file's duration is authoritative: the browser container
      // often has none (MediaRecorder WebM), and the client's claim is ignored.
      const convertedInfo = await engine.probe(outputPath);
      const durationMs = convertedInfo.durationMs;
      if (durationMs === undefined || durationMs > VOICE_MAX_DURATION_MS) {
        throw new HttpError(422, 'voice_too_long', 'The recording is too long');
      }

      const converted = await readFile(outputPath);

      return new Response(converted, {
        status: 200,
        headers: {
          'content-type': 'audio/mp4',
          'content-length': String(converted.byteLength),
          'cache-control': 'no-store',
          'x-zilar-duration-ms': String(durationMs),
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        // A leftover temp directory must never break the reply.
      });
    }
  });

  return routes;
}

// Reads the body chunk by chunk and stops as soon as the cap is passed, so a
// large upload never has to fit in memory.
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<Uint8Array | undefined> {
  if (body === null) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

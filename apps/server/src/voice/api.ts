// Voice conversion on the Effect `HttpApi` adapter (T-0573): the binary pilot.
// The same method, path, statuses, texts, headers and step order as the old
// Hono router (`routes.ts`), mounted under Hono by
// `apps/server/src/effect/http.ts`.
//
// This is the first module that moves a raw binary body. The endpoint declares
// no payload schema, so nothing is buffered or decoded before the handler: the
// handler reads `request.request.stream` chunk by chunk and stops as soon as
// the running total passes the cap (`readCapped`), exactly like the old
// `c.req.raw.body` reader. The reply is a raw `HttpServerResponse.uint8Array`;
// `HttpApiBuilder` returns a handler-returned `HttpServerResponse` untouched
// (`isHttpServerResponse`), so the bytes and the custom headers survive.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, Stream } from 'effect';
import { HttpServer, HttpServerResponse, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import {
  Session,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { NotAudioError, createFfmpegEngine } from './engine';
import { VOICE_MAX_BYTES, VOICE_MAX_DURATION_MS, type VoiceRoutesDependencies } from './routes';

export interface VoiceApiDependencies extends VoiceRoutesDependencies {
  logger: Logger;
}

const VoiceGroup = HttpApiGroup.make('voice')
  // No payload schema: the handler reads the raw body stream itself.
  .add(HttpApiEndpoint.post('convert', '/voice'))
  .middleware(Session)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const VoiceApi = HttpApi.make('voice').add(VoiceGroup);

export const VOICE_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'POST', path: '/api/voice' },
];

/**
 * `POST /api/voice` takes a browser recording, converts it to AAC/M4A and
 * answers with the converted bytes plus the duration `ffprobe` measured. The
 * client then uploads those bytes through XEP-0363; the download url never
 * travels through this route.
 */
export function createVoiceApi(deps: VoiceApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const engine = deps.engine ?? createFfmpegEngine();
  const maxBytes = deps.maxBytes ?? VOICE_MAX_BYTES;

  const groupLayer = HttpApiBuilder.group(VoiceApi, 'voice', (handlers) =>
    handlers.handle('convert', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          const declared = Number(request.request.headers['content-length'] ?? '');
          if (Number.isFinite(declared) && declared > maxBytes) {
            throw new HttpError(413, 'voice_too_large', 'The recording is too large');
          }

          const bytes = yield* readCapped(request.request.stream, maxBytes).pipe(Effect.orDie);
          if (bytes === undefined) {
            throw new HttpError(413, 'voice_too_large', 'The recording is too large');
          }
          if (bytes.byteLength === 0) {
            throw new HttpError(400, 'voice_empty', 'The recording is empty');
          }

          const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'zilar-voice-')));
          const inputPath = join(dir, 'input.bin');
          const outputPath = join(dir, 'output.m4a');

          return yield* Effect.gen(function* () {
            yield* Effect.promise(() => writeFile(inputPath, bytes));

            const inputDurationMs = yield* Effect.promise(async () => {
              try {
                return (await engine.probe(inputPath)).durationMs;
              } catch (error) {
                if (error instanceof NotAudioError) {
                  throw new HttpError(
                    415,
                    'voice_not_audio',
                    'The upload is not a supported recording',
                  );
                }
                throw error;
              }
            });

            if (inputDurationMs !== undefined && inputDurationMs > VOICE_MAX_DURATION_MS) {
              throw new HttpError(422, 'voice_too_long', 'The recording is too long');
            }

            yield* Effect.promise(() => engine.convert(inputPath, outputPath));

            // The converted file's duration is authoritative: the browser
            // container often has none (MediaRecorder WebM), and the client's
            // claim is ignored.
            const convertedInfo = yield* Effect.promise(() => engine.probe(outputPath));
            const durationMs = convertedInfo.durationMs;
            if (durationMs === undefined || durationMs > VOICE_MAX_DURATION_MS) {
              throw new HttpError(422, 'voice_too_long', 'The recording is too long');
            }

            const converted = yield* Effect.promise(() => readFile(outputPath));

            return HttpServerResponse.uint8Array(converted, {
              status: 200,
              headers: {
                'content-type': 'audio/mp4',
                'content-length': String(converted.byteLength),
                'cache-control': 'no-store',
                'x-zilar-duration-ms': String(durationMs),
              },
            });
          }).pipe(
            // The temp directory is removed on every exit path; a failed remove
            // is ignored and never breaks the reply.
            Effect.ensuring(
              Effect.promise(() => rm(dir, { recursive: true, force: true }).catch(() => {})),
            ),
          );
        }),
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(VoiceApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: VOICE_API_ROUTES };
}

// Reads the body stream chunk by chunk and stops as soon as the cap is passed,
// so a large upload never has to fit in memory. `undefined` means the cap was
// exceeded; the over-cap chunk itself is not collected.
function readCapped<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  cap: number,
): Effect.Effect<Uint8Array | undefined, E, R> {
  return Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let exceeded = false;
    yield* Stream.runForEachWhile(stream, (chunk) =>
      Effect.sync(() => {
        total += chunk.byteLength;
        if (total > cap) {
          exceeded = true;
          return false;
        }
        chunks.push(chunk);
        return true;
      }),
    );

    if (exceeded) {
      return undefined;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  });
}

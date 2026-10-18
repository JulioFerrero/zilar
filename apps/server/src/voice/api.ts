// The endpoint declares no payload schema, so nothing is buffered before the handler: it
// reads the body stream chunk by chunk and stops past the cap, and answers raw bytes.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import { readCapped } from '../http/read-capped';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import { NotAudioError, createFfmpegEngine, type VoiceEngine } from './engine';
import type { Auth } from '../auth/auth';

/** Hard cap on the uploaded recording, enforced while reading the body. */
const VOICE_MAX_BYTES = 10 * 1024 * 1024;
/** Recordings shorter than a blink or longer than five minutes are rejected. */
const VOICE_MAX_DURATION_MS = 5 * 60 * 1000;

interface VoiceRoutesDependencies {
  auth: Auth;
  engine?: VoiceEngine;
  maxBytes?: number;
}
export interface VoiceApiDependencies extends VoiceRoutesDependencies {
  logger: Logger;
}

const VoiceGroup = HttpApiGroup.make('voice')
  .add(HttpApiEndpoint.post('convert', '/voice'))
  .middleware(Session)
  .prefix('/api');

const VoiceApi = HttpApi.make('voice').add(VoiceGroup);

export function createVoiceApi(deps: VoiceApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const engine = deps.engine ?? createFfmpegEngine();
  const maxBytes = deps.maxBytes ?? VOICE_MAX_BYTES;

  const groupLayer = HttpApiBuilder.group(VoiceApi, 'voice', (handlers) =>
    handlers.handle(
      'convert',
      handler(logger, (request) =>
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

            // The converted file's duration is authoritative: MediaRecorder WebM often has
            // none, and the client's claim is ignored.
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
            // The temp directory is removed on every exit path; a failed remove never breaks
            // the reply.
            Effect.ensuring(
              Effect.promise(() => rm(dir, { recursive: true, force: true }).catch(() => {})),
            ),
          );
        }),
      ),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(VoiceApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  return mountApi(VoiceApi, apiLayer);
}

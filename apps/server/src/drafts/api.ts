import { Duration, Effect, Layer, Queue, Schema, Stream } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { pino, type Logger } from 'pino';
import type { Auth } from '../auth/auth';
import { Session, handler, mountApi, sessionLayer, type EffectApiMount } from '../effect/http-core';
import type { DraftHubEvent } from './events';
import { sharedDraftHub, type DraftHub } from './hub';

// A comment line this often keeps the connection (and any proxy buffer) alive between
// turns; event parsers ignore it.
export const DRAFT_SSE_HEARTBEAT_MS = 25_000;

// The stream ends after this long: the session is only checked when the request opens,
// so a revoked session would otherwise keep receiving drafts. Both clients reconnect,
// which re-runs the session check.
export const DRAFT_STREAM_MAX_MS = 10 * 60_000;

export interface DraftsApiDependencies {
  auth: Auth;
  hub?: DraftHub;
  logger?: Logger;
}

const DraftStreamSuccess = Schema.String;

const DraftsGroup = HttpApiGroup.make('drafts')
  .add(HttpApiEndpoint.get('stream', '/drafts/stream', { success: DraftStreamSuccess }))
  .middleware(Session)
  .prefix('/api');

const DraftsApi = HttpApi.make('drafts').add(DraftsGroup);

function encodeSseEvent(event: DraftHubEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function encodeHeartbeat(): string {
  return ': heartbeat\n\n';
}

export function createDraftsApi(deps: DraftsApiDependencies): EffectApiMount {
  const logger = deps.logger ?? defaultLogger();
  const hub = deps.hub ?? sharedDraftHub;

  const groupLayer = HttpApiBuilder.group(DraftsApi, 'drafts', (handlers) =>
    handlers.handle(
      'stream',
      handler(logger, (_request, user) =>
        Effect.sync(() => {
          const frames = Stream.unwrap(
            Effect.acquireRelease(
              Effect.gen(function* () {
                const queue = yield* Queue.unbounded<DraftHubEvent>();
                const unsubscribe = hub.subscribe(user.id, (event) => {
                  Queue.offerUnsafe(queue, event);
                });
                return { queue, unsubscribe };
              }),
              ({ unsubscribe }) => Effect.sync(unsubscribe),
            ).pipe(
              Effect.map(({ queue }) =>
                Stream.fromEffectRepeat(
                  // The timeout reads full with `Duration`, so vitest's fake timers keep
                  // controlling the heartbeat test.
                  Queue.take(queue).pipe(
                    Effect.timeoutOption(Duration.millis(DRAFT_SSE_HEARTBEAT_MS)),
                    Effect.map((event) =>
                      event._tag === 'Some' ? encodeSseEvent(event.value) : encodeHeartbeat(),
                    ),
                  ),
                ),
              ),
            ),
          );
          return HttpServerResponse.stream(
            frames.pipe(
              // End the response after the cap; the client reconnects and re-auths.
              Stream.interruptWhen(Effect.sleep(Duration.millis(DRAFT_STREAM_MAX_MS))),
              Stream.encodeText,
            ),
            {
              headers: {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
                'transfer-encoding': 'chunked',
                'x-accel-buffering': 'no',
              },
            },
          );
        }),
      ),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(DraftsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  return mountApi(DraftsApi, apiLayer);
}

let silentLogger: Logger | undefined;

function defaultLogger(): Logger {
  silentLogger ??= pino({ level: 'silent' });
  return silentLogger;
}

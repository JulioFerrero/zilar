// Draft stream on the Effect `HttpApi` adapter (T-0581): the SSE pilot.
// The same method, path, statuses, headers and bytes as the old Hono router
// (`routes.ts`), mounted under Hono by `apps/server/src/effect/http.ts`.
//
// The response is an endless `Stream` of SSE text frames: hub events offered
// into an unbounded `Queue` are drained one at a time, each followed by an
// idle wait of `DRAFT_SSE_HEARTBEAT_MS` that answers a `: heartbeat` comment
// when no event arrived. The subscribe runs in an `acquireRelease` scope, so
// interruption — the client disconnecting and the web runtime cancelling the
// body — always runs the unsubscribe. No decode schemas: the endpoint
// declares no payload and the handler returns a raw `HttpServerResponse`.

import { Duration, Effect, Layer, Queue, Schema, Stream } from 'effect';
import { HttpServer, HttpServerResponse, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { pino, type Logger } from 'pino';
import type { Auth } from '../auth/auth';
import {
  CurrentUser,
  Session,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import type { DraftHubEvent } from './events';
import { sharedDraftHub, type DraftHub } from './hub';

// A comment line this often keeps the connection (and any proxy buffer)
// alive between turns. Carried as an SSE comment, so event parsers ignore it.
export const DRAFT_SSE_HEARTBEAT_MS = 25_000;

export interface DraftsApiDependencies {
  auth: Auth;
  hub?: DraftHub;
  logger?: Logger;
}

const DraftStreamSuccess = Schema.String;

const DraftsGroup = HttpApiGroup.make('drafts')
  // No payload schema: the handler streams raw SSE text frames itself.
  .add(HttpApiEndpoint.get('stream', '/drafts/stream', { success: DraftStreamSuccess }))
  .middleware(Session)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const DraftsApi = HttpApi.make('drafts').add(DraftsGroup);

export const DRAFTS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/drafts/stream' },
];

// `writeSSE({ event, data })` from Hono's `streamSSE` splits `data` on
// newlines into one `data: <line>` frame per line, then writes
// `event: <event>\ndata: <json>\n\n`. `JSON.stringify` of the hub event never
// contains a newline, so each event is exactly one `event:` line, one
// `data:` line and a blank line.
function encodeSseEvent(event: DraftHubEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// The idle marker the old route wrote with `stream.write(': heartbeat\n\n')`:
// a comment line event parsers ignore.
function encodeHeartbeat(): string {
  return ': heartbeat\n\n';
}

/**
 * `GET /api/drafts/stream`: the caller's own AI drafts as `event: draft` /
 * `event: end` SSE frames with JSON `data:`, plus a `: heartbeat` comment
 * every `DRAFT_SSE_HEARTBEAT_MS` of idleness. The stream never ends on its
 * own; interrupting it (client disconnect) unsubscribes from the hub.
 */
export function createDraftsApi(deps: DraftsApiDependencies): EffectApiMount {
  const logger = deps.logger ?? defaultLogger();
  const hub = deps.hub ?? sharedDraftHub;

  const groupLayer = HttpApiBuilder.group(DraftsApi, 'drafts', (handlers) =>
    handlers.handle('stream', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          const user = yield* CurrentUser;
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
                  // One frame cycle: wait for the next event, timing out at
                  // the heartbeat interval, then encode what arrived. The
                  // timeout reads full with `Duration`, so vitest's fake
                  // timers keep controlling the heartbeat test.
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
          return HttpServerResponse.stream(frames.pipe(Stream.encodeText), {
            headers: {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
              'transfer-encoding': 'chunked',
              'x-accel-buffering': 'no',
            },
          });
        }),
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(DraftsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: DRAFTS_API_ROUTES };
}

let silentLogger: Logger | undefined;

// A caller that builds the API without a logger (the tests) gets this silent
// one: only the shared envelope could log (an unhandled failure), and the old
// route had no log line of its own, so a silent one keeps the bytes identical.
function defaultLogger(): Logger {
  silentLogger ??= pino({ level: 'silent' });
  return silentLogger;
}

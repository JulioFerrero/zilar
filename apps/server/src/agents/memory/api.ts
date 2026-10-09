// The AI-memory routes on the Effect `HttpApi` adapter (T-0533): the same
// methods, paths, limiter order, status codes and bodies as the deleted
// router (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// A DM is visible to and changeable by the AI's owner only; a room is visible
// to everyone who can see it and changeable by the AI's owner and the topic
// managers. Text is never logged.

import { Effect, Layer, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../../auth/auth';
import type { ServerConfig } from '../../config';
import type { ServerDatabase } from '../../db/client';
import { sqlRuntimeFor } from '../../effect/sql';
import { HttpError } from '../../errors';
import { createRateLimiter, type RateLimiter } from '../../rate-limit';
import { resolvePinChat } from '../../pins/access';
import { canManageTopic } from '../../topics/access';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import {
  CurrentUser,
  Session,
  failureResponse,
  httpErrorResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../../effect/http-core';
import { clearMemory, deleteFact, listFacts, renderMemoryBlock } from './store';

export const AI_MEMORY_WRITE_RATE_LIMIT_MAX = 60;
export const AI_MEMORY_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface AiMemoryApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  logger: Logger;
}

export interface ResolvedMemoryChat {
  aiId: string;
  chatKey: string;
  canChange: boolean;
}

function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

interface AiOwnerLookupRow {
  id: string;
  owner: string;
  jid: string;
}

// The same 404 as for an unknown chat or an unknown AI, so neither can be
// probed.
function toMissingMemoryChat(): HttpError {
  return new HttpError(404, 'not_found', 'Chat not found');
}

function toForbiddenChange(): HttpError {
  return new HttpError(
    403,
    'forbidden',
    'Only the AI owner or a room admin can change this memory',
  );
}

// Resolves the `chat` and `ai` parameters to the stored `chat_key`, the AI id
// and whether the caller may change the memory. An unknown AI, a chat the
// caller may not see, a DM the caller does not own, or any other host all
// answer the same 404.
export async function resolveMemoryChat(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
  chat: string,
  aiId: string,
): Promise<ResolvedMemoryChat> {
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiOwnerLookupRow>`SELECT id, owner, jid FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    throw toMissingMemoryChat();
  }

  const domain = config.xmpp.domain.toLowerCase();
  const mucDomain = config.xmpp.mucDomain.toLowerCase();
  const bare = (chat.split('/')[0] ?? '').toLowerCase();
  const at = bare.indexOf('@');
  const host = at <= 0 ? '' : bare.slice(at + 1);

  if (host === domain) {
    if (ai.owner !== userId || bare !== ai.jid.toLowerCase()) {
      throw toMissingMemoryChat();
    }
    return {
      aiId: ai.id,
      chatKey: `dm:${jidFor(localpartFor(userId), config.xmpp.domain).toLowerCase()}`,
      canChange: true,
    };
  }

  if (host === mucDomain) {
    const resolved = await resolvePinChat(db, {
      chatJid: chat,
      userId,
      domain: config.xmpp.domain,
      mucDomain: config.xmpp.mucDomain,
    });
    if (resolved.kind !== 'room') {
      throw toMissingMemoryChat();
    }
    const canChange = ai.owner === userId || (await canManageTopic(db, resolved.topic, userId));
    return { aiId: ai.id, chatKey: `room:${resolved.chatJid}`, canChange };
  }

  throw toMissingMemoryChat();
}

// The query and body replace `memoryQuerySchema` and `clearBodySchema` (zod).
// 1..256 characters; the payload/query decode is strict (`onExcessProperty`
// below) so an excess key fails like the old `.strict()`.
const chatField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const MemoryQuery = Schema.Struct({ chat: chatField, ai: chatField });
const ClearBody = Schema.Struct({ chat: chatField, ai: chatField });

const MemoryFact = Schema.Struct({ id: Schema.String, text: Schema.String });
const MemoryView = Schema.Struct({
  facts: Schema.Array(MemoryFact),
  lines: Schema.Array(Schema.String),
  canChange: Schema.Boolean,
});
const OkResult = Schema.Struct({ ok: Schema.Boolean });

// The write budget runs before the query or body is decoded, exactly like the
// old routes' `requireWriteBudget` -> `safeParse` order: an invalid request
// still spends budget. `requires: CurrentUser` is satisfied by `Session`.
class AiMemoryWriteRateLimit extends HttpApiMiddleware.Service<
  AiMemoryWriteRateLimit,
  { requires: CurrentUser }
>()('zilar/effect/http/AiMemoryWriteRateLimit') {}

function writeRateLimitLayer(limiter: RateLimiter): Layer.Layer<AiMemoryWriteRateLimit> {
  return Layer.succeed(
    AiMemoryWriteRateLimit,
    AiMemoryWriteRateLimit.of(
      Effect.fnUntraced(function* (httpEffect) {
        const user = yield* CurrentUser;
        if (!limiter.allow(user.id)) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(429, 'rate_limited', 'Too many memory changes, try again later'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

// Turns a query or payload decode failure into the module's old 400
// `invalid_request` answer.
class AiMemorySchemaErrors extends HttpApiMiddleware.Service<AiMemorySchemaErrors>()(
  'zilar/effect/http/AiMemorySchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<AiMemorySchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(AiMemorySchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

const AiMemoryGroup = HttpApiGroup.make('aiMemory')
  .add(
    HttpApiEndpoint.get('view', '/ai-memory', {
      query: MemoryQuery,
      success: MemoryView,
    }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('deleteFact', '/ai-memory/facts/:id', {
      params: { id: Schema.String },
      query: MemoryQuery,
      success: OkResult,
    })
      .annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' })
      .middleware(AiMemoryWriteRateLimit),
    HttpApiEndpoint.post('clear', '/ai-memory/clear', {
      payload: ClearBody,
      success: OkResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(AiMemoryWriteRateLimit),
  )
  .middleware(Session)
  .middleware(AiMemorySchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const AiMemoryApi = HttpApi.make('aiMemory').add(AiMemoryGroup);

export const AI_MEMORY_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/ai-memory' },
  { method: 'DELETE', path: '/api/ai-memory/facts/:id' },
  { method: 'POST', path: '/api/ai-memory/clear' },
];

export function createAiMemoryApi(deps: AiMemoryApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = createRateLimiter({
    max: AI_MEMORY_WRITE_RATE_LIMIT_MAX,
    windowMs: AI_MEMORY_WRITE_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const groupLayer = HttpApiBuilder.group(AiMemoryApi, 'aiMemory', (handlers) =>
    handlers
      // The facts and cover lines of one chat; everyone who can see the chat
      // may read them.
      .handle('view', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const resolved = yield* Effect.promise(() =>
              resolveMemoryChat(
                deps.db,
                deps.config,
                user.id,
                request.query.chat,
                request.query.ai,
              ),
            );
            const [facts, lines] = yield* Effect.promise(() =>
              Promise.all([
                listFacts(deps.db, resolved.aiId, resolved.chatKey),
                renderMemoryBlock(deps.db, resolved.aiId, resolved.chatKey),
              ]),
            );
            return { facts, lines, canChange: resolved.canChange };
          }),
          logger,
          requestId,
        );
      })
      // Deletes one fact; only the AI owner or a room manager may.
      .handle('deleteFact', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const resolved = yield* Effect.promise(() =>
              resolveMemoryChat(
                deps.db,
                deps.config,
                user.id,
                request.query.chat,
                request.query.ai,
              ),
            );
            if (!resolved.canChange) {
              throw toForbiddenChange();
            }
            const removed = yield* Effect.promise(() =>
              deleteFact(deps.db, resolved.aiId, resolved.chatKey, request.params.id),
            );
            if (!removed) {
              throw new HttpError(404, 'not_found', 'Fact not found');
            }
            return { ok: true };
          }),
          logger,
          requestId,
        );
      })
      // Clears the memory; only the AI owner or a room manager may.
      .handle('clear', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const resolved = yield* Effect.promise(() =>
              resolveMemoryChat(
                deps.db,
                deps.config,
                user.id,
                request.payload.chat,
                request.payload.ai,
              ),
            );
            if (!resolved.canChange) {
              throw toForbiddenChange();
            }
            yield* Effect.promise(() => clearMemory(deps.db, resolved.aiId, resolved.chatKey));
            return { ok: true };
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(AiMemoryApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(writeRateLimitLayer(writeLimiter)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: AI_MEMORY_API_ROUTES };
}

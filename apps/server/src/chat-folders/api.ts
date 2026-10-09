// Chat folders on the Effect `HttpApi` adapter (T-0520): the same methods,
// paths, limiter order and answers as the deleted Hono router (`routes.ts`),
// mounted under Hono by `apps/server/src/effect/http.ts`. Handlers keep calling
// the drizzle service; the DB rewrite is a separate lane.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
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
} from '../effect/http-core';
import {
  createChatFolder,
  deleteChatFolder,
  FOLDER_CHAT_TYPES,
  FOLDER_CHATS_MAX,
  FOLDER_ICONS,
  FOLDER_NAME_MAX,
  listChatFolders,
  reorderChatFolders,
  updateChatFolder,
} from './service';

export const CHAT_FOLDERS_WRITE_RATE_LIMIT_MAX = 60;
export const CHAT_FOLDERS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const FolderIcon = Schema.Literals(FOLDER_ICONS);
const FolderChatTypeSchema = Schema.Literals(FOLDER_CHAT_TYPES);

const includeTypesSchema = Schema.Array(FolderChatTypeSchema).check(
  Schema.makeFilter((types) =>
    new Set(types).size === types.length ? undefined : 'includeTypes must not contain duplicates',
  ),
);

const jidListSchema = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
)
  .check(Schema.isMaxLength(FOLDER_CHATS_MAX))
  .check(
    Schema.makeFilter((jids) =>
      new Set(jids).size === jids.length ? undefined : 'Chat lists must not contain duplicates',
    ),
  );

// `name` is trimmed before the length check, like zod's `.trim().min(1).max()`.
const folderNameSchema = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(FOLDER_NAME_MAX),
);

const CreateFolderBody = Schema.Struct({
  name: folderNameSchema,
  icon: FolderIcon,
  includeTypes: includeTypesSchema.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  includeChats: jidListSchema.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  excludeChats: jidListSchema.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  excludeMuted: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  excludeRead: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});

const PatchFolderBody = Schema.Struct({
  name: Schema.optional(folderNameSchema),
  icon: Schema.optional(FolderIcon),
  includeTypes: Schema.optional(includeTypesSchema),
  includeChats: Schema.optional(jidListSchema),
  excludeChats: Schema.optional(jidListSchema),
  excludeMuted: Schema.optional(Schema.Boolean),
  excludeRead: Schema.optional(Schema.Boolean),
}).check(
  Schema.makeFilter((value) => (Object.keys(value).length > 0 ? undefined : 'Nothing to update')),
);

const OrderFoldersBody = Schema.Struct({
  ids: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
});

const FolderView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: FolderIcon,
  position: Schema.Number,
  includeTypes: Schema.Array(FolderChatTypeSchema),
  includeChats: Schema.Array(Schema.String),
  excludeChats: Schema.Array(Schema.String),
  excludeMuted: Schema.Boolean,
  excludeRead: Schema.Boolean,
});

const FolderListResult = Schema.Struct({ folders: Schema.Array(FolderView) });
const FolderResult = Schema.Struct({ folder: FolderView });
const DeleteResult = Schema.Struct({ deleted: Schema.Boolean });

// Applied to the group so a payload decode failure renders like the old zod
// path: a 400 `invalid_request` carrying the first schema message.
class ChatFoldersSchemaErrors extends HttpApiMiddleware.Service<ChatFoldersSchemaErrors>()(
  'zilar/effect/http/ChatFoldersSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<ChatFoldersSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ChatFoldersSchemaErrors, (error) =>
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

const ChatFoldersGroup = HttpApiGroup.make('chatFolders')
  .add(
    HttpApiEndpoint.get('list', '/chat-folders', {
      success: FolderListResult,
    }),
    HttpApiEndpoint.post('create', '/chat-folders', {
      payload: CreateFolderBody,
      success: FolderResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.put('order', '/chat-folders/order', {
      payload: OrderFoldersBody,
      success: FolderListResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.patch('update', '/chat-folders/:id', {
      params: { id: Schema.String },
      payload: PatchFolderBody,
      success: FolderResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('remove', '/chat-folders/:id', {
      params: { id: Schema.String },
      success: DeleteResult,
    }),
  )
  .middleware(Session)
  .middleware(ChatFoldersSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const ChatFoldersApi = HttpApi.make('chatFolders').add(ChatFoldersGroup);

export interface ChatFoldersApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  logger: Logger;
}

export const CHAT_FOLDERS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/chat-folders' },
  { method: 'POST', path: '/api/chat-folders' },
  { method: 'PUT', path: '/api/chat-folders/order' },
  { method: 'PATCH', path: '/api/chat-folders/:id' },
  { method: 'DELETE', path: '/api/chat-folders/:id' },
];

export function createChatFoldersApi(deps: ChatFoldersApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = createRateLimiter({
    max: CHAT_FOLDERS_WRITE_RATE_LIMIT_MAX,
    windowMs: CHAT_FOLDERS_WRITE_RATE_LIMIT_WINDOW_MS,
    now,
  });

  function checkWriteLimit(userId: string, requestId: string) {
    if (writeLimiter.allow(userId)) {
      return undefined;
    }
    return httpErrorResponse(
      requestId,
      new HttpError(429, 'rate_limited', 'Too many folder changes, try again later'),
    );
  }

  const groupLayer = HttpApiBuilder.group(ChatFoldersApi, 'chatFolders', (handlers) =>
    handlers
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return {
              folders: yield* Effect.promise(() =>
                listChatFolders(deps.db, user.id, new Date(now())),
              ),
            };
          }),
          logger,
          requestId,
        );
      })
      .handle('create', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const limited = checkWriteLimit(user.id, requestId);
            if (limited !== undefined) {
              return limited;
            }
            const folder = yield* Effect.promise(() =>
              createChatFolder(deps.db, {
                userId: user.id,
                name: request.payload.name,
                icon: request.payload.icon,
                includeTypes: [...request.payload.includeTypes],
                includeChats: [...request.payload.includeChats],
                excludeChats: [...request.payload.excludeChats],
                excludeMuted: request.payload.excludeMuted,
                excludeRead: request.payload.excludeRead,
                now: new Date(now()),
              }),
            );
            return HttpServerResponse.jsonUnsafe({ folder }, { status: 201 });
          }),
          logger,
          requestId,
        );
      })
      .handle('order', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const limited = checkWriteLimit(user.id, requestId);
            if (limited !== undefined) {
              return limited;
            }
            const folders = yield* Effect.promise(() =>
              reorderChatFolders(deps.db, {
                userId: user.id,
                ids: [...request.payload.ids],
                now: new Date(now()),
              }),
            );
            return { folders };
          }),
          logger,
          requestId,
        );
      })
      .handle('update', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const limited = checkWriteLimit(user.id, requestId);
            if (limited !== undefined) {
              return limited;
            }
            const folder = yield* Effect.promise(() =>
              updateChatFolder(deps.db, {
                userId: user.id,
                id: request.params.id,
                ...(request.payload.name !== undefined ? { name: request.payload.name } : {}),
                ...(request.payload.icon !== undefined ? { icon: request.payload.icon } : {}),
                ...(request.payload.includeTypes !== undefined
                  ? { includeTypes: [...request.payload.includeTypes] }
                  : {}),
                ...(request.payload.includeChats !== undefined
                  ? { includeChats: [...request.payload.includeChats] }
                  : {}),
                ...(request.payload.excludeChats !== undefined
                  ? { excludeChats: [...request.payload.excludeChats] }
                  : {}),
                ...(request.payload.excludeMuted !== undefined
                  ? { excludeMuted: request.payload.excludeMuted }
                  : {}),
                ...(request.payload.excludeRead !== undefined
                  ? { excludeRead: request.payload.excludeRead }
                  : {}),
                now: new Date(now()),
              }),
            );
            return { folder };
          }),
          logger,
          requestId,
        );
      })
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const limited = checkWriteLimit(user.id, requestId);
            if (limited !== undefined) {
              return limited;
            }
            yield* Effect.promise(() =>
              deleteChatFolder(deps.db, { userId: user.id, id: request.params.id }),
            );
            return { deleted: true };
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(ChatFoldersApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: CHAT_FOLDERS_API_ROUTES };
}

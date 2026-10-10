// Chat folders on the Effect `HttpApi` adapter (T-0520): the same methods,
// paths, limiter order and answers as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). Its service
// runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  SchemaErrors,
  Session,
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
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

const ChatFoldersGroup = HttpApiGroup.make('chatFolders')
  .add(
    HttpApiEndpoint.get('list', '/chat-folders', {
      success: FolderListResult,
    }),
    HttpApiEndpoint.post('create', '/chat-folders', {
      payload: CreateFolderBody,
      success: FolderResult.pipe(HttpApiSchema.status(201)),
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
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
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
      .handle(
        'list',
        handler(logger, async (_request, user) => ({
          folders: await listChatFolders(deps.db, user.id, new Date(now())),
        })),
      )
      .handle(
        'create',
        handler(logger, async (request, user) => {
          const limited = checkWriteLimit(user.id, requestIdOf(request.request));
          if (limited !== undefined) {
            return limited;
          }
          const folder = await createChatFolder(deps.db, {
            userId: user.id,
            name: request.payload.name,
            icon: request.payload.icon,
            includeTypes: [...request.payload.includeTypes],
            includeChats: [...request.payload.includeChats],
            excludeChats: [...request.payload.excludeChats],
            excludeMuted: request.payload.excludeMuted,
            excludeRead: request.payload.excludeRead,
            now: new Date(now()),
          });
          return { folder };
        }),
      )
      .handle(
        'order',
        handler(logger, async (request, user) => {
          const limited = checkWriteLimit(user.id, requestIdOf(request.request));
          if (limited !== undefined) {
            return limited;
          }
          const folders = await reorderChatFolders(deps.db, {
            userId: user.id,
            ids: [...request.payload.ids],
            now: new Date(now()),
          });
          return { folders };
        }),
      )
      .handle(
        'update',
        handler(logger, async (request, user) => {
          const limited = checkWriteLimit(user.id, requestIdOf(request.request));
          if (limited !== undefined) {
            return limited;
          }
          const folder = await updateChatFolder(deps.db, {
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
          });
          return { folder };
        }),
      )
      .handle(
        'remove',
        handler(logger, async (request, user) => {
          const limited = checkWriteLimit(user.id, requestIdOf(request.request));
          if (limited !== undefined) {
            return limited;
          }
          await deleteChatFolder(deps.db, { userId: user.id, id: request.params.id });
          return { deleted: true };
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ChatFoldersApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ChatFoldersApi, apiLayer);
}

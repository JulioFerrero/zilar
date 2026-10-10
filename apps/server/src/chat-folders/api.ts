// Chat folders on the Effect `HttpApi` adapter (T-0520): the same methods,
// paths, limiter order and answers as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). Its service
// runs on effect/sql.
//
// The schemas and the group live in the shared contract (`@zilar/api-contract`,
// T-0892); this file keeps the handlers and layers.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import { ChatFoldersGroup } from '@zilar/api-contract';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { chainASchemaErrorLayer } from '../groups/schema-errors';
import {
  createChatFolder,
  deleteChatFolder,
  listChatFolders,
  reorderChatFolders,
  updateChatFolder,
} from './service';

export const CHAT_FOLDERS_WRITE_RATE_LIMIT_MAX = 60;
export const CHAT_FOLDERS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

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
            includeTypes: [...(request.payload.includeTypes ?? [])],
            includeChats: [...(request.payload.includeChats ?? [])],
            excludeChats: [...(request.payload.excludeChats ?? [])],
            excludeMuted: request.payload.excludeMuted ?? false,
            excludeRead: request.payload.excludeRead ?? false,
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
          return { deleted: true as const };
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ChatFoldersApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(chainASchemaErrorLayer(logger)),
  );

  return mountApi(ChatFoldersApi, apiLayer);
}

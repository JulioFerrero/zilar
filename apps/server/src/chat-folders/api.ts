import type { ServerCore } from '../app/deps';

import { HttpApi, HttpApiBuilder } from 'effect/http-api';

import { ChatFoldersGroup } from '@zilar/api-contract';

import { HttpError } from '../errors';
import { limiter } from '../rate-limit';
import {
  mountGroups,
  handler,
  httpErrorResponse,
  requestIdOf,
  type EffectApiMount,
} from '../effect/http-core';
import {
  createChatFolder,
  deleteChatFolder,
  listChatFolders,
  reorderChatFolders,
  updateChatFolder,
} from './service';

const ChatFoldersApi = HttpApi.make('chatFolders').add(ChatFoldersGroup);

export interface ChatFoldersApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'logger'
> {
  now?: () => number;
}

export function createChatFoldersApi(deps: ChatFoldersApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = limiter('chatFoldersWrite', now);

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

  return mountGroups(ChatFoldersApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: true,
  });
}

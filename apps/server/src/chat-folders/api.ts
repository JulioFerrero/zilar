import type { ServerCore } from '../app/deps';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { ChatFoldersGroup } from '@zilar/api-contract';
import { handler, mountGroups, withLimit, type EffectApiMount } from '../effect/http-core';
import { limiter } from '../rate-limit';
import {
  createChatFolder,
  deleteChatFolder,
  listChatFolders,
  reorderChatFolders,
  updateChatFolder,
} from './service';
const ChatFoldersApi = HttpApi.make('chatFolders').add(ChatFoldersGroup);
export type ChatFoldersApiDependencies = Pick<ServerCore, 'auth' | 'db' | 'config' | 'logger'> & {
  now?: () => number;
};
export function createChatFoldersApi(deps: ChatFoldersApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const limited = withLimit(
    logger,
    limiter('chatFoldersWrite', now),
    'Too many folder changes, try again later',
  );
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
        limited(async (request, user) => ({
          folder: await createChatFolder(deps.db, {
            userId: user.id,
            ...request.payload,
            now: new Date(now()),
          }),
        })),
      )
      .handle(
        'order',
        limited(async (request, user) => ({
          folders: await reorderChatFolders(deps.db, {
            userId: user.id,
            ids: [...request.payload.ids],
            now: new Date(now()),
          }),
        })),
      )
      .handle(
        'update',
        limited(async (request, user) => ({
          folder: await updateChatFolder(deps.db, {
            userId: user.id,
            id: request.params.id,
            ...request.payload,
            now: new Date(now()),
          }),
        })),
      )
      .handle(
        'remove',
        limited(async (request, user) => {
          await deleteChatFolder(deps.db, { userId: user.id, id: request.params.id });
          return { deleted: true as const };
        }),
      ),
  );
  return mountGroups(ChatFoldersApi, groupLayer, { auth: deps.auth, logger, schemaErrors: true });
}

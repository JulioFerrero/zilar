import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { ChatsGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { type ArchivePool } from '../search/service';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { createRateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { deleteOwnHandlers } from './delete-own';
import { listChatsFor } from './list-handler';
import { markDeliveredFor, markReadFor } from './mark-handlers';
import { replyFor } from './reply-handler';

export const CHAT_READ_RATE_LIMIT_MAX = 600;
export const CHAT_READ_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export type { ChatListEntry, ChatUnreadFields } from './list-handler';

export interface ChatsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  // Undefined = the list keeps its shape (no unread, no previews).
  archive: ArchivePool | undefined;
  // Optional: with no client the delivered notice is skipped.
  adminClient?: EjabberdAdminClient;
  // The live gateway's turn read model for each topic's AI activity.
  getGateway?: () => TurnWatcher | null;
  now?: () => number;
}

// The contract's schema passes each entry through unchanged, so the wire shape is exactly what the route returned.
const ChatsApi = HttpApi.make('chats').add(ChatsGroup);

export function createChatsApi(deps: ChatsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const readLimiter = createRateLimiter({
    max: CHAT_READ_RATE_LIMIT_MAX,
    windowMs: CHAT_READ_RATE_LIMIT_WINDOW_MS,
    now,
  });
  // The notification reply has its own budget, checked before the claim.
  const replyLimiter = createRateLimiter({ max: 60, windowMs: 10 * 60 * 1000, now });
  // Both DM delete handlers are built in `delete-own.ts`.
  const deleteOwn = deleteOwnHandlers(deps);

  const groupLayer = HttpApiBuilder.group(ChatsApi, 'chats', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) => listChatsFor(deps, user)),
      )
      // Access is checked before the write budget, so a probe of an invisible chat costs nothing and answers the same 404.
      .handle(
        'markRead',
        handler(logger, (request, user) => markReadFor(deps, readLimiter, request, user)),
      )
      // Access is checked before the write budget, like the read mark.
      .handle(
        'markDelivered',
        handler(logger, (request, user) => markDeliveredFor(deps, readLimiter, request, user)),
      )
      // The caller's own copy of a DM.
      .handle('clearHistory', deleteOwn.clearHistory)
      .handle('deleteForMe', deleteOwn.deleteForMe)
      // A reply from a phone notification, sent as the caller.
      .handle(
        'reply',
        handler(logger, (request, user) => replyFor(deps, replyLimiter, request, user)),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ChatsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ChatsApi, apiLayer);
}

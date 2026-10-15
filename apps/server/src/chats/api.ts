// The chats list on the Effect `HttpApi` adapter (T-0533): the same method,
// path and answer as the deleted router (`routes.ts`), mounted by the Effect
// edge (`apps/server/src/effect/edge.ts`). Its services run on effect/sql.
// T-1543: the `'list'` body lives in `list-handler.ts` and the two mark bodies
// in `mark-handlers.ts`, so this file keeps the wiring and the exports.

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

export const CHAT_READ_RATE_LIMIT_MAX = 600;
export const CHAT_READ_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export type { ChatListEntry, ChatUnreadFields } from './list-handler';

export interface ChatsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  // T-1198: the read-only pool on the ejabberd MAM archive. Required but
  // nullable, so `app.ts` passes it straight through with no new lines;
  // undefined = the list keeps its old shape (no unread, no previews).
  archive: ArchivePool | undefined;
  // T-1245: the ejabberd admin client the live delivered notice sends through.
  // Optional: with no client the notice is skipped and nothing else changes.
  adminClient?: EjabberdAdminClient;
  /** T-1514: the live gateway's turn read model for each topic's AI activity. */
  getGateway?: () => TurnWatcher | null;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

// The chat list is a discriminated union already typed by `ChatListEntry`; the
// contract's schema (`@zilar/api-contract`, T-0894) passes each entry through
// unchanged, so the wire shape stays exactly what the old route returned.
const ChatsApi = HttpApi.make('chats').add(ChatsGroup);

export function createChatsApi(deps: ChatsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const readLimiter = createRateLimiter({
    max: CHAT_READ_RATE_LIMIT_MAX,
    windowMs: CHAT_READ_RATE_LIMIT_WINDOW_MS,
    now,
  });
  // T-1236: both DM delete handlers (their own limiter + audit recorder live in
  // `delete-own.ts`), built here so `api.ts` stays inside its 400-line bar.
  const deleteOwn = deleteOwnHandlers(deps);

  const groupLayer = HttpApiBuilder.group(ChatsApi, 'chats', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, (_request, user) => listChatsFor(deps, user)),
      )
      // The caller's read mark for one chat. Access is checked before the
      // write budget is charged, so a probe of an invisible chat costs
      // nothing and answers the same 404 as an unknown chat.
      .handle(
        'markRead',
        handler(logger, (request, user) => markReadFor(deps, readLimiter, request, user)),
      )
      // The receiving device's delivery confirmation. Access is checked
      // before the write budget is charged, like the read mark, so a probe
      // of an invisible chat costs nothing and answers the same 404 as an
      // unknown chat.
      .handle(
        'markDelivered',
        handler(logger, (request, user) => markDeliveredFor(deps, readLimiter, request, user)),
      )
      // T-1236: the caller's own copy of a DM, both bodies in `delete-own.ts`.
      .handle('clearHistory', deleteOwn.clearHistory)
      .handle('deleteForMe', deleteOwn.deleteForMe),
  );

  const apiLayer = HttpApiBuilder.layer(ChatsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ChatsApi, apiLayer);
}

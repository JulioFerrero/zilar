import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { ChatsGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config/load';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { ServerDatabase } from '../db/client';
import type { ArchivePool } from '../search/service';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
  httpErrorResponse,
  requestIdOf,
  type SessionUser,
} from '../effect/http-core';
import { limiter, type RateLimiter } from '../rate-limit';
import { deleteOwnHandlers } from './delete-own';
import { listChatsFor } from './list-handler';
import { replyFor, kindFor } from './reply-handler';
import { buildDisplayed } from '@zilar/xmpp-core';
import type { HttpServerRequest } from 'effect/http';
import { HttpError } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { markDeliveredAndNotify } from './delivered-notice';
import { chatAccessFromParam, putChatRead } from './reads';

// effect-plain: mark handler bodies, access and limits only
// `api.ts` wraps these with `handler` and the limiter, so access is checked before the write budget.

interface MarkReadRequest {
  params: { jid: string };
  payload: { messageId: string; displayed?: string | undefined };
  request: HttpServerRequest.HttpServerRequest;
}

interface MarkDeliveredRequest {
  params: { jid: string };
  payload: { originIds: readonly string[] };
  request: HttpServerRequest.HttpServerRequest;
}

// Access is checked before the write budget, so a probe costs nothing and answers the same 404.
async function markReadFor(
  deps: ChatsApiDependencies,
  limiter: RateLimiter,
  request: MarkReadRequest,
  user: SessionUser,
) {
  const { bare } = await chatAccessFromParam(deps, request.params.jid, user.id);
  if (!limiter.allow(user.id)) {
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(429, 'rate_limited', 'Too many read updates, try again later'),
    );
  }
  await putChatRead(deps.db, {
    bare,
    userId: user.id,
    messageId: request.payload.messageId,
  });

  // Sends the same XEP-0333 marker an in-app read does; best effort, the mark is already stored.
  const displayed = request.payload.displayed;
  const adminClient = deps.adminClient;
  if (displayed !== undefined && adminClient !== undefined) {
    try {
      const callerBare = jidFor(localpartFor(user.id), deps.config.xmpp.domain);
      const stanza = buildDisplayed({
        chatJid: bare,
        kind: kindFor(bare, deps.config.xmpp.mucDomain),
        messageId: displayed,
      }).toString();
      await adminClient.sendStanza(callerBare, bare, stanza);
    } catch {
      deps.logger.warn({ userId: user.id, chatJid: bare }, 'read marker send failed');
    }
  }
}

// Access is checked before the write budget, like the read mark.
async function markDeliveredFor(
  deps: ChatsApiDependencies,
  limiter: RateLimiter,
  request: MarkDeliveredRequest,
  user: SessionUser,
) {
  const { bare } = await chatAccessFromParam(deps, request.params.jid, user.id);
  if (!limiter.allow(user.id)) {
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(429, 'rate_limited', 'Too many delivered updates, try again later'),
    );
  }
  // Stores the mark and, for a moved DM, tells the author's devices off the HTTP path.
  await markDeliveredAndNotify(deps, {
    bare,
    userId: user.id,
    originIds: request.payload.originIds,
  });
}
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
  const readLimiter = limiter('chatRead', now);
  // The notification reply has its own budget, checked before the claim.
  const replyLimiter = limiter('chatReply', now);
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

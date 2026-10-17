// effect-plain: moved unchanged from apps/server/src/chats/api.ts (size split)
// The two mark handler bodies (`markRead`, `markDelivered`) and their shared
// chat access helper, moved out of `api.ts` (T-1543 size split). `api.ts` wraps
// them with `handler` and passes the API's rate limiter, so the check order is
// unchanged: access first, then the write budget.

import { buildDisplayed } from '@zilar/xmpp-core';
import type { HttpServerRequest } from 'effect/http';
import { httpErrorResponse, requestIdOf, type SessionUser } from '../effect/http-core';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { ChatsApiDependencies } from './api';
import { markDeliveredAndNotify } from './delivered-notice';
import { putChatRead, requireChatReadAccess } from './reads';
import { kindFor } from './reply-handler';

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

// The normalised bare JID a mark may be stored under. A malformed param
// answers the same 404 as an unknown or invisible chat, so JIDs cannot be
// probed.
async function chatAccessForMark(
  deps: ChatsApiDependencies,
  encodedJid: string,
  userId: string,
): Promise<{ bare: string }> {
  let jid: string;
  try {
    jid = decodeURIComponent(encodedJid);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  return requireChatReadAccess(deps.db, {
    chatJid: jid,
    userId,
    domain: deps.config.xmpp.domain,
    mucDomain: deps.config.xmpp.mucDomain,
  });
}

// The caller's read mark for one chat. Access is checked before the write
// budget is charged, so a probe of an invisible chat costs nothing and answers
// the same 404 as an unknown chat.
export async function markReadFor(
  deps: ChatsApiDependencies,
  limiter: RateLimiter,
  request: MarkReadRequest,
  user: SessionUser,
) {
  const { bare } = await chatAccessForMark(deps, request.params.jid, user.id);
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

  // T-1893: a notification's Mark as read sends the same XEP-0333 marker an
  // in-app read sends, as the caller. Best effort: the mark is already stored,
  // so a failed send never fails the read.
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

// The receiving device's delivery confirmation. Access is checked before the
// write budget is charged, like the read mark, so a probe of an invisible chat
// costs nothing and answers the same 404 as an unknown chat.
export async function markDeliveredFor(
  deps: ChatsApiDependencies,
  limiter: RateLimiter,
  request: MarkDeliveredRequest,
  user: SessionUser,
) {
  const { bare } = await chatAccessForMark(deps, request.params.jid, user.id);
  if (!limiter.allow(user.id)) {
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(429, 'rate_limited', 'Too many delivered updates, try again later'),
    );
  }
  // One call: store the mark and (for a moved DM) tell the author's
  // online devices, best effort and off the HTTP path (T-1245).
  await markDeliveredAndNotify(deps, {
    bare,
    userId: user.id,
    originIds: request.payload.originIds,
  });
}

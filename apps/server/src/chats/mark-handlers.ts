// effect-plain: mark handler bodies, access and limits only
// `api.ts` wraps these with `handler` and the limiter, so access is checked before the write budget.

import { buildDisplayed } from '@zilar/xmpp-core';
import type { HttpServerRequest } from 'effect/http';
import { httpErrorResponse, requestIdOf, type SessionUser } from '../effect/http-core';
import { HttpError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { ChatsApiDependencies } from './api';
import { markDeliveredAndNotify } from './delivered-notice';
import { chatAccessFromParam, putChatRead } from './reads';
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

// Access is checked before the write budget, so a probe costs nothing and answers the same 404.
export async function markReadFor(
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
export async function markDeliveredFor(
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

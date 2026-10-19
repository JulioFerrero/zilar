// The reply route behind a notification's Reply action: a phone sends headlessly, so the route injects the stanza as the signed-in user.
// The `notification_replies` claim row makes a retry idempotent: the winner inserts, sends, then marks it sent.
// A loser answers 204 when the first send finished and 409 while the claim is fresh. The reply text is never logged.

import { buildMessage } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { HttpServerRequest } from 'effect/http';
import { isDmBlocked } from '../blocks/service';
import type { ServerDatabase } from '../db/client';
import { httpErrorResponse, requestIdOf, type SessionUser } from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import type { RateLimiter } from '../rate-limit';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { ChatsApiDependencies } from './api';
import { chatAccessFromParam } from './access';

type ClaimResult = 'claimed' | 'sent' | 'in_flight';

interface ReplyRequest {
  params: { jid: string };
  payload: { clientId: string; text: string };
  request: HttpServerRequest.HttpServerRequest;
}

// A room JID is on the MUC domain; anything else the access check let through is a DM.
export function kindFor(bare: string, mucDomain: string): 'groupchat' | 'chat' {
  return bare.slice(bare.indexOf('@') + 1) === mucDomain.toLowerCase() ? 'groupchat' : 'chat';
}

// The insert is the atomic claim: only one request wins; the row's state decides whether this request waits, succeeds or takes over.
async function claimReply(
  db: ServerDatabase,
  input: { userId: string; clientId: string; chatJid: string },
): Promise<ClaimResult> {
  const inserted = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ one: number }>`INSERT INTO notification_replies
        (user_id, client_id, chat_jid)
        VALUES (${input.userId}, ${input.clientId}, ${input.chatJid})
        ON CONFLICT (user_id, client_id) DO NOTHING
        RETURNING 1 AS one`;
    }),
  );
  if (inserted.length > 0) {
    return 'claimed';
  }

  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ sent: boolean; fresh: boolean }>`SELECT
          (sent_at IS NOT NULL) AS sent,
          (sent_at IS NULL AND created_at > now() - interval '2 minutes') AS fresh
        FROM notification_replies
        WHERE user_id = ${input.userId} AND client_id = ${input.clientId}
        LIMIT 1`;
    }),
  );
  if (existing === undefined) {
    // The claim was released between insert and read; this request waits rather than send without one.
    return 'in_flight';
  }
  if (existing.sent) {
    return 'sent';
  }
  if (existing.fresh) {
    return 'in_flight';
  }

  // The `WHERE` keeps the takeover atomic: two racing retries cannot both win.
  const taken = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ one: number }>`UPDATE notification_replies
        SET created_at = now()
        WHERE user_id = ${input.userId} AND client_id = ${input.clientId}
          AND sent_at IS NULL
          AND created_at <= now() - interval '2 minutes'
        RETURNING 1 AS one`;
    }),
  );
  return taken.length > 0 ? 'claimed' : 'in_flight';
}

async function markSent(
  db: ServerDatabase,
  input: { userId: string; clientId: string },
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE notification_replies SET sent_at = now()
        WHERE user_id = ${input.userId} AND client_id = ${input.clientId}`;
    }),
  );
}

// A failed send refunds the claim, so the same `clientId` can be retried.
async function releaseReply(
  db: ServerDatabase,
  input: { userId: string; clientId: string },
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM notification_replies
        WHERE user_id = ${input.userId} AND client_id = ${input.clientId}`;
    }),
  );
}

// Access, DM block, reply budget and the claim are checked in that order; the claim is released when the send fails.
export async function replyFor(
  deps: ChatsApiDependencies,
  limiter: RateLimiter,
  request: ReplyRequest,
  user: SessionUser,
) {
  const { bare } = await chatAccessFromParam(deps, request.params.jid, user.id);
  const kind = kindFor(bare, deps.config.xmpp.mucDomain);

  if (kind === 'chat' && (await isDmBlocked(deps.db, user.id, bare))) {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }

  if (!limiter.allow(user.id)) {
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(429, 'rate_limited', 'Too many replies, try again later'),
    );
  }

  const adminClient = deps.adminClient;
  if (adminClient === undefined) {
    return httpErrorResponse(requestIdOf(request.request), xmppUnavailable());
  }

  const { clientId, text } = request.payload;
  const claim = await claimReply(deps.db, { userId: user.id, clientId, chatJid: bare });
  if (claim === 'sent') {
    return;
  }
  if (claim === 'in_flight') {
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(409, 'reply_in_flight', 'The reply is still sending'),
    );
  }

  const callerBare = jidFor(localpartFor(user.id), deps.config.xmpp.domain);
  try {
    const stanza = buildMessage({ id: clientId, to: bare, kind, text }).toString();
    await adminClient.sendStanza(callerBare, bare, stanza);
  } catch {
    await releaseReply(deps.db, { userId: user.id, clientId });
    deps.logger.warn(
      { userId: user.id, chatJid: bare, clientId },
      'notification reply send failed',
    );
    return httpErrorResponse(
      requestIdOf(request.request),
      new HttpError(503, 'send_failed', 'Could not send the reply. Try again.'),
    );
  }

  await markSent(deps.db, { userId: user.id, clientId });
  deps.logger.info({ userId: user.id, chatJid: bare, clientId }, 'notification reply sent');
}

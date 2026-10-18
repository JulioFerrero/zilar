// Clear-history and delete-for-me for DMs, scoped to the caller's own archive rows (username = caller localpart, bare_peer = peer).
// Only direct chats: a group or room answers 400.

import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import { createAuditRecorder, type AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import { requireChatAccess } from '../chat-prefs/access';
import type { ServerDatabase } from '../db/client';
import { handler, httpErrorResponse, requestIdOf, type SessionUser } from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { createRateLimiter } from '../rate-limit';
import type { ArchivePool } from '../search/service';
import { localpartFor } from '../xmpp/provisioning';

// The two delete-for-me writes share one budget; access is checked first, so a probe costs no token.
export const CHAT_HISTORY_WRITE_RATE_LIMIT_MAX = 60;
export const CHAT_HISTORY_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface DeleteOwnDependencies {
  db: ServerDatabase;
  // Undefined answers 503, like the search route.
  archive: ArchivePool | undefined;
  // Records one id-only entry per delete; a failed audit write never throws.
  audit: AuditRecorder;
}

// Int8 bound, and the id is bound as a string (never a `BigInt`), so an id Postgres could not cast is a 400, not a 500.
const ARCHIVE_ID_PATTERN = /^\d+$/;
const MAX_ARCHIVE_ID = 9223372036854775807n;

function archiveRequired(archive: ArchivePool | undefined): ArchivePool {
  if (archive === undefined) {
    throw xmppUnavailable();
  }
  return archive;
}

// The same access rule as the read mark, so unknown and invisible chats answer the same 404; a group answers 400.
export async function requireDmAccess(
  db: ServerDatabase,
  options: { chatJid: string; userId: string; domain: string; mucDomain: string },
): Promise<{ bare: string }> {
  const { bare } = await requireChatAccess(db, options);
  const host = bare.slice(bare.indexOf('@') + 1);
  if (host === options.mucDomain.toLowerCase()) {
    throw new HttpError(400, 'invalid_request', 'Only direct chats');
  }
  return { bare };
}

// Deletes the caller's archive rows with `bare`, then the read and delivery marks, and records one audit entry.
export async function clearOwnHistory(
  deps: DeleteOwnDependencies,
  options: { userId: string; bare: string },
): Promise<number> {
  const archive = archiveRequired(deps.archive);
  const username = localpartFor(options.userId);
  const deleted = await archive.query(
    'DELETE FROM archive WHERE username = $1 AND bare_peer = $2 RETURNING timestamp',
    [username, options.bare],
  );
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM chat_reads
        WHERE user_id = ${options.userId} AND chat_jid = ${options.bare}`;
      // The caller's own delivery row held a mark into the author's archive; clearing the copy drops it.
      yield* sql`DELETE FROM chat_deliveries
        WHERE user_id = ${options.userId} AND chat_jid = ${options.bare}`;
    }),
  );
  await deps.audit.record({
    actorUserId: options.userId,
    aiId: null,
    groupId: null,
    action: 'chat.history_cleared',
    subjectId: null,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: { chatJid: options.bare, deleted: deleted.length },
  });
  return deleted.length;
}

// Deletes exactly one of the caller's archive rows; the id is validated as digits and bound as a string, never a `BigInt`.
export async function deleteOwnArchiveRow(
  deps: DeleteOwnDependencies,
  options: { userId: string; bare: string; archiveId: string },
): Promise<boolean> {
  if (!ARCHIVE_ID_PATTERN.test(options.archiveId)) {
    throw new HttpError(400, 'invalid_request', 'archiveId must be an archive id');
  }
  const parsed = BigInt(options.archiveId);
  if (parsed > MAX_ARCHIVE_ID) {
    throw new HttpError(400, 'invalid_request', 'archiveId must be an archive id');
  }
  const archive = archiveRequired(deps.archive);
  const username = localpartFor(options.userId);
  const deleted = await archive.query(
    'DELETE FROM archive WHERE username = $1 AND bare_peer = $2 AND timestamp = $3 RETURNING timestamp',
    [username, options.bare, options.archiveId],
  );
  if (deleted.length === 0) {
    return false;
  }
  await deps.audit.record({
    actorUserId: options.userId,
    aiId: null,
    groupId: null,
    action: 'chat.message_deleted',
    subjectId: null,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: { chatJid: options.bare, deleted: 1 },
  });
  return true;
}

// The two delete handlers live here so `api.ts` only names them.
export interface DeleteOwnHandlerDependencies {
  db: ServerDatabase;
  archive: ArchivePool | undefined;
  config: ServerConfig;
  logger: Logger;
  now?: () => number;
}

interface ChatJidRequest {
  params: { jid: string };
  request: HttpServerRequest.HttpServerRequest;
}

interface ArchiveIdRequest {
  params: { jid: string; archiveId: string };
  request: HttpServerRequest.HttpServerRequest;
}

// A malformed percent escape is an unknown chat (404), not a server error.
function decodeChatJid(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
}

function tooManyChanges(): HttpError {
  return new HttpError(429, 'rate_limited', 'Too many history changes, try again later');
}

// Both check DM access before the shared write budget.
export function deleteOwnHandlers(deps: DeleteOwnHandlerDependencies) {
  const logger = deps.logger;
  // A failed audit write is logged, never thrown.
  const audit = createAuditRecorder({ db: deps.db, logger });
  const limiter = createRateLimiter({
    max: CHAT_HISTORY_WRITE_RATE_LIMIT_MAX,
    windowMs: CHAT_HISTORY_WRITE_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });
  const service: DeleteOwnDependencies = { db: deps.db, archive: deps.archive, audit };
  const { domain, mucDomain } = deps.config.xmpp;
  return {
    clearHistory: handler(logger, async (request: ChatJidRequest, user: SessionUser) => {
      const { bare } = await requireDmAccess(deps.db, {
        chatJid: decodeChatJid(request.params.jid),
        userId: user.id,
        domain,
        mucDomain,
      });
      if (!limiter.allow(user.id)) {
        return httpErrorResponse(requestIdOf(request.request), tooManyChanges());
      }
      await clearOwnHistory(service, { userId: user.id, bare });
    }),
    deleteForMe: handler(logger, async (request: ArchiveIdRequest, user: SessionUser) => {
      const { bare } = await requireDmAccess(deps.db, {
        chatJid: decodeChatJid(request.params.jid),
        userId: user.id,
        domain,
        mucDomain,
      });
      if (!limiter.allow(user.id)) {
        return httpErrorResponse(requestIdOf(request.request), tooManyChanges());
      }
      const deleted = await deleteOwnArchiveRow(service, {
        userId: user.id,
        bare,
        archiveId: request.params.archiveId,
      });
      if (!deleted) {
        throw new HttpError(404, 'not_found', 'Message not found');
      }
    }),
  };
}

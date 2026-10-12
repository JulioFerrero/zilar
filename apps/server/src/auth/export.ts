// The account export route (T-1262, task T-C of
// `docs/audit/account-deletion-plan.md` §9). It streams the plan's §6a JSON
// document: the caller's profile, contacts and their own archive. The archive
// is read under the same scope as search (`allowedArchives`), never a peer's,
// and is paged by timestamp so memory stays flat.
//
// Limits: a session at most 30 minutes old (403 `reauth_required`), one export
// per hour per user (429 `rate_limited`), and 200 000 messages (413
// `export_too_large`) counted up front. A 250 MB byte cap truncates the stream
// with `"truncated": true` instead of failing mid-download. The log carries
// only `{ userId, messageCount, byteSize }` — never a body or an XML stanza.

import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { SqlClient } from 'effect/sql';
import type { Logger } from 'pino';
import type { Auth } from './auth';
import type { AuditRecorder } from '../audit/service';
import { UNNAMED_CONTACT_NAME } from '../contacts/service';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { ownBareJid } from '../jid';
import type { RateLimiter } from '../rate-limit';
import { createRateLimiter } from '../rate-limit';
import {
  allowedArchives,
  createArchivePool,
  type ArchivePool,
  type ArchiveRow,
  type SearchOwner,
} from '../search/service';
import { localpartFor } from '../xmpp/provisioning';
import { assertFreshSession } from './deletion-request';
import {
  createExportStream,
  type ExportChat,
  type ExportContact,
  type ExportProfile,
  type ExportSummary,
} from './export-stream';
import { bioForUser } from './profile-bio';
import { currentSession } from './sessions';

export const EXPORT_RATE_LIMIT_MAX = 1;
export const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const EXPORT_MAX_MESSAGES = 200_000;
export const EXPORT_MAX_BYTES = 250 * 1024 * 1024;
export const EXPORT_PAGE_SIZE = 500;

export interface ExportDeps {
  db: ServerDatabase;
  config: ServerConfig;
  auth: Auth;
  audit: AuditRecorder;
  logger: Logger;
  limiter: Pick<RateLimiter, 'allow'>;
  /** Absent (and `XMPP_ARCHIVE_DATABASE_URL` unset) → 501 `export_unavailable`. */
  archive?: ArchivePool;
  /** Injected in tests so the freshness check is measured against it. */
  now?: () => number;
}

type ChatScope = { kind: 'dm'; owner: string; peer: string } | { kind: 'room'; room: string };

interface ContactRow {
  userId: string;
  name: string;
  jid: string | null;
}

/**
 * The export's own read-only archive pool when the app did not pass one. The
 * `/me/export` route lives on the auth group, which `app.ts` builds without an
 * archive (T-1262 keeps `app.ts` untouched), so the module resolves the pool
 * from the same config `main.ts` uses.
 */
export function createExportArchivePool(config: ServerConfig): ArchivePool | undefined {
  const url = config.XMPP_ARCHIVE_DATABASE_URL;
  return url === undefined ? undefined : createArchivePool(url);
}

/** The pieces `createAuthApi` already holds; the factory builds the rest. */
export interface ExportRouteDeps {
  db: ServerDatabase;
  config: ServerConfig;
  auth: Auth;
  audit: AuditRecorder;
  logger: Logger;
  archive?: ArchivePool;
  now?: () => number;
}

/**
 * The `GET /me/export` handler closure. It owns the per-user limiter (one
 * export per hour) and resolves the archive pool from the injected one or from
 * `XMPP_ARCHIVE_DATABASE_URL`, so `auth/api.ts` wires the route in one line.
 */
export function createExportHandler(
  deps: ExportRouteDeps,
): (userId: string, headers: Headers) => Promise<HttpServerResponse.HttpServerResponse> {
  const now = deps.now ?? Date.now;
  const limiter = createRateLimiter({
    max: EXPORT_RATE_LIMIT_MAX,
    windowMs: EXPORT_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const archive = deps.archive ?? createExportArchivePool(deps.config);
  return (userId, headers) =>
    runExport(
      {
        db: deps.db,
        config: deps.config,
        auth: deps.auth,
        audit: deps.audit,
        logger: deps.logger,
        limiter,
        now,
        ...(archive === undefined ? {} : { archive }),
      },
      userId,
      headers,
    );
}

/**
 * The `GET /me/export` handler: every gate first, then the streamed answer. The
 * size `count(*)` runs before a byte is written; a decode failure after this
 * point is a defect the shared envelope renders.
 */
export async function runExport(
  deps: ExportDeps,
  userId: string,
  headers: Headers,
): Promise<HttpServerResponse.HttpServerResponse> {
  const archive = deps.archive;
  if (archive === undefined) {
    throw new HttpError(501, 'export_unavailable', 'Account export is not configured');
  }
  const now = deps.now ?? Date.now;
  const session = await currentSession(deps.auth, headers);
  assertFreshSession(session.createdAt, now(), 'Sign in again to export your messages.');
  if (!deps.limiter.allow(userId)) {
    throw new HttpError(429, 'rate_limited', 'Too many exports, try again later');
  }

  const allowed = await allowedArchives(deps.db, deps.config, userId);
  const messageCount = await countArchiveRows(archive, allowed);
  if (messageCount > EXPORT_MAX_MESSAGES) {
    throw new HttpError(413, 'export_too_large', 'Export too large. Contact the operator.');
  }

  const [profile, contacts] = await Promise.all([
    exportProfile(deps.db, userId),
    listContacts(deps.db, deps.config, userId),
  ]);
  const exportedAt = new Date(now()).toISOString();
  const ownJid = ownBareJid(allowed, deps.config.xmpp.domain);
  const stream = createExportStream(
    {
      exportedAt,
      profile,
      contacts,
      chats: exportChats(archive, allowed),
      ownBareJid: ownJid,
      byteCap: EXPORT_MAX_BYTES,
    },
    (summary) => recordExportDone(deps, userId, summary),
  );
  const responseHeaders = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="zilar-export-${exportedAt.slice(0, 10)}.json"`,
  });
  return HttpServerResponse.raw(stream, { status: 200, headers: responseHeaders });
}

function recordExportDone(deps: ExportDeps, userId: string, summary: ExportSummary): void {
  // Counts only, never a handle, a body or an XML stanza.
  deps.logger.info(
    { userId, messageCount: summary.messageCount, byteSize: summary.byteSize },
    'account export',
  );
  void deps.audit.record({
    actorUserId: userId,
    aiId: null,
    groupId: null,
    action: 'account.exported',
    subjectId: userId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: null,
  });
}

// One chat per DM peer then one per room, exactly the order `allowedArchives`
// builds them, so each chat's rows are read (and streamed) on their own.
async function* exportChats(
  archive: ArchivePool,
  allowed: SearchOwner,
): AsyncGenerator<ExportChat> {
  for (const peer of allowed.dmPeers) {
    yield {
      jid: peer,
      kind: 'dm',
      pages: chatPages(archive, { kind: 'dm', owner: allowed.ownLocalpart, peer }),
    };
  }
  for (const room of allowed.rooms) {
    yield { jid: room, kind: 'room', pages: chatPages(archive, { kind: 'room', room }) };
  }
}

// Keyset by timestamp: each page asks for rows newer than the last row read, so
// the read is a bounded index scan however long the history is.
async function* chatPages(archive: ArchivePool, scope: ChatScope): AsyncGenerator<ArchiveRow[]> {
  let cursor = 0n;
  for (;;) {
    const built = buildChatPageQuery(scope, cursor, EXPORT_PAGE_SIZE);
    const rows = await archive.query(built.text, built.values);
    if (rows.length === 0) {
      return;
    }
    yield rows;
    if (rows.length < EXPORT_PAGE_SIZE) {
      return;
    }
    cursor = BigInt(rows[rows.length - 1]?.timestamp ?? 0);
  }
}

function buildChatPageQuery(
  scope: ChatScope,
  cursorMicros: bigint,
  limit: number,
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const columns = `peer, bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, xml, txt AS "body"`;
  const where =
    scope.kind === 'room'
      ? `username = ${next(scope.room)}`
      : `username = ${next(scope.owner)} AND bare_peer = ${next(scope.peer)}`;
  return {
    text: `SELECT ${columns} FROM archive WHERE ${where} AND timestamp > ${next(cursorMicros)} ORDER BY timestamp ASC LIMIT ${next(limit)}`,
    values,
  };
}

// The whole scoped archive in one count: exactly the scope `archive-query.ts`
// uses with no chat filter (rooms any, DMs under the caller's own username).
function buildCountQuery(allowed: SearchOwner): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  return {
    text: `SELECT count(*)::bigint AS "count" FROM archive WHERE (username = ANY(${next(
      allowed.rooms,
    )}) OR (username = ${next(allowed.ownLocalpart)} AND bare_peer = ANY(${next(
      allowed.dmPeers,
    )})))`,
    values,
  };
}

async function countArchiveRows(archive: ArchivePool, allowed: SearchOwner): Promise<number> {
  const built = buildCountQuery(allowed);
  const rows = (await archive.query(built.text, built.values)) as unknown as Array<{
    count: string | number | bigint;
  }>;
  return Number(rows[0]?.count ?? 0);
}

async function exportProfile(db: ServerDatabase, userId: string): Promise<ExportProfile> {
  const [user] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        id: string;
        name: string;
      }>`SELECT id, name FROM "user" WHERE id = ${userId} LIMIT 1`;
    }),
  );
  const [handleRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        handle: string;
      }>`SELECT handle FROM handles WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  const bio = await bioForUser(db, userId);
  return {
    id: user?.id ?? userId,
    name: user?.name ?? '',
    handle: handleRow?.handle ?? null,
    bio: bio ?? '',
  };
}

// The caller's contacts (never a blocked peer), the same rows `allowedArchives`
// reads, but keeping the `userId` the export's `contacts` entry needs.
async function listContacts(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
): Promise<ExportContact[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ContactRow>`SELECT c.contact_user_id AS "userId", u.name, x.jid
        FROM contacts c
        INNER JOIN "user" u ON u.id = c.contact_user_id
        LEFT JOIN xmpp_accounts x ON x.user_id = c.contact_user_id
        WHERE c.user_id = ${userId}
          AND NOT EXISTS (SELECT 1 FROM user_blocks b
            WHERE (b.user_id = ${userId} AND b.blocked_user_id = c.contact_user_id)
               OR (b.user_id = c.contact_user_id AND b.blocked_user_id = ${userId}))`;
    }),
  );
  const domain = config.xmpp.domain;
  return rows.map((row) => ({
    userId: row.userId,
    name: row.name.trim() === '' ? UNNAMED_CONTACT_NAME : row.name,
    jid: row.jid ?? `${localpartFor(row.userId)}@${domain}`,
  }));
}

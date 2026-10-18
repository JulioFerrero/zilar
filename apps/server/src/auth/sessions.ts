// The caller's own sessions (T-1235): the list Settings → Devices shows, and
// the sign-out of one other device.
//
// Better Auth's own `/list-sessions` route runs `freshSessionMiddleware`
// (better-auth/dist/api/routes/session.mjs:347-350), so a session older than
// the 24 h default `freshAge` gets 403 `SESSION_NOT_FRESH`. These routes read
// the `session` table directly, so every session lists, however old.
//
// The client never sees a token or an IP address: the list answers ids, the
// two timestamps, the user agent and `current`; the delete takes an id.

import type { AuthSession, AuthSessions } from '@zilar/api-contract';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { localpartFor } from '../xmpp/provisioning';
import type { Auth } from './auth';

export interface SessionsDeps {
  db: ServerDatabase;
  auth: Auth;
}

/** The admin-client call revocation needs (T-1982). */
export type KickAdminClient = Pick<EjabberdAdminClient, 'kickUser'>;

export interface KickLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export const REVOKED_SESSION_KICK_REASON = 'Session revoked';
export const SIGNED_OUT_SESSION_KICK_REASON = 'Session signed out';

/**
 * Ends every XMPP stream of the user after a session row is deleted (T-1982).
 * ejabberd kicks all of the user's streams, so the user's other devices
 * reconnect briefly with fresh tokens; the revoked device cannot.
 *
 * Best effort: signing a device out must still work when ejabberd is down, so
 * a failure is logged and never rethrown.
 */
export async function endXmppSessions(
  adminClient: KickAdminClient | undefined,
  logger: KickLogger | undefined,
  userId: string,
  reason: string,
): Promise<void> {
  if (adminClient?.kickUser === undefined) {
    return;
  }
  try {
    await adminClient.kickUser(localpartFor(userId), reason);
  } catch (error) {
    logger?.warn({ userId, err: error }, 'could not end the XMPP sessions');
  }
}

interface SessionRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userAgent: string | null;
}

/**
 * The caller's own session row: its id and `createdAt`. `listSessions` and
 * `revokeSession` read only the id; the deletion request (T-1261) reads
 * `createdAt` to demand a session at most 30 minutes old (plan §9, decision 9).
 */
export async function currentSession(
  auth: Auth,
  headers: Headers,
): Promise<{ id: string; createdAt: Date }> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new HttpError(401, 'unauthorized', 'Authentication required');
  }
  return { id: session.session.id, createdAt: session.session.createdAt };
}

/**
 * The caller's own session id, so the list marks the right row `current` and
 * the delete refuses to remove it. The session middleware reads the same
 * `auth.api.getSession` (`apps/server/src/effect/http-core.ts:45-46`) but
 * hands the handler only the user id, so the handler reads the session once
 * more, exactly like `PATCH /me` (`apps/server/src/auth/api.ts:183`). The push
 * subscribe handler (`apps/server/src/push/api-subscribe.ts`) reuses it to
 * stamp the registering session onto the device row (T-1255).
 */
export async function currentSessionId(auth: Auth, headers: Headers): Promise<string> {
  return (await currentSession(auth, headers)).id;
}

/** Every unexpired session of `userId`, newest `updatedAt` first. */
export async function listSessions(
  deps: SessionsDeps,
  userId: string,
  headers: Headers,
): Promise<AuthSessions> {
  const currentId = await currentSessionId(deps.auth, headers);
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // `created_at`/`updated_at` are `timestamp WITHOUT time zone`, which the
      // pg driver parses in the process's local zone; the cast returns the same
      // instant as a timestamptz, like `/me` (`auth/api.ts:294-297`).
      return yield* sql<SessionRow>`SELECT
          id,
          (created_at AT TIME ZONE 'UTC') AS "createdAt",
          (updated_at AT TIME ZONE 'UTC') AS "updatedAt",
          user_agent AS "userAgent"
        FROM "session"
        WHERE user_id = ${userId} AND expires_at > now()
        ORDER BY updated_at DESC, id`;
    }),
  );
  return {
    sessions: rows.map((row): AuthSession => ({
      id: row.id,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      // The token and the IP address stay on the server.
      ...(row.userAgent === null ? {} : { userAgent: row.userAgent }),
      current: row.id === currentId,
    })),
  };
}

/**
 * Signs out one of the caller's other sessions. An unknown id and an id
 * belonging to another user answer the same 404 (`WHERE user_id` scopes the
 * delete, and the unknown case has no row either); the caller's own session
 * answers 400, because it has its own Sign out.
 */
export async function revokeSession(
  deps: SessionsDeps & {
    audit: AuditRecorder;
    adminClient?: KickAdminClient;
    logger?: KickLogger;
  },
  userId: string,
  headers: Headers,
  sessionId: string,
): Promise<void> {
  const currentId = await currentSessionId(deps.auth, headers);
  if (sessionId === currentId) {
    throw new HttpError(400, 'invalid_request', 'Use Sign out');
  }
  const deleted = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`DELETE FROM "session"
        WHERE id = ${sessionId} AND user_id = ${userId}
        RETURNING id`;
    }),
  );
  if (deleted.length === 0) {
    throw new HttpError(404, 'not_found', 'Session not found');
  }
  // Ids only: the revoked session id, never a token or an IP address.
  await deps.audit.record({
    actorUserId: userId,
    aiId: null,
    groupId: null,
    action: 'session.revoked',
    subjectId: sessionId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: null,
  });
  // The row is gone, so the device can no longer get a token; this closes the
  // stream it already holds. Failing to reach ejabberd never undoes the revoke.
  await endXmppSessions(deps.adminClient, deps.logger, userId, REVOKED_SESSION_KICK_REASON);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

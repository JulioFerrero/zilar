// The list and sign-out of one other device; reads the `session` table directly so a session older than 24 h still lists.
// The client never sees a token or an IP address: the list answers ids, timestamps, the user agent and `current`.

import type { ServerCore } from '../app/deps';
import type { AuthSession, AuthSessions } from '@zilar/api-contract';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { EjabberdAdminClient } from '../xmpp/admin/types';

import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { localpartFor } from '../xmpp/provisioning';
import type { Auth } from './auth';

export type SessionsDeps = Pick<ServerCore, 'db' | 'auth'>;

export type KickAdminClient = Pick<EjabberdAdminClient, 'kickUser'>;

export interface KickLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export const REVOKED_SESSION_KICK_REASON = 'Session revoked';
export const SIGNED_OUT_SESSION_KICK_REASON = 'Session signed out';

// Ends all the user's XMPP streams after a session row is deleted; other devices briefly reconnect with fresh tokens.
// Best effort: signing out must work when ejabberd is down.
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

// The caller's own session id and `createdAt`; the deletion request needs `createdAt` for the 30-minute gate.
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

// The caller's own session id, so the list marks `current` and the delete refuses it.
export async function currentSessionId(auth: Auth, headers: Headers): Promise<string> {
  return (await currentSession(auth, headers)).id;
}

// Every unexpired session of `userId`, newest `updatedAt` first.
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
      // `created_at`/`updated_at` are `timestamp WITHOUT time zone`; the cast keeps the instant timezone-independent.
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

// An unknown id and another user's id answer the same 404 (`WHERE user_id` scopes the delete); the caller's own session answers 400.
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
  // Ids only: never a token or an IP address.
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
  await endXmppSessions(deps.adminClient, deps.logger, userId, REVOKED_SESSION_KICK_REASON);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

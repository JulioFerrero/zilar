// Contact-request query helpers (T-0983 size split, moved unchanged from
// `./service`): handle resolution, the contact/pair probes, the row-to-view
// mapping and the shared row types and dependency seam.
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { normalizeHandle } from '../handles/rules';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

export const MAX_PENDING_OUTGOING = 20;
export const RE_REQUEST_COOLDOWN_DAYS = 7;
// The list endpoint caps each side server-side; the outgoing cap above is
// the binding one, so 100 newest per side is headroom, not a limit anyone
// should hit.
export const MAX_LIST_ROWS = 100;

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface ContactRequestRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: ContactRequestStatus;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface ContactRequestView {
  id: string;
  status: ContactRequestStatus;
  createdAt: string;
  other: { userId: string; name: string; handle: string | null; image: string | null };
}

export interface ContactRequestsDeps {
  db: ServerDatabase;
  audit?: AuditRecorder;
  adminClient?: EjabberdAdminClient;
  domain?: string;
  /** Override the clock in tests. Defaults to the wall clock. */
  now?: () => Date;
  /**
   * Test-only seam: called inside the create transaction immediately before
   * the insert. A test throws a pair-index unique violation here to reach the
   * recovery path, which PGlite cannot reproduce by racing (it serializes on
   * one connection). Never set in production.
   */
  onInsert?: () => void;
  /**
   * Test-only seam: called on the fresh connection before the recovery reads.
   * A test uses it to trace the recovery reads and to commit the concurrent
   * winner that landed between the pre-check and the insert. Never set in
   * production.
   */
  onRecovery?: () => void | Promise<void>;
}

// Resolves an exact, case-insensitive handle to its user row under the
// caller's transaction connection. Unknown and retired handles answer the
// same 404 `not_found`, so failures never reveal which one it was. There is
// deliberately no prefix or partial search.
export function resolveHandleUser(
  sql: SqlClient.SqlClient,
  handle: string,
): Effect.Effect<{ id: string }, HttpError | SqlError.SqlError> {
  return Effect.gen(function* () {
    const [row] = yield* sql<{ userId: string | null }>`SELECT user_id FROM handles
      WHERE handle_lower = ${normalizeHandle(handle.trim())} LIMIT 1`;
    if (!row || !row.userId) {
      return yield* Effect.fail(new HttpError(404, 'not_found', 'No user with that username'));
    }
    return { id: row.userId };
  });
}

export function serviceNow(deps: ContactRequestsDeps): Date {
  return deps.now ? deps.now() : new Date();
}

export function auditFor(
  deps: ContactRequestsDeps,
  action: string,
  actorUserId: string,
  subjectId: string,
): void {
  void deps.audit?.record({
    actorUserId,
    aiId: null,
    groupId: null,
    action,
    subjectId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: null,
  });
}

export function isContactEffect(
  sql: SqlClient.SqlClient,
  userId: string,
  otherId: string,
): Effect.Effect<boolean, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [row] = yield* sql<{ userId: string }>`SELECT user_id FROM contacts
      WHERE user_id = ${userId} AND contact_user_id = ${otherId} LIMIT 1`;
    return row !== undefined;
  });
}

export function pendingBetweenEffect(
  sql: SqlClient.SqlClient,
  firstId: string,
  secondId: string,
): Effect.Effect<ContactRequestRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [forward] = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
      WHERE from_user_id = ${firstId} AND to_user_id = ${secondId} AND status = 'pending'
      LIMIT 1`;
    if (forward) {
      return forward;
    }
    const [reverse] = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
      WHERE from_user_id = ${secondId} AND to_user_id = ${firstId} AND status = 'pending'
      LIMIT 1`;
    return reverse ?? null;
  });
}

export function toView(
  row: ContactRequestRow,
  viewerId: string,
  profileByUser: Map<string, { name: string; image: string | null; handle: string | null }>,
): ContactRequestView {
  const otherId = row.fromUserId === viewerId ? row.toUserId : row.fromUserId;
  const profile = profileByUser.get(otherId);
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    other: {
      userId: otherId,
      name: profile?.name ?? 'Unnamed user',
      handle: profile?.handle ?? null,
      image: profile?.image ?? null,
    },
  };
}

// One joined query for every distinct other party: display name + image
// from `user`, handle from `handles`. Missing users (deleted between the
// list read and here — nearly impossible inside one request) fall back to
// the `toView` defaults.
export function profilesByUserEffect(
  otherIds: string[],
): Effect.Effect<
  Map<string, { name: string; image: string | null; handle: string | null }>,
  SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const byUser = new Map<string, { name: string; image: string | null; handle: string | null }>();
    if (otherIds.length === 0) {
      return byUser;
    }
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      userId: string;
      name: string;
      image: string | null;
      handle: string | null;
    }>`SELECT u.id AS user_id, u.name, u.image, h.handle
      FROM "user" u
      LEFT JOIN handles h ON h.user_id = u.id
      WHERE u.id IN ${sql.in([...new Set(otherIds)])}`;
    for (const row of rows) {
      const name = row.name.trim() === '' ? 'Unnamed user' : row.name;
      byUser.set(row.userId, { name, image: row.image, handle: row.handle });
    }
    return byUser;
  });
}

export function findActionableEffect(
  sql: SqlClient.SqlClient,
  id: string,
  viewerId: string,
  side: 'to' | 'from',
): Effect.Effect<ContactRequestRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const statement =
      side === 'to'
        ? sql<ContactRequestRow>`SELECT * FROM contact_requests
            WHERE id = ${id} AND to_user_id = ${viewerId} LIMIT 1`
        : sql<ContactRequestRow>`SELECT * FROM contact_requests
            WHERE id = ${id} AND from_user_id = ${viewerId} LIMIT 1`;
    const [row] = yield* statement;
    return row ?? null;
  });
}

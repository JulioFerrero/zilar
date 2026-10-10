import { Effect, Exit, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { MAX_AUDIT_LIST_LIMIT } from '@zilar/api-contract';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

export const DEFAULT_AUDIT_LIST_LIMIT = 50;

const cursorSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(80),
    Schema.isPattern(/^[0-9a-zA-Z_:.\\-]+$/),
  ),
);

// One result row, exactly as it appears in the API. Visibility rules are
// applied by the list functions: a row's `actor_user_id` is only included
// when the caller is allowed to see it (i.e. they own the AI, or they own
// or administer the group).
export interface PublicAuditEntry {
  id: string;
  at: Date;
  aiId: string | null;
  groupId: string | null;
  action: string;
  subjectId: string | null;
  argsHash: string | null;
  cost: { currency: 'EUR' | 'USD'; amount: number } | null;
  result: 'ok' | 'denied' | 'error';
  detail: Record<string, unknown> | null;
  /** The acting user. Only present when the caller may see it. */
  actorUserId: string | null;
}

export interface ListAuditPage {
  entries: PublicAuditEntry[];
  /** A cursor for `before`. `null` when there are no more pages. */
  next: string | null;
}

export interface ListAuditOptions {
  limit?: number;
  /** Cursor returned by a previous page. */
  before?: string;
}

// One audit row as the driver returns it: snake_case columns are camelCased
// by `transformResultNames`, timestamptz comes back as a `Date`, and numeric
// comes back as a string.
interface AuditLogRow {
  id: string;
  at: Date;
  actorUserId: string | null;
  aiId: string | null;
  groupId: string | null;
  action: string;
  subjectId: string | null;
  argsHash: string | null;
  costCurrency: 'EUR' | 'USD' | null;
  costAmount: string | null;
  result: 'ok' | 'denied' | 'error';
  detail: Record<string, unknown> | null;
}

// Cursor format: `<ISO_AT>_<id>`, base64url. The id breaks ties when two rows
// share the same `at` (possible when two writers inserted at the same
// instant), so pagination never returns duplicates or skips.
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}_${id}`, 'ascii').toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('ascii');
  } catch {
    throw new Error('Invalid cursor');
  }
  const separatorIndex = decoded.lastIndexOf('_');
  if (separatorIndex < 0) {
    throw new Error('Invalid cursor');
  }
  const atIso = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) {
    throw new Error('Invalid cursor');
  }
  return { at, id };
}

// Lists audit rows whose `group_id` matches, newest first. Visibility:
// the group's owner and admins only. A non-member — or a plain member —
// gets the same empty page as an unknown group id, so existence is never
// leaked. T-0108: topic entries for a private topic the viewer cannot see
// are dropped from the page (the recorder never stores a private topic's
// name in `detail`, and this filter keeps the entries themselves hidden).
export async function listAuditForGroup(
  db: ServerDatabase,
  groupId: string,
  userId: string,
  options: ListAuditOptions = {},
): Promise<ListAuditPage> {
  const limit = clampLimit(options.limit);
  const before = options.before === undefined ? null : parseCursor(options.before);
  const visible = await isGroupAdmin(db, groupId, userId);
  if (!visible) {
    return { entries: [], next: null };
  }
  // Over-fetch so private-topic entries can be filtered without shrinking
  // the page more than needed; pagination stays newest-first and the cursor
  // still advances.
  const page = await listForColumn(db, 'group', groupId, limit * 2 + 1, before);
  const kept = await filterHiddenTopicEntries(db, userId, page.entries);
  const entries = kept.slice(0, limit);
  const last = entries[entries.length - 1];
  return {
    entries,
    next: kept.length > limit && last !== undefined ? encodeCursor(last.at, last.id) : page.next,
  };
}

// Lists audit rows whose `ai_id` matches, newest first. Visibility: the AI's
// owner only. Anyone else — a stranger, even a group admin — gets the same
// empty page as an unknown AI.
export async function listAuditForAi(
  db: ServerDatabase,
  aiId: string,
  userId: string,
  options: ListAuditOptions = {},
): Promise<ListAuditPage> {
  const limit = clampLimit(options.limit);
  const before = options.before === undefined ? null : parseCursor(options.before);
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  if (!ai || ai.owner !== userId) {
    return { entries: [], next: null };
  }
  return listForColumn(db, 'ai', aiId, limit, before);
}

// The shared `WHERE` and cursor logic. `limit + 1` rows are fetched so we
// can tell the caller whether another page exists, without running two
// queries. The column comes from a closed choice, so no untrusted name is
// ever interpolated: each side builds its own fixed fragment.
async function listForColumn(
  db: ServerDatabase,
  scope: 'group' | 'ai',
  value: string,
  limit: number,
  before: { at: Date; id: string } | null,
): Promise<ListAuditPage> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const scopeCondition = scope === 'group' ? sql`group_id = ${value}` : sql`ai_id = ${value}`;
      const beforeCondition =
        before === null
          ? sql``
          : sql`AND (at < ${before.at} OR (at = ${before.at} AND id < ${before.id}))`;
      return yield* sql<AuditLogRow>`SELECT * FROM audit_log
        WHERE ${scopeCondition} ${beforeCondition}
        ORDER BY at DESC, id DESC
        LIMIT ${limit + 1}`;
    }),
  );
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const next =
    hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1]!.at, page[page.length - 1]!.id)
      : null;
  return { entries: page.map(toPublicAuditEntry), next };
}

// Maps an internal row to the public shape. The caller is known to be
// allowed to read this scope, so `actor_user_id` is always included: only
// admins and AI owners ever see it.
function toPublicAuditEntry(row: AuditLogRow): PublicAuditEntry {
  const hasCost = row.costCurrency !== null && row.costAmount !== null;
  return {
    id: row.id,
    at: row.at,
    aiId: row.aiId,
    groupId: row.groupId,
    action: row.action,
    subjectId: row.subjectId,
    argsHash: row.argsHash,
    cost: hasCost
      ? {
          currency: row.costCurrency as 'EUR' | 'USD',
          amount: Number(row.costAmount),
        }
      : null,
    result: row.result,
    detail: row.detail ?? null,
    actorUserId: row.actorUserId,
  };
}

function isGroupAdmin(db: ServerDatabase, groupId: string, userId: string): Promise<boolean> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ role: string }>`SELECT gm.role FROM group_members gm
        INNER JOIN groups g ON g.id = ${groupId}
        WHERE gm.group_id = ${groupId} AND gm.user_id = ${userId}
        LIMIT 1`;
    }),
  ).then((rows) => {
    if (rows.length === 0) {
      return false;
    }
    const role = rows[0]!.role;
    return role === 'owner' || role === 'admin';
  });
}

// Drops entries about a private topic the viewer cannot see. Topic actions
// (`topic.*`) carry the topic id in `subject_id`; anything else passes
// through. Group membership is already established by the caller.
async function filterHiddenTopicEntries(
  db: ServerDatabase,
  userId: string,
  entries: PublicAuditEntry[],
): Promise<PublicAuditEntry[]> {
  const topicActions = entries.filter((entry) => entry.action.startsWith('topic.'));
  if (topicActions.length === 0) {
    return entries;
  }
  const subjectIds = [
    ...new Set(
      topicActions.map((entry) => entry.subjectId).filter((id): id is string => id !== null),
    ),
  ];
  if (subjectIds.length === 0) {
    return entries;
  }
  const topicRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; visibility: string }>`SELECT id, visibility FROM topics
        WHERE id IN ${sql.in(subjectIds)}`;
    }),
  );
  const byId = new Map(topicRows.map((row) => [row.id, row]));
  let privateSeen: Set<string> = new Set();
  const privateIds = topicRows.filter((row) => row.visibility === 'private').map((row) => row.id);
  if (privateIds.length > 0) {
    const memberRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT topic_id FROM topic_members
          WHERE topic_id IN ${sql.in(privateIds)} AND user_id = ${userId}`;
      }),
    );
    privateSeen = new Set(memberRows.map((row) => row.topicId));
    // T-0116: topics reached through a role, not a direct row.
    const roleRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT tra.topic_id FROM topic_role_access tra
          INNER JOIN group_member_roles gmr ON gmr.role_id = tra.role_id
          WHERE tra.topic_id IN ${sql.in(privateIds)} AND gmr.user_id = ${userId}`;
      }),
    );
    for (const row of roleRows) {
      privateSeen.add(row.topicId);
    }
  }
  return entries.filter((entry) => {
    if (!entry.action.startsWith('topic.') || entry.subjectId === null) {
      return true;
    }
    const topic = byId.get(entry.subjectId);
    // A topic row that is gone (or never existed) carries no private name;
    // keep the entry so the log stays complete.
    if (!topic || topic.visibility !== 'private') {
      return true;
    }
    return privateSeen.has(topic.id);
  });
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_AUDIT_LIST_LIMIT;
  }
  if (limit < 1) {
    return 1;
  }
  if (limit > MAX_AUDIT_LIST_LIMIT) {
    return MAX_AUDIT_LIST_LIMIT;
  }
  return Math.floor(limit);
}

function parseCursor(cursor: string): { at: Date; id: string } {
  const exit = Schema.decodeUnknownExit(cursorSchema)(cursor);
  if (!Exit.isSuccess(exit)) {
    throw new Error('Invalid cursor');
  }
  return decodeCursor(exit.value);
}

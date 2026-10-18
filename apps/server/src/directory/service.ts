// The public directory: search over public groups and channels only. Private groups and
// people never appear here; strangers never see them.

import { Effect } from 'effect';
import { SqlClient, type Statement } from 'effect/sql';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';

export const DIRECTORY_PAGE_SIZE = 20;
export const DIRECTORY_QUERY_MIN_LENGTH = 2;
// A user joins a public group or channel through one request; the cap is counted
// atomically inside the join transaction.
export const PUBLIC_GROUP_MAX_MEMBERS = 5000;

export type GroupKind = 'group' | 'channel';

export interface DirectoryEntry {
  id: string;
  kind: GroupKind;
  title: string;
  handle: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  avatarUrl?: string | undefined;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  next: string | null;
}

interface DirectoryCursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}_${id}`, 'ascii').toString('base64url');
}

function decodeCursor(cursor: string): DirectoryCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('ascii');
  } catch {
    throw new HttpError(400, 'invalid_request', 'Invalid cursor');
  }
  const separatorIndex = decoded.lastIndexOf('_');
  if (separatorIndex < 0) {
    throw new HttpError(400, 'invalid_request', 'Invalid cursor');
  }
  const at = new Date(decoded.slice(0, separatorIndex));
  const id = decoded.slice(separatorIndex + 1);
  if (Number.isNaN(at.getTime()) || id === '') {
    throw new HttpError(400, 'invalid_request', 'Invalid cursor');
  }
  return { createdAt: at, id };
}

export interface SearchDirectoryInput {
  query?: string | undefined;
  kind?: GroupKind | undefined;
  cursor?: string | undefined;
}

interface DirectoryRow {
  id: string;
  kind: GroupKind;
  title: string;
  handle: string | null;
  description: string | null;
  createdAt: Date;
}

// Newest first when `q` is empty; with a query, handle-then-title prefix matches come
// first (exact handle first), then newest. The cursor walks `(created_at, id)` so
// pagination never skips or repeats.
export async function searchDirectory(
  db: ServerDatabase,
  viewerId: string,
  input: SearchDirectoryInput,
): Promise<DirectoryPage> {
  const raw = (input.query ?? '').trim();
  const hasQuery = raw !== '';
  if (hasQuery && raw.length < DIRECTORY_QUERY_MIN_LENGTH) {
    throw new HttpError(400, 'invalid_request', 'Search needs at least 2 characters');
  }
  const before = input.cursor === undefined ? null : decodeCursor(input.cursor);
  const lower = raw.toLowerCase();

  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const conditions: Array<Statement.Fragment> = [sql`g.visibility = 'public'`];
      if (input.kind !== undefined) {
        conditions.push(sql`g.kind = ${input.kind}`);
      }
      if (hasQuery) {
        conditions.push(
          sql.or([
            sql`h.handle ILIKE ${escapeLike(raw) + '%'}`,
            sql`g.title ILIKE ${escapeLike(raw) + '%'}`,
          ]),
        );
      }
      if (before !== null) {
        conditions.push(
          sql.or([
            sql`g.created_at < ${before.createdAt}`,
            sql.and([sql`g.created_at = ${before.createdAt}`, sql`g.id < ${before.id}`]),
          ]),
        );
      }

      return yield* sql<DirectoryRow>`SELECT g.id, g.kind, g.title, h.handle,
          g.description, g.created_at
        FROM groups g
        INNER JOIN handles h ON h.group_id = g.id
        WHERE ${sql.and(conditions)}
        ORDER BY g.created_at DESC, g.id DESC
        LIMIT ${DIRECTORY_PAGE_SIZE + 1}`;
    }),
  );

  const page = rows.slice(0, DIRECTORY_PAGE_SIZE);
  if (page.length === 0) {
    return { entries: [], next: null };
  }
  const counts = await countMembers(
    db,
    page.map((row) => row.id),
  );
  const joined = await membershipsOf(
    db,
    viewerId,
    page.map((row) => row.id),
  );

  const entryAvatars = await avatarIdsByOwner(
    db,
    'group',
    page.map((row) => row.id),
  );
  const entries = page.map((row): DirectoryEntry => {
    if (row.handle === null) {
      throw new Error('a public group without a handle row');
    }
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      handle: row.handle,
      description: row.description,
      memberCount: counts.get(row.id) ?? 0,
      joined: joined.has(row.id),
      ...(entryAvatars.get(row.id) === undefined
        ? {}
        : { avatarUrl: avatarUrlFor(entryAvatars.get(row.id)!) }),
    };
  });
  // Ranking reorders the page in memory; the cursor still walks newest-first overall.
  if (hasQuery) {
    const rank = (entry: DirectoryEntry): number => {
      const handleLower = entry.handle.toLowerCase();
      if (handleLower === lower) {
        return 0;
      }
      if (handleLower.startsWith(lower)) {
        return 1;
      }
      return 2;
    };
    entries.sort((a, b) => rank(a) - rank(b));
  }

  const last = page[page.length - 1];
  const next =
    rows.length > DIRECTORY_PAGE_SIZE && last !== undefined
      ? encodeCursor(last.createdAt, last.id)
      : null;
  return { entries, next };
}

// Exact, case-insensitive handle match only. A private group and an unknown handle
// answer the same 404, so neither can be probed.
export async function publicGroupForHandle(
  db: ServerDatabase,
  viewerId: string,
  handle: string,
): Promise<DirectoryEntry> {
  const lower = handle.trim().toLowerCase();
  if (lower === '') {
    throw new HttpError(404, 'not_found', 'No public group with that handle');
  }
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        id: string;
        kind: GroupKind;
        title: string;
        handle: string;
        description: string | null;
        visibility: string;
      }>`SELECT g.id, g.kind, g.title, h.handle, g.description, g.visibility
        FROM handles h
        INNER JOIN groups g ON g.id = h.group_id
        WHERE h.handle_lower = ${lower}
        LIMIT 1`;
    }),
  );
  // A user's handle is not a group; a private group reads exactly like unknown.
  if (!row || row.visibility !== 'public') {
    throw new HttpError(404, 'not_found', 'No public group with that handle');
  }
  const counts = await countMembers(db, [row.id]);
  const joined = await membershipsOf(db, viewerId, [row.id]);
  const singleAvatar = await avatarIdsByOwner(db, 'group', [row.id]);
  const singleAvatarId = singleAvatar.get(row.id);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    handle: row.handle,
    description: row.description,
    memberCount: counts.get(row.id) ?? 0,
    joined: joined.has(row.id),
    ...(singleAvatarId === undefined ? {} : { avatarUrl: avatarUrlFor(singleAvatarId) }),
  };
}

// `%`, `_` and the escape char in a query are literal text, never wildcards. PostgreSQL
// `LIKE`/`ILIKE` use backslash as the escape by default, so no `ESCAPE` clause is needed.
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function countMembers(db: ServerDatabase, groupIds: string[]): Promise<Map<string, number>> {
  if (groupIds.length === 0) {
    return new Map();
  }
  const ids = [...new Set(groupIds)];
  // A group's members are its people and its own AIs, summed in one grouped query.
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string; total: number }>`SELECT group_id, count(*)::int AS total
        FROM (
          SELECT group_id FROM group_members WHERE group_id IN ${sql.in(ids)}
          UNION ALL
          SELECT group_id FROM group_ais WHERE group_id IN ${sql.in(ids)}
        ) AS participants
        GROUP BY group_id`;
    }),
  );
  return new Map(rows.map((row) => [row.groupId, Number(row.total)]));
}

async function membershipsOf(
  db: ServerDatabase,
  viewerId: string,
  groupIds: string[],
): Promise<Set<string>> {
  if (groupIds.length === 0) {
    return new Set();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string }>`SELECT group_id FROM group_members
        WHERE user_id = ${viewerId} AND group_id IN ${sql.in([...new Set(groupIds)])}`;
    }),
  );
  return new Set(rows.map((row) => row.groupId));
}

// Public directory (T-0164): search over public groups and channels only.
// Private groups and people never appear here; strangers never see them.
// Rows are read from `groups` joined to their single `handles` row (the
// shared namespace with T-0163 `@username`s) and counted from
// `group_members`.

import { and, count, desc, eq, ilike, inArray, lt, or } from 'drizzle-orm';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerDatabase } from '../db/client';
import { groupMembers, groups, handles } from '../db/schema';
import { HttpError } from '../errors';

export const DIRECTORY_PAGE_SIZE = 20;
export const DIRECTORY_QUERY_MIN_LENGTH = 2;
// A user joins a public group or channel through one request; people and
// AIs share this cap, counted atomically inside the join transaction.
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
  /** T-0165: the group's picture, when it has one. Omitted when none. */
  avatarUrl?: string | undefined;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  /** A cursor for the next page, or null when there are no more pages. */
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

// Newest first when `q` is empty, so Explore shows fresh groups; with a
// query, handle-then-title prefix matches come first (exact handle first),
// then newest — the deterministic tie-break is `(created_at, id)` with a
// cursor over both. Every row is a public group with its single handle row
// joined in one query; counts ride along from `group_members`.
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

  // The cursor walks the public rows newest-first; with a query the same
  // walk is filtered to prefix matches, so pagination never skips or repeats.
  const conditions = [eq(groups.visibility, 'public')];
  if (input.kind !== undefined) {
    conditions.push(eq(groups.kind, input.kind));
  }
  if (hasQuery) {
    conditions.push(
      or(ilike(handles.handle, `${escapeLike(raw)}%`), ilike(groups.title, `${escapeLike(raw)}%`))!,
    );
  }
  if (before !== null) {
    conditions.push(
      or(
        lt(groups.createdAt, before.createdAt),
        and(eq(groups.createdAt, before.createdAt), lt(groups.id, before.id)),
      )!,
    );
  }

  const rows = await db
    .select({
      id: groups.id,
      kind: groups.kind,
      title: groups.title,
      handle: handles.handle,
      description: groups.description,
      createdAt: groups.createdAt,
    })
    .from(groups)
    .innerJoin(handles, eq(handles.groupId, groups.id))
    .where(and(...conditions))
    .orderBy(desc(groups.createdAt), desc(groups.id))
    .limit(DIRECTORY_PAGE_SIZE + 1);

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

  // T-0165: every entry that already carries a name gets `avatarUrl` when
  // the group has a picture (omitted when none, like today).
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
  // title-prefix, keeping newest-first inside each bucket. The cursor still
  // walks newest-first overall; ranking only reorders the page in memory.
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

// The public group behind one `@handle`: exact, case-insensitive match
// only (like T-0163's user lookup — no prefix search anywhere). A private
// group and an unknown handle answer the same 404, so neither can be
// probed from here.
export async function publicGroupForHandle(
  db: ServerDatabase,
  viewerId: string,
  handle: string,
): Promise<DirectoryEntry> {
  const lower = handle.trim().toLowerCase();
  if (lower === '') {
    throw new HttpError(404, 'not_found', 'No public group with that handle');
  }
  const [row] = await db
    .select({
      id: groups.id,
      kind: groups.kind,
      title: groups.title,
      handle: handles.handle,
      description: groups.description,
      visibility: groups.visibility,
    })
    .from(handles)
    .innerJoin(groups, eq(groups.id, handles.groupId))
    .where(eq(handles.handleLower, lower))
    .limit(1);
  // A handle row for a user is not a group; a group row that is private
  // (invisible while the retire path settles) reads exactly like unknown.
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

// `%`, `_` and the escape char in a query are literal text, never
// wildcards. PostgreSQL `LIKE`/`ILIKE` treat backslash as the escape by
// default, so no `ESCAPE` clause is needed.
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function countMembers(db: ServerDatabase, groupIds: string[]): Promise<Map<string, number>> {
  if (groupIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ groupId: groupMembers.groupId, total: count() })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, [...new Set(groupIds)]))
    .groupBy(groupMembers.groupId);
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
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.userId, viewerId), inArray(groupMembers.groupId, [...new Set(groupIds)])),
    );
  return new Set(rows.map((row) => row.groupId));
}

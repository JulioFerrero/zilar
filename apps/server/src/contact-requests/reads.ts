import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { normalizeHandle } from '@zilar/protocol';
import {
  isContactEffect,
  MAX_LIST_ROWS,
  pendingBetweenEffect,
  profilesByUserEffect,
  toView,
  type ContactRequestRow,
  type ContactRequestsDeps,
  type ContactRequestView,
} from './queries';

// Pending requests, newest first, with name, handle and image; never an email.
// A sender the viewer blocked is never listed, and the profiles resolve in one
// joined query.
export async function listContactRequests(
  deps: ContactRequestsDeps,
  viewerId: string,
): Promise<{ incoming: ContactRequestView[]; outgoing: ContactRequestView[] }> {
  const { blockedSenders, sent, received } = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const blockedSenders = yield* sql<{ blockedUserId: string }>`SELECT blocked_user_id
        FROM user_blocks WHERE user_id = ${viewerId}`;
      const sent = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
        WHERE from_user_id = ${viewerId} AND status = 'pending'
        ORDER BY created_at DESC LIMIT ${MAX_LIST_ROWS}`;
      const received = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
        WHERE to_user_id = ${viewerId} AND status = 'pending'
        ORDER BY created_at DESC LIMIT ${MAX_LIST_ROWS}`;
      return { blockedSenders, sent, received };
    }),
  );
  const blocked = new Set(blockedSenders.map((row) => row.blockedUserId));
  const visibleIncoming = received.filter((row) => !blocked.has(row.fromUserId));
  const rows = [...sent, ...visibleIncoming].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const otherIds = [
    ...new Set(rows.map((row) => (row.fromUserId === viewerId ? row.toUserId : row.fromUserId))),
  ];
  const profileByUser = await runSql(deps.db, profilesByUserEffect(otherIds));
  const incoming: ContactRequestView[] = [];
  const outgoing: ContactRequestView[] = [];
  for (const row of rows) {
    const view = toView(row, viewerId, profileByUser);
    if (row.toUserId === viewerId) {
      incoming.push(view);
    } else {
      outgoing.push(view);
    }
  }
  return { incoming, outgoing };
}

export type ViewerRelation =
  'self' | 'blocked' | 'contact' | 'request_sent' | 'request_received' | 'none';

// `blocked` is checked right after `self` and means the viewer blocked the other
// side. Unknown and retired handles answer the same 404 as `resolveHandleUser`.
export async function relationFor(
  db: ServerDatabase,
  viewerId: string,
  otherId: string,
): Promise<ViewerRelation> {
  if (viewerId === otherId) {
    return 'self';
  }
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [block] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
        WHERE user_id = ${viewerId} AND blocked_user_id = ${otherId} LIMIT 1`;
      if (block) {
        return 'blocked' as const;
      }
      if (yield* isContactEffect(sql, viewerId, otherId)) {
        return 'contact' as const;
      }
      const pending = yield* pendingBetweenEffect(sql, viewerId, otherId);
      if (pending) {
        return pending.fromUserId === viewerId
          ? ('request_sent' as const)
          : ('request_received' as const);
      }
      return 'none' as const;
    }),
  );
}

// The batched form of `relationFor`: the same per-user result, with the three
// probes run once over the whole set, for the people search.
export async function relationsFor(
  db: ServerDatabase,
  viewerId: string,
  otherIds: readonly string[],
): Promise<Map<string, ViewerRelation>> {
  const unique = [...new Set(otherIds)];
  const relations = new Map<string, ViewerRelation>();
  for (const id of unique) {
    if (id === viewerId) {
      relations.set(id, 'self');
    }
  }
  const others = unique.filter((id) => id !== viewerId);
  if (others.length === 0) {
    return relations;
  }
  const { blocked, contacts, pending } = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const blocked = yield* sql<{ userId: string }>`SELECT blocked_user_id AS "userId"
        FROM user_blocks WHERE user_id = ${viewerId} AND blocked_user_id IN ${sql.in(others)}`;
      const contacts = yield* sql<{ userId: string }>`SELECT contact_user_id AS "userId"
        FROM contacts WHERE user_id = ${viewerId} AND contact_user_id IN ${sql.in(others)}`;
      const pending = yield* sql<ContactRequestRow>`SELECT * FROM contact_requests
        WHERE status = 'pending'
          AND ((from_user_id = ${viewerId} AND to_user_id IN ${sql.in(others)})
            OR (to_user_id = ${viewerId} AND from_user_id IN ${sql.in(others)}))`;
      return { blocked, contacts, pending };
    }),
  );
  const blockedIds = new Set(blocked.map((row) => row.userId));
  const contactIds = new Set(contacts.map((row) => row.userId));
  const pendingByOther = new Map<string, ViewerRelation>();
  for (const row of pending) {
    const outgoing = row.fromUserId === viewerId;
    const other = outgoing ? row.toUserId : row.fromUserId;
    pendingByOther.set(other, outgoing ? 'request_sent' : 'request_received');
  }
  for (const id of others) {
    if (blockedIds.has(id)) {
      relations.set(id, 'blocked');
    } else if (contactIds.has(id)) {
      relations.set(id, 'contact');
    } else if (pendingByOther.has(id)) {
      relations.set(id, pendingByOther.get(id) as ViewerRelation);
    } else {
      relations.set(id, 'none');
    }
  }
  return relations;
}

export interface OtherUserProfile {
  userId: string;
  name: string;
  handle: string;
  image: string | null;
  bio?: string;
}

export async function profileForHandle(
  db: ServerDatabase,
  viewerId: string,
  handle: string,
): Promise<OtherUserProfile & { relation: Awaited<ReturnType<typeof relationFor>> }> {
  const lower = normalizeHandle(handle.trim());
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<{
        userId: string;
        handle: string;
        name: string;
        image: string | null;
        bio: string | null;
      }>`SELECT h.user_id, h.handle, u.name, u.image, p.bio
        FROM handles h
        INNER JOIN "user" u ON u.id = h.user_id
        LEFT JOIN user_profiles p ON p.user_id = h.user_id
        WHERE h.handle_lower = ${lower} LIMIT 1`;
      return found ?? null;
    }),
  );
  // An unknown handle and a retired one answer the same 404. So does a handle
  // whose owner blocked the viewer: the account's existence is never revealed.
  if (!row || !row.userId) {
    throw new HttpError(404, 'not_found', 'No user with that username');
  }
  const blockedByTarget = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [block] = yield* sql<{ userId: string }>`SELECT user_id FROM user_blocks
        WHERE user_id = ${row.userId} AND blocked_user_id = ${viewerId} LIMIT 1`;
      return block ?? null;
    }),
  );
  if (blockedByTarget) {
    throw new HttpError(404, 'not_found', 'No user with that username');
  }
  return {
    userId: row.userId,
    name: row.name.trim() === '' ? 'Unnamed user' : row.name,
    handle: row.handle,
    image: row.image,
    relation: await relationFor(db, viewerId, row.userId),
    ...(row.bio === null || row.bio === '' ? {} : { bio: row.bio }),
  };
}

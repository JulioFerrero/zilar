// Contact-request reads (T-0983 size split, moved unchanged from `./service`):
// the list endpoint, the viewer-to-other relation and the by-handle profile.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { normalizeHandle } from '../handles/rules';
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

// Lists the viewer's pending requests, newest first: `{ incoming, outgoing }`
// with the other person's name, handle and image. Never an email. Incoming
// requests from people the viewer blocked are never listed. Names, images
// and handles resolve in ONE joined query over the distinct other ids —
// never one select per row.
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

// The relation between the viewer and the owner of a handle, for
// `GET /api/users/by-handle/:handle`: `self`, `blocked`, `contact`,
// `request_sent`, `request_received` or `none`. `blocked` is checked first
// after `self` and means the viewer blocked the other side. Unknown and
// retired handles answer the same 404 as `resolveHandleUser`.
export async function relationFor(
  db: ServerDatabase,
  viewerId: string,
  otherId: string,
): Promise<'self' | 'blocked' | 'contact' | 'request_sent' | 'request_received' | 'none'> {
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

export interface OtherUserProfile {
  userId: string;
  name: string;
  handle: string;
  image: string | null;
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
      }>`SELECT h.user_id, h.handle, u.name, u.image
        FROM handles h
        INNER JOIN "user" u ON u.id = h.user_id
        WHERE h.handle_lower = ${lower} LIMIT 1`;
      return found ?? null;
    }),
  );
  // Reuse the row just read: an unknown handle and a retired handle answer
  // the same 404. So does a handle whose owner blocked the viewer: the
  // blocked person is never told the account exists.
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
  };
}

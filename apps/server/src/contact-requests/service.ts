// Contact requests (T-0163): adding by `@username` sends a request the
// other person must accept. Unknown handles, retired handles and
// not-allowed requests answer the same 404 wherever specified.

import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { SetupTransaction } from '../setup/settings';
import { contactRequests, contacts, handles, user, userBlocks } from '../db/schema';
import { HttpError } from '../errors';
import { addContactPair, syncRoster } from '../contacts/service';
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
}

// Any database the handle/contact reads accept: the plain db or a
// transaction cast (the codebase precedent: `tx as unknown as
// ServerDatabase`). Lets callers re-resolve under their locks.
export type TxDatabase = ServerDatabase | SetupTransaction;

// Resolves an exact, case-insensitive handle to its user row. Unknown and
// retired handles answer the same 404 `not_found`, so failures never reveal
// which one it was. There is deliberately no prefix or partial search.
// Takes any queryable (the plain db or a transaction) so callers can
// re-resolve under their locks.
export async function resolveHandleUser(db: TxDatabase, handle: string): Promise<{ id: string }> {
  const [row] = await db
    .select({ userId: handles.userId })
    .from(handles)
    .where(eq(handles.handleLower, normalizeHandle(handle.trim())))
    .limit(1);
  if (!row || !row.userId) {
    throw new HttpError(404, 'not_found', 'No user with that username');
  }
  return { id: row.userId };
}

function serviceNow(deps: ContactRequestsDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

function auditFor(
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

async function isContact(db: ServerDatabase, userId: string, otherId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: contacts.userId })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.contactUserId, otherId)))
    .limit(1);
  return row !== undefined;
}

async function pendingBetween(
  db: ServerDatabase,
  firstId: string,
  secondId: string,
): Promise<ContactRequestRow | null> {
  // Two plain equality predicates, no raw SQL: PGlite's parameter binding
  // inside template-literal fragments can misbehave under transactions.
  const [forward] = await db
    .select()
    .from(contactRequests)
    .where(
      and(
        eq(contactRequests.fromUserId, firstId),
        eq(contactRequests.toUserId, secondId),
        eq(contactRequests.status, 'pending'),
      ),
    )
    .limit(1);
  if (forward) {
    return forward as ContactRequestRow;
  }
  const [reverse] = await db
    .select()
    .from(contactRequests)
    .where(
      and(
        eq(contactRequests.fromUserId, secondId),
        eq(contactRequests.toUserId, firstId),
        eq(contactRequests.status, 'pending'),
      ),
    )
    .limit(1);
  return (reverse as ContactRequestRow | undefined) ?? null;
}

// Creates a pending request `fromId -> handle`. Refuses: to yourself (400),
// to an existing contact (409 `already_contact`), a duplicate pending
// request in either direction (409 `request_exists` — the reverse request is
// returned so the web can offer "Accept"), more than 20 pending outgoing
// (429), a re-request within 7 days after a decline (429
// `declined_recently`). The target-handle resolve, the contact check, the
// duplicate and cooldown reads, the outgoing-cap count and the insert all
// run in one transaction under the per-sender advisory lock, so the check-
// then-act cannot double-create under concurrency and a racing accept
// cannot leave a stale pending row behind: the in-transaction contact read
// sees the committed pair.
//
// Race recovery lives OUTSIDE the transaction (see below): on real Postgres
// a unique violation aborts the tx, so any read issued on it afterwards
// fails with 25P02. The same-direction backstop is the partial unique
// index, the opposite-direction backstop is the unordered-pair index.
export async function createContactRequest(
  deps: ContactRequestsDeps,
  fromId: string,
  handle: string,
): Promise<{ request: ContactRequestRow; reverseOf?: ContactRequestRow }> {
  const now = serviceNow(deps);

  let targetId: string | undefined;
  try {
    const created = await deps.db.transaction(async (tx) => {
      const txDb = tx as unknown as ServerDatabase;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'contact-sender:' + fromId}))`);
      // The handle is resolved INSIDE the transaction, under the sender lock:
      // a handle that moved (or an account deleted) between the HTTP layer
      // and here must answer the same 404, never a 500 from a dangling FK
      // insert. Reads through the transaction object go over the same single
      // connection, so no second lock is held while waiting (PGlite has one
      // connection per database: two concurrent advisory takes on it would
      // self-deadlock, which is why the per-pair key below is folded into the
      // sender lock's critical section instead of a second take).
      const target = await resolveHandleUser(txDb, handle);
      targetId = target.id;
      if (target.id === fromId) {
        throw new HttpError(400, 'invalid_request', 'You cannot add yourself');
      }
      // Block effects are silent: when the target blocked the sender, the
      // request is stored `declined` but answers exactly like a normal new
      // request (the route still returns 201 with `status: pending` to the
      // sender). When the sender blocked the target, they must unblock
      // first (409 `blocked`).
      const [blockedByTarget] = await txDb
        .select({ userId: userBlocks.userId })
        .from(userBlocks)
        .where(and(eq(userBlocks.userId, target.id), eq(userBlocks.blockedUserId, fromId)))
        .limit(1);
      const [blockedBySender] = await txDb
        .select({ userId: userBlocks.userId })
        .from(userBlocks)
        .where(and(eq(userBlocks.userId, fromId), eq(userBlocks.blockedUserId, target.id)))
        .limit(1);
      if (blockedBySender) {
        throw new HttpError(409, 'blocked', 'Unblock this person first');
      }
      const silentDecline = blockedByTarget !== undefined;
      // The duplicate check serializes on the sender lock taken above (same
      // critical section as the cap count), so no second lock order exists
      // to deadlock.

      if (await isContact(txDb, fromId, target.id)) {
        throw new HttpError(409, 'already_contact', 'You are already contacts');
      }

      const outgoingFirst = await pendingBetween(txDb, fromId, target.id);
      if (outgoingFirst && outgoingFirst.fromUserId === fromId) {
        throw new HttpError(409, 'request_exists', 'A request is already pending');
      }
      if (outgoingFirst) {
        // The other side already asked: answer with that request so the web
        // can offer "Accept" instead of creating a second row.
        return { request: outgoingFirst, reverseOf: outgoingFirst };
      }

      const [outgoing] = await tx
        .select({ total: count() })
        .from(contactRequests)
        .where(and(eq(contactRequests.fromUserId, fromId), eq(contactRequests.status, 'pending')));
      if (Number(outgoing?.total ?? 0) >= MAX_PENDING_OUTGOING) {
        throw new HttpError(429, 'too_many_requests', 'Too many pending requests');
      }

      // The 7-day re-request cooldown: the single most recent decline of
      // this exact direction (`orderBy decidedAt desc limit 1` — no
      // unbounded read), INSIDE the transaction like every other row this
      // decision depends on. Silent declines (the target blocked the sender)
      // skip it: they must keep answering like fresh requests, never 429.
      if (!silentDecline) {
        const [lastDeclined] = await txDb
          .select({ decidedAt: contactRequests.decidedAt })
          .from(contactRequests)
          .where(
            and(
              eq(contactRequests.fromUserId, fromId),
              eq(contactRequests.toUserId, target.id),
              eq(contactRequests.status, 'declined'),
            ),
          )
          .orderBy(desc(contactRequests.decidedAt))
          .limit(1);
        if (
          lastDeclined?.decidedAt &&
          now.getTime() - lastDeclined.decidedAt.getTime() <
            RE_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
        ) {
          throw new HttpError(429, 'declined_recently', 'That request was declined recently');
        }
      }

      const [row] = await tx
        .insert(contactRequests)
        .values(
          silentDecline
            ? {
                id: randomUUID(),
                fromUserId: fromId,
                toUserId: target.id,
                status: 'declined',
                createdAt: now,
                decidedAt: now,
              }
            : { id: randomUUID(), fromUserId: fromId, toUserId: target.id, createdAt: now },
        )
        .returning();
      if (!row) {
        throw new Error('contact request insert returned no row');
      }
      return { request: row as ContactRequestRow };
    });
    // Audited after the commit: a rolled-back create leaves no audit row.
    // Only a fresh row has no `reverseOf`.
    if (created.reverseOf === undefined) {
      auditFor(deps, 'contact_request.created', fromId, created.request.id);
    }
    // Silent to the sender: a request stored `declined` because the target
    // blocked them answers like a normal new pending request — `pending`
    // with no `decidedAt` — while the stored row stays `declined`.
    if (created.request.status === 'declined') {
      return {
        ...created,
        request: { ...created.request, status: 'pending' as const, decidedAt: null },
      };
    }
    return created;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    // A concurrent create won the race and this transaction aborted with a
    // unique violation (on real Postgres the tx is dead from here on, so
    // the recovery reads MUST use `deps.db`, a fresh connection — never the
    // aborted tx). Same-direction loser: the partial unique index fired.
    // Opposite-direction loser: the unordered-pair index fired. Either way
    // re-read the authoritative row outside and answer like the pre-check:
    // the reverse-direction loser returns the winner's row so its caller
    // can offer "Accept" exactly like the serial reverse case.
    if (!isPendingPairViolation(error) || targetId === undefined) {
      throw error;
    }
    const [raced] = await deps.db
      .select()
      .from(contactRequests)
      .where(
        and(
          eq(contactRequests.fromUserId, fromId),
          eq(contactRequests.toUserId, targetId),
          eq(contactRequests.status, 'pending'),
        ),
      )
      .limit(1);
    if (raced) {
      throw new HttpError(409, 'request_exists', 'A request is already pending');
    }
    const reverse = await pendingBetween(deps.db, fromId, targetId);
    if (reverse && reverse.fromUserId !== fromId) {
      return { request: reverse, reverseOf: reverse };
    }
    if (reverse) {
      throw new HttpError(409, 'request_exists', 'A request is already pending');
    }
    throw error;
  }
}

// Whether `error` is a unique violation on one of the pending-request
// indexes: SQLSTATE 23505 surfaced through Drizzle's wrapped driver error
// (walk the `cause` chain; the code may sit nested), optionally narrowed by
// constraint name. Matched by code/constraint — never by message text.
export function isPendingPairViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return (
        record.constraint === undefined ||
        record.constraint === 'contact_requests_pending_idx' ||
        record.constraint === 'contact_requests_pending_pair_idx'
      );
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}

function toView(
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

// Lists the viewer's pending requests, newest first: `{ incoming, outgoing }`
// with the other person's name, handle and image. Never an email. Incoming
// requests from people the viewer blocked are never listed. Names, images
// and handles resolve in ONE joined query over the distinct other ids —
// never one select per row.
export async function listContactRequests(
  deps: ContactRequestsDeps,
  viewerId: string,
): Promise<{ incoming: ContactRequestView[]; outgoing: ContactRequestView[] }> {
  const [blockedSenders, sent, received] = await Promise.all([
    deps.db
      .select({ blockedUserId: userBlocks.blockedUserId })
      .from(userBlocks)
      .where(eq(userBlocks.userId, viewerId)),
    deps.db
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.fromUserId, viewerId), eq(contactRequests.status, 'pending')))
      .orderBy(desc(contactRequests.createdAt))
      .limit(MAX_LIST_ROWS),
    deps.db
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.toUserId, viewerId), eq(contactRequests.status, 'pending')))
      .orderBy(desc(contactRequests.createdAt))
      .limit(MAX_LIST_ROWS),
  ]);
  const blocked = new Set(blockedSenders.map((row) => row.blockedUserId));
  const visibleIncoming = (received as ContactRequestRow[]).filter(
    (row) => !blocked.has(row.fromUserId),
  );
  const rows = [...(sent as ContactRequestRow[]), ...visibleIncoming].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const otherIds = [
    ...new Set(rows.map((row) => (row.fromUserId === viewerId ? row.toUserId : row.fromUserId))),
  ];
  const profileByUser = await profilesByUser(deps.db, otherIds);
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

// One joined query for every distinct other party: display name + image
// from `user`, handle from `handles`. Missing users (deleted between the
// list read and here — nearly impossible inside one request) fall back to
// the `toView` defaults.
async function profilesByUser(
  db: ServerDatabase,
  otherIds: string[],
): Promise<Map<string, { name: string; image: string | null; handle: string | null }>> {
  const byUser = new Map<string, { name: string; image: string | null; handle: string | null }>();
  if (otherIds.length === 0) {
    return byUser;
  }
  const rows = await db
    .select({ userId: user.id, name: user.name, image: user.image, handle: handles.handle })
    .from(user)
    .leftJoin(handles, eq(handles.userId, user.id))
    .where(inArray(user.id, [...new Set(otherIds)]));
  for (const row of rows) {
    const name = row.name.trim() === '' ? 'Unnamed user' : row.name;
    byUser.set(row.userId, { name, image: row.image, handle: row.handle });
  }
  return byUser;
}

async function findActionable(
  db: ServerDatabase,
  id: string,
  viewerId: string,
  side: 'to' | 'from',
): Promise<ContactRequestRow | null> {
  const [row] = await db
    .select()
    .from(contactRequests)
    .where(
      and(
        eq(contactRequests.id, id),
        side === 'to'
          ? eq(contactRequests.toUserId, viewerId)
          : eq(contactRequests.fromUserId, viewerId),
      ),
    )
    .limit(1);
  return (row as ContactRequestRow | undefined) ?? null;
}

// Accepts a request (recipient only). The status flip runs in a transaction
// under a per-request advisory lock, so a double click flips once and a
// failure before the flip leaves nothing behind. The contact-pair creation
// and roster sync follow outside the transaction but are idempotent: every
// re-accept of an `accepted` row re-runs them, so a half-finished first
// accept (flipped but pair missing) repairs on retry.
// Creates the mutual contact exactly like an invite does (the shared
// `addContactPair` + roster sync with the same retry).
export async function acceptContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  const existing = await findActionable(deps.db, id, viewerId, 'to');
  if (!existing) {
    throw notFound();
  }
  if (existing.status !== 'pending' && existing.status !== 'accepted') {
    throw notFound();
  }
  const now = serviceNow(deps);

  let flippedNow = false;
  const settled = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'contact-accept:' + id}))`);

    const [current] = await tx
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.id, id), eq(contactRequests.toUserId, viewerId)))
      .limit(1);
    if (!current) {
      throw notFound();
    }
    const currentRow = current as ContactRequestRow;
    if (currentRow.status !== 'pending' && currentRow.status !== 'accepted') {
      throw notFound();
    }
    if (currentRow.status === 'pending') {
      const [flipped] = await tx
        .update(contactRequests)
        .set({ status: 'accepted', decidedAt: now })
        .where(and(eq(contactRequests.id, id), eq(contactRequests.status, 'pending')))
        .returning();
      if (!flipped) {
        // A concurrent decision won the race: re-read so an accepted row
        // still answers idempotently instead of 404ing.
        const [raced] = await tx
          .select()
          .from(contactRequests)
          .where(eq(contactRequests.id, id))
          .limit(1);
        if (raced && (raced.status as string) === 'accepted') {
          return raced as ContactRequestRow;
        }
        throw notFound();
      }
      flippedNow = true;
      return flipped as ContactRequestRow;
    }
    return currentRow;
  });

  // Idempotent repair: re-runs on every accept of an accepted row, so a
  // half-finished first accept (pair missing, roster unsynced) heals.
  await addContactPair(deps.db, {
    userId: settled.fromUserId,
    contactUserId: settled.toUserId,
    source: 'manual',
  });
  if (deps.adminClient && deps.domain) {
    await syncRoster(deps.db, deps.adminClient, deps.domain, settled.fromUserId);
    await syncRoster(deps.db, deps.adminClient, deps.domain, settled.toUserId);
  }
  // Audited once, after the commit and the pair write, by the call that
  // actually flipped the row; an idempotent re-accept adds nothing.
  if (flippedNow) {
    auditFor(deps, 'contact_request.accepted', viewerId, settled.id);
  }
  return settled;
}

async function decideContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
  status: 'declined' | 'cancelled',
  side: 'to' | 'from',
  auditAction: string,
): Promise<ContactRequestRow> {
  const existing = await findActionable(deps.db, id, viewerId, side);
  if (!existing || existing.status !== 'pending') {
    throw notFound();
  }
  const now = serviceNow(deps);
  const [row] = await deps.db
    .update(contactRequests)
    .set({ status, decidedAt: now })
    .where(and(eq(contactRequests.id, id), eq(contactRequests.status, 'pending')))
    .returning();
  if (!row) {
    throw notFound();
  }
  auditFor(deps, auditAction, viewerId, row.id);
  return row as ContactRequestRow;
}

// Declines a request (recipient only). A request the caller may not act on
// and an unknown id answer the same 404.
export async function declineContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  return decideContactRequest(deps, id, viewerId, 'declined', 'to', 'contact_request.declined');
}

// Cancels a request (sender only). A request the caller may not act on and
// an unknown id answer the same 404.
export async function cancelContactRequest(
  deps: ContactRequestsDeps,
  id: string,
  viewerId: string,
): Promise<ContactRequestRow> {
  return decideContactRequest(deps, id, viewerId, 'cancelled', 'from', 'contact_request.cancelled');
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
  const [block] = await db
    .select({ userId: userBlocks.userId })
    .from(userBlocks)
    .where(and(eq(userBlocks.userId, viewerId), eq(userBlocks.blockedUserId, otherId)))
    .limit(1);
  if (block) {
    return 'blocked';
  }
  if (await isContact(db, viewerId, otherId)) {
    return 'contact';
  }
  const pending = await pendingBetween(db, viewerId, otherId);
  if (pending) {
    return pending.fromUserId === viewerId ? 'request_sent' : 'request_received';
  }
  return 'none';
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
  const [row] = await db
    .select({ userId: handles.userId, handle: handles.handle, name: user.name, image: user.image })
    .from(handles)
    .innerJoin(user, eq(user.id, handles.userId))
    .where(eq(handles.handleLower, lower))
    .limit(1);
  // Reuse the row just read: an unknown handle and a retired handle answer
  // the same 404. So does a handle whose owner blocked the viewer: the
  // blocked person is never told the account exists.
  if (!row || !row.userId) {
    throw new HttpError(404, 'not_found', 'No user with that username');
  }
  const [blockedByTarget] = await db
    .select({ userId: userBlocks.userId })
    .from(userBlocks)
    .where(and(eq(userBlocks.userId, row.userId), eq(userBlocks.blockedUserId, viewerId)))
    .limit(1);
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

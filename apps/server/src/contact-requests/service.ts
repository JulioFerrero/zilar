// Contact requests (T-0163): adding by `@username` sends a request the
// other person must accept. Unknown handles, retired handles and
// not-allowed requests answer the same 404 wherever specified.

import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { contactRequests, contacts, handles } from '../db/schema';
import { HttpError } from '../errors';
import { addContactPair, syncRoster } from '../contacts/service';
import { normalizeHandle } from '../handles/rules';
import { displayNameFor, handleUserIdFor } from '../handles/store';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

export const MAX_PENDING_OUTGOING = 20;
export const RE_REQUEST_COOLDOWN_DAYS = 7;

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

// Resolves an exact, case-insensitive handle to its user row. Unknown and
// retired handles answer the same 404 `not_found`, so failures never reveal
// which one it was. There is deliberately no prefix or partial search.
export async function resolveHandleUser(
  db: ServerDatabase,
  handle: string,
): Promise<{ id: string }> {
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
// `declined_recently`). The contact check, the duplicate and cooldown reads
// plus the insert run in one transaction under a per-pair advisory lock, so
// a racing accept (which deletes no rows but flips no pending row either —
// it only touches pending rows) cannot leave a stale pending row behind:
// the in-transaction contact read sees the committed pair.
export async function createContactRequest(
  deps: ContactRequestsDeps,
  fromId: string,
  handle: string,
): Promise<{ request: ContactRequestRow; reverseOf?: ContactRequestRow }> {
  const now = serviceNow(deps);
  const target = await resolveHandleUser(deps.db, handle);
  if (target.id === fromId) {
    throw new HttpError(400, 'invalid_request', 'You cannot add yourself');
  }

  const pair = [fromId, target.id].sort().join(':');

  return deps.db.transaction(async (tx) => {
    const txDb = tx as unknown as ServerDatabase;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'contact-request:' + pair}))`);

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

    // The 7-day re-request cooldown: the most recent decline of this
    // exact direction, read INSIDE the transaction like every other row
    // this decision depends on (it is the committed history the insert
    // below must respect).
    const recentDeclines = await txDb
      .select()
      .from(contactRequests)
      .where(
        and(
          eq(contactRequests.fromUserId, fromId),
          eq(contactRequests.toUserId, target.id),
          eq(contactRequests.status, 'declined'),
        ),
      );
    const latestDeclinedAt = recentDeclines
      .map((row) => row.decidedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
    if (
      latestDeclinedAt !== Number.NEGATIVE_INFINITY &&
      now.getTime() - latestDeclinedAt < RE_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    ) {
      throw new HttpError(429, 'declined_recently', 'That request was declined recently');
    }

    try {
      const [row] = await tx
        .insert(contactRequests)
        .values({ id: randomUUID(), fromUserId: fromId, toUserId: target.id, createdAt: now })
        .returning();
      if (!row) {
        throw new Error('contact request insert returned no row');
      }
      auditFor(deps, 'contact_request.created', fromId, row.id);
      return { request: row as ContactRequestRow };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      // A concurrent create won the race on the partial unique index: the
      // in-transaction read above missed it. Answer like the pre-check.
      const [raced] = await tx
        .select()
        .from(contactRequests)
        .where(
          and(
            eq(contactRequests.fromUserId, fromId),
            eq(contactRequests.toUserId, target.id),
            eq(contactRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (raced) {
        throw new HttpError(409, 'request_exists', 'A request is already pending');
      }
      throw error;
    }
  });
}

async function toView(
  db: ServerDatabase,
  row: ContactRequestRow,
  viewerId: string,
  handleByUser: Map<string, string>,
): Promise<ContactRequestView> {
  const otherId = row.fromUserId === viewerId ? row.toUserId : row.fromUserId;
  const profile = await displayNameFor(db, otherId);
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    other: {
      userId: otherId,
      name: profile.name,
      handle: handleByUser.get(otherId) ?? null,
      image: profile.image,
    },
  };
}

// Lists the viewer's pending requests, newest first: `{ incoming, outgoing }`
// with the other person's name, handle and image. Never an email.
export async function listContactRequests(
  deps: ContactRequestsDeps,
  viewerId: string,
): Promise<{ incoming: ContactRequestView[]; outgoing: ContactRequestView[] }> {
  const sent = (await deps.db
    .select()
    .from(contactRequests)
    .where(and(eq(contactRequests.fromUserId, viewerId), eq(contactRequests.status, 'pending')))
    .orderBy(desc(contactRequests.createdAt))) as ContactRequestRow[];
  const received = (await deps.db
    .select()
    .from(contactRequests)
    .where(and(eq(contactRequests.toUserId, viewerId), eq(contactRequests.status, 'pending')))
    .orderBy(desc(contactRequests.createdAt))) as ContactRequestRow[];
  const rows = [...sent, ...received].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const otherIds = [
    ...new Set(rows.map((row) => (row.fromUserId === viewerId ? row.toUserId : row.fromUserId))),
  ];
  const handleByUser = await handleUserIdFor(deps.db, otherIds);
  const incoming: ContactRequestView[] = [];
  const outgoing: ContactRequestView[] = [];
  for (const row of rows) {
    const view = await toView(deps.db, row, viewerId, handleByUser);
    if (row.toUserId === viewerId) {
      incoming.push(view);
    } else {
      outgoing.push(view);
    }
  }
  return { incoming, outgoing };
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

// Accepts a request (recipient only). The status flip and the contact-pair
// creation share one transaction under a per-request advisory lock, so a
// failure after the claim refunds it (the transaction rolls back). The
// conditional update on `status = 'pending'` keeps a double click to one
// flip; a re-accept of an `accepted` request re-runs `addContactPair` and
// the roster sync idempotently, so it repairs a half-finished accept.
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
      auditFor(deps, 'contact_request.accepted', viewerId, (flipped as ContactRequestRow).id);
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
// `GET /api/users/by-handle/:handle`: `self`, `contact`, `request_sent`,
// `request_received` or `none`. Unknown and retired handles answer the same
// 404 as `resolveHandleUser`.
export async function relationFor(
  db: ServerDatabase,
  viewerId: string,
  otherId: string,
): Promise<'self' | 'contact' | 'request_sent' | 'request_received' | 'none'> {
  if (viewerId === otherId) {
    return 'self';
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
  const target = await resolveHandleUser(db, handle);
  const [row] = await db
    .select()
    .from(handles)
    .where(eq(handles.handleLower, normalizeHandle(handle.trim())))
    .limit(1);
  const profile = await displayNameFor(db, target.id);
  return {
    userId: target.id,
    name: profile.name.trim() === '' ? 'Unnamed user' : profile.name,
    handle: row?.handle ?? handle.trim(),
    image: profile.image,
    relation: await relationFor(db, viewerId, target.id),
  };
}

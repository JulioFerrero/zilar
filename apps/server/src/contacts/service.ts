// Contacts and the XMPP roster sync. Every query runs on the `effect/sql`
// client registered for this database (see `../effect/sql`). The exported
// functions stay `async` so routes and tests keep their shape.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { findInviteByCode } from '../auth/invites';

// The XMPP roster group every Zilar contact goes into.
export const ROSTER_GROUP = 'Zilar';

// Shown for contacts who never set a display name. Never an email: a contact's
// email must not leak into another user's chat list.
export const UNNAMED_CONTACT_NAME = 'Unnamed user';

export type ContactSource = 'invite' | 'manual';

export interface Contact {
  userId: string;
  name: string;
  jid: string;
  // T-0165: a stored picture wins over `user.image`; without a row the
  // existing `user.image` value is kept.
  avatarUrl?: string | undefined;
  /** The contact's `@username`, when they have one (T-0163). */
  handle?: string | null;
}

export interface AddContactPairInput {
  userId: string;
  contactUserId: string;
  source: ContactSource;
}

// Creates both directions of a contact relationship. Idempotent, so calling it
// again for an existing pair changes nothing.
export async function addContactPair(
  db: ServerDatabase,
  input: AddContactPairInput,
): Promise<void> {
  if (input.userId === input.contactUserId) {
    return;
  }
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO contacts (user_id, contact_user_id, source)
        VALUES (${input.userId}, ${input.contactUserId}, ${input.source}),
               (${input.contactUserId}, ${input.userId}, ${input.source})
        ON CONFLICT DO NOTHING`;
    }),
  );
}

interface ContactListRow {
  userId: string;
  name: string;
  image: string | null;
  jid: string | null;
  handle: string | null;
}

export async function listContacts(
  db: ServerDatabase,
  userId: string,
  domain: string,
): Promise<Contact[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ContactListRow>`SELECT c.contact_user_id AS user_id, u.name, u.image,
          x.jid, h.handle
        FROM contacts c
        INNER JOIN "user" u ON u.id = c.contact_user_id
        LEFT JOIN xmpp_accounts x ON x.user_id = c.contact_user_id
        LEFT JOIN handles h ON h.user_id = c.contact_user_id
        WHERE c.user_id = ${userId}
        ORDER BY u.name ASC`;
    }),
  );

  // The avatar is read by joining `avatars` at read time: a stored
  // picture wins (`/api/avatars/<id>`), otherwise the existing
  // `user.image` value is kept (Better Auth's table is untouched).
  const avatarIds = await avatarIdsByOwner(
    db,
    'user',
    rows.map((row) => row.userId),
  );

  const mapped = rows.map((row) => ({
    contact: {
      userId: row.userId,
      name: row.name.trim() === '' ? UNNAMED_CONTACT_NAME : row.name,
      jid: row.jid ?? jidFor(localpartFor(row.userId), domain),
      ...(row.image ? { avatarUrl: row.image } : {}),
      ...(avatarIds.get(row.userId) === undefined
        ? {}
        : { avatarUrl: avatarUrlFor(avatarIds.get(row.userId)!) }),
      ...(row.handle ? { handle: row.handle } : {}),
    } satisfies Contact,
    unnamed: row.name.trim() === '',
  }));

  // The SQL order puts blank names first. Keep named contacts in their SQL
  // order and move unnamed ones after, preserving relative order (stable).
  return [...mapped.filter((row) => !row.unnamed), ...mapped.filter((row) => row.unnamed)].map(
    (row) => row.contact,
  );
}

export interface RosterSyncResult {
  synced: number;
  pending: number;
  ok: boolean;
}

interface PendingRosterRow {
  contactUserId: string;
  name: string;
  jid: string | null;
}

// Adds every not-yet-synced contact of `userId` to that user's XMPP roster.
// A failure (for example ejabberd is down) leaves the rows `roster_synced`
// false and stops early, so a later call can retry. It never throws for an
// admin-client error: the caller decides whether the failure matters.
export async function syncRoster(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  domain: string,
  userId: string,
): Promise<RosterSyncResult> {
  const pending = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PendingRosterRow>`SELECT c.contact_user_id, u.name, x.jid
        FROM contacts c
        INNER JOIN "user" u ON u.id = c.contact_user_id
        LEFT JOIN xmpp_accounts x ON x.user_id = c.contact_user_id
        WHERE c.user_id = ${userId} AND c.roster_synced = false`;
    }),
  );

  const localpart = localpartFor(userId);
  let synced = 0;

  for (const row of pending) {
    const contactJid = row.jid ?? jidFor(localpartFor(row.contactUserId), domain);
    try {
      await adminClient.addRosterItem(localpart, contactJid, {
        nick: row.name,
        groups: [ROSTER_GROUP],
        subs: 'both',
      });
    } catch {
      return { synced, pending: pending.length - synced, ok: false };
    }
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE contacts SET roster_synced = true
          WHERE user_id = ${userId} AND contact_user_id = ${row.contactUserId}`;
      }),
    );
    synced += 1;
  }

  return { synced, pending: 0, ok: true };
}

export interface RosterNicknameResult {
  updated: number;
  pending: number;
  ok: boolean;
}

// After a user changes their display name, the nickname in every contact's
// roster must follow: the item that matters is the one where this user is the
// contact, owned by each of their contacts. Every row is marked unsynced
// first, so if ejabberd fails, `syncRoster` fixes it on the contact's next
// token request using the user's current display name.
export async function refreshRosterNicknames(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  domain: string,
  userId: string,
  name: string,
): Promise<RosterNicknameResult> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ ownerId: string }>`SELECT c.user_id AS owner_id
        FROM contacts c WHERE c.contact_user_id = ${userId}`;
    }),
  );
  if (rows.length === 0) {
    return { updated: 0, pending: 0, ok: true };
  }

  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE contacts SET roster_synced = false WHERE contact_user_id = ${userId}`;
    }),
  );

  const [account] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ jid: string }>`SELECT jid FROM xmpp_accounts
        WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  const jid = account?.jid ?? jidFor(localpartFor(userId), domain);

  let updated = 0;
  for (const row of rows) {
    try {
      await adminClient.addRosterItem(localpartFor(row.ownerId), jid, {
        nick: name,
        groups: [ROSTER_GROUP],
        subs: 'both',
      });
    } catch {
      return { updated, pending: rows.length - updated, ok: false };
    }
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE contacts SET roster_synced = true
          WHERE user_id = ${row.ownerId} AND contact_user_id = ${userId}`;
      }),
    );
    updated += 1;
  }

  return { updated, pending: 0, ok: true };
}

export interface SetUpContactsInput {
  userId: string;
  inviteCode: string;
}

// Runs after a new user is created: records which invite they came from and,
// when that invite had a creator, makes the inviter and the new user contacts
// and pushes the two roster items. Roster failures are not fatal: the rows
// stay with `roster_synced = false` and the token endpoint retries.
export async function setUpContactsFromInvite(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  domain: string,
  input: SetUpContactsInput,
): Promise<void> {
  const invite = await findInviteByCode(db, input.inviteCode);
  if (!invite) {
    return;
  }

  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO user_invites (user_id, invite_id, invited_by)
        VALUES (${input.userId}, ${invite.id}, ${invite.createdBy ?? null})
        ON CONFLICT DO NOTHING`;
    }),
  );

  const inviterId = invite.createdBy;
  if (!inviterId || inviterId === input.userId) {
    return;
  }

  await addContactPair(db, {
    userId: input.userId,
    contactUserId: inviterId,
    source: 'invite',
  });
  await syncRoster(db, adminClient, domain, input.userId);
  await syncRoster(db, adminClient, domain, inviterId);
}

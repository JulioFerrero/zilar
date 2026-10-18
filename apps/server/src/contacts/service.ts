import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { findInviteByCode } from '../auth/invites';
import { removePairRosterItems, type RosterLogger } from '../blocks/roster';

export const ROSTER_GROUP = 'Zilar';

// Shown for contacts with no display name. Never an email: it must not leak into
// another user's chat list.
export const UNNAMED_CONTACT_NAME = 'Unnamed user';

export type ContactSource = 'invite' | 'manual';

export interface Contact {
  userId: string;
  name: string;
  jid: string;
  // A stored picture wins over `user.image`; without a row the existing value is kept.
  avatarUrl?: string | undefined;
  handle?: string | null;
}

export interface AddContactPairInput {
  userId: string;
  contactUserId: string;
  source: ContactSource;
}

// Runs on the caller's connection so a caller holding a transaction can use its locks.
export function addContactPairEffect(
  sql: SqlClient.SqlClient,
  input: AddContactPairInput,
): Effect.Effect<void, SqlError.SqlError> {
  if (input.userId === input.contactUserId) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    yield* sql`INSERT INTO contacts (user_id, contact_user_id, source)
      VALUES (${input.userId}, ${input.contactUserId}, ${input.source}),
             (${input.contactUserId}, ${input.userId}, ${input.source})
      ON CONFLICT DO NOTHING`;
  });
}

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
      yield* addContactPairEffect(sql, input);
    }),
  );
}

export interface RemoveContactDeps {
  db: ServerDatabase;
  audit?: AuditRecorder;
  adminClient?: EjabberdAdminClient | undefined;
  domain?: string | undefined;
  logger?: RosterLogger | undefined;
}

// Removes a contact in both directions; an unknown target answers 404 first. The
// accepted request is cancelled under the pair locks, and roster items are removed after
// the commit, best effort.
export async function removeContact(
  deps: RemoveContactDeps,
  userId: string,
  targetId: string,
): Promise<void> {
  const deleted = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          // The same sorted pair keys as the accept repair, so a re-accept cannot insert
          // the pair after this delete commits.
          const [lockLow, lockHigh] = [userId, targetId].sort();
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'user-block:' + lockLow}))`;
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'user-block:' + lockHigh}))`;
          const rows = yield* sql<{ userId: string }>`DELETE FROM contacts
            WHERE (user_id = ${userId} AND contact_user_id = ${targetId})
              OR (user_id = ${targetId} AND contact_user_id = ${userId})
            RETURNING user_id`;
          if (rows.length === 0) {
            return rows;
          }
          // An accepted request left behind could be re-accepted, and the repair would
          // re-add the pair.
          yield* sql`UPDATE contact_requests
            SET status = 'cancelled', decided_at = ${new Date().toISOString()}
            WHERE status = 'accepted'
              AND ((from_user_id = ${userId} AND to_user_id = ${targetId})
                OR (from_user_id = ${targetId} AND to_user_id = ${userId}))`;
          return rows;
        }),
      );
    }),
  );
  if (deleted.length === 0) {
    throw new HttpError(404, 'not_found', 'Contact not found');
  }
  // Audited after the commit; ids only, never names.
  void deps.audit?.record({
    actorUserId: userId,
    aiId: null,
    groupId: null,
    action: 'contact.removed',
    subjectId: targetId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: null,
  });
  if (deps.adminClient !== undefined && deps.domain !== undefined) {
    await removePairRosterItems({
      db: deps.db,
      adminClient: deps.adminClient,
      domain: deps.domain,
      logger: deps.logger,
      userId,
      targetId,
    });
  }
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
      // A contact accepted between blocks (or written by an older version) must still not
      // show on either side.
      return yield* sql<ContactListRow>`SELECT c.contact_user_id AS user_id, u.name, u.image,
          x.jid, h.handle
        FROM contacts c
        INNER JOIN "user" u ON u.id = c.contact_user_id
        LEFT JOIN xmpp_accounts x ON x.user_id = c.contact_user_id
        LEFT JOIN handles h ON h.user_id = c.contact_user_id
        WHERE c.user_id = ${userId}
          AND NOT EXISTS (SELECT 1 FROM user_blocks b
            WHERE (b.user_id = ${userId} AND b.blocked_user_id = c.contact_user_id)
               OR (b.user_id = c.contact_user_id AND b.blocked_user_id = ${userId}))
        ORDER BY u.name ASC`;
    }),
  );

  // The avatar is joined at read time: a stored picture wins, otherwise `user.image`.
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

  // The SQL order puts blank names first. Keep the stable SQL order, unnamed contacts
  // last.
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

// Adds every not-yet-synced contact to the user's XMPP roster. A failure leaves the rows
// `roster_synced` false and stops early so a later call retries; an admin-client error
// never throws, the caller decides.
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

// After a display-name change every contact's roster nickname must follow: mark every
// row unsynced first, so if ejabberd fails `syncRoster` fixes it on the contact's next
// token request with the current name.
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

// After a new user is created: record the invite and, when it had a creator, make the
// inviter and the new user contacts and push both roster items. Roster failures are not
// fatal: the rows stay unsynced and the token endpoint retries.
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

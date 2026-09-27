import { and, asc, eq } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { contacts, user, userInvites, xmppAccounts } from '../db/schema';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { findInviteByCode } from '../auth/invites';

// The XMPP roster group every Galena contact goes into.
export const ROSTER_GROUP = 'Galena';

export type ContactSource = 'invite' | 'manual';

export interface Contact {
  userId: string;
  name: string;
  jid: string;
  avatarUrl?: string;
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
  await db
    .insert(contacts)
    .values([
      {
        userId: input.userId,
        contactUserId: input.contactUserId,
        source: input.source,
      },
      {
        userId: input.contactUserId,
        contactUserId: input.userId,
        source: input.source,
      },
    ])
    .onConflictDoNothing();
}

export async function listContacts(
  db: ServerDatabase,
  userId: string,
  domain: string,
): Promise<Contact[]> {
  const rows = await db
    .select({
      userId: contacts.contactUserId,
      name: user.name,
      image: user.image,
      jid: xmppAccounts.jid,
    })
    .from(contacts)
    .innerJoin(user, eq(user.id, contacts.contactUserId))
    .leftJoin(xmppAccounts, eq(xmppAccounts.userId, contacts.contactUserId))
    .where(eq(contacts.userId, userId))
    .orderBy(asc(user.name));

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    jid: row.jid ?? jidFor(localpartFor(row.userId), domain),
    ...(row.image ? { avatarUrl: row.image } : {}),
  }));
}

export interface RosterSyncResult {
  synced: number;
  pending: number;
  ok: boolean;
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
  const pending = await db
    .select({
      contactUserId: contacts.contactUserId,
      name: user.name,
      jid: xmppAccounts.jid,
    })
    .from(contacts)
    .innerJoin(user, eq(user.id, contacts.contactUserId))
    .leftJoin(xmppAccounts, eq(xmppAccounts.userId, contacts.contactUserId))
    .where(and(eq(contacts.userId, userId), eq(contacts.rosterSynced, false)));

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
    await db
      .update(contacts)
      .set({ rosterSynced: true })
      .where(and(eq(contacts.userId, userId), eq(contacts.contactUserId, row.contactUserId)));
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
  const rows = await db
    .select({ ownerId: contacts.userId })
    .from(contacts)
    .where(eq(contacts.contactUserId, userId));
  if (rows.length === 0) {
    return { updated: 0, pending: 0, ok: true };
  }

  await db.update(contacts).set({ rosterSynced: false }).where(eq(contacts.contactUserId, userId));

  const [account] = await db
    .select({ jid: xmppAccounts.jid })
    .from(xmppAccounts)
    .where(eq(xmppAccounts.userId, userId))
    .limit(1);
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
    await db
      .update(contacts)
      .set({ rosterSynced: true })
      .where(and(eq(contacts.userId, row.ownerId), eq(contacts.contactUserId, userId)));
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

  await db
    .insert(userInvites)
    .values({
      userId: input.userId,
      inviteId: invite.id,
      invitedBy: invite.createdBy ?? null,
    })
    .onConflictDoNothing();

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

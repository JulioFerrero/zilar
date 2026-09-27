import { boolean, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from '../auth/auth-schema';

export * from '../auth/auth-schema';

export const serverMeta = pgTable('server_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// Maps one of our users to the XMPP account we created for them. The localpart
// and JID are stored, never derived from user-controlled data (email or name).
export const xmppAccounts = pgTable('xmpp_accounts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  localpart: text('localpart').notNull().unique(),
  jid: text('jid').notNull().unique(),
  provisioned: boolean('provisioned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Which invite created each user. This is our own table, never Better Auth's.
// `invited_by` is copied from the invite's creator at sign-up (null for
// bootstrap invites).
export const userInvites = pgTable('user_invites', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  inviteId: text('invite_id').references(() => invites.id, { onDelete: 'set null' }),
  invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per direction of a contact relationship. When A and B become
// contacts there are two rows: (A, B) and (B, A). `roster_synced` tracks
// whether we managed to add the matching item to the owner's XMPP roster.
export const contacts = pgTable(
  'contacts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contactUserId: text('contact_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['invite', 'manual'] }).notNull(),
    rosterSynced: boolean('roster_synced').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.contactUserId] })],
);

// A group is backed by a members-only XMPP MUC room. The room localpart is
// random and never derived from the title.
export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  roomLocalpart: text('room_localpart').notNull().unique(),
  title: text('title').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

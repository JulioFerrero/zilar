import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
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

// A provider API key a user pasted in Settings → Connections. The key is stored
// only as an encrypted envelope (see connections/crypto.ts); the plaintext is
// never written here. `owner` is the authenticated user for now — workspace
// ownership arrives with the workspaces table. `provider` is one of the fixed
// ids in connections/providers.ts and is validated at the route boundary.
export const providerConnections = pgTable(
  'provider_connections',
  {
    id: text('id').primaryKey(),
    owner: text('owner')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    label: text('label'),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('provider_connections_owner_idx').on(table.owner)],
);

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

// Which AIs belong to which groups (T-0054). An AI in a group is a real MUC
// member (affiliation `member` under its own JID) whose gateway session joins
// the room and answers @mentions. `added_by` is the user who added it.
export const groupAis = pgTable(
  'group_ais',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.aiId] })],
);

// An AI an owner created. It is a real XMPP user (its own account and roster),
// never a member of Better Auth: `owner` points at the user who owns it and
// `localpart`/`jid` are the identity we registered in ejabberd. The persona and
// model live here; the spend cap is in `ai_limits`, the gateway key in
// `llm_virtual_keys`. `provider_connection_id` is RESTRICT, so a connection an
// AI uses cannot be deleted out from under it.
export const ais = pgTable(
  'ais',
  {
    id: text('id').primaryKey(),
    owner: text('owner')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    template: text('template', { enum: ['dev', 'marketing', 'fun', 'custom'] }).notNull(),
    persona: text('persona').notNull(),
    // The persona before the latest chat-driven change (`setPersonaFromChat`).
    // One level deep: `revertPersonaFromChat` swaps the two, so a second undo
    // re-applies the change. Null until the owner first shapes the AI by chat.
    previousPersona: text('previous_persona'),
    providerConnectionId: text('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'restrict' }),
    model: text('model').notNull(),
    localpart: text('localpart').notNull().unique(),
    jid: text('jid').notNull().unique(),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ais_owner_idx').on(table.owner)],
);

// The owner's hard limits for one AI. `per_month_usd` is the LiteLLM key's
// budget; `per_day_usd` is kept for the daily ledger a later task builds (see
// the comment in ais/service.ts). Money is numeric, never a float.
export const aiLimits = pgTable('ai_limits', {
  aiId: text('ai_id')
    .primaryKey()
    .references(() => ais.id, { onDelete: 'cascade' }),
  perDayUsd: numeric('per_day_usd', { precision: 12, scale: 2 }).notNull(),
  perMonthUsd: numeric('per_month_usd', { precision: 12, scale: 2 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// The spend baseline for one AI on one UTC day (T-0058). LiteLLM's key spend
// is cumulative over the key's 30-day budget window, so today's spend is the
// current spend minus the spend at the start of today (UTC), stored here on
// the first read of the day. Money is numeric, like the other money columns.
export const aiDailySpend = pgTable(
  'ai_daily_spend',
  {
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    baselineUsd: numeric('baseline_usd', { precision: 12, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.aiId, table.day] })],
);

// The capped LiteLLM virtual key issued for one AI. `litellm_key_id` is the
// token id we use to update or revoke the key; `encrypted_key` is the usable
// `sk-...` string sealed with the T-0028 KeyCipher, because T-0033 must call
// LiteLLM *as the AI* for the cap to apply. Neither ever reaches a response.
// `litellm_model_id` is the private model registered for this AI (nullable,
// because AIs created before T-0033 have none). Both ids are nullable so a
// resumable delete can clear them one at a time while the row survives.
export const llmVirtualKeys = pgTable('llm_virtual_keys', {
  aiId: text('ai_id')
    .primaryKey()
    .references(() => ais.id, { onDelete: 'cascade' }),
  litellmKeyId: text('litellm_key_id'),
  litellmModelId: text('litellm_model_id'),
  encryptedKey: text('encrypted_key').notNull(),
  budgetUsd: numeric('budget_usd', { precision: 12, scale: 2 }).notNull(),
  budgetDuration: text('budget_duration').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

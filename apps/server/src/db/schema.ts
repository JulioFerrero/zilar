import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from '../auth/auth-schema';

export * from '../auth/auth-schema';

export const serverMeta = pgTable('server_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// First-run setup (T-0161): instance mail settings. `mail.resend_api_key`
// is stored encrypted (see `setup/crypto.ts`); `mail.from` is stored in
// clear text.
export const instanceSettings = pgTable('instance_settings', {
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

// @usernames (T-0163): one namespace for people and groups. Only `user_id`
// rows are written in this task; the `group_id` column and its check exist
// so the next task (public groups/channels) needs no change to the table.
// The primary key on `handle_lower` is the only uniqueness rule: concurrent
// claims race on it, never check-then-insert.
export const handles = pgTable(
  'handles',
  {
    handleLower: text('handle_lower').primaryKey(),
    handle: text('handle').notNull(),
    userId: text('user_id')
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .unique()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('handles_owner_check', sql`num_nonnulls(${table.userId}, ${table.groupId}) = 1`),
  ],
);

// A handle given up by a change stays reserved for its former owner until
// `reserved_until` (30 days): the owner may reclaim it, nobody else may take
// it. Expired rows read as free and are reaped on the next claim.
export const retiredHandles = pgTable(
  'retired_handles',
  {
    handleLower: text('handle_lower').primaryKey(),
    formerUserId: text('former_user_id').references(() => user.id, { onDelete: 'cascade' }),
    formerGroupId: text('former_group_id').references(() => groups.id, { onDelete: 'cascade' }),
    reservedUntil: timestamp('reserved_until', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'retired_handles_owner_check',
      sql`num_nonnulls(${table.formerUserId}, ${table.formerGroupId}) = 1`,
    ),
  ],
);

// A pending request from one user to become another's contact. Two partial
// unique indexes share the work: `contact_requests_pending_idx` keeps at
// most one pending row per direction (the race backstop for same-direction
// creates), and `contact_requests_pending_pair_idx` keeps at most one
// pending row per unordered pair (the backstop for simultaneous
// opposite-direction creates — A→B and B→A racing past each other's
// duplicate check). `decided_at` is set on accept/decline/cancel and gates
// the 7-day re-request cooldown.
export const contactRequests = pgTable(
  'contact_requests',
  {
    id: text('id').primaryKey(),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted', 'declined', 'cancelled'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'contact_requests_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'cancelled')`,
    ),
    uniqueIndex('contact_requests_pending_idx')
      .on(table.fromUserId, table.toUserId)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex('contact_requests_pending_pair_idx')
      .on(
        sql`least(${table.fromUserId}, ${table.toUserId})`,
        sql`greatest(${table.fromUserId}, ${table.toUserId})`,
      )
      .where(sql`${table.status} = 'pending'`),
    check('contact_requests_different_users_check', sql`${table.fromUserId} <> ${table.toUserId}`),
  ],
);

// A group is backed by a members-only XMPP MUC room. The room localpart is
// random and never derived from the title.
export const groupKindSchema = z.enum(['group', 'channel']);
export type GroupKind = z.infer<typeof groupKindSchema>;

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  roomLocalpart: text('room_localpart').notNull().unique(),
  title: text('title').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  // T-0108: plain members may create topics only when this is true.
  // Owners/admins always may.
  membersCanCreateTopics: boolean('members_can_create_topics').notNull().default(false),
  // T-0124: a channel is a group with one read-only broadcast feed: only
  // owner/admins post (the room is moderated and subscribers are visitors);
  // members subscribe, read and mute. Defaults to a plain group.
  kind: text('kind', { enum: ['group', 'channel'] })
    .notNull()
    .default('group'),
  // T-0124: the channel's short blurb, shown in its panel. Null = none.
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Shareable group invite links (T-0115, decision D28). One row per link: only
// the SHA-256 hash of the token is stored — the token itself is shown once at
// creation and never persisted, logged or audited. `token_hint` (the last 4
// token characters) lets an admin tell links apart. `max_uses` null means
// unlimited; `expires_at` null means never. A link is usable while it is not
// revoked, not expired and under its use cap; joining consumes one use with
// an atomic conditional update so two racing joins can never exceed
// `max_uses`.
export const groupInviteLinks = pgTable(
  'group_invite_links',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    tokenHint: text('token_hint').notNull(),
    label: text('label'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('group_invite_links_group_idx').on(table.groupId)],
);

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

// A topic inside a group (T-0108, decisions D25/D26/D29). A group is a list
// of topics; every topic is its own members-only XMPP MUC room, so ejabberd
// itself enforces who receives a private topic's messages. The group's
// original room becomes its "General" topic (same room, same history):
// exactly one General per group, always public, never archived.
// `glyph` is 1-2 display characters (default: the first letter of the name,
// uppercased). Task-strip fields (`kind`, `status`, owners, link) live here
// too. `archived_at` is soft: archived topics keep their rows and history.
export const topics = pgTable(
  'topics',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    glyph: text('glyph').notNull(),
    roomLocalpart: text('room_localpart').notNull().unique(),
    visibility: text('visibility', { enum: ['public', 'private'] })
      .notNull()
      .default('public'),
    kind: text('kind', { enum: ['chat', 'task', 'bug', 'ui', 'routine'] })
      .notNull()
      .default('chat'),
    status: text('status', {
      enum: ['open', 'in_progress', 'in_review', 'blocked', 'done'],
    })
      .notNull()
      .default('open'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    ownerAiId: text('owner_ai_id').references(() => ais.id, { onDelete: 'set null' }),
    linkUrl: text('link_url'),
    linkLabel: text('link_label'),
    // T-0116: custom group role whose holders may decide approval cards in
    // this topic (see `canDecide`). Null = owner/admin only. Set null when
    // the role is deleted. Only meaningful next to `topic_role_access`
    // rows, which is how the holders get to see a private topic.
    approverRoleId: text('approver_role_id').references(() => groupRoles.id, {
      onDelete: 'set null',
    }),
    isGeneral: boolean('is_general').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Names are unique per group, case-insensitively, while active. An
    // archived topic frees its name for reuse.
    uniqueIndex('topics_active_name_idx')
      .on(table.groupId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    // Exactly one General topic per group.
    uniqueIndex('topics_general_idx')
      .on(table.groupId)
      .where(sql`${table.isGeneral} IS TRUE`),
    index('topics_group_idx').on(table.groupId),
  ],
);

// Custom group roles (T-0116, decision D29): labels with two powers — a
// role can be added to a private topic (every holder gets access, now and
// later) and a topic can name an approver role whose holders may decide
// approval cards in that topic. The built-in owner/admin/member stay as
// they are. Names are unique per group ignoring case
// (`group_roles_group_name_idx` on `(group_id, lower(name))`; the service
// maps a violation to 409 `role_exists`); at most 20 roles per group
// (checked in code under a per-group advisory lock).
export const groupRoles = pgTable(
  'group_roles',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('group_roles_group_idx').on(table.groupId),
    // Names are unique per group ignoring case (the service maps a
    // violation to 409 `role_exists`, so concurrent creates race safely).
    uniqueIndex('group_roles_group_name_idx').on(table.groupId, sql`lower(${table.name})`),
  ],
);

// Who holds a custom group role (T-0116). The holder must be a group member:
// leaving the group deletes the rows (see `removeGroupMember`), and the
// service refuses to assign non-members.
export const groupMemberRoles = pgTable(
  'group_member_roles',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => groupRoles.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.userId] })],
);

// Which roles may see a private topic (T-0116). Only meaningful for private
// topics: every holder of a listed role joins the room through the same
// `desiredMembers` as `topic_members`.
export const topicRoleAccess = pgTable(
  'topic_role_access',
  {
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => groupRoles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.topicId, table.roleId] })],
);

// Membership of private topics (T-0108). Rows exist only for private topics:
// a public topic's members are all group members, with no rows here. At most
// one of the two owner columns on `topics` is set; the application enforces
// it (a check constraint cannot easily express "at most one non-null" across
// nullable FK columns without surprising drizzle-kit diffs, so code owns it).
export const topicMembers = pgTable(
  'topic_members',
  {
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.topicId, table.userId] })],
);

// Membership of AIs in non-General topics (T-0109). Rows exist only for
// non-General topics: an AI in the group is in General through `group_ais`,
// and may additionally be added to exactly the other topics it works in.
// Adding requires the AI's owner (who must see the topic); removing needs
// the owner or a topic manager. Removing the AI from the group deletes every
// row here (see `removeGroupAi`).
export const topicAis = pgTable(
  'topic_ais',
  {
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.topicId, table.aiId] })],
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
    // `disabled` means provisioning in progress (set by `createAi` and
    // flipped to `active` once every step succeeded, see ais/service.ts);
    // `stopped` is the kill-switched owner pause (T-0080). A resume must
    // never be able to activate a `disabled` row, so the two are distinct.
    status: text('status', { enum: ['active', 'disabled', 'stopped'] })
      .notNull()
      .default('active'),
    // T-0091: the AI's home machine — where its desk lives — or null when it
    // runs on the platform. The runner does not host desks yet, so this is
    // only a pointer the UI shows today. `SET NULL` on machine delete so a
    // row that vanished can never leave a dangling id behind.
    machineId: text('machine_id').references(() => machines.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ais_owner_idx').on(table.owner), index('ais_machine_idx').on(table.machineId)],
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

// Pinned messages (T-0114, decision D28). One row per pin: the chat is a
// room bare JID for groups/topics, or the canonical DM pair key
// `min(jidA,jidB)|max(jidA,jidB)` (lowercased bare JIDs) so both people share
// one list. `message_id` is the same identifier clients use for corrections,
// retractions and reactions (T-0059/T-0061). The sender/text snapshot is for
// display only — the server never authorizes against it — so a client that
// has not loaded the message can still show the pin. Unique
// `(chat_jid, message_id)`; at most 20 pins per chat (enforced in code).
export const pinnedMessages = pgTable(
  'pinned_messages',
  {
    id: text('id').primaryKey(),
    chatJid: text('chat_jid').notNull(),
    messageId: text('message_id').notNull(),
    senderName: text('sender_name').notNull(),
    text: text('text').notNull().default(''),
    kind: text('kind', { enum: ['text', 'image', 'file', 'voice', 'card'] })
      .notNull()
      .default('text'),
    pinnedBy: text('pinned_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pinned_messages_chat_message_idx').on(table.chatJid, table.messageId),
    index('pinned_messages_chat_idx').on(table.chatJid),
  ],
);

// Per-user chat preferences (T-0113): mute (with a duration), archive and
// pin, for a DM, a group General room, or an individual topic room. One row
// per (user, chat JID); a row back at all defaults is deleted, not kept.
// Mute semantics live with the clients: while `muted_until` is in the future
// the chat counts no unread in list totals and makes no notification or
// sound. A far-future `muted_until` means "forever". Pinning a group mutes
// nothing: muting a group covers its topics via the General room's row,
// applied by the client unless a topic has its own row.
export const chatPrefs = pgTable(
  'chat_prefs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatJid: text('chat_jid').notNull(),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    archived: boolean('archived').notNull().default(false),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chatJid] }),
    check('chat_prefs_jid_length_check', sql`char_length(${table.chatJid}) BETWEEN 1 AND 255`),
    index('chat_prefs_user_idx').on(table.userId),
  ],
);

// User-made sticker packs (T-0120, decision D27). `server` packs can be
// found and added by every user of this Zilar server; `private` packs only
// by the owner (usable by others only through stickers already sent).
export const stickerPacks = pgTable('sticker_packs', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  visibility: text('visibility', { enum: ['private', 'server'] })
    .notNull()
    .default('private'),
  // Set by the Telegram importer (T-0123); null for packs made here.
  importedFrom: text('imported_from'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One sticker in a pack (T-0120). The bytes live on the server disk under
// `storage_key` (a relative `<uuid>.<ext>` path, never user input).
// `source_id` (T-0123) carries the Telegram `file_unique_id` of an imported
// sticker, so re-running an import fills gaps instead of duplicating rows.
// Unique per pack; null for stickers made here.
export const stickers = pgTable(
  'stickers',
  {
    id: text('id').primaryKey(),
    packId: text('pack_id')
      .notNull()
      .references(() => stickerPacks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    emoji: text('emoji'),
    mime: text('mime', { enum: ['image/webp', 'image/png'] }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    sourceId: text('source_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('stickers_pack_idx').on(table.packId),
    uniqueIndex('stickers_pack_source_idx')
      .on(table.packId, table.sourceId)
      .where(sql`${table.sourceId} IS NOT NULL`),
  ],
);

// The packs in a user's sticker panel, ordered. The owner's own packs are
// added automatically at pack creation.
export const userStickerPacks = pgTable(
  'user_sticker_packs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    packId: text('pack_id')
      .notNull()
      .references(() => stickerPacks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.packId] })],
);

// Web push devices (T-0119). One row per browser subscription: the `node`
// identifies the XEP-0357 push pair ejabberd notifies, `endpoint`/`p256dh`/
// `auth` are the Web Push subscription (the keys sealed with PUSH_STORAGE_KEY,
// AES-256-GCM — never plaintext). `last_used_at` is the last successful send;
// a device with no send for 90 days is listed as inactive. `failed_at` marks
// the last failed send. Expired subscriptions (404/410 from the push service)
// are deleted outright.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    node: text('node').notNull().unique(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (table) => [
    index('push_subscriptions_user_idx').on(table.userId),
    check(
      'push_subscriptions_node_length_check',
      sql`char_length(${table.node}) BETWEEN 1 AND 256`,
    ),
  ],
);

// Per-user push preferences (T-0119): whether notifications may carry the
// first 120 characters of the message text. Off means who-and-where only.
export const pushSettings = pgTable('push_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  showPreviews: boolean('show_previews').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Favorite stickers per user (T-0121). Ordered by `addedAt`; at most 200 per
// user (enforced in code under a per-user advisory lock, like the panel
// links). Both FKs cascade: deleting a user or a sticker drops the row.
export const stickerFavorites = pgTable(
  'sticker_favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    stickerId: text('sticker_id')
      .notNull()
      .references(() => stickers.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.stickerId] }),
    index('sticker_favorites_user_idx').on(table.userId),
  ],
);

// A machine (runner host) an owner paired with the server. `publicKey` is the
// runner's ed25519 public key (SPKI DER, base64) and is globally unique: a key
// that was ever registered — including on a revoked machine — can never pair
// again, so a stolen runner stays locked out until its key is replaced.
// `capabilities` is the runner's capability report as sent on pairing
// (snake_case keys, see machines/service.ts). Revocation is permanent: the row
// stays with `status = 'revoked'` and the machine must pair again with a new
// key. `lastSeenAt` is written by the tunnel hub when the machine connects.
export const machines = pgTable(
  'machines',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull().unique(),
    capabilities: jsonb('capabilities').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'approved', 'revoked'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (table) => [index('machines_owner_idx').on(table.ownerUserId)],
);

// A one-time pairing code an owner created for `POST /api/runner/pair`. Only
// the SHA-256 hash is stored; the plain code is returned once at creation and
// never logged. A code is consumed with an atomic
// `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING …` so two
// concurrent pair requests cannot both win.
export const machinePairingCodes = pgTable(
  'machine_pairing_codes',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('machine_pairing_codes_owner_idx').on(table.ownerUserId)],
);

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

// One stored approval request (T-0073). The AI asked a human to approve a
// specific action; the args are bound to the row by `args_hash`, so a consumer
// must present the same hash or the approval does not apply. T-0110: the
// scope is (AI, topic) — `group_id` and `topic_id` are either both set (a
// group chat, always in that topic's room; the group's old scope lives on
// its General topic) or both null (a DM with the AI). `status` is `pending`
// until a human decides or the sweeper expires it; `approved_once` is
// single-use (the verify path flips it to `consumed`); `approved_always` is
// treated identically to a one-shot for now (standing rules are out of
// scope). `decided_by` is the deciding user's id; it is intentionally not
// exposed by the API.
export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    // T-0110: the topic the request was raised in. Null exactly when
    // `group_id` is null (personal chat). Cascades with the topic.
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    details: text('details'),
    argsHash: text('args_hash').notNull(),
    worstCaseCurrency: text('worst_case_currency'),
    worstCaseAmount: numeric('worst_case_amount', { precision: 12, scale: 2 }),
    requestedBy: text('requested_by').notNull(),
    status: text('status', {
      enum: ['pending', 'approved_once', 'approved_always', 'denied', 'consumed'],
    })
      .notNull()
      .default('pending'),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('approvals_ai_status_idx').on(table.aiId, table.status),
    index('approvals_group_status_idx').on(table.groupId, table.status),
    // T-0110: personal scope is `group_id` and `topic_id` both null; group
    // scope is both set. A row with exactly one of them is rejected.
    check('approvals_topic_scope_check', sql`("group_id" IS NULL) = ("topic_id" IS NULL)`),
  ],
);

// Append-only audit log (T-0079). Every row is one decision or one machine
// lifecycle event: who acted, on which AI/group, what the action was, the
// hash of the args it ran against, the cost (optional), and the outcome. The
// shape is small on purpose so we never store notes, names, secrets, key
// material or free text in `detail`. Foreign keys are intentionally absent:
// an audit row must outlive the deletion of its user, AI or group, so the
// log keeps a faithful history even after the entities it refers to are
// gone. Mutability is enforced at the database, not just in code: a custom
// migration installs triggers that refuse UPDATE / DELETE / TRUNCATE.
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: text('actor_user_id'),
    aiId: text('ai_id'),
    groupId: text('group_id'),
    action: text('action').notNull(),
    subjectId: text('subject_id'),
    argsHash: text('args_hash'),
    costCurrency: text('cost_currency'),
    costAmount: numeric('cost_amount', { precision: 12, scale: 2 }),
    result: text('result', { enum: ['ok', 'denied', 'error'] }).notNull(),
    detail: jsonb('detail'),
  },
  (table) => [
    index('audit_log_group_at_idx').on(table.groupId, table.at),
    index('audit_log_ai_at_idx').on(table.aiId, table.at),
    index('audit_log_actor_at_idx').on(table.actorUserId, table.at),
  ],
);

// One row per state-changing action the gateway accepted (T-0090). The row
// sits next to the approval row and carries the exact parsed args the
// adapter will run: the platform executes what was approved, never
// anything the AI substitutes later. `status` follows the lifecycle
// `waiting → running → executed | failed` with `cancelled` reachable from
// `waiting` (denied / expired / killed / hash-tampered) but not from
// `running` — once a row is `running`, only `executed` or `failed` are
// valid transitions, so a crash between claim and finish leaves the row
// for `recoverStuck` to report but never re-execute. `args` is the parsed
// value, capped at 20 KB serialised, so the stored hash and the stored
// args always agree. `result_summary` is the adapter's success string,
// truncated to 500 chars; never the adapter's error text.
export const pendingActions = pgTable(
  'pending_actions',
  {
    id: text('id').primaryKey(),
    approvalId: text('approval_id')
      .notNull()
      .unique()
      .references(() => approvals.id, { onDelete: 'cascade' }),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    // T-0110: the topic the pending action was raised in. Null exactly when
    // `group_id` is null. Cascades with the topic.
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    args: jsonb('args').$type<unknown>().notNull(),
    argsHash: text('args_hash').notNull(),
    requestedBy: text('requested_by').notNull(),
    status: text('status', {
      enum: ['waiting', 'running', 'executed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('waiting'),
    resultSummary: text('result_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when the row is claimed (`waiting → running`). Stuck detection
    // measures from here: a request may wait a long time for its approval.
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('pending_actions_status_idx').on(table.status),
    // T-0110: personal scope is both ids null; group scope is both set.
    check('pending_actions_topic_scope_check', sql`("group_id" IS NULL) = ("topic_id" IS NULL)`),
  ],
);

// One row per "always allow" rule (T-0099). T-0110: a rule grants a single
// AI the right to run a single action in one topic (or the personal chat
// with its owner when `group_id`/`topic_id` are both null) without a fresh
// card. The unique partial indexes enforce "at most one active rule per
// (AI, topic, action)": the inactive ones can pile up so an audit reader
// sees the history. Revocation is soft (`revoked_at`/`revoked_by`);
// deletion of the AI, group or topic cascades, leaving nothing usable
// behind.
export const approvalRules = pgTable(
  'approval_rules',
  {
    id: text('id').primaryKey(),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    // `null` means the personal chat between the AI and its owner.
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    // T-0110: the topic the rule applies in. Null exactly when `group_id`
    // is null (personal chat). Cascades with the topic.
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    // T-0110: rules in a topic are unique on (AI, topic, action) while
    // active. Personal rules (both ids null) keep their own index.
    uniqueIndex('approval_rules_active_topic_idx')
      .on(table.aiId, table.topicId, table.action)
      .where(sql`${table.revokedAt} IS NULL AND ${table.topicId} IS NOT NULL`),
    uniqueIndex('approval_rules_active_personal_idx')
      .on(table.aiId, table.action)
      .where(sql`${table.revokedAt} IS NULL AND ${table.groupId} IS NULL`),
    // Personal scope is both ids null; group scope is both set.
    check('approval_rules_topic_scope_check', sql`("group_id" IS NULL) = ("topic_id" IS NULL)`),
  ],
);

// One stored AI tool (T-0103). T-0110: a tool belongs to one AI and one
// topic — or the personal chat between the AI and its owner when
// `group_id`/`topic_id` are both null. Same-name tools in different topics
// are different tools; the active-name uniqueness is enforced per (AI,
// topic) with the two partial unique indexes, like `approval_rules`.
// Deletion is soft (`deleted_at`), so a deleted name can be reused while
// the history rows survive.
export const aiTools = pgTable(
  'ai_tools',
  {
    id: text('id').primaryKey(),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    // `null` means the personal chat between the AI and its owner.
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    // T-0110: the topic the tool belongs to. Null exactly when `group_id`
    // is null (personal chat). Cascades with the topic.
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    // T-0132: the host set a human approved for this tool (per tool in its
    // (AI, topic) scope). The sandbox may only contact declared hosts ∩
    // this set; default empty, so a tool with no approval still runs, with
    // no network. Never expanded automatically — only `tool.approve_hosts`
    // (tier 2 card) sets it, `tool.revoke_hosts` empties it. Existing rows
    // start empty (no backfill: tools and routines are off by default, so
    // none exist in production); a routine that already pins hosts keeps
    // its own pinning but the sandbox still intersects with this set.
    approvedHosts: jsonb('approved_hosts').$type<string[]>().notNull().default([]),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ai_tools_active_personal_idx')
      .on(table.aiId, table.name)
      .where(sql`${table.deletedAt} IS NULL AND ${table.groupId} IS NULL`),
    // T-0110: tools in a topic are unique on (AI, topic, name) while
    // active. Personal tools keep their own index.
    uniqueIndex('ai_tools_active_topic_idx')
      .on(table.aiId, table.topicId, table.name)
      .where(sql`${table.deletedAt} IS NULL AND ${table.topicId} IS NOT NULL`),
    // Personal scope is both ids null; group scope is both set.
    check('ai_tools_topic_scope_check', sql`("group_id" IS NULL) = ("topic_id" IS NULL)`),
  ],
);

// One version of a tool's code (T-0103). Append-only: no service function
// ever updates or deletes a row here; a revert inserts a new row copying
// an older one. `version` counts from 1 per tool.
export const aiToolVersions = pgTable(
  'ai_tool_versions',
  {
    id: text('id').primaryKey(),
    toolId: text('tool_id')
      .notNull()
      .references(() => aiTools.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    source: text('source').notNull(),
    hosts: jsonb('hosts').$type<string[]>().notNull(),
    message: text('message').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ai_tool_versions_tool_version_idx').on(table.toolId, table.version)],
);

// One recorded run of a tool version (T-0103). `output_text` is the
// runner's output truncated to 2 KiB. Only the newest 50 rows per tool are
// kept; the insert prunes the rest in the same transaction.
export const aiToolRuns = pgTable(
  'ai_tool_runs',
  {
    id: text('id').primaryKey(),
    toolId: text('tool_id')
      .notNull()
      .references(() => aiTools.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    trigger: text('trigger', { enum: ['manual', 'routine', 'ai'] }).notNull(),
    status: text('status', { enum: ['ok', 'error'] }).notNull(),
    errorKind: text('error_kind'),
    durationMs: integer('duration_ms').notNull(),
    fetchCount: integer('fetch_count').notNull(),
    outputText: text('output_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_tool_runs_tool_idx').on(table.toolId)],
);

// One scheduled routine (T-0104): a stored tool plus a schedule in one
// topic, posting the tool's output as the AI. T-0110 scope: (AI, topic) —
// `group_id`/`topic_id` are both set (a group topic) or both null (the
// personal chat with the AI's owner). `approved_hosts` is the exact host
// set a human approved; the scheduler pauses the routine when the tool's
// current version contacts new sites. Deletion is soft (`deleted_at`); at
// most 10 non-deleted routines per (AI, topic), enforced in the service.
export const routines = pgTable(
  'routines',
  {
    id: text('id').primaryKey(),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    // `null` means the personal chat between the AI and its owner.
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    // The topic the routine belongs to and posts into. Null exactly when
    // `group_id` is null (personal chat). Cascades with the topic.
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    toolId: text('tool_id')
      .notNull()
      .references(() => aiTools.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    schedule: jsonb('schedule').$type<unknown>().notNull(),
    input: jsonb('input').$type<unknown>(),
    approvedHosts: jsonb('approved_hosts').$type<string[]>().notNull(),
    status: text('status', { enum: ['active', 'paused', 'needs_approval'] })
      .notNull()
      .default('active'),
    pausedReason: text('paused_reason', { enum: ['user', 'failures', 'hosts_changed'] }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status', { enum: ['ok', 'error', 'skipped'] }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // The scheduler's due query: active routines ordered by next run.
    index('routines_status_next_run_idx').on(table.status, table.nextRunAt),
    // Personal scope is both ids null; group scope is both set.
    check('routines_topic_scope_check', sql`("group_id" IS NULL) = ("topic_id" IS NULL)`),
  ],
);

import { sql } from 'drizzle-orm';
import {
  boolean,
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
// must present the same hash or the approval does not apply. `group_id` is
// null for a DM with the AI and set for a group, because who may decide
// differs between the two. `status` is `pending` until a human decides or the
// sweeper expires it; `approved_once` is single-use (the verify path flips it
// to `consumed`); `approved_always` is treated identically to a one-shot for
// now (standing rules are out of scope). `decided_by` is the deciding user's
// id; it is intentionally not exposed by the API.
export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
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
  (table) => [index('pending_actions_status_idx').on(table.status)],
);

// One row per "always allow" rule (T-0099). A rule grants a single AI the
// right to run a single action in one chat (a group, or the personal chat
// with its owner when `group_id` is null) without a fresh card. The unique
// partial indexes enforce "at most one active rule per (AI, chat, action)":
// the inactive ones can pile up so an audit reader sees the history.
// Revocation is soft (`revoked_at`/`revoked_by`); deletion of the AI or
// group cascades, leaving nothing usable behind.
export const approvalRules = pgTable(
  'approval_rules',
  {
    id: text('id').primaryKey(),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    // `null` means the personal chat between the AI and its owner.
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('approval_rules_active_group_idx')
      .on(table.aiId, table.groupId, table.action)
      .where(sql`${table.revokedAt} IS NULL`),
    uniqueIndex('approval_rules_active_personal_idx')
      .on(table.aiId, table.action)
      .where(sql`${table.revokedAt} IS NULL AND ${table.groupId} IS NULL`),
  ],
);

// One stored AI tool (T-0103). A tool belongs to one AI and one chat: a
// group, or the personal chat between the AI and its owner when `group_id`
// is null. Same-name tools in different chats are different tools; the
// active-name uniqueness is enforced per (AI, chat) with the two partial
// unique indexes, like `approval_rules`. Deletion is soft (`deleted_at`),
// so a deleted name can be reused while the history rows survive.
export const aiTools = pgTable(
  'ai_tools',
  {
    id: text('id').primaryKey(),
    aiId: text('ai_id')
      .notNull()
      .references(() => ais.id, { onDelete: 'cascade' }),
    // `null` means the personal chat between the AI and its owner.
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    currentVersion: integer('current_version').notNull().default(1),
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
    uniqueIndex('ai_tools_active_group_idx')
      .on(table.aiId, table.groupId, table.name)
      .where(sql`${table.deletedAt} IS NULL AND ${table.groupId} IS NOT NULL`),
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

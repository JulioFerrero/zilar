// Chat preferences and the per-user background default (T-0113, T-0458).
//
// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { ChatPrefRow } from '../db/rows';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { jidFor, localpartFor } from '../xmpp/provisioning';

export const CHAT_PREFS_MAX_ROWS = 200;
export const CHAT_PREFS_MAX_PINNED = 20;

// Mirrors `CHAT_BACKGROUND_PRESET_IDS` in `packages/ui-tokens` (T-0457). The
// server keeps its own copy so it does not depend on the UI package.
export const CHAT_BACKGROUND_PRESET_IDS = [
  'slate',
  'gold',
  'blue',
  'navy',
  'forest',
  'wine',
  'amber',
] as const;

/** The three nullable background columns, shared by the pref and the default. */
export interface BackgroundFields {
  backgroundPreset: string | null;
  backgroundImageId: string | null;
  backgroundDim: number | null;
}

/** `undefined` keeps the stored value; `null` clears it. */
export interface BackgroundFieldsInput {
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

export type { ChatPrefRow };

export interface ChatPrefView extends BackgroundFields {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  updatedAt: string;
}

function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// A MUC room JID (`localpart@mucDomain`) is visible to the caller when any
// non-archived topic with that room is visible to them (General, or a topic
// they can see under T-0108's rule).
async function canSeeRoomJid(
  db: ServerDatabase,
  roomLocalpart: string,
  userId: string,
): Promise<boolean> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics
        WHERE room_localpart = ${roomLocalpart}`;
    }),
  );
  for (const row of rows) {
    if (await canSeeTopic(db, row, userId)) {
      return true;
    }
  }
  return false;
}

// A DM JID is the XMPP account of one of the caller's contacts, or one of the
// caller's own AIs. Everything is compared as lowercased bare JIDs.
async function canDm(db: ServerDatabase, bare: string, userId: string, domain: string) {
  const contactRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ contactUserId: string }>`SELECT contact_user_id FROM contacts
        WHERE user_id = ${userId}`;
    }),
  );
  if (contactRows.length === 0) {
    const owned = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ jid: string }>`SELECT jid FROM ais WHERE owner = ${userId}`;
      }),
    );
    return owned.some((ai) => ai.jid.toLowerCase() === bare);
  }
  const accountRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string; jid: string }>`SELECT user_id, jid FROM xmpp_accounts
        WHERE user_id IN ${sql.in(contactRows.map((row) => row.contactUserId))}`;
    }),
  );
  const jidByUserId = new Map(accountRows.map((row) => [row.userId, row.jid.toLowerCase()]));
  for (const row of contactRows) {
    const known = jidByUserId.get(row.contactUserId);
    if (known !== undefined && known === bare) {
      return true;
    }
    // No account row yet (an account is provisioned at sign-in; tests seed it
    // through signup): fall back to the derived JID of the contact.
    if (
      known === undefined &&
      jidFor(localpartFor(row.contactUserId), domain).toLowerCase() === bare
    ) {
      return true;
    }
  }
  const owned = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ jid: string }>`SELECT jid FROM ais WHERE owner = ${userId}`;
    }),
  );
  return owned.some((ai) => ai.jid.toLowerCase() === bare);
}

export interface ChatAccess {
  /** Normalised (lowercased) bare JID the pref is stored under. */
  bare: string;
}

/**
 * Whether the caller may keep prefs for `chatJid`: a DM with one of their
 * contacts or one of their own AIs, or a group General/topic room they can
 * see. Anything else (and any malformed JID) answers 404, like an unknown
 * chat, so JIDs cannot be probed.
 */
export async function requireChatAccess(
  db: ServerDatabase,
  options: { chatJid: string; userId: string; domain: string; mucDomain: string },
): Promise<ChatAccess> {
  const { chatJid, userId, domain, mucDomain } = options;
  const bare = (chatJid.split('/')[0] ?? '').toLowerCase();
  const at = bare.indexOf('@');
  if (
    chatJid.trim() !== chatJid ||
    bare === '' ||
    bare.includes(' ') ||
    bare.length > 255 ||
    at <= 0 ||
    bare.indexOf('@', at + 1) !== -1
  ) {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  const host = bare.slice(at + 1);
  const local = bare.slice(0, at);
  if (local !== '' && host === mucDomain.toLowerCase()) {
    if (await canSeeRoomJid(db, local, userId)) {
      return { bare };
    }
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  if (host === domain.toLowerCase()) {
    if (await canDm(db, bare, userId, domain)) {
      return { bare };
    }
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  throw new HttpError(404, 'not_found', 'Chat not found');
}

export function toChatPrefView(row: ChatPrefRow): ChatPrefView {
  return {
    chatJid: row.chatJid,
    mutedUntil: row.mutedUntil === null ? null : row.mutedUntil.toISOString(),
    archived: row.archived,
    pinnedAt: row.pinnedAt === null ? null : row.pinnedAt.toISOString(),
    backgroundPreset: row.backgroundPreset,
    backgroundImageId: row.backgroundImageId,
    backgroundDim: row.backgroundDim,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Merges a background patch with the stored values and rejects the invalid
// combinations. An image id that does not exist and one owned by another user
// answer the same error, so an id cannot be probed. Shared by the per-chat
// pref and the per-user default.
async function resolveBackgroundFields(
  db: ServerDatabase,
  userId: string,
  existing: BackgroundFields | undefined,
  input: BackgroundFieldsInput,
): Promise<BackgroundFields> {
  const backgroundPreset =
    input.backgroundPreset === undefined
      ? (existing?.backgroundPreset ?? null)
      : input.backgroundPreset;
  const backgroundImageId =
    input.backgroundImageId === undefined
      ? (existing?.backgroundImageId ?? null)
      : input.backgroundImageId;
  const backgroundDim =
    input.backgroundDim === undefined ? (existing?.backgroundDim ?? null) : input.backgroundDim;

  if (backgroundPreset !== null && backgroundImageId !== null) {
    throw new HttpError(400, 'invalid_request', 'Choose a preset or an image');
  }
  if (backgroundDim !== null && backgroundImageId === null) {
    throw new HttpError(400, 'invalid_request', 'Dim needs an image');
  }
  if (backgroundImageId !== null) {
    const [image] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`SELECT id FROM chat_backgrounds
          WHERE id = ${backgroundImageId} AND user_id = ${userId} LIMIT 1`;
      }),
    );
    if (image === undefined) {
      throw new HttpError(400, 'invalid_request', 'Unknown background image');
    }
  }
  return { backgroundPreset, backgroundImageId, backgroundDim };
}

export async function listChatPrefs(db: ServerDatabase, userId: string): Promise<ChatPrefView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatPrefRow>`SELECT * FROM chat_prefs WHERE user_id = ${userId}`;
    }),
  );
  return rows.map(toChatPrefView).sort((a, b) => a.chatJid.localeCompare(b.chatJid));
}

export interface PutChatPrefInput extends BackgroundFieldsInput {
  userId: string;
  bare: string;
  /** `undefined` leaves the field; `null` clears it. */
  mutedUntil?: Date | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  now: Date;
}

/**
 * Partial update of one pref row. A write that lands back on all defaults
 * deletes the row instead of keeping it. Enforces the per-user row and pin
 * caps. `pinned: true` stamps `now` (keeping an existing stamp);
 * `pinned: false` clears the stamp.
 */
export async function putChatPref(
  db: ServerDatabase,
  input: PutChatPrefInput,
): Promise<ChatPrefView | null> {
  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatPrefRow>`SELECT * FROM chat_prefs
        WHERE user_id = ${input.userId} AND chat_jid = ${input.bare} LIMIT 1`;
    }),
  );

  const mutedUntil =
    input.mutedUntil === undefined ? (existing?.mutedUntil ?? null) : input.mutedUntil;
  const archived = input.archived === undefined ? (existing?.archived ?? false) : input.archived;
  const pinnedAt =
    input.pinned === undefined
      ? (existing?.pinnedAt ?? null)
      : input.pinned
        ? (existing?.pinnedAt ?? input.now)
        : null;
  const background = await resolveBackgroundFields(db, input.userId, existing, input);

  if (
    mutedUntil === null &&
    archived === false &&
    pinnedAt === null &&
    background.backgroundPreset === null &&
    background.backgroundImageId === null &&
    background.backgroundDim === null
  ) {
    if (existing !== undefined) {
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM chat_prefs
            WHERE user_id = ${input.userId} AND chat_jid = ${input.bare}`;
        }),
      );
    }
    return null;
  }

  if (existing === undefined) {
    const [total] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM chat_prefs
          WHERE user_id = ${input.userId}`;
      }),
    );
    if (Number(total?.total ?? 0) >= CHAT_PREFS_MAX_ROWS) {
      throw new HttpError(409, 'too_many_prefs', 'Too many chat preferences');
    }
  }
  if (pinnedAt !== null && (existing === undefined || existing.pinnedAt === null)) {
    const [pinned] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM chat_prefs
          WHERE user_id = ${input.userId} AND pinned_at IS NOT NULL`;
      }),
    );
    if (Number(pinned?.total ?? 0) >= CHAT_PREFS_MAX_PINNED) {
      throw new HttpError(409, 'too_many_pins', 'Too many pinned chats');
    }
  }

  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatPrefRow>`INSERT INTO chat_prefs
          (user_id, chat_jid, muted_until, archived, pinned_at,
            background_preset, background_image_id, background_dim, updated_at)
        VALUES (
          ${input.userId},
          ${input.bare},
          ${mutedUntil === null ? null : mutedUntil.toISOString()},
          ${archived},
          ${pinnedAt === null ? null : pinnedAt.toISOString()},
          ${background.backgroundPreset},
          ${background.backgroundImageId},
          ${background.backgroundDim},
          ${input.now.toISOString()}
        )
        ON CONFLICT (user_id, chat_jid) DO UPDATE SET
          muted_until = EXCLUDED.muted_until,
          archived = EXCLUDED.archived,
          pinned_at = EXCLUDED.pinned_at,
          background_preset = EXCLUDED.background_preset,
          background_image_id = EXCLUDED.background_image_id,
          background_dim = EXCLUDED.background_dim,
          updated_at = EXCLUDED.updated_at
        RETURNING *`;
    }),
  );
  if (!row) {
    throw new HttpError(500, 'internal_error', 'Could not save the chat preference');
  }
  return toChatPrefView(row);
}

export interface PutChatBackgroundDefaultInput extends BackgroundFieldsInput {
  now: Date;
}

/** The per-user global background default; all null when there is no row. */
export async function getChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
): Promise<BackgroundFields> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BackgroundFields>`SELECT background_preset, background_image_id, background_dim
        FROM chat_background_defaults WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };
}

/**
 * Partial update of the per-user background default. A write that lands back
 * on all defaults deletes the row instead of keeping it.
 */
export async function putChatBackgroundDefault(
  db: ServerDatabase,
  userId: string,
  input: PutChatBackgroundDefaultInput,
): Promise<BackgroundFields> {
  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BackgroundFields>`SELECT * FROM chat_background_defaults
        WHERE user_id = ${userId} LIMIT 1`;
    }),
  );

  const background = await resolveBackgroundFields(db, userId, existing, input);

  if (
    background.backgroundPreset === null &&
    background.backgroundImageId === null &&
    background.backgroundDim === null
  ) {
    if (existing !== undefined) {
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM chat_background_defaults WHERE user_id = ${userId}`;
        }),
      );
    }
    return { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };
  }

  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BackgroundFields>`INSERT INTO chat_background_defaults
          (user_id, background_preset, background_image_id, background_dim, updated_at)
        VALUES (
          ${userId},
          ${background.backgroundPreset},
          ${background.backgroundImageId},
          ${background.backgroundDim},
          ${input.now.toISOString()}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          background_preset = EXCLUDED.background_preset,
          background_image_id = EXCLUDED.background_image_id,
          background_dim = EXCLUDED.background_dim,
          updated_at = EXCLUDED.updated_at
        RETURNING background_preset, background_image_id, background_dim`;
    }),
  );
  if (!row) {
    throw new HttpError(500, 'internal_error', 'Could not save the background default');
  }
  return {
    backgroundPreset: row.backgroundPreset,
    backgroundImageId: row.backgroundImageId,
    backgroundDim: row.backgroundDim,
  };
}

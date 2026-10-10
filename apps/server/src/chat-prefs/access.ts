// Chat prefs access checks (T-1019 size split): who may keep prefs for which
// chat. Moved unchanged from `chat-prefs/service.ts`.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { jidFor, localpartFor } from '../xmpp/provisioning';

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

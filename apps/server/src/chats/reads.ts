// Stores the caller's last-read archive id per chat, forward only; invisible and unknown chats answer the same 404.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { requireChatAccess } from '../chat-prefs/access';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { DeliveryLookup } from './deliveries';

// The same 404 for an unknown and an invisible chat, like chat prefs.
export async function requireChatReadAccess(
  db: ServerDatabase,
  options: { chatJid: string; userId: string; domain: string; mucDomain: string },
): Promise<{ bare: string }> {
  return requireChatAccess(db, options);
}

export interface ChatAccessDependencies {
  db: ServerDatabase;
  config: Pick<ServerConfig, 'xmpp'>;
}

// A malformed param answers the same 404, so JIDs cannot be probed.
export async function chatAccessFromParam(
  deps: ChatAccessDependencies,
  encodedJid: string,
  userId: string,
): Promise<{ bare: string }> {
  let jid: string;
  try {
    jid = decodeURIComponent(encodedJid);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  return requireChatReadAccess(deps.db, {
    chatJid: jid,
    userId,
    domain: deps.config.xmpp.domain,
    mucDomain: deps.config.xmpp.mucDomain,
  });
}

// Microsecond int8 ids: the range check rejects what Postgres could not cast, so it answers 400, not 500.
const MAX_ARCHIVE_ID = 9223372036854775807n;

// Keeps the larger id, so an old device cannot move the mark back.
export async function putChatRead(
  db: ServerDatabase,
  options: {
    bare: string;
    userId: string;
    messageId: string;
  },
): Promise<void> {
  if (options.messageId.trim() === '') {
    throw new HttpError(400, 'invalid_request', 'messageId must not be empty');
  }
  let next: bigint;
  try {
    next = BigInt(options.messageId);
  } catch {
    throw new HttpError(400, 'invalid_request', 'messageId must be an archive id');
  }
  if (next < 0n || next > MAX_ARCHIVE_ID) {
    throw new HttpError(400, 'invalid_request', 'messageId must be an archive id');
  }
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Opening the chat clears the manual unread mark on every device, scoped to the caller.
      yield* sql`UPDATE chat_prefs SET unread_mark = false, updated_at = now()
        WHERE user_id = ${options.userId} AND chat_jid = ${options.bare} AND unread_mark`;
      // The `WHERE` keeps forward-only atomic; stored marks are validated, so the bigint cast cannot fail.
      yield* sql`INSERT INTO chat_reads (user_id, chat_jid, last_read_id, updated_at)
        VALUES (${options.userId}, ${options.bare}, ${options.messageId}, now())
        ON CONFLICT (user_id, chat_jid) DO UPDATE SET
          last_read_id = EXCLUDED.last_read_id,
          updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.last_read_id::bigint > chat_reads.last_read_id::bigint`;
    }),
  );
}

// One query finds each peer's newest mark under its own user id with the caller's JID.
// The stored id is the one both DM sides share, so it compares against the caller's message ids.
export async function readForChats(
  db: ServerDatabase,
  options: { userId: string; callerJid: string; lookups: readonly DeliveryLookup[] },
): Promise<Record<string, string>> {
  const peerIds = options.lookups.flatMap((lookup) =>
    lookup.dmPeerUserId === undefined ? [] : [lookup.dmPeerUserId],
  );
  if (peerIds.length === 0) {
    return {};
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Keyed by the peer's user id under the caller's JID, so another peer's mark cannot leak in.
      return yield* sql<{
        userId: string;
        lastReadId: string;
      }>`SELECT user_id, max(last_read_id::bigint) AS last_read_id
        FROM chat_reads
        WHERE chat_jid = ${options.callerJid.toLowerCase()} AND user_id IN ${sql.in(peerIds)}
        GROUP BY user_id`;
    }),
  );
  const byPeer = new Map(rows.map((row) => [row.userId, String(row.lastReadId)]));
  const answer: Record<string, string> = {};
  for (const lookup of options.lookups) {
    if (lookup.dmPeerUserId === undefined) {
      continue;
    }
    const mark = byPeer.get(lookup.dmPeerUserId);
    if (mark !== undefined && mark !== null) {
      answer[lookup.chatJid] = mark;
    }
  }
  return answer;
}

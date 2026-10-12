// The read mark write (T-1198): `PUT /api/chats/:jid/read` stores the
// caller's last-read archive id per chat, forward only. The handler checks
// chat access with the same rule the chat prefs use, so a chat the caller
// may not see answers the same 404 as an unknown one.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { requireChatAccess } from '../chat-prefs/access';
import type { ServerDatabase } from '../db/client';
import type { ChatReadRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';

/**
 * Whether the caller may mark `chatJid` read. Answers the same 404 for an
 * unknown and an invisible chat, like the chat-prefs access check.
 */
export async function requireChatReadAccess(
  db: ServerDatabase,
  options: { chatJid: string; userId: string; domain: string; mucDomain: string },
): Promise<{ bare: string }> {
  return requireChatAccess(db, options);
}

/**
 * Archive ids are microsecond-timestamp int8s: the range check below rejects a
 * well-formed mark Postgres could not cast, so it answers 400, not 500.
 */
const MAX_ARCHIVE_ID = 9223372036854775807n;

/**
 * Stores the caller's read mark for a visible chat, keeping the larger
 * archive id (microsecond timestamps compare as numbers), so an old device
 * cannot move the mark back. Unknown and invisible chats answer 404 alike.
 */
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
  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatReadRow>`SELECT * FROM chat_reads
        WHERE user_id = ${options.userId} AND chat_jid = ${options.bare} LIMIT 1`;
    }),
  );
  // Forward only: an equal or older mark keeps the stored row.
  if (existing !== undefined && next <= BigInt(existing.lastReadId)) {
    return;
  }
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The `WHERE` keeps the forward-only rule atomic: two devices racing
      // cannot move the mark back between the read above and this write.
      // Stored marks are always numeric (writes validate first), so the
      // bigint cast cannot fail.
      yield* sql`INSERT INTO chat_reads (user_id, chat_jid, last_read_id, updated_at)
        VALUES (${options.userId}, ${options.bare}, ${options.messageId}, now())
        ON CONFLICT (user_id, chat_jid) DO UPDATE SET
          last_read_id = EXCLUDED.last_read_id,
          updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.last_read_id::bigint > chat_reads.last_read_id::bigint`;
    }),
  );
}

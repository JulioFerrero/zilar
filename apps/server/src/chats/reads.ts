import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { DeliveryLookup } from './deliveries';
const MAX_ARCHIVE_ID = 9223372036854775807n;
export async function putChatRead(
  db: ServerDatabase,
  options: { bare: string; userId: string; messageId: string },
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
      yield* sql`UPDATE chat_prefs SET unread_mark = false, updated_at = now() WHERE user_id = ${options.userId} AND chat_jid = ${options.bare} AND unread_mark`;
      yield* sql`INSERT INTO chat_reads (user_id, chat_jid, last_read_id, updated_at) VALUES (${options.userId}, ${options.bare}, ${options.messageId}, now()) ON CONFLICT (user_id, chat_jid) DO UPDATE SET last_read_id = EXCLUDED.last_read_id, updated_at = EXCLUDED.updated_at WHERE EXCLUDED.last_read_id::bigint > chat_reads.last_read_id::bigint`;
    }),
  );
}
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
      return yield* sql<{
        userId: string;
        lastReadId: string;
      }>`SELECT user_id, max(last_read_id::bigint) AS last_read_id FROM chat_reads WHERE chat_jid = ${options.callerJid.toLowerCase()} AND user_id IN ${sql.in(peerIds)} GROUP BY user_id`;
    }),
  );
  const byPeer = new Map(rows.map((row) => [row.userId, String(row.lastReadId)]));
  const answer: Record<string, string> = {};
  for (const lookup of options.lookups) {
    const mark = lookup.dmPeerUserId === undefined ? undefined : byPeer.get(lookup.dmPeerUserId);
    if (mark !== undefined && mark !== null) {
      answer[lookup.chatJid] = mark;
    }
  }
  return answer;
}

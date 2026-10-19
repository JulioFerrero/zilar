import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { jidFor, localpartFor } from '../xmpp/provisioning';
export type ChatAccess = { bare: string };
async function canSeeRoom(db: ServerDatabase, roomLocalpart: string, userId: string) {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE room_localpart = ${roomLocalpart}`;
    }),
  );
  for (const row of rows) if (await canSeeTopic(db, row, userId)) return true;
  return false;
}
async function canDm(db: ServerDatabase, bare: string, userId: string, domain: string) {
  const contacts = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        userId: string;
        jid: string | null;
      }>`SELECT c.contact_user_id AS "userId", x.jid FROM contacts c LEFT JOIN xmpp_accounts x ON x.user_id = c.contact_user_id WHERE c.user_id = ${userId}`;
    }),
  );
  if (
    contacts.some(
      (row) => (row.jid ?? jidFor(localpartFor(row.userId), domain)).toLowerCase() === bare,
    )
  )
    return true;
  const ais = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ jid: string }>`SELECT jid FROM ais WHERE owner = ${userId}`;
    }),
  );
  return ais.some((ai) => ai.jid.toLowerCase() === bare);
}
export async function requireChatAccess(
  db: ServerDatabase,
  options: { chatJid: string; userId: string; domain: string; mucDomain: string },
): Promise<ChatAccess> {
  const { chatJid, userId, domain, mucDomain } = options;
  const bare = (chatJid.split('/')[0] ?? '').toLowerCase();
  const at = bare.indexOf('@');
  if (
    chatJid.trim() !== chatJid ||
    bare.includes(' ') ||
    bare.length > 255 ||
    at <= 0 ||
    bare.indexOf('@', at + 1) !== -1
  )
    throw new HttpError(404, 'not_found', 'Chat not found');
  const host = bare.slice(at + 1);
  const local = bare.slice(0, at);
  if (host === mucDomain.toLowerCase()) {
    if (await canSeeRoom(db, local, userId)) return { bare };
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  if (host === domain.toLowerCase() && (await canDm(db, bare, userId, domain))) return { bare };
  throw new HttpError(404, 'not_found', 'Chat not found');
}
export function chatAccessFromParam(
  deps: { db: ServerDatabase; config: { xmpp: { domain: string; mucDomain: string } } },
  encodedJid: string,
  userId: string,
): Promise<ChatAccess> {
  let jid: string;
  try {
    jid = decodeURIComponent(encodedJid);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
  return requireChatAccess(deps.db, { chatJid: jid, userId, ...deps.config.xmpp });
}

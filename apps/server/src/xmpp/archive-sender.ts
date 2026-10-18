// T-2004: display names for room senders. The archive row's `bare_peer` holds
// the real sender's bare JID (ejabberd stores no muc#user item; it builds that
// when serving MAM), so names are looked up by that JID from our own tables.
// No stanza parsing lives here: stored XML can only carry a forged item.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { bareJid } from '../jid';

// Display names for room senders, looked up by their real JID from our own
// tables (a user through `xmpp_accounts`, an AI through `ais`) in one query.
// The keys are bare and lowercased; an unknown JID is absent, so the caller
// decides its fallback.
export async function senderNamesByJid(
  db: ServerDatabase,
  jids: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(jids.map((jid) => bareJid(jid)))].filter((jid) => jid !== '');
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ jid: string; name: string }>`SELECT lower(x.jid) AS jid, u.name
        FROM xmpp_accounts x
        INNER JOIN "user" u ON u.id = x.user_id
        WHERE lower(x.jid) IN ${sql.in(wanted)}
        UNION ALL
        SELECT lower(a.jid) AS jid, a.name
        FROM ais a
        WHERE lower(a.jid) IN ${sql.in(wanted)}`;
    }),
  );
  const names = new Map<string, string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (name !== '') {
      names.set(row.jid, name);
    }
  }
  return names;
}

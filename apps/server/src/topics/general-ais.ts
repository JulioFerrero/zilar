// General has no `topic_ais` rows: its AIs are the group's `group_ais`, so
// the list reads them here; shape and order match `listTopicAis`.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { TopicAiView } from './access';
import { aiAvatarUrls, withAiAvatars } from './views';

export async function listGeneralAis(db: ServerDatabase, groupId: string): Promise<TopicAiView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; name: string; jid: string }>`SELECT a.id, a.name, a.jid
        FROM group_ais ga
        INNER JOIN ais a ON a.id = ga.ai_id
        WHERE ga.group_id = ${groupId}`;
    }),
  );
  const ais = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return withAiAvatars(
    ais,
    await aiAvatarUrls(
      db,
      ais.map((ai) => ai.id),
    ),
  );
}

// T-1244: the hand-set unread mark. `PUT /api/chats/:jid/read` clears it for
// the caller only.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';

describe('the chat unread mark (T-1244)', () => {
  let context: TestContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    context = await createTestContext();
    app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
  });

  afterEach(async () => {
    await context.close();
  });

  function dmJid(userId: string): string {
    return `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
  }

  async function putRead(cookie: string, jid: string, messageId: string) {
    const response = await app.request(
      `${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/read`,
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ messageId }),
      },
    );
    const text = await response.text();
    return { status: response.status, text };
  }

  it('leaves another user unread mark untouched', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const peer = dmJid(bob.id);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO chat_prefs (user_id, chat_jid, unread_mark)
          VALUES (${alice.id}, ${peer}, true), (${bob.id}, ${peer}, true)`;
      }),
    );

    const read = await putRead(alice.cookie, peer, '1760000000000000');
    expect(read.status).toBe(204);

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          userId: string;
          unreadMark: boolean;
        }>`SELECT user_id, unread_mark FROM chat_prefs
          WHERE chat_jid = ${peer} ORDER BY user_id`;
      }),
    );
    const byUser = new Map(rows.map((row) => [row.userId, row.unreadMark]));
    expect(byUser.get(alice.id)).toBe(false);
    expect(byUser.get(bob.id)).toBe(true);
  });
});

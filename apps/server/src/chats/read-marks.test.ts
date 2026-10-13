// T-1311: `/api/chats` reports a DM peer's read mark as `readUntil`, in the
// caller's own-message terms. The peer's device stores that mark under its own
// user id with the caller's JID as the chat (`PUT /api/chats/:jid/read`), so
// the list reads it back from `chat_reads`.

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

describe('readUntil on /api/chats (T-1311)', () => {
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
      archive: undefined,
    });
  });

  afterEach(async () => {
    await context.close();
  });

  it("reports the peer's read mark on the DM row", async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const ownJid = `${localpartFor(alice.id)}@${TEST_XMPP_DOMAIN}`.toLowerCase();
    const peer = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    const mark = String(Date.parse('2026-06-02T00:00:00.000Z') * 1000);

    // Bob read Alice's messages: his device stored the mark under his own id
    // with Alice's JID as the chat.
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO chat_reads (user_id, chat_jid, last_read_id, updated_at)
          VALUES (${bob.id}, ${ownJid}, ${mark}, now())`;
      }),
    );

    const response = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: alice.cookie },
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      chats: Array<{ chatJid: string; readUntil?: string }>;
    };
    const entry = json.chats.find((chat) => chat.chatJid === peer);
    expect(entry?.readUntil).toBe(mark);
  });
});

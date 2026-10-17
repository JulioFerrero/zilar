// T-1893: a notification's Mark as read stores the archive id and sends the
// XEP-0333 `<displayed>` marker as the caller, best effort. A failed send never
// fails the read.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  expectedJid,
  testSql,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';

const ARCHIVE_ID = '1780272000000000';

function markRead(
  app: ReturnType<typeof createApp>,
  user: { cookie: string },
  jid: string,
  payload: { messageId: string; displayed?: string },
): Promise<Response> {
  return app.request(`${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/read`, {
    method: 'PUT',
    headers: { cookie: user.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function readMarks(context: TestContext, userId: string) {
  return testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ chatJid: string; lastReadId: string }>`SELECT
          chat_jid AS "chatJid", last_read_id AS "lastReadId"
        FROM chat_reads WHERE user_id = ${userId}`;
    }),
  );
}

describe('PUT /api/chats/:jid/read with a displayed id (T-1893)', () => {
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

  it('stores the mark and sends <displayed> as the caller', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const peer = expectedJid(bob.id);

    const response = await markRead(app, alice, peer, {
      messageId: ARCHIVE_ID,
      displayed: 'origin-1',
    });

    expect(response.status).toBe(204);
    const marks = await readMarks(context, alice.id);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.lastReadId).toBe(ARCHIVE_ID);

    expect(context.adminClient.sentStanzas).toHaveLength(1);
    const sent = context.adminClient.sentStanzas[0];
    expect(sent?.from).toBe(expectedJid(alice.id));
    expect(sent?.to).toBe(peer);
    expect(sent?.stanza).toContain('<displayed');
    expect(sent?.stanza).toContain('id="origin-1"');
  });

  it('sends nothing without a displayed id', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');

    const response = await markRead(app, alice, expectedJid(bob.id), { messageId: ARCHIVE_ID });

    expect(response.status).toBe(204);
    expect(await readMarks(context, alice.id)).toHaveLength(1);
    expect(context.adminClient.sentStanzas).toHaveLength(0);
  });

  it('still answers 204 and stores the mark when the send fails', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    context.adminClient.sendStanza = async () => {
      throw new Error('ejabberd is down');
    };

    const response = await markRead(app, alice, expectedJid(bob.id), {
      messageId: ARCHIVE_ID,
      displayed: 'origin-1',
    });

    expect(response.status).toBe(204);
    const marks = await readMarks(context, alice.id);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.lastReadId).toBe(ARCHIVE_ID);
    expect(context.logOutput()).toContain('read marker send failed');
  });
});

// T-1889: `POST /api/chats/:jid/reply` sends a notification's reply as the
// caller. Access, DM block, budget and the idempotency claim are checked in
// that order; a repeated `clientId` never sends twice and a failed send
// refunds the claim.

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
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';

function replyUrl(jid: string): string {
  return `${TEST_BASE_URL}/api/chats/${encodeURIComponent(jid)}/reply`;
}

function postReply(
  app: ReturnType<typeof createApp>,
  user: { cookie: string },
  jid: string,
  payload: { clientId: string; text: string },
): Promise<Response> {
  return app.request(replyUrl(jid), {
    method: 'POST',
    headers: { cookie: user.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function claimRows(context: TestContext, userId: string, clientId: string) {
  return testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ one: number }>`SELECT 1 AS one FROM notification_replies
        WHERE user_id = ${userId} AND client_id = ${clientId}`;
    }),
  );
}

describe('POST /api/chats/:jid/reply (T-1889)', () => {
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

  it('answers the same 404 for an invisible chat and sends nothing', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');

    const response = await postReply(app, alice, `stranger@${TEST_XMPP_DOMAIN}`, {
      clientId: 'invisible-1',
      text: 'hello',
    });

    expect(response.status).toBe(404);
    expect(context.adminClient.sentStanzas).toHaveLength(0);
  });

  it('answers 404 and sends nothing to a blocked DM', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO user_blocks (user_id, blocked_user_id)
          VALUES (${alice.id}, ${bob.id})`;
      }),
    );

    const response = await postReply(app, alice, expectedJid(bob.id), {
      clientId: 'blocked-1',
      text: 'hello',
    });

    expect(response.status).toBe(404);
    expect(context.adminClient.sentStanzas).toHaveLength(0);
  });

  it('sends the app stanza as the caller and answers 204', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');

    const response = await postReply(app, alice, expectedJid(bob.id), {
      clientId: 'first-reply',
      text: 'Hello from the lockscreen',
    });

    expect(response.status).toBe(204);
    expect(context.adminClient.sentStanzas).toHaveLength(1);
    const sent = context.adminClient.sentStanzas[0];
    expect(sent?.from).toBe(expectedJid(alice.id));
    expect(sent?.to).toBe(expectedJid(bob.id));
    expect(sent?.stanza).toContain('type="chat"');
    expect(sent?.stanza).toContain('<body>Hello from the lockscreen</body>');
    expect(sent?.stanza).toContain('<origin-id');
    expect(sent?.stanza).toContain('id="first-reply"');
    // The reply text is user content and must never reach the log.
    expect(context.logOutput()).not.toContain('Hello from the lockscreen');
  });

  it('answers 204 for the same clientId and never sends twice', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const payload = { clientId: 'retried-reply', text: 'Only once' };

    const first = await postReply(app, alice, expectedJid(bob.id), payload);
    const second = await postReply(app, alice, expectedJid(bob.id), payload);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(context.adminClient.sentStanzas).toHaveLength(1);
  });

  it('answers 409 while a fresh claim has not been sent', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO notification_replies (user_id, client_id, chat_jid, created_at)
          VALUES (${alice.id}, 'in-flight', ${expectedJid(bob.id)}, now())`;
      }),
    );

    const response = await postReply(app, alice, expectedJid(bob.id), {
      clientId: 'in-flight',
      text: 'Still sending',
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('reply_in_flight');
    expect(context.adminClient.sentStanzas).toHaveLength(0);
  });

  it('takes over a claim older than two minutes', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO notification_replies (user_id, client_id, chat_jid, created_at)
          VALUES (${alice.id}, 'stale', ${expectedJid(bob.id)}, now() - interval '3 minutes')`;
      }),
    );

    const response = await postReply(app, alice, expectedJid(bob.id), {
      clientId: 'stale',
      text: 'After the wait',
    });

    expect(response.status).toBe(204);
    expect(context.adminClient.sentStanzas).toHaveLength(1);
  });

  it('answers 503 when the send fails, refunds the claim and lets a retry send', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const original = context.adminClient.sendStanza.bind(context.adminClient);
    let fail = true;
    context.adminClient.sendStanza = async (from, to, stanza) => {
      if (fail) {
        throw new Error('ejabberd is down');
      }
      return original(from, to, stanza);
    };
    const payload = { clientId: 'failed-reply', text: 'Try again' };

    const first = await postReply(app, alice, expectedJid(bob.id), payload);

    expect(first.status).toBe(503);
    const body = (await first.json()) as { error: { code: string } };
    expect(body.error.code).toBe('send_failed');
    expect(context.adminClient.sentStanzas).toHaveLength(0);
    expect(await claimRows(context, alice.id, 'failed-reply')).toHaveLength(0);

    fail = false;
    const retry = await postReply(app, alice, expectedJid(bob.id), payload);

    expect(retry.status).toBe(204);
    expect(context.adminClient.sentStanzas).toHaveLength(1);
  });
});

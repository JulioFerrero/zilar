// T-1244: the hand-set unread mark. The prefs PUT stores it, and
// `PUT /api/chats/:jid/read` clears it for the caller only.

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

  async function putPref(cookie: string, jid: string, body: unknown) {
    const response = await app.request(
      `${TEST_BASE_URL}/api/chat-prefs/${encodeURIComponent(jid)}`,
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  }

  async function listPrefs(cookie: string): Promise<{ status: number; json: unknown }> {
    const response = await app.request(`${TEST_BASE_URL}/api/chat-prefs`, { headers: { cookie } });
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
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

  function prefFor(json: unknown, jid: string): { unreadMark?: boolean } | undefined {
    const prefs = (json as { prefs: Array<{ chatJid: string; unreadMark?: boolean }> }).prefs;
    return prefs.find((pref) => pref.chatJid.toLowerCase() === jid.toLowerCase());
  }

  it('clears the unread mark when the chat is read', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const bob = await contactOf(context, app, alice.id, 'bob@example.com');
    const peer = dmJid(bob.id);

    const marked = await putPref(alice.cookie, peer, { unreadMark: true });
    expect(marked.status).toBe(200);
    expect(prefFor((await listPrefs(alice.cookie)).json, peer)?.unreadMark).toBe(true);

    const read = await putRead(alice.cookie, peer, '1760000000000000');
    expect(read.status).toBe(204);

    expect(prefFor((await listPrefs(alice.cookie)).json, peer)?.unreadMark).toBe(false);
  });

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

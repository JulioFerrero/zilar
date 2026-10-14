// T-1355: a channel created through the New channel flow stores `kind =
// 'channel'` and answers the chat list as a channel row with no topics. The
// list used to attach the channel's General feed as a topic, so the clients
// built a topic tree and rendered the channel as a group ("1 topic", the
// "Group › General" header and a task strip).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  testSql,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from '../test-support';

interface ChatListEntryBody {
  kind: string;
  groupId?: string;
  chatKind?: string;
  subscriberCount?: number;
  topics?: unknown[];
}

describe('a channel in the chat list (T-1355)', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  it('stores kind = channel and lists it as a channel with no topics', async () => {
    const owner = await bootstrapUser(context, app, 'channel-owner@example.com');
    const created = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({
        title: 'Zilar Updates',
        memberIds: [],
        kind: 'channel',
        description: 'Release news',
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // The stored group is a channel, never a plain group.
    const [stored] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ kind: string }>`SELECT kind FROM groups WHERE id = ${id}`;
      }),
    );
    expect(stored?.kind).toBe('channel');

    const list = await app.request(`${TEST_BASE_URL}/api/chats`, {
      headers: { cookie: owner.cookie },
    });
    expect(list.status).toBe(200);
    const { chats } = (await list.json()) as { chats: ChatListEntryBody[] };
    const entry = chats.find((chat) => chat.groupId === id);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('group');
    expect(entry?.chatKind).toBe('channel');
    // The channel's General feed is not listed as a topic.
    expect(entry?.topics).toEqual([]);
    // The subscriber count still rides the channel row.
    expect(entry?.subscriberCount).toBeGreaterThanOrEqual(1);
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  FakeAdminClient,
  testApp,
  testSql,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { syncTopicRoom } from '../topics/rooms';
import type { TopicRow } from '../topics/access';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { createPushCipher } from './crypto';
import { saveDevice } from './store';
import type { WebPushSubscription } from './subscriptions';
import { createPushTestTables } from './test-tables';

const STORAGE_KEY = 'test-push-storage-key-0000000000000000';

function subscription(endpoint: string): WebPushSubscription {
  return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
}

describe('topic room push subscription sync', () => {
  let context: TestContext;
  let adminClient: FakeAdminClient;
  let anaId: string;
  let bobId: string;
  let groupId: string;
  let generalRoom: string;
  let secretRoom: string;
  let privateTopicId: string;

  async function topicRow(roomLocalpart: string): Promise<TopicRow> {
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<TopicRow>`SELECT * FROM topics WHERE room_localpart = ${roomLocalpart}`;
      }),
    );
    if (!row) {
      throw new Error(`no topic for room ${roomLocalpart}`);
    }
    return row;
  }

  beforeEach(async () => {
    context = await createTestContext();
    await createPushTestTables(context.db);
    adminClient = context.adminClient;
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    anaId = ana.id;
    bobId = bob.id;
    groupId = randomUUID();
    generalRoom = 'gpushsyncgeneral0';
    secretRoom = 'gpushsyncsecret00';
    privateTopicId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO groups (id, room_localpart, title, created_by) VALUES (${groupId}, ${generalRoom}, 'Push group', ${anaId})`;
        yield* sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${groupId}, ${anaId}, 'owner'), (${groupId}, ${bobId}, 'member')`;
        yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${randomUUID()}, ${groupId}, 'General', 'G', ${generalRoom}, 'public', 'chat', 'open', true, ${anaId})`;
        yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${privateTopicId}, ${groupId}, 'Secret', 'S', ${secretRoom}, 'private', 'chat', 'open', false, ${anaId})`;
        yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by) VALUES (${privateTopicId}, ${anaId}, ${anaId})`;
      }),
    );
  });

  afterEach(async () => {
    await context.close();
  });

  function logger() {
    return { warn: () => {} };
  }

  async function giveDevice(userId: string, endpoint: string): Promise<void> {
    await saveDevice(context.db, createPushCipher(STORAGE_KEY), {
      id: randomUUID(),
      userId,
      node: `p-${endpoint}`,
      subscription: subscription(`https://push.example.com/${endpoint}`),
      userAgent: null,
      now: new Date(),
    });
  }

  it('subscribes device holders and skips everyone else', async () => {
    await giveDevice(bobId, 'bob-device');
    const general = await topicRow(generalRoom);
    await syncTopicRoom(
      { db: context.db, adminClient, domain: TEST_XMPP_DOMAIN, logger: logger() },
      general,
    );
    const bobJid = jidFor(localpartFor(bobId), TEST_XMPP_DOMAIN);
    const anaJid = jidFor(localpartFor(anaId), TEST_XMPP_DOMAIN);
    expect(adminClient.roomSubscriptions).toContainEqual({
      roomId: generalRoom,
      userJid: bobJid,
      nick: localpartFor(bobId),
    });
    // Ana has no device: no subscription for her.
    expect(adminClient.roomSubscriptions.some((entry) => entry.userJid === anaJid)).toBe(false);
  });

  it('unsubscribes a removed member and skips non-members of private topics', async () => {
    await giveDevice(bobId, 'bob-device');
    const bobJid = jidFor(localpartFor(bobId), TEST_XMPP_DOMAIN);
    // Bob still holds a stale room affiliation from before he lost access.
    adminClient.affiliationState.set(secretRoom, new Map([[bobJid, 'member']]));
    const secret = await topicRow(secretRoom);
    await syncTopicRoom(
      { db: context.db, adminClient, domain: TEST_XMPP_DOMAIN, logger: logger() },
      secret,
    );
    const affiliations = adminClient.affiliationState.get(secretRoom);
    expect(affiliations?.has(bobJid)).toBe(false);
    // Bob cannot see the private topic: subscribed nowhere, and the sync
    // unsubscribes his stale push subscription too.
    expect(adminClient.roomSubscriptions).toEqual([]);
    expect(adminClient.roomUnsubscriptions).toContainEqual({
      roomId: secretRoom,
      userJid: bobJid,
    });
  });

  it('unsubscribes everyone when the topic is archived', async () => {
    await giveDevice(anaId, 'ana-device');
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE topics SET archived_at = now() WHERE id = ${privateTopicId}`;
      }),
    );
    // A stale affiliation and push subscription from before the archive.
    const anaJid = jidFor(localpartFor(anaId), TEST_XMPP_DOMAIN);
    adminClient.affiliationState.set(secretRoom, new Map([[anaJid, 'member']]));
    const secret = await topicRow(secretRoom);
    await syncTopicRoom(
      { db: context.db, adminClient, domain: TEST_XMPP_DOMAIN, logger: logger() },
      secret,
    );
    expect(adminClient.roomUnsubscriptions).toContainEqual({
      roomId: secretRoom,
      userJid: anaJid,
    });
    expect(adminClient.roomSubscriptions).toEqual([]);
  });

  it('creates rooms with allow_subscription enabled', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const { createEjabberdAdminClient } = await import('../xmpp/admin-client');
    const client = createEjabberdAdminClient(
      {
        apiUrl: 'http://ejabberd.test/api',
        adminJid: 'admin@zilar.localhost',
        adminPassword: 'admin-secret-value',
        domain: TEST_XMPP_DOMAIN,
        mucDomain: 'rooms.zilar.localhost',
        wsPublicUrl: 'ws://ejabberd.test:5280/ws',
        jwtSecret: 's'.repeat(40),
      },
      (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(
          new Response(JSON.stringify(0), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    );
    await client.createRoom('gnewroom00000001', { title: 'New' });
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      options: Array<{ name: string; value: string }>;
    };
    expect(body.options.find((option) => option.name === 'allow_subscription')).toEqual({
      name: 'allow_subscription',
      value: 'true',
    });
  });

  it('changes room options and manages room subscriptions', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const { createEjabberdAdminClient } = await import('../xmpp/admin-client');
    const client = createEjabberdAdminClient(
      {
        apiUrl: 'http://ejabberd.test/api',
        adminJid: 'admin@zilar.localhost',
        adminPassword: 'admin-secret-value',
        domain: TEST_XMPP_DOMAIN,
        mucDomain: 'rooms.zilar.localhost',
        wsPublicUrl: 'ws://ejabberd.test:5280/ws',
        jwtSecret: 's'.repeat(40),
      },
      (url, init) => {
        calls.push({ url, init });
        const body =
          url === 'http://ejabberd.test/api/subscribe_room'
            ? JSON.stringify(['urn:xmpp:mucsub:nodes:messages'])
            : JSON.stringify(0);
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    );
    const userJid = jidFor(localpartFor(bobId), TEST_XMPP_DOMAIN);
    await client.changeRoomOption('groom000000000001', 'allow_subscription', 'true');
    await client.subscribeRoom('groom000000000001', userJid, localpartFor(bobId));
    await client.unsubscribeRoom('groom000000000001', userJid);
    expect(calls.map((call) => call.url)).toEqual([
      'http://ejabberd.test/api/change_room_option',
      'http://ejabberd.test/api/subscribe_room',
      'http://ejabberd.test/api/unsubscribe_room',
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name: 'groom000000000001',
      service: 'rooms.zilar.localhost',
      option: 'allow_subscription',
      value: 'true',
    });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      user: localpartFor(bobId),
      host: TEST_XMPP_DOMAIN,
      nick: localpartFor(bobId),
      room: 'groom000000000001',
      service: 'rooms.zilar.localhost',
      nodes: 'urn:xmpp:mucsub:nodes:messages',
    });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      user: localpartFor(bobId),
      host: TEST_XMPP_DOMAIN,
      room: 'groom000000000001',
      service: 'rooms.zilar.localhost',
    });
  });
});

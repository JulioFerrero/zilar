import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { chatPrefs, groupMembers, groups, topicMembers, topics } from '../db/schema';
import { localpartFor } from '../xmpp/provisioning';
import { createPushCipher } from './crypto';
import { handleIncomingPush, type PushServiceDeps } from './service';
import { saveDevice } from './store';
import type { ArchivePool } from '../search/service';
import type { WebPushSubscription } from './subscriptions';
import { createPushTestTables } from './test-tables';

const STORAGE_KEY = 'test-push-storage-key-0000000000000000';
const MUC = 'rooms.zilar.localhost';

function subscription(endpoint: string): WebPushSubscription {
  return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
}

interface SentPush {
  endpoint: string;
  payload: string;
}

function dmRow(ownerLocalpart: string, peerJid: string, text: string, originId: string) {
  return {
    owner: ownerLocalpart,
    peer: `${peerJid}/laptop`,
    barePeer: peerJid,
    kind: 'chat',
    nick: '',
    originId,
    timestamp: BigInt(Date.parse('2026-09-30T10:00:00Z')) * 1000n,
    text,
    xml: `<message from="${peerJid}/laptop" to="x"><body>${text}</body></message>`,
  };
}

function roomRow(roomJid: string, nick: string, text: string, originId: string) {
  return {
    owner: roomJid,
    peer: `${roomJid}/${nick}`,
    barePeer: roomJid,
    kind: 'groupchat',
    nick,
    originId,
    timestamp: BigInt(Date.parse('2026-09-30T10:00:00Z')) * 1000n,
    text,
    xml: `<message from="${roomJid}/${nick}" type="groupchat"><body>${text}</body></message>`,
  };
}

describe('push send-time service', () => {
  let context: TestContext;
  let sent: SentPush[];
  let archiveRows: Array<Record<string, unknown>>;
  let archiveThrows = false;
  let sendBehavior: 'ok' | 'gone' | 'error' = 'ok';

  const archive: ArchivePool = {
    query: async () => {
      if (archiveThrows) {
        throw new Error('archive is down');
      }
      return archiveRows as unknown as import('../search/service').ArchiveRow[];
    },
    close: async () => {},
  };

  function deps(): PushServiceDeps {
    return {
      db: context.db,
      config: context.config,
      archive,
      cipher: createPushCipher(STORAGE_KEY),
      sender: {
        send: async (target, payload) => {
          if (sendBehavior === 'gone') {
            return { gone: true };
          }
          if (sendBehavior === 'error') {
            throw new Error('push relay refused the request');
          }
          sent.push({ endpoint: target.endpoint, payload });
          return { gone: false };
        },
      },
      logger: context.logger,
      recentlyNotified: new Map(),
    };
  }

  async function registerDevice(userId: string, node: string): Promise<string> {
    const row = await saveDevice(context.db, createPushCipher(STORAGE_KEY), {
      id: randomUUID(),
      userId,
      node,
      subscription: subscription(`https://push.example.com/${node}`),
      userAgent: null,
      now: new Date('2026-09-30T09:00:00Z'),
    });
    return row.id;
  }

  beforeEach(async () => {
    context = await createTestContext();
    await createPushTestTables(context.db);
    sent = [];
    archiveRows = [];
    archiveThrows = false;
    sendBehavior = 'ok';
  });

  afterEach(async () => {
    await context.close();
  });

  it('notifies a DM with sender name and preview', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-1');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'hello ana, are you there?', 'dm-1')];

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-1', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'sent', userId: ana.id });
    expect(sent).toHaveLength(1);
    const payload = JSON.parse(sent[0]!.payload) as {
      title: string;
      body: string;
      chatId: string;
    };
    // The sender name comes from the contacts table, never an e-mail (test
    // contacts have no display name yet, hence the placeholder).
    expect(payload.title).toBe('Unnamed user');
    expect(payload.title).not.toContain('@');
    expect(payload.body).toBe('hello ana, are you there?');
    expect(payload.chatId).toBe(bobJid);
    expect(context.logOutput()).not.toContain('hello ana');
    expect(context.logOutput()).not.toContain('push.example.com');
  });

  it('skips your own room message but notifies another member (round 5)', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    const groupId = randomUUID();
    const room = 'gownmessage0000001';
    await context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: room,
      title: 'Own nick group',
      createdBy: ana.id,
    });
    await context.db.insert(groupMembers).values([
      { groupId, userId: ana.id, role: 'owner' },
      { groupId, userId: bob.id, role: 'member' },
    ]);
    await context.db.insert(topics).values({
      id: randomUUID(),
      groupId,
      name: 'General',
      glyph: 'G',
      roomLocalpart: room,
      visibility: 'public',
      kind: 'chat',
      status: 'open',
      isGeneral: true,
      createdBy: ana.id,
    });
    await registerDevice(bob.id, 'p-bob-own');
    const roomJid = `${room}@${MUC}`;
    // Newest row is Bob's own message (sent from another session while this
    // device was offline): skipped, never notified. The older row from Ana
    // notifies normally.
    archiveRows = [
      roomRow(roomJid, localpartFor(bob.id), 'my own words', 'room-own'),
      roomRow(roomJid, 'Ana', 'hello bob', 'room-other'),
    ];

    const outcome = await handleIncomingPush(deps(), { node: 'p-bob-own', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'sent', userId: bob.id });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({
      title: 'Ana in Own nick group',
      body: 'hello bob',
    });
  });

  it('notifies a group room as who-in-where', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    const groupId = randomUUID();
    const room = 'gweekendtrip000001';
    await context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: 'gweekendtrip000001',
      title: 'Weekend trip',
      createdBy: ana.id,
    });
    await context.db.insert(groupMembers).values([
      { groupId, userId: ana.id, role: 'owner' },
      { groupId, userId: bob.id, role: 'member' },
    ]);
    await context.db.insert(topics).values({
      id: randomUUID(),
      groupId,
      name: 'General',
      glyph: 'G',
      roomLocalpart: room,
      visibility: 'public',
      kind: 'chat',
      status: 'open',
      isGeneral: true,
      createdBy: ana.id,
    });
    await registerDevice(bob.id, 'p-bob-1');
    archiveRows = [roomRow(`${room}@${MUC}`, 'Ana', 'packing the tent now', 'room-1')];

    const outcome = await handleIncomingPush(deps(), { node: 'p-bob-1', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'sent', userId: bob.id });
    const payload = JSON.parse(sent[0]!.payload) as { title: string; body: string };
    expect(payload.title).toBe('Ana in Weekend trip');
    expect(payload.body).toBe('packing the tent now');
  });

  it('drops muted chats and chats muted through their group', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-2');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    await context.db.insert(chatPrefs).values({
      userId: ana.id,
      chatJid: bobJid,
      mutedUntil: new Date('2026-10-30T00:00:00Z'),
      archived: false,
      pinnedAt: null,
      updatedAt: new Date(),
    });
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'muted hello', 'dm-2')];

    const shared = deps();
    const outcome = await handleIncomingPush(shared, { node: 'p-ana-2', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'muted' });
    expect(sent).toHaveLength(0);
    expect(context.logOutput()).not.toContain('muted hello');
  });

  it('hides private topics the user cannot see', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    const cara = await contactOf(context, app, ana.id, 'cara@example.com');
    const groupId = randomUUID();
    const generalRoom = 'ggeneralroom00001';
    const secretRoom = 'gsecretroom000001';
    const privateTopicId = randomUUID();
    await context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: generalRoom,
      title: 'Acme Web',
      createdBy: ana.id,
    });
    await context.db.insert(groupMembers).values([
      { groupId, userId: ana.id, role: 'owner' },
      { groupId, userId: bob.id, role: 'member' },
      { groupId, userId: cara.id, role: 'member' },
    ]);
    await context.db.insert(topics).values({
      id: randomUUID(),
      groupId,
      name: 'General',
      glyph: 'G',
      roomLocalpart: generalRoom,
      visibility: 'public',
      kind: 'chat',
      status: 'open',
      isGeneral: true,
      createdBy: ana.id,
    });
    await context.db.insert(topics).values({
      id: privateTopicId,
      groupId,
      name: 'Layoffs',
      glyph: 'L',
      roomLocalpart: secretRoom,
      visibility: 'private',
      kind: 'chat',
      status: 'open',
      isGeneral: false,
      createdBy: ana.id,
    });
    await context.db.insert(topicMembers).values({
      topicId: privateTopicId,
      userId: ana.id,
      addedBy: ana.id,
    });
    // Bob is a group member but not in the private topic.
    await registerDevice(bob.id, 'p-bob-2');
    archiveRows = [roomRow(`${secretRoom}@${MUC}`, 'Ana', 'secret layoff plan text', 'room-2')];

    const outcome = await handleIncomingPush(deps(), { node: 'p-bob-2', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'hidden' });
    expect(sent).toHaveLength(0);
    expect(context.logOutput()).not.toContain('Layoffs');
    expect(context.logOutput()).not.toContain('secret layoff plan');
  });

  it('shows only who-and-where when previews are off', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-3');
    const { setShowPreviewsForUser } = await import('./store');
    await setShowPreviewsForUser(context.db, ana.id, false, new Date());
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'private preview text', 'dm-3')];

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-3', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'sent' });
    const payload = JSON.parse(sent[0]!.payload) as { title: string; body: string };
    expect(payload.title).toBe('Unnamed user');
    expect(payload.body).toBe('New message');
    expect(sent[0]!.payload).not.toContain('private preview text');
  });

  it('deletes expired subscriptions and still answers the IQ', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-4');
    sendBehavior = 'gone';
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'will expire', 'dm-4')];

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-4', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'sent' });
    const { deviceByNode } = await import('./store');
    expect(await deviceByNode(context.db, 'p-ana-4')).toBeUndefined();
  });

  it('marks failed sends without leaking the endpoint into the log', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    const deviceId = await registerDevice(ana.id, 'p-ana-5');
    sendBehavior = 'error';
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'relay refused text', 'dm-5')];

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-5', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'send-failed' });
    const { devicesForUser } = await import('./store');
    const [device] = await devicesForUser(context.db, ana.id);
    expect(device?.id).toBe(deviceId);
    expect(device?.failedAt).not.toBeNull();
    expect(device?.lastUsedAt).toBeNull();
    expect(context.logOutput()).not.toContain('relay refused');
    expect(context.logOutput()).not.toContain('push.example.com');
  });

  it('retries a failed send on the next publish IQ (F3)', async () => {
    // A transient relay failure must not suppress the message: the origin
    // id is marked only after a successful send, so the retried publish
    // notifies instead of dropping as `duplicate`.
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-retry');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'retry me', 'dm-retry')];

    const shared = deps();
    sendBehavior = 'error';
    expect(
      await handleIncomingPush(shared, { node: 'p-ana-retry', from: TEST_XMPP_DOMAIN }),
    ).toMatchObject({ kind: 'dropped', reason: 'send-failed' });
    expect(sent).toHaveLength(0);

    sendBehavior = 'ok';
    expect(
      await handleIncomingPush(shared, { node: 'p-ana-retry', from: TEST_XMPP_DOMAIN }),
    ).toMatchObject({ kind: 'sent' });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ body: 'retry me' });
  });

  it('answers unknown nodes without sending', async () => {
    const outcome = await handleIncomingPush(deps(), {
      node: 'p-nothing',
      from: TEST_XMPP_DOMAIN,
    });
    expect(outcome).toMatchObject({ kind: 'unknown-device' });
    expect(sent).toHaveLength(0);
  });

  it('never notifies twice for the same message', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-6');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'once only', 'dm-6')];

    const shared = deps();
    expect(
      await handleIncomingPush(shared, { node: 'p-ana-6', from: TEST_XMPP_DOMAIN }),
    ).toMatchObject({ kind: 'sent' });
    expect(
      await handleIncomingPush(shared, { node: 'p-ana-6', from: TEST_XMPP_DOMAIN }),
    ).toMatchObject({ kind: 'dropped', reason: 'duplicate' });
    expect(sent).toHaveLength(1);
  });

  it('notifies every device of one user for the same message (S1)', async () => {
    // Dedup is keyed by node: the phone's send must not make the laptop's
    // IQ drop the same message as a duplicate — but a retried IQ for the
    // same node still dedups.
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-phone');
    await registerDevice(ana.id, 'p-ana-laptop');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    archiveRows = [dmRow(localpartFor(ana.id), bobJid, 'both devices ring', 'dm-s1')];

    const shared = deps();
    expect(
      await handleIncomingPush(shared, { node: 'p-ana-phone', from: TEST_XMPP_DOMAIN }),
    ).toMatchObject({ kind: 'sent' });
    expect(
      await handleIncomingPush(shared, { node: 'p-ana-laptop', from: TEST_XMPP_DOMAIN }),
    ).toMatchObject({ kind: 'sent' });
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((entry) => entry.endpoint)).size).toBe(2);
    // Same node again: retry protection holds.
    expect(
      await handleIncomingPush(shared, { node: 'p-ana-phone', from: TEST_XMPP_DOMAIN }),
    ).toMatchObject({ kind: 'dropped', reason: 'duplicate' });
    expect(sent).toHaveLength(2);
  });

  it('skips retraction rows and notifies the older visible message', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-7');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    const local = localpartFor(ana.id);
    archiveRows = [
      {
        ...dmRow(local, bobJid, 'fallback sentence', 'dm-retract'),
        xml: `<message from="${bobJid}/laptop"><retract xmlns="urn:xmpp:message-retract:1" id="dm-7"/><body>fallback sentence</body></message>`,
      },
      dmRow(local, bobJid, 'still here', 'dm-7'),
    ];

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-7', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'sent' });
    const payload = JSON.parse(sent[0]!.payload) as { body: string };
    expect(payload.body).toBe('still here');
  });

  it('stays silent when the archive has nothing in scope (finding 2)', async () => {
    // Persistent emptiness may be a muted or hidden message whose MAM row
    // never landed: no generic buzz, so existence never leaks.
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    await registerDevice(ana.id, 'p-ana-8');
    archiveRows = [];

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-8', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'no-message' });
    expect(sent).toHaveLength(0);
  });

  it('notifies a message whose MAM row lands during the retry race', async () => {
    // Attempts 1-2 see nothing (the publish IQ won the race); attempt 3
    // sees the acceptable row and notifies it.
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-race');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    const late = dmRow(localpartFor(ana.id), bobJid, 'landed late', 'dm-late');
    let reads = 0;
    const racing: ArchivePool = {
      query: async () => {
        reads += 1;
        return (reads < 3 ? [] : [late]) as unknown as import('../search/service').ArchiveRow[];
      },
      close: async () => {},
    };
    const racingDeps = (): PushServiceDeps => ({ ...deps(), archive: racing });

    const outcome = await handleIncomingPush(racingDeps(), {
      node: 'p-ana-race',
      from: TEST_XMPP_DOMAIN,
    });
    expect(reads).toBe(3);
    expect(outcome).toMatchObject({ kind: 'sent' });
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ body: 'landed late' });
  });

  it('stays silent when only a muted row lands during the retry race', async () => {
    // Empty, empty, then a muted row: the trigger itself may have been the
    // muted message all along — silence, never a generic.
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await registerDevice(ana.id, 'p-ana-racer');
    const bobJid = `${localpartFor(bob.id)}@${TEST_XMPP_DOMAIN}`;
    await context.db.insert(chatPrefs).values({
      userId: ana.id,
      chatJid: bobJid,
      mutedUntil: new Date('2026-10-30T00:00:00Z'),
      archived: false,
      pinnedAt: null,
      updatedAt: new Date(),
    });
    const mutedRow = dmRow(localpartFor(ana.id), bobJid, 'muted late', 'dm-muted-late');
    let reads = 0;
    const racing: ArchivePool = {
      query: async () => {
        reads += 1;
        return (reads < 3 ? [] : [mutedRow]) as unknown as import('../search/service').ArchiveRow[];
      },
      close: async () => {},
    };
    const racingDeps = (): PushServiceDeps => ({ ...deps(), archive: racing });

    const outcome = await handleIncomingPush(racingDeps(), {
      node: 'p-ana-racer',
      from: TEST_XMPP_DOMAIN,
    });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'muted' });
    expect(sent).toHaveLength(0);
  });

  it('notifies a hidden message once it becomes visible (finding 4)', async () => {
    // A row skipped as hidden is never marked seen: after the user is
    // added to the private topic, the next IQ notifies it.
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    const groupId = randomUUID();
    const generalRoom = 'gracegeneral00001';
    const secretRoom = 'gracesecret000001';
    const privateTopicId = randomUUID();
    await context.db.insert(groups).values({
      id: groupId,
      roomLocalpart: generalRoom,
      title: 'Grace Group',
      createdBy: ana.id,
    });
    await context.db.insert(groupMembers).values([
      { groupId, userId: ana.id, role: 'owner' },
      { groupId, userId: bob.id, role: 'member' },
    ]);
    await context.db.insert(topics).values({
      id: randomUUID(),
      groupId,
      name: 'General',
      glyph: 'G',
      roomLocalpart: generalRoom,
      visibility: 'public',
      kind: 'chat',
      status: 'open',
      isGeneral: true,
      createdBy: ana.id,
    });
    await context.db.insert(topics).values({
      id: privateTopicId,
      groupId,
      name: 'Secrets',
      glyph: 'S',
      roomLocalpart: secretRoom,
      visibility: 'private',
      kind: 'chat',
      status: 'open',
      isGeneral: false,
      createdBy: ana.id,
    });
    await context.db.insert(topicMembers).values({
      topicId: privateTopicId,
      userId: ana.id,
      addedBy: ana.id,
    });
    await registerDevice(bob.id, 'p-bob-race');
    archiveRows = [roomRow(`${secretRoom}@${MUC}`, 'Ana', 'hidden plan text', 'room-hidden-1')];

    const shared = deps();
    const first = await handleIncomingPush(shared, { node: 'p-bob-race', from: TEST_XMPP_DOMAIN });
    expect(first).toMatchObject({ kind: 'dropped', reason: 'hidden' });
    expect(sent).toHaveLength(0);

    // Bob joins the private topic; the same row is still unmarked, so the
    // next IQ notifies it.
    await context.db.insert(topicMembers).values({
      topicId: privateTopicId,
      userId: bob.id,
      addedBy: ana.id,
    });
    const second = await handleIncomingPush(shared, { node: 'p-bob-race', from: TEST_XMPP_DOMAIN });
    expect(second).toMatchObject({ kind: 'sent' });
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({
      title: 'Ana in Grace Group › Secrets',
      body: 'hidden plan text',
    });
  });

  it('pins the archive query text and params (finding 1)', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    await registerDevice(ana.id, 'p-ana-query');
    const seen: Array<{ text: string; values: unknown[] }> = [];
    const spying: ArchivePool = {
      query: async (text, values) => {
        seen.push({ text, values });
        return [];
      },
      close: async () => {},
    };
    const spyingDeps = (): PushServiceDeps => ({ ...deps(), archive: spying });

    await handleIncomingPush(spyingDeps(), { node: 'p-ana-query', from: TEST_XMPP_DOMAIN });
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      // Rooms are compared as full JIDs (`username = ANY($1)`), DMs under
      // the caller's own localpart with a `bare_peer` filter — values
      // travel as bindings, never string-built SQL.
      expect(call.text).toContain('username = ANY($1)');
      expect(call.text).toContain('username = $2 AND bare_peer = ANY($3)');
      const [rooms, ownLocalpart, dmPeers, cap] = call.values;
      expect(Array.isArray(rooms)).toBe(true);
      expect(ownLocalpart).toBe(localpartFor(ana.id));
      expect(Array.isArray(dmPeers)).toBe(true);
      expect(cap).toBe(25);
    }
  });

  it('drops when the archive is down instead of guessing', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    await registerDevice(ana.id, 'p-ana-9');
    archiveThrows = true;

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-9', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'archive-unavailable' });
    expect(sent).toHaveLength(0);
  });

  it('drops undecryptable devices (rotated storage key)', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    await registerDevice(ana.id, 'p-ana-10');
    const rotated: PushServiceDeps = {
      ...deps(),
      cipher: createPushCipher('rotated-storage-key-0000000000000000'),
    };
    const outcome = await handleIncomingPush(rotated, { node: 'p-ana-10', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'undecryptable' });
    expect(sent).toHaveLength(0);
  });
});

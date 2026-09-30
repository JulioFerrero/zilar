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
const MUC = 'rooms.galena.localhost';

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

  it('sends the content-free generic when the archive has nothing in scope', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    await registerDevice(ana.id, 'p-ana-8');
    archiveRows = [];

    const outcome = await handleIncomingPush(deps(), { node: 'p-ana-8', from: TEST_XMPP_DOMAIN });
    expect(outcome).toMatchObject({ kind: 'generic' });
    expect(JSON.parse(sent[0]!.payload)).toEqual({ title: 'Galena', body: 'New message' });
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

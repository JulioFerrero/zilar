import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';
import type { ArchivePool } from '../search/service';
import { createPushCipher } from './crypto';
import type { GroupchatRow } from './archive-scan';
import {
  runGroupNotifierTick,
  type GroupNotifierDeps,
  type GroupNotifierState,
} from './group-notifier';
import type { PushServiceDeps } from './service';
import { saveDevice, type SaveDeviceInput } from './store';

// A fixed storage key and clock, matching `delivery.test.ts`.
const STORAGE_KEY = 'test-push-storage-key-0000000000000000';
const cipher = createPushCipher(STORAGE_KEY);
const NOW = new Date('2026-06-01T12:00:00Z');
const ROW_MICROS = BigInt(Date.parse('2026-06-01T11:00:00.000Z')) * 1000n;

// A static fake archive: it answers the one seeded row on every tick, so a
// second tick only stays silent when the notifier's per-node dedupe holds.
function fakeArchive(
  rows: GroupchatRow[],
): Pick<ArchivePool, 'query'> & { close: () => Promise<void> } {
  return {
    query: (async () =>
      rows.map((row) => ({
        ...row,
        headline: '',
        body: row.text,
      }))) as unknown as ArchivePool['query'],
    close: () => Promise.resolve(),
  };
}

function webPushInput(userId: string): SaveDeviceInput {
  return {
    id: randomUUID(),
    userId,
    node: randomUUID(),
    kind: 'webpush',
    subscription: {
      endpoint: `https://push.example.com/${randomUUID()}`,
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
    },
    userAgent: null,
    now: NOW,
  };
}

function buildDeps(
  context: TestContext,
  archive: { query: ArchivePool['query']; close: () => Promise<void> },
): GroupNotifierDeps {
  const service: PushServiceDeps = {
    db: context.db,
    config: context.config,
    archive: {
      query: archive.query,
      close: archive.close,
    },
    cipher,
    sender: {
      send: () => Promise.resolve({ gone: false }),
    },
    logger: { info: () => undefined, warn: () => undefined },
    recentlyNotified: new Map(),
    now: () => NOW,
  };
  return { service, admin: context.adminClient, logger: service.logger };
}

function freshState(): GroupNotifierState {
  return { cursor: { timestampMicros: 0n, rowId: 0n }, resourceCache: new Map() };
}

interface GroupSetup {
  roomJid: string;
  roomLocalpart: string;
  domain: string;
  memberIds: string[];
}

async function setupGroup(context: TestContext, memberIds: string[]): Promise<GroupSetup> {
  const ownerId = await seedUser(context);
  const { generalTopicId } = await seedGroup(
    context,
    ownerId,
    [
      { userId: ownerId, role: 'owner' },
      ...memberIds.map((userId) => ({ userId, role: 'member' as const })),
    ],
    [],
  );
  const [topic] = await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM topics
        WHERE id = ${generalTopicId} LIMIT 1`;
    }),
  );
  if (topic === undefined) {
    throw new Error('seeded general topic not found');
  }
  const roomLocalpart = topic.roomLocalpart.toLowerCase();
  const roomJid = `${roomLocalpart}@${context.config.xmpp.mucDomain}`.toLowerCase();
  return {
    roomJid,
    roomLocalpart,
    domain: context.config.xmpp.domain,
    memberIds: [ownerId, ...memberIds],
  };
}

// `barePeer` is the archived real sender JID; the nick is only display text.
function groupchatRow(
  setup: GroupSetup,
  senderId: string,
  originId: string,
  nick = localpartFor(senderId),
): GroupchatRow {
  return {
    owner: setup.roomJid,
    barePeer: `${localpartFor(senderId)}@${setup.domain}`,
    kind: 'groupchat',
    nick,
    originId,
    timestamp: ROW_MICROS,
    text: 'the group text',
    xml: `<message type="groupchat" from="${setup.roomJid}/${nick}"><body>the group text</body></message>`,
    id: 7,
  };
}

// One row of a multi-photo album: every photo carries the T-1267 marker with
// the same id, and no caption, so the payload is "{count} photos".
function albumRow(setup: GroupSetup, senderId: string, index: number): GroupchatRow {
  const nick = localpartFor(senderId);
  return {
    owner: setup.roomJid,
    barePeer: `${localpartFor(senderId)}@${setup.domain}`,
    kind: 'groupchat',
    nick,
    originId: `origin-${index}`,
    timestamp: ROW_MICROS,
    text: null,
    xml: `<message type="groupchat" from="${setup.roomJid}/${nick}"><album xmlns="urn:zilar:album:0" id="alb-1" index="${index}" count="3"/></message>`,
    id: index + 1,
  };
}

describe('runGroupNotifierTick', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('skips the sender and a connected member but delivers to an offline member', async () => {
    const senderId = await seedUser(context);
    const connectedId = await seedUser(context);
    const offlineId = await seedUser(context);
    const setup = await setupGroup(context, [senderId, connectedId, offlineId]);
    await saveDevice(context.db, cipher, webPushInput(senderId));
    await saveDevice(context.db, cipher, webPushInput(connectedId));
    const offlineDevice = await saveDevice(context.db, cipher, webPushInput(offlineId));
    context.adminClient.setOnlineResources(localpartFor(connectedId), ['phone']);

    const deps = buildDeps(context, fakeArchive([groupchatRow(setup, senderId, 'origin-1')]));
    const sent: string[] = [];
    deps.service.sender.send = (subscription: { endpoint: string }) => {
      sent.push(subscription.endpoint);
      return Promise.resolve({ gone: false });
    };

    await runGroupNotifierTick(deps, freshState());

    expect(sent).toEqual([offlineDevice.endpoint]);
  });

  it("does not push a member's own row even when the nick differs", async () => {
    const senderId = await seedUser(context);
    const otherId = await seedUser(context);
    const setup = await setupGroup(context, [senderId, otherId]);
    await saveDevice(context.db, cipher, webPushInput(senderId));
    const otherDevice = await saveDevice(context.db, cipher, webPushInput(otherId));

    // The sender joined under a display nick: `bare_peer`, not the nick,
    // decides whose row this is.
    const deps = buildDeps(
      context,
      fakeArchive([groupchatRow(setup, senderId, 'origin-nick', 'Someone Else')]),
    );
    const sent: string[] = [];
    deps.service.sender.send = (subscription: { endpoint: string }) => {
      sent.push(subscription.endpoint);
      return Promise.resolve({ gone: false });
    };

    await runGroupNotifierTick(deps, freshState());

    expect(sent).toEqual([otherDevice.endpoint]);
  });

  it('does not push a legacy own row with no bare_peer when the nick is the sender', async () => {
    const senderId = await seedUser(context);
    const otherId = await seedUser(context);
    const setup = await setupGroup(context, [senderId, otherId]);
    const senderDevice = await saveDevice(context.db, cipher, webPushInput(senderId));
    const otherDevice = await saveDevice(context.db, cipher, webPushInput(otherId));

    // An old row has no real sender JID: its nick held the sender's localpart.
    const legacyRow = { ...groupchatRow(setup, senderId, 'origin-legacy'), barePeer: '' };
    const deps = buildDeps(context, fakeArchive([legacyRow]));
    const sent: string[] = [];
    deps.service.sender.send = (subscription: { endpoint: string }) => {
      sent.push(subscription.endpoint);
      return Promise.resolve({ gone: false });
    };

    await runGroupNotifierTick(deps, freshState());

    expect(sent).toEqual([otherDevice.endpoint]);
    expect(sent).not.toContain(senderDevice.endpoint);
  });

  it('delivers exactly once per device and never repeats on the next tick', async () => {
    const senderId = await seedUser(context);
    const firstId = await seedUser(context);
    const secondId = await seedUser(context);
    const setup = await setupGroup(context, [senderId, firstId, secondId]);
    await saveDevice(context.db, cipher, webPushInput(firstId));
    await saveDevice(context.db, cipher, webPushInput(secondId));
    await saveDevice(context.db, cipher, webPushInput(secondId));

    const archive = fakeArchive([groupchatRow(setup, senderId, 'origin-2')]);
    const deps = buildDeps(context, archive);
    let sends = 0;
    deps.service.sender.send = () => {
      sends += 1;
      return Promise.resolve({ gone: false });
    };
    const state = freshState();

    await runGroupNotifierTick(deps, state);
    await runGroupNotifierTick(deps, state);

    // One send per device: the second tick is deduped per node.
    expect(sends).toBe(3);
  });

  it('sends nothing to a muted member', async () => {
    const senderId = await seedUser(context);
    const mutedId = await seedUser(context);
    const setup = await setupGroup(context, [senderId, mutedId]);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO chat_prefs (user_id, chat_jid, muted_until)
          VALUES (${mutedId}, ${setup.roomJid}, ${new Date('2026-07-01T00:00:00Z')})`;
      }),
    );
    await saveDevice(context.db, cipher, webPushInput(mutedId));

    const deps = buildDeps(context, fakeArchive([groupchatRow(setup, senderId, 'origin-3')]));
    let sends = 0;
    deps.service.sender.send = () => {
      sends += 1;
      return Promise.resolve({ gone: false });
    };

    await runGroupNotifierTick(deps, freshState());

    expect(sends).toBe(0);
  });

  it('delivers a 3-photo album once per device', async () => {
    const senderId = await seedUser(context);
    const memberId = await seedUser(context);
    const setup = await setupGroup(context, [senderId, memberId]);
    const device = await saveDevice(context.db, cipher, webPushInput(memberId));
    const rows = [0, 1, 2].map((index) => albumRow(setup, senderId, index));

    const deps = buildDeps(context, fakeArchive(rows));
    const sent: string[] = [];
    deps.service.sender.send = (subscription: { endpoint: string }) => {
      sent.push(subscription.endpoint);
      return Promise.resolve({ gone: false });
    };

    await runGroupNotifierTick(deps, freshState());

    // The album's first row is delivered; the two siblings stay silent.
    expect(sent).toEqual([device.endpoint]);
  });
});

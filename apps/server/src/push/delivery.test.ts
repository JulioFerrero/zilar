import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { createPushCipher } from './crypto';
import type { ArchiveCandidate } from './archive-scan';
import { deliverToDevice, handleIncomingPush, type ScanResult } from './delivery';
import { FcmSendError, type FcmSender, type FcmWakeData } from './fcm';
import type { ResolvedPushMessage } from './payload';
import type { PushServiceDeps } from './service';
import {
  deviceByNode,
  removeDevice,
  saveDevice,
  type PushDeviceRow,
  type SaveDeviceInput,
} from './store';

// A fixed storage key and clock, matching `store.test.ts`: the cipher only
// needs any 32+ character string, and the exact timestamps never matter.
const STORAGE_KEY = 'test-push-storage-key-0000000000000000';
const cipher = createPushCipher(STORAGE_KEY);
const NOW = new Date('2026-06-01T12:00:00Z');

// The newest acceptable message the scan would hand over: text and sender name
// are present on purpose, so a native wake leaking either would show up.
const MESSAGE: ResolvedPushMessage = {
  chatJid: 'ana@zilar.localhost',
  chatKind: 'dm',
  senderName: 'Ana',
  place: 'Ana',
  text: 'the secret text',
  messageId: 'origin-1',
};

function accepted(message: ResolvedPushMessage = MESSAGE): ScanResult {
  return { newest: { message }, notify: [message.messageId ?? 'origin-1'], saw: 'duplicate' };
}

interface NativeCall {
  token: string;
  data: FcmWakeData;
}

function fakeNativeSender(result: { gone: boolean } = { gone: false }): {
  sender: FcmSender;
  calls: NativeCall[];
} {
  const calls: NativeCall[] = [];
  return {
    sender: {
      send: (token, data) => {
        calls.push({ token, data });
        return Promise.resolve(result);
      },
    },
    calls,
  };
}

interface WebCall {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: string;
}

function fakeWebSender(result: { gone: boolean } = { gone: false }): {
  sender: PushServiceDeps['sender'];
  calls: WebCall[];
} {
  const calls: WebCall[] = [];
  return {
    sender: {
      send: (subscription, payload) => {
        calls.push({ subscription, payload });
        return Promise.resolve(result);
      },
    },
    calls,
  };
}

// `deliverToDevice` reads `db`, `config`, `cipher`, the two senders and `now`;
// the archive is a stub because the scan already ran.
function buildDeps(
  context: TestContext,
  options: {
    sender?: PushServiceDeps['sender'];
    nativeSender?: FcmSender;
    archive?: PushServiceDeps['archive'];
  } = {},
): PushServiceDeps {
  return {
    db: context.db,
    config: context.config,
    archive: options.archive ?? {
      query: () => Promise.resolve([]),
      close: () => Promise.resolve(),
    },
    cipher,
    sender: options.sender ?? { send: () => Promise.resolve({ gone: false }) },
    ...(options.nativeSender === undefined ? {} : { nativeSender: options.nativeSender }),
    logger: { info: () => undefined, warn: () => undefined },
    recentlyNotified: new Map(),
    now: () => NOW,
  };
}

function webPushInput(userId: string): SaveDeviceInput {
  return {
    id: randomUUID(),
    userId,
    node: randomUUID(),
    kind: 'webpush',
    subscription: {
      endpoint: 'https://push.example.com/1',
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
    },
    userAgent: null,
    now: NOW,
  };
}

function fcmInput(userId: string, token = 'fcm-token-1'): SaveDeviceInput {
  return {
    id: randomUUID(),
    userId,
    node: randomUUID(),
    kind: 'fcm',
    token,
    userAgent: null,
    now: NOW,
  };
}

function run(deps: PushServiceDeps, device: PushDeviceRow, scan: ScanResult) {
  return Effect.runPromise(deliverToDevice(deps, device, scan));
}

describe('deliverToDevice', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('sends an ids-only wake to an fcm device', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, fcmInput(userId));
    const { sender, calls } = fakeNativeSender();

    const outcome = await run(buildDeps(context, { nativeSender: sender }), device, accepted());

    expect(outcome).toEqual({ kind: 'sent', userId, deviceId: device.id });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.token).toBe('fcm-token-1');
    expect(calls[0]?.data).toEqual({
      chatId: 'ana@zilar.localhost',
      chatKind: 'dm',
      messageId: 'origin-1',
      serverId: context.config.xmpp.domain,
    });
    expect(calls[0]?.data).not.toHaveProperty('text');
    expect(calls[0]?.data).not.toHaveProperty('senderName');
  });

  it('still sends the Web Push payload to a webpush device', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, webPushInput(userId));
    const { sender, calls } = fakeWebSender();

    const outcome = await run(buildDeps(context, { sender }), device, accepted());

    expect(outcome).toEqual({ kind: 'sent', userId, deviceId: device.id });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.subscription).toEqual({
      endpoint: 'https://push.example.com/1',
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
    });
    expect(JSON.parse(calls[0]?.payload ?? '')).toEqual({
      title: 'Ana',
      body: 'the secret text',
      chatId: 'ana@zilar.localhost',
      messageId: 'origin-1',
    });
  });

  it('drops a muted scan result before either sender is called', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, fcmInput(userId));
    const native = fakeNativeSender();
    const web = fakeWebSender();
    const scan: ScanResult = { newest: undefined, notify: [], saw: 'muted' };

    const outcome = await run(
      buildDeps(context, { sender: web.sender, nativeSender: native.sender }),
      device,
      scan,
    );

    expect(outcome).toEqual({ kind: 'dropped', userId, deviceId: device.id, reason: 'muted' });
    expect(native.calls).toHaveLength(0);
    expect(web.calls).toHaveLength(0);
  });

  it('removes an fcm device whose token is gone', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, fcmInput(userId));
    const { sender } = fakeNativeSender({ gone: true });
    const deps = buildDeps(context, { nativeSender: sender });
    deps.recentlyNotified.set(device.node, new Set(['origin-1']));

    await run(deps, device, accepted());

    expect(await deviceByNode(context.db, device.node)).toBeUndefined();
    // PERF-17: the removed device's dedupe set goes with its row.
    expect(deps.recentlyNotified.has(device.node)).toBe(false);
  });

  it('drops an fcm device as send-failed when no native sender is configured', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, fcmInput(userId));

    const outcome = await run(buildDeps(context), device, accepted());

    expect(outcome).toEqual({
      kind: 'dropped',
      userId,
      deviceId: device.id,
      reason: 'send-failed',
    });
  });
});

// Microsecond-stamped DM rows for the archive stub, newest first — the order
// readNewestCandidates returns them in.
function archiveRow(originId: string, timestampMicros: bigint): ArchiveCandidate {
  return {
    owner: 'ignored',
    barePeer: 'ana@zilar.localhost',
    kind: 'chat',
    nick: '',
    originId,
    timestamp: timestampMicros,
    text: 'hello',
    xml: '<message from="ana@zilar.localhost" type="chat"><body>hello</body></message>',
  };
}

// `ArchivePool.query` is typed on the wider `ArchiveRow`; the scan only
// reads the `ArchiveCandidate` subset, so the stub widens back.
function stubArchive(rows: ArchiveCandidate[]): PushServiceDeps['archive'] {
  return {
    query: () => Promise.resolve(rows.map((row) => ({ ...row, peer: '', headline: '' }))),
    close: () => Promise.resolve(),
  };
}

function microsAgo(ms: number): bigint {
  return BigInt(NOW.getTime() - ms) * 1000n;
}

describe('handleIncomingPush archive scan', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('notifies three unseen messages oldest-first across three publish IQs', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, webPushInput(userId));
    const { sender, calls } = fakeWebSender();
    const rows = [
      archiveRow('origin-new', microsAgo(60_000)),
      archiveRow('origin-mid', microsAgo(120_000)),
      archiveRow('origin-old', microsAgo(180_000)),
    ];
    const deps = buildDeps(context, { sender, archive: stubArchive(rows) });
    const notification = { node: device.node, from: 'ana@zilar.localhost' };

    for (let iq = 0; iq < 3; iq += 1) {
      const outcome = await handleIncomingPush(deps, notification);
      expect(outcome).toEqual({ kind: 'sent', userId, deviceId: device.id });
    }
    expect(calls.map((call) => JSON.parse(call.payload).messageId)).toEqual([
      'origin-old',
      'origin-mid',
      'origin-new',
    ]);

    const repeat = await handleIncomingPush(deps, notification);
    expect(repeat).toEqual({ kind: 'dropped', userId, deviceId: device.id, reason: 'duplicate' });
    expect(calls).toHaveLength(3);
  });

  it('never notifies a row older than ten minutes', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, webPushInput(userId));
    const { sender, calls } = fakeWebSender();
    const deps = buildDeps(context, {
      sender,
      archive: stubArchive([archiveRow('origin-stale', microsAgo(20 * 60_000))]),
    });

    const outcome = await handleIncomingPush(deps, { node: device.node, from: 'ana' });

    expect(outcome.kind).toBe('dropped');
    expect(calls).toHaveLength(0);
  });

  it('stores the FCM failure reason and clears it on a later success', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, fcmInput(userId));
    const rows = [archiveRow('origin-fail', microsAgo(60_000))];
    const failing: FcmSender = {
      send: () => Promise.reject(new FcmSendError(503, 'UNAVAILABLE')),
    };

    const failed = await handleIncomingPush(
      buildDeps(context, { nativeSender: failing, archive: stubArchive(rows) }),
      { node: device.node, from: 'ana@zilar.localhost' },
    );

    expect(failed).toEqual({ kind: 'dropped', userId, deviceId: device.id, reason: 'send-failed' });
    const afterFailure = await deviceByNode(context.db, device.node);
    expect(afterFailure?.lastFailure).toBe('UNAVAILABLE');
    expect(afterFailure?.failedAt?.toISOString()).toBe(NOW.toISOString());

    const { sender } = fakeNativeSender();
    const sent = await handleIncomingPush(
      buildDeps(context, { nativeSender: sender, archive: stubArchive(rows) }),
      { node: device.node, from: 'ana@zilar.localhost' },
    );

    expect(sent).toEqual({ kind: 'sent', userId, deviceId: device.id });
    const afterSuccess = await deviceByNode(context.db, device.node);
    expect(afterSuccess?.lastFailure).toBeNull();
    expect(afterSuccess?.failedAt).toBeNull();
    expect(afterSuccess?.lastUsedAt?.toISOString()).toBe(NOW.toISOString());
  });
});

// PERF-17: a device removed outside the delivery pipeline (the API
// `DELETE /push/subscriptions`, or T-1255's session-revoke cascade deleting
// the row) shows up as `unknown-device` on its next publish; that is where the
// component forgets the node's dedupe set.
describe('handleIncomingPush removed devices', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('forgets an unsubscribed node when its publish arrives', async () => {
    const userId = await seedUser(context);
    const device = await saveDevice(context.db, cipher, webPushInput(userId));
    const deps = buildDeps(context);
    deps.recentlyNotified.set(device.node, new Set(['origin-1']));

    // The unsubscribe path deletes the row: the API handler calls
    // `removeDevice`, not the component.
    await removeDevice(context.db, userId, device.id);

    const outcome = await handleIncomingPush(deps, { node: device.node, from: 'ana' });

    expect(outcome).toEqual({ kind: 'unknown-device', node: device.node });
    expect(deps.recentlyNotified.has(device.node)).toBe(false);
  });
});

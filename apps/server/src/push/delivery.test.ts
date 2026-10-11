import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support';
import { seedUser } from '../test-support/seed';
import { createPushCipher } from './crypto';
import { deliverToDevice, type ScanResult } from './delivery';
import type { FcmSender, FcmWakeData } from './fcm';
import type { ResolvedPushMessage } from './payload';
import type { PushServiceDeps } from './service';
import { deviceByNode, saveDevice, type PushDeviceRow, type SaveDeviceInput } from './store';

// A fixed storage key and clock, matching `store.test.ts`: the cipher only
// needs any 32+ character string, and the exact timestamps never matter.
const STORAGE_KEY = 'test-push-storage-key-0000000000000000';
const cipher = createPushCipher(STORAGE_KEY);
const NOW = new Date('2026-06-01T12:00:00Z');

// The newest acceptable message the scan would hand over: text and sender name
// are present on purpose, so a native wake leaking either would show up.
const MESSAGE: ResolvedPushMessage = {
  chatJid: 'ana@zilar.localhost',
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
  options: { sender?: PushServiceDeps['sender']; nativeSender?: FcmSender } = {},
): PushServiceDeps {
  return {
    db: context.db,
    config: context.config,
    archive: { query: () => Promise.resolve([]), close: () => Promise.resolve() },
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

    await run(buildDeps(context, { nativeSender: sender }), device, accepted());

    expect(await deviceByNode(context.db, device.node)).toBeUndefined();
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

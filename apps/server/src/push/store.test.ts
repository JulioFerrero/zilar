import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestContext,
} from '../test-support';
import { createPushCipher } from './crypto';
import { createPushTestTables } from './test-tables';
import { devicesForUser, toPushDeviceView } from './store';
import type { WebPushSubscription } from './subscriptions';

const STORAGE_KEY = 'test-push-storage-key-0000000000000000';

function subscription(endpoint: string): WebPushSubscription {
  return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
}

describe('push device store', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
    await createPushTestTables(context.db);
  });

  afterEach(async () => {
    await context.close();
  });

  it('saves, lists, seals and removes own devices', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const cipher = createPushCipher(STORAGE_KEY);
    const { saveDevice, removeDevice, deviceByNode } = await import('./store');

    const row = await saveDevice(context.db, cipher, {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-device-1',
      subscription: subscription('https://push.example.com/sub/1'),
      userAgent: 'Test Browser',
      now: new Date('2026-09-30T10:00:00Z'),
    });
    // The keys are sealed at rest, never plaintext.
    expect(row.p256dh).not.toContain('p256dh-key');
    expect(row.endpoint).toBe('https://push.example.com/sub/1');

    expect(await deviceByNode(context.db, 'p-device-1')).toMatchObject({ id: row.id });
    expect(await deviceByNode(context.db, 'p-unknown')).toBeUndefined();

    const devices = await devicesForUser(context.db, ana.id);
    expect(devices.map((device) => device.node)).toEqual(['p-device-1']);

    // A fresh device counts from its registration (not inactive yet).
    const view = toPushDeviceView(row, new Date('2026-09-30T11:00:00Z'));
    expect(view).toMatchObject({ id: row.id, userAgent: 'Test Browser', inactive: false });

    // Scoped remove: another user's id does not remove anything.
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    expect(await removeDevice(context.db, bob.id, row.id)).toBe(false);
    expect(await removeDevice(context.db, ana.id, 'missing')).toBe(false);
    expect(await removeDevice(context.db, ana.id, row.id)).toBe(true);
    expect(await devicesForUser(context.db, ana.id)).toEqual([]);
  });

  it('replaces a re-registration of the same endpoint', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const cipher = createPushCipher(STORAGE_KEY);
    const { saveDevice } = await import('./store');
    const now = new Date('2026-09-30T10:00:00Z');

    await saveDevice(context.db, cipher, {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-first',
      subscription: subscription('https://push.example.com/sub/1'),
      userAgent: null,
      now,
    });
    await saveDevice(context.db, cipher, {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-second',
      subscription: subscription('https://push.example.com/sub/1'),
      userAgent: null,
      now,
    });
    expect((await devicesForUser(context.db, ana.id)).map((row) => row.node)).toEqual(['p-second']);
  });

  it('marks devices inactive after 90 days without a send', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const cipher = createPushCipher(STORAGE_KEY);
    const { saveDevice, markDeviceUsed } = await import('./store');

    const row = await saveDevice(context.db, cipher, {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-old',
      subscription: subscription('https://push.example.com/sub/old'),
      userAgent: null,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(toPushDeviceView(row, new Date('2026-04-02T00:00:00Z')).inactive).toBe(true);
    await markDeviceUsed(context.db, row.id, new Date('2026-04-01T00:00:00Z'));
    const [used] = await devicesForUser(context.db, ana.id);
    expect(toPushDeviceView(used!, new Date('2026-04-02T00:00:00Z')).inactive).toBe(false);
  });

  it('stores the previews setting per user, defaulting to on', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const { showPreviewsForUser, setShowPreviewsForUser } = await import('./store');
    expect(await showPreviewsForUser(context.db, ana.id)).toBe(true);
    expect(await setShowPreviewsForUser(context.db, ana.id, false, new Date())).toBe(false);
    expect(await showPreviewsForUser(context.db, ana.id)).toBe(false);
  });

  it('never exposes the endpoint URL in the device view', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const cipher = createPushCipher(STORAGE_KEY);
    const { saveDevice } = await import('./store');
    const row = await saveDevice(context.db, cipher, {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-view',
      subscription: subscription('https://push.example.com/secret-sub'),
      userAgent: null,
      now: new Date(),
    });
    const json = JSON.stringify(toPushDeviceView(row, new Date()));
    expect(json).not.toContain('push.example.com');
    expect(TEST_BASE_URL).toContain('localhost');
  });
});

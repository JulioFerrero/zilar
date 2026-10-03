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

  it('caps devices at 20 per user, atomically under concurrency', async () => {
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const cipher = createPushCipher(STORAGE_KEY);
    const { saveDevice } = await import('./store');
    const { HttpError } = await import('../errors');
    const now = new Date('2026-09-30T10:00:00Z');

    // 21 concurrent registrations with distinct endpoints: the per-user
    // advisory lock serializes the count-then-insert, so exactly 20 win
    // and one answers 409 — never 21 rows.
    const outcomes = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        saveDevice(context.db, cipher, {
          id: randomUUID(),
          userId: ana.id,
          node: `p-conc-${index}`,
          subscription: subscription(`https://push.example.com/conc-${index}`),
          userAgent: null,
          now,
        }).then(
          () => 'saved' as const,
          (error: unknown) =>
            error instanceof HttpError && error.code === 'too_many_devices'
              ? ('capped' as const)
              : (() => {
                  throw error;
                })(),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === 'saved')).toHaveLength(20);
    expect(outcomes.filter((outcome) => outcome === 'capped')).toHaveLength(1);
    expect(await devicesForUser(context.db, ana.id)).toHaveLength(20);
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

  it('drops the stale enable-pair when a device re-registers (same endpoint, new node)', async () => {
    // The row delete is scoped by user id AND endpoint in the same
    // transaction as the insert: the old pair's node is reported to the
    // admin seam so the caller can drop it in ejabberd, and a failure there
    // never fails the registration. The seam carries ids only — no endpoint
    // URL, no keys.
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    const cipher = createPushCipher(STORAGE_KEY);
    const { saveDevice } = await import('./store');
    const now = new Date('2026-09-30T10:00:00Z');

    await saveDevice(context.db, cipher, {
      id: randomUUID(),
      userId: ana.id,
      node: 'p-old-pair',
      subscription: subscription('https://push.example.com/sub/rereg'),
      userAgent: null,
      now,
    });
    const disabled: Array<{ userId: string; node: string }> = [];
    await saveDevice(
      context.db,
      cipher,
      {
        id: randomUUID(),
        userId: ana.id,
        node: 'p-new-pair',
        subscription: subscription('https://push.example.com/sub/rereg'),
        userAgent: null,
        now,
      },
      {
        disablePushPair: (userId, node) => {
          disabled.push({ userId, node });
          return Promise.resolve();
        },
      },
    );
    expect(disabled).toEqual([{ userId: ana.id, node: 'p-old-pair' }]);
    expect((await devicesForUser(context.db, ana.id)).map((row) => row.node)).toEqual([
      'p-new-pair',
    ]);

    // A re-registration whose cleanup throws still registers: the stray
    // pair's publishes drop as `unknown-device` instead of failing the call.
    await saveDevice(
      context.db,
      cipher,
      {
        id: randomUUID(),
        userId: ana.id,
        node: 'p-newer-pair',
        subscription: subscription('https://push.example.com/sub/rereg'),
        userAgent: null,
        now,
      },
      {
        disablePushPair: () => Promise.reject(new Error('ejabberd is down')),
      },
    );
    expect((await devicesForUser(context.db, ana.id)).map((row) => row.node)).toEqual([
      'p-newer-pair',
    ]);

    // Another user's identical endpoint is untouched: the delete is scoped
    // by user id, not by endpoint alone.
    const bob = await contactOf(context, app, ana.id, 'bob@example.com');
    await saveDevice(context.db, cipher, {
      id: randomUUID(),
      userId: bob.id,
      node: 'p-bob',
      subscription: subscription('https://push.example.com/sub/rereg'),
      userAgent: null,
      now,
    });
    const seen: string[] = [];
    await saveDevice(
      context.db,
      cipher,
      {
        id: randomUUID(),
        userId: ana.id,
        node: 'p-newest-pair',
        subscription: subscription('https://push.example.com/sub/rereg'),
        userAgent: null,
        now,
      },
      {
        disablePushPair: (_userId, node) => {
          seen.push(node);
          return Promise.resolve();
        },
      },
    );
    expect(seen).toEqual(['p-newer-pair']);
    expect((await devicesForUser(context.db, bob.id)).map((row) => row.node)).toEqual(['p-bob']);
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

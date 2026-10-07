import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapUser,
  createTestContext,
  testApp,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import type { ArchivePool } from '../search/service';
import { createPushCipher } from './crypto';
import { handleIncomingPush, type PushServiceDeps } from './service';
import { saveDevice } from './store';
import type { WebPushSubscription } from './subscriptions';
import { createPushTestTables } from './test-tables';

const STORAGE_KEY = 'test-push-storage-key-0000000000000000';

function subscription(endpoint: string): WebPushSubscription {
  return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
}

describe('push delivery Effect boundary', () => {
  let context: TestContext;
  let sent: number;

  beforeEach(async () => {
    context = await createTestContext();
    await createPushTestTables(context.db);
    sent = 0;
  });

  afterEach(async () => {
    await context.close();
  });

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

  function deps(archive: ArchivePool): PushServiceDeps {
    return {
      db: context.db,
      config: context.config,
      archive,
      cipher: createPushCipher(STORAGE_KEY),
      sender: {
        send: async () => {
          sent += 1;
          return { gone: false };
        },
      },
      logger: context.logger,
      recentlyNotified: new Map(),
    };
  }

  it('drops as archive-unavailable on a synchronous scan throw instead of rejecting (finding 1)', async () => {
    // The archive answers a non-array, so the scan's own bookkeeping
    // (`rows.length` over the cast result) throws synchronously. The old
    // Promise version caught any throw from `newestMessageForUser` and
    // dropped as `archive-unavailable`; the Effect pipeline must keep that
    // and never reject the boundary (ejabberd would disable the push pair).
    const app = testApp(context);
    const ana = await bootstrapUser(context, app, 'ana@example.com');
    await registerDevice(ana.id, 'p-ana-sync');
    const archive: ArchivePool = {
      query: async () => null as unknown as import('../search/service').ArchiveRow[],
      close: async () => {},
    };

    const outcome = await handleIncomingPush(deps(archive), {
      node: 'p-ana-sync',
      from: TEST_XMPP_DOMAIN,
    });
    expect(outcome).toMatchObject({ kind: 'dropped', reason: 'archive-unavailable' });
    expect(sent).toBe(0);
  });
});

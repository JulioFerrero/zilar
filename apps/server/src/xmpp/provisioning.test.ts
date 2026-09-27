import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { user, xmppAccounts } from '../db/schema';
import { FakeAdminClient, createTestContext, type TestContext } from '../test-support';
import { ensureXmppAccount, findXmppAccount, jidFor, localpartFor } from './provisioning';

// ensureXmppAccount never creates users itself: it only maps an existing one.
async function createUser(context: TestContext, id: string): Promise<void> {
  await context.db.insert(user).values({
    id,
    name: '',
    email: `${id.replace(/[^a-zA-Z0-9]/g, '_')}@example.com`,
    emailVerified: true,
  });
}

describe('localpartFor', () => {
  it('is deterministic', () => {
    expect(localpartFor('user-123')).toBe(localpartFor('user-123'));
  });

  it('uses a valid Better Auth id as-is', () => {
    expect(localpartFor('abc123def456')).toBe('abc123def456');
  });

  it('lowercases a Better Auth id', () => {
    expect(localpartFor('ZHj28vfbcT5vss0u0vWhveDDnx5ptPkk')).toBe(
      'zhj28vfbct5vss0u0vwhveddnx5ptpkk',
    );
  });

  it('produces valid localparts for hostile ids', () => {
    for (const userId of ['user@example.com', 'José', 'a'.repeat(80), 'id with spaces', '🦊']) {
      const localpart = localpartFor(userId);
      expect(localpart).toMatch(/^[a-z0-9._-]{1,64}$/);
    }
  });

  it('gives different users different localparts', () => {
    const ids = Array.from({ length: 50 }, (_, index) => `User ${index}@example.com`);
    const localparts = new Set(ids.map(localpartFor));
    expect(localparts.size).toBe(ids.length);
  });

  it('truncates long hostile ids to a stable, short localpart', () => {
    const userId = 'X'.repeat(500);
    expect(localpartFor(userId)).toHaveLength(21);
    expect(localpartFor(userId)).toBe(localpartFor(userId));
  });
});

describe('jidFor', () => {
  it('joins localpart and domain', () => {
    expect(jidFor('alice', 'galena.localhost')).toBe('alice@galena.localhost');
  });
});

describe('ensureXmppAccount', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('creates the row and registers the account in ejabberd', async () => {
    await createUser(context, 'user-one');
    const result = await ensureXmppAccount(
      context.db,
      context.adminClient,
      'user-one',
      context.xmppConfig.domain,
    );

    expect(result).toEqual({ jid: 'user-one@galena.localhost', provisioned: true });
    expect(context.adminClient.registered).toEqual(['user-one']);

    const row = await findXmppAccount(context.db, 'user-one');
    expect(row).toMatchObject({ localpart: 'user-one', provisioned: true });
    expect(await context.db.select().from(xmppAccounts)).toHaveLength(1);
  });

  it('is idempotent and safe under concurrency', async () => {
    await createUser(context, 'user-race');
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        ensureXmppAccount(context.db, context.adminClient, 'user-race', context.xmppConfig.domain),
      ),
    );

    for (const result of results) {
      expect(result).toEqual({ jid: 'user-race@galena.localhost', provisioned: true });
    }
    expect(await context.db.select().from(xmppAccounts)).toHaveLength(1);
  });

  it('maps a hostile user id to a valid JID', async () => {
    await createUser(context, 'User@Example.com');
    const result = await ensureXmppAccount(
      context.db,
      context.adminClient,
      'User@Example.com',
      context.xmppConfig.domain,
    );

    const localpart = result.jid.slice(0, result.jid.indexOf('@'));
    expect(localpart).toMatch(/^[a-z0-9._-]{1,64}$/);
    expect(context.adminClient.registered).toEqual([localpart]);
  });

  it('keeps provisioned false when the admin client fails, and rethrows without requesterId', async () => {
    await createUser(context, 'user-down');
    const adminClient = new FakeAdminClient();
    adminClient.failRegister = true;

    await expect(
      ensureXmppAccount(context.db, adminClient, 'user-down', context.xmppConfig.domain),
    ).rejects.toThrow('ejabberd is down');

    const row = await findXmppAccount(context.db, 'user-down');
    expect(row).toMatchObject({ provisioned: false });
  });

  it('returns provisioned false instead of throwing when a requester is set', async () => {
    await createUser(context, 'user-lazy');
    const adminClient = new FakeAdminClient();
    adminClient.failRegister = true;

    const result = await ensureXmppAccount(
      context.db,
      adminClient,
      'user-lazy',
      context.xmppConfig.domain,
      { requesterId: 'user-lazy' },
    );

    expect(result).toEqual({ jid: 'user-lazy@galena.localhost', provisioned: false });
  });

  it('retries provisioning lazily and flips provisioned to true', async () => {
    await createUser(context, 'user-retry');
    const adminClient = new FakeAdminClient();
    adminClient.failRegister = true;

    const first = await ensureXmppAccount(
      context.db,
      adminClient,
      'user-retry',
      context.xmppConfig.domain,
      { requesterId: 'user-retry' },
    );
    expect(first.provisioned).toBe(false);

    adminClient.failRegister = false;
    const second = await ensureXmppAccount(
      context.db,
      adminClient,
      'user-retry',
      context.xmppConfig.domain,
      { requesterId: 'user-retry' },
    );
    expect(second.provisioned).toBe(true);
    expect(adminClient.registered).toEqual(['user-retry']);
  });
});

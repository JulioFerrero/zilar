import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import {
  DEFAULT_INVITE_MAX_USES,
  consumeInvite,
  createInvite,
  findInviteByCode,
  findUsableInvite,
  generateInviteCode,
  revokeInvite,
} from './invites';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

describe('invites', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('generates 128-bit base64url codes', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateInviteCode()).not.toBe(code);
  });

  it('creates an invite with the documented defaults', async () => {
    const before = Date.now();
    const invite = await createInvite(context.db, { createdBy: null });

    expect(invite.maxUses).toBe(DEFAULT_INVITE_MAX_USES);
    expect(invite.uses).toBe(0);
    expect(invite.createdBy).toBeNull();
    expect(invite.revokedAt).toBeNull();
    expect(invite.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY_IN_MS);
  });

  it('records the creator when there is one', async () => {
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO "user" (id, name, email) VALUES (${'user-1'}, ${'Creator'}, ${'creator@example.com'})`;
      }),
    );

    const invite = await createInvite(context.db, { createdBy: 'user-1' });
    expect(invite.createdBy).toBe('user-1');
  });

  it('finds usable invites and ignores expired, revoked or used-up ones', async () => {
    const usable = await createInvite(context.db, { createdBy: null });
    expect(await findUsableInvite(context.db, usable.code)).not.toBeNull();

    const expired = await createInvite(context.db, { createdBy: null, expiresInDays: -1 });
    expect(await findUsableInvite(context.db, expired.code)).toBeNull();

    const revoked = await createInvite(context.db, { createdBy: null });
    await revokeInvite(context.db, revoked.code);
    expect(await findUsableInvite(context.db, revoked.code)).toBeNull();

    const usedUp = await createInvite(context.db, { createdBy: null, maxUses: 1 });
    await consumeInvite(context.db, usedUp.code);
    expect(await findUsableInvite(context.db, usedUp.code)).toBeNull();

    expect(await findUsableInvite(context.db, 'missing-code')).toBeNull();
  });

  it('consumes an invite atomically under concurrency', async () => {
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 1 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeInvite(context.db, invite.code)),
    );

    expect(results.filter((row) => row !== null)).toHaveLength(1);
    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(1);
  });

  it('increments uses up to maxUses and then stops', async () => {
    const invite = await createInvite(context.db, { createdBy: null, maxUses: 2 });

    expect(await consumeInvite(context.db, invite.code)).not.toBeNull();
    expect(await consumeInvite(context.db, invite.code)).not.toBeNull();
    expect(await consumeInvite(context.db, invite.code)).toBeNull();

    const stored = await findInviteByCode(context.db, invite.code);
    expect(stored?.uses).toBe(2);
  });

  it('revokes an invite once', async () => {
    const invite = await createInvite(context.db, { createdBy: null });

    const revoked = await revokeInvite(context.db, invite.code);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(await revokeInvite(context.db, invite.code)).toBeNull();
    expect(await consumeInvite(context.db, invite.code)).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { instanceOwnerId, isInstanceOwner, INSTANCE_OWNER_SETTING } from './instance-owner';

interface CapturedWarn {
  fields: Record<string, unknown>;
  message: string;
}

function captureLogger(): {
  warn: (fields: Record<string, unknown>, message: string) => void;
  calls: CapturedWarn[];
} {
  const calls: CapturedWarn[] = [];
  return {
    warn: (fields, message) => {
      calls.push({ fields, message });
    },
    calls,
  };
}

async function seedUserAt(context: TestContext, createdAt: string, email: string): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "user" (id, name, email, created_at)
        VALUES (${id}, ${'User'}, ${email}, ${createdAt})`;
    }),
  );
  return id;
}

async function deleteUser(context: TestContext, userId: string): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM "user" WHERE id = ${userId}`;
    }),
  );
}

async function storedOwner(context: TestContext): Promise<string | null> {
  return testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ value: string }>`SELECT value FROM instance_settings
        WHERE key = ${INSTANCE_OWNER_SETTING}`;
      return rows[0]?.value ?? null;
    }),
  );
}

describe('instance owner', () => {
  let context: TestContext;
  let logger: ReturnType<typeof captureLogger>;

  beforeEach(async () => {
    context = await createTestContext();
    logger = captureLogger();
  });

  afterEach(async () => {
    await context.close();
  });

  it('stores the oldest user on the first call and reuses it afterwards', async () => {
    const oldest = await seedUserAt(context, '2026-01-01 00:00:00', 'oldest@example.com');
    const newer = await seedUserAt(context, '2026-02-01 00:00:00', 'newer@example.com');

    expect(await instanceOwnerId(context.db)).toBe(oldest);
    expect(await storedOwner(context)).toBe(oldest);

    // A later account does not take over: the first claim is final.
    await seedUserAt(context, '2026-03-01 00:00:00', 'latest@example.com');
    expect(await instanceOwnerId(context.db)).toBe(oldest);
    expect(await isInstanceOwner(context.db, oldest)).toBe(true);
    expect(await isInstanceOwner(context.db, newer)).toBe(false);
  });

  it("does not move ownership when the owner's row is deleted", async () => {
    const oldest = await seedUserAt(context, '2026-01-01 00:00:00', 'oldest@example.com');
    const surviving = await seedUserAt(context, '2026-02-01 00:00:00', 'surviving@example.com');
    expect(await instanceOwnerId(context.db)).toBe(oldest);

    await deleteUser(context, oldest);

    // The stored id is unchanged, and no remaining user becomes the owner.
    expect(await instanceOwnerId(context.db)).toBe(oldest);
    expect(await isInstanceOwner(context.db, surviving, logger)).toBe(false);
    expect(await isInstanceOwner(context.db, oldest, logger)).toBe(false);

    // One warn per check, ids only.
    expect(logger.calls).toHaveLength(2);
    for (const call of logger.calls) {
      expect(call.fields).toEqual({ ownerUserId: oldest, userId: expect.any(String) });
    }
  });

  it('returns null and stores nothing when there are no users', async () => {
    expect(await instanceOwnerId(context.db)).toBeNull();
    expect(await storedOwner(context)).toBeNull();
  });
});

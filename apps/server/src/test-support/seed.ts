import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AisRow, GroupMemberRow } from '../db/rows';
import { testSql, type TestContext } from '../test-support';

// Raw-SQL seed helpers shared by the server test files. Each writes through
// `testSql`, so a test seeds and asserts on the same effect/sql runtime the
// modules use. The defaults mirror the per-file copies these replaced; a test
// passes an override where its old copy used a different column.

export interface SeedUserOverrides {
  name?: string;
  email?: string;
}

export async function seedUser(
  context: TestContext,
  overrides: SeedUserOverrides = {},
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "user" ${sql.insert({
        id,
        name: overrides.name ?? 'User',
        email: overrides.email ?? `${id}@example.com`,
      })}`;
    }),
  );
  return id;
}

export interface SeedAiOverrides {
  name?: string;
  status?: AisRow['status'];
  perDayUsd?: string;
  perMonthUsd?: string;
}

export async function seedAi(
  context: TestContext,
  ownerId: string,
  overrides: SeedAiOverrides = {},
): Promise<{ aiId: string; jid: string }> {
  const connectionId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO provider_connections ${sql.insert({
        id: connectionId,
        owner: ownerId,
        provider: 'openai',
        encrypted_key: 'sealed-placeholder',
        label: null,
      })}`;
    }),
  );

  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  const jid = `${localpart}@zilar.localhost`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ais ${sql.insert({
        id: aiId,
        owner: ownerId,
        name: overrides.name ?? 'Helper AI',
        template: 'dev',
        persona: 'A persona',
        provider_connection_id: connectionId,
        model: 'gpt-4o-mini',
        localpart,
        jid,
        status: overrides.status ?? 'active',
      })}`;
      yield* sql`INSERT INTO ai_limits ${sql.insert({
        ai_id: aiId,
        per_day_usd: overrides.perDayUsd ?? '1.00',
        per_month_usd: overrides.perMonthUsd ?? '20.00',
      })}`;
    }),
  );
  return { aiId, jid };
}

// A group member, with the role union from the `group_members` row type.
export interface SeedGroupMember {
  userId: string;
  role: GroupMemberRow['role'];
}

export interface SeedGroupOverrides {
  title?: string;
}

export async function seedGroup(
  context: TestContext,
  ownerId: string,
  members: SeedGroupMember[],
  aiIds: string[],
  overrides: SeedGroupOverrides = {},
): Promise<{ groupId: string; generalTopicId: string }> {
  const groupId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO groups ${sql.insert({
        id: groupId,
        room_localpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
        title: overrides.title ?? 'Trip',
        created_by: ownerId,
      })}`;
      yield* sql`INSERT INTO group_members ${sql.insert(
        members.map((entry) => ({
          group_id: groupId,
          user_id: entry.userId,
          role: entry.role,
        })),
      )}`;
      for (const aiId of aiIds) {
        yield* sql`INSERT INTO group_ais ${sql.insert({ group_id: groupId, ai_id: aiId, added_by: ownerId })}`;
      }
    }),
  );

  // Every group has a General topic; group-scoped fixtures use it.
  const generalTopicId = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id: generalTopicId,
        group_id: groupId,
        name: 'General',
        glyph: 'G',
        room_localpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        is_general: true,
        created_by: ownerId,
      })}`;
    }),
  );
  return { groupId, generalTopicId };
}

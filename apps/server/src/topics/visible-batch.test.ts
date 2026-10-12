import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { TopicRow } from '../db/rows';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { visibleTopics } from './access';
import { visibleTopicsForGroups } from './visible-batch';

function sortedIds(rows: readonly TopicRow[]): string[] {
  return rows.map((row) => row.id).sort();
}

interface SeedTopicOptions {
  name: string;
  visibility?: 'public' | 'private';
  archived?: boolean;
}

async function seedTopic(
  context: TestContext,
  groupId: string,
  createdBy: string,
  options: SeedTopicOptions,
): Promise<string> {
  const id = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics ${sql.insert({
        id,
        group_id: groupId,
        name: options.name,
        glyph: 'T',
        room_localpart: `t${randomBytes(15).toString('hex').slice(0, 15)}`,
        visibility: options.visibility ?? 'public',
        kind: 'chat',
        status: 'open',
        is_general: false,
        created_by: createdBy,
        archived_at: options.archived ? new Date() : null,
      })}`;
    }),
  );
  return id;
}

describe('visibleTopicsForGroups (T-1175)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('matches visibleTopics per group across membership, private rows, roles and archives', async () => {
    const owner = await seedUser(context, { name: 'Owner' });
    const viewer = await seedUser(context, { name: 'Viewer' });

    const first = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        { userId: viewer, role: 'member' },
      ],
      [],
      { title: 'First' },
    );
    const second = await seedGroup(
      context,
      owner,
      [
        { userId: owner, role: 'owner' },
        { userId: viewer, role: 'member' },
      ],
      [],
      { title: 'Second' },
    );
    // The viewer is not a member of this one, even though it holds a public
    // topic: the batched pass must answer nothing for it.
    const outsider = await seedGroup(context, owner, [{ userId: owner, role: 'owner' }], [], {
      title: 'Outsider',
    });

    const publicFirst = await seedTopic(context, first.groupId, owner, { name: 'Public first' });
    const directFirst = await seedTopic(context, first.groupId, owner, {
      name: 'Direct first',
      visibility: 'private',
    });
    const roleFirst = await seedTopic(context, first.groupId, owner, {
      name: 'Role first',
      visibility: 'private',
    });
    await seedTopic(context, first.groupId, owner, {
      name: 'No access first',
      visibility: 'private',
    });
    await seedTopic(context, first.groupId, owner, { name: 'Archived first', archived: true });
    const publicSecond = await seedTopic(context, second.groupId, owner, { name: 'Public second' });
    await seedTopic(context, outsider.groupId, owner, { name: 'Hidden public' });

    const roleId = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO group_roles (id, group_id, name, created_by)
          VALUES (${roleId}, ${first.groupId}, 'Readers', ${owner})`;
        yield* sql`INSERT INTO group_member_roles (role_id, user_id, assigned_by)
          VALUES (${roleId}, ${viewer}, ${owner})`;
        yield* sql`INSERT INTO topic_role_access (topic_id, role_id)
          VALUES (${roleFirst}, ${roleId})`;
        yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by)
          VALUES (${directFirst}, ${viewer}, ${owner})`;
      }),
    );

    const groupIds = [first.groupId, second.groupId, outsider.groupId];
    const batched = await visibleTopicsForGroups(context.db, groupIds, viewer);

    expect([...batched.keys()].sort()).toEqual([...groupIds].sort());
    for (const groupId of groupIds) {
      const expected = await visibleTopics(context.db, groupId, viewer);
      expect(sortedIds(batched.get(groupId) ?? [])).toEqual(sortedIds(expected));
    }

    // Pin the rules the spec calls out.
    expect(sortedIds(batched.get(first.groupId) ?? [])).toEqual(
      [first.generalTopicId, publicFirst, directFirst, roleFirst].sort(),
    );
    expect(sortedIds(batched.get(second.groupId) ?? [])).toEqual(
      [second.generalTopicId, publicSecond].sort(),
    );
    expect(batched.get(outsider.groupId)).toEqual([]);
  });
});

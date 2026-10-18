import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSql } from '../effect/sql';
import type { RoomAffiliation } from '../xmpp/admin/schemas';
import {
  createTestContext,
  expectedJid,
  FakeAdminClient,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { drainPendingGroupSyncs, stopRoomSyncRetry, syncGroupTopicRooms } from './ais';

// An ejabberd whose first affiliation write fails and works afterwards, like a
// server that was briefly unreachable during a membership change.
class FlakyAffiliationAdminClient extends FakeAdminClient {
  private remainingFailures = 1;

  override setAffiliation(
    roomId: string,
    jid: string,
    affiliation: RoomAffiliation,
  ): Promise<void> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      return Promise.reject(new Error('ejabberd is down'));
    }
    return super.setAffiliation(roomId, jid, affiliation);
  }
}

describe('topic room sync retry (T-1180)', () => {
  let context: TestContext;
  let adminClient: FlakyAffiliationAdminClient;

  beforeEach(async () => {
    adminClient = new FlakyAffiliationAdminClient();
    context = await createTestContext({ adminClient });
  });

  afterEach(async () => {
    stopRoomSyncRetry();
    await context.close();
  });

  it('retries a failed sync until it succeeds, then forgets the group', async () => {
    const ownerId = await seedUser(context, { name: 'Owner' });
    const { groupId } = await seedGroup(context, ownerId, [{ userId: ownerId, role: 'owner' }], []);

    // The first run cannot reach ejabberd: no affiliation lands and the group
    // is noted for a retry.
    await syncGroupTopicRooms(context.db, adminClient, groupId, TEST_XMPP_DOMAIN, context.logger);
    expect(adminClient.affiliations).toHaveLength(0);

    // The next drain succeeds and drops the group.
    await drainPendingGroupSyncs();
    expect(adminClient.affiliations).toHaveLength(1);
    const roomId = adminClient.affiliations[0]!.roomId;
    expect(adminClient.affiliationState.get(roomId)?.get(expectedJid(ownerId))).toBe('member');

    // The group was forgotten: a later drain does not re-sync a room that has
    // drifted since, because it is no longer pending.
    adminClient.affiliationState.delete(roomId);
    await drainPendingGroupSyncs();
    expect(adminClient.affiliationState.get(roomId)).toBeUndefined();
  });
});

describe('archived topic rooms after a removal (T-2002)', () => {
  let context: TestContext;
  let adminClient: FakeAdminClient;

  beforeEach(async () => {
    adminClient = new FakeAdminClient();
    context = await createTestContext({ adminClient });
  });

  afterEach(async () => {
    stopRoomSyncRetry();
    await context.close();
  });

  it('drops a removed person from an archived topic room', async () => {
    const ownerId = await seedUser(context, { name: 'Owner' });
    const removedId = await seedUser(context, { name: 'Removed' });
    const { groupId } = await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: removedId, role: 'member' },
      ],
      [],
    );
    const roomLocalpart = `t${randomUUID().replaceAll('-', '').slice(0, 15)}`;
    await runSql(
      context.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const topicId = randomUUID();
        yield* sql`INSERT INTO topics ${sql.insert({
          id: topicId,
          group_id: groupId,
          name: 'Old plans',
          glyph: 'O',
          room_localpart: roomLocalpart,
          visibility: 'private',
          kind: 'chat',
          status: 'open',
          is_general: false,
          archived_at: new Date(),
          created_by: ownerId,
        })}`;
        yield* sql`INSERT INTO topic_members ${sql.insert(
          [ownerId, removedId].map((userId) => ({
            topic_id: topicId,
            user_id: userId,
            added_by: ownerId,
          })),
        )}`;
        yield* sql`DELETE FROM group_members
          WHERE group_id = ${groupId} AND user_id = ${removedId}`;
      }),
    );
    adminClient.affiliationState.set(
      roomLocalpart,
      new Map([
        [expectedJid(ownerId), 'member'],
        [expectedJid(removedId), 'member'],
      ]),
    );

    await syncGroupTopicRooms(context.db, adminClient, groupId, TEST_XMPP_DOMAIN, context.logger);

    const room = adminClient.affiliationState.get(roomLocalpart);
    expect(room?.has(expectedJid(removedId))).toBe(false);
    expect(room?.get(expectedJid(ownerId))).toBe('member');
  });

  // T-2010: the retry includes archived topic rooms, so a failed removal
  // there is retried instead of waiting for the next membership change.
  it('retries a failed sync of an archived topic room', async () => {
    const ownerId = await seedUser(context, { name: 'Owner' });
    const { groupId } = await seedGroup(context, ownerId, [{ userId: ownerId, role: 'owner' }], []);
    const roomLocalpart = `t${randomUUID().replaceAll('-', '').slice(0, 15)}`;
    await runSql(
      context.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const topicId = randomUUID();
        yield* sql`INSERT INTO topics ${sql.insert({
          id: topicId,
          group_id: groupId,
          name: 'Old plans',
          glyph: 'O',
          room_localpart: roomLocalpart,
          visibility: 'private',
          kind: 'chat',
          status: 'open',
          is_general: false,
          archived_at: new Date(),
          created_by: ownerId,
        })}`;
        yield* sql`INSERT INTO topic_members ${sql.insert({
          topic_id: topicId,
          user_id: ownerId,
          added_by: ownerId,
        })}`;
      }),
    );

    adminClient.failAffiliation = true;
    await syncGroupTopicRooms(context.db, adminClient, groupId, TEST_XMPP_DOMAIN, context.logger);
    expect(adminClient.affiliations).toHaveLength(0);

    adminClient.failAffiliation = false;
    await drainPendingGroupSyncs();

    expect(adminClient.affiliationState.get(roomLocalpart)?.get(expectedJid(ownerId))).toBe(
      'member',
    );
  });
});

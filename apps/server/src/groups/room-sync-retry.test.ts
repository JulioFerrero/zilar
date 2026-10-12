import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomAffiliation } from '../xmpp/admin-client';
import {
  createTestContext,
  expectedJid,
  FakeAdminClient,
  TEST_XMPP_DOMAIN,
  type TestContext,
} from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { syncGroupTopicRooms } from './ais';
import { drainPendingGroupSyncs, stopRoomSyncRetry } from './room-sync-retry';

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
    expect(adminClient.affiliationState.get(roomId)?.get(expectedJid(ownerId))).toBe('owner');

    // The group was forgotten: a later drain does not re-sync a room that has
    // drifted since, because it is no longer pending.
    adminClient.affiliationState.delete(roomId);
    await drainPendingGroupSyncs();
    expect(adminClient.affiliationState.get(roomId)).toBeUndefined();
  });
});

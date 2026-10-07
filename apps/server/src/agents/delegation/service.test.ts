import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aiDelegations,
  ais,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topicAis,
  topics,
  user,
} from '../../db/schema';
import { createTestContext, TEST_XMPP_DOMAIN, type TestContext } from '../../test-support';
import {
  CONTEXT_SUMMARY_MAX,
  DELEGATION_ITEM_MAX,
  DELEGATION_LIST_MAX,
  OBJECTIVE_MAX,
  RESULT_SUMMARY_MAX,
  RETURN_FORMAT_MAX,
  cancelDelegation,
  checkDelegation,
  createDelegation,
  finishDelegation,
  getDelegationForAi,
} from './service';

async function seedOwner(context: TestContext): Promise<string> {
  const ownerId = randomUUID();
  await context.db
    .insert(user)
    .values({ id: ownerId, name: 'Owner', email: `${ownerId}@example.com` });
  return ownerId;
}

interface SeedAiOptions {
  canDelegate?: boolean;
  acceptsDelegation?: boolean;
  status?: 'active' | 'disabled' | 'stopped';
}

async function seedAi(
  context: TestContext,
  ownerId: string,
  name: string,
  options: SeedAiOptions = {},
): Promise<string> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'CHANGE_ME',
    label: null,
  });
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name,
    template: 'dev',
    persona: 'Persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid: `${localpart}@${TEST_XMPP_DOMAIN}`,
    status: options.status ?? 'active',
    canDelegate: options.canDelegate ?? false,
    acceptsDelegation: options.acceptsDelegation ?? false,
  });
  return aiId;
}

async function seedGroup(context: TestContext, ownerId: string): Promise<string> {
  const groupId = randomUUID();
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart: randomUUID(),
    title: 'Room',
    createdBy: ownerId,
  });
  await context.db.insert(groupMembers).values({ groupId, userId: ownerId, role: 'owner' });
  return groupId;
}

async function seedTopic(
  context: TestContext,
  ownerId: string,
  groupId: string,
  isGeneral: boolean,
): Promise<string> {
  const topicId = randomUUID();
  await context.db.insert(topics).values({
    id: topicId,
    groupId,
    name: isGeneral ? 'General' : 'Work',
    glyph: 'G',
    roomLocalpart: randomUUID(),
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral,
    createdBy: ownerId,
  });
  return topicId;
}

async function addGroupAi(
  context: TestContext,
  groupId: string,
  aiId: string,
  addedBy: string,
): Promise<void> {
  await context.db.insert(groupAis).values({ groupId, aiId, addedBy });
}

async function addTopicAi(
  context: TestContext,
  topicId: string,
  aiId: string,
  addedBy: string,
): Promise<void> {
  await context.db.insert(topicAis).values({ topicId, aiId, addedBy });
}

describe('delegation service', () => {
  let context: TestContext;
  let owner: string;
  let groupId: string;

  beforeEach(async () => {
    context = await createTestContext();
    owner = await seedOwner(context);
    groupId = await seedGroup(context, owner);
  });

  afterEach(async () => {
    await context.close();
  });

  // A delegating boss and an accepting worker, both in the group room.
  async function readyPair(): Promise<{ boss: string; worker: string }> {
    const boss = await seedAi(context, owner, 'Boss', { canDelegate: true });
    const worker = await seedAi(context, owner, 'Worker', { acceptsDelegation: true });
    await addGroupAi(context, groupId, boss, owner);
    await addGroupAi(context, groupId, worker, owner);
    return { boss, worker };
  }

  async function createReadyDelegation(): Promise<string> {
    const { boss, worker } = await readyPair();
    const result = await createDelegation(context.db, {
      fromAiId: boss,
      toAiId: worker,
      groupId,
      objective: 'Do the thing',
    });
    if (!result.ok) throw new Error(`seed delegation failed: ${result.reason}`);
    return result.delegation.id;
  }

  describe('checkDelegation', () => {
    it('accepts a delegator and a receiver in the group room', async () => {
      const { boss, worker } = await readyPair();
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId }),
      ).toEqual({
        ok: true,
      });
    });

    it('accepts a non-General topic through topicAis', async () => {
      const topicId = await seedTopic(context, owner, groupId, false);
      const boss = await seedAi(context, owner, 'Boss', { canDelegate: true });
      const worker = await seedAi(context, owner, 'Worker', { acceptsDelegation: true });
      await addTopicAi(context, topicId, boss, owner);
      await addTopicAi(context, topicId, worker, owner);
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId, topicId }),
      ).toEqual({ ok: true });
    });

    it('accepts a General topic through groupAis', async () => {
      const topicId = await seedTopic(context, owner, groupId, true);
      const { boss, worker } = await readyPair();
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId, topicId }),
      ).toEqual({ ok: true });
    });

    it('rejects the same AI', async () => {
      const { boss } = await readyPair();
      expect(await checkDelegation(context.db, { fromAiId: boss, toAiId: boss, groupId })).toEqual({
        ok: false,
        reason: 'same_ai',
      });
    });

    it('rejects a source without canDelegate', async () => {
      const boss = await seedAi(context, owner, 'Boss');
      const worker = await seedAi(context, owner, 'Worker', { acceptsDelegation: true });
      await addGroupAi(context, groupId, boss, owner);
      await addGroupAi(context, groupId, worker, owner);
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId }),
      ).toEqual({
        ok: false,
        reason: 'cannot_delegate',
      });
    });

    it('rejects a target without acceptsDelegation', async () => {
      const { boss } = await readyPair();
      const worker = await seedAi(context, owner, 'Worker');
      await addGroupAi(context, groupId, worker, owner);
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId }),
      ).toEqual({
        ok: false,
        reason: 'not_accepting',
      });
    });

    it('rejects an AI that is not in the group room', async () => {
      const boss = await seedAi(context, owner, 'Boss', { canDelegate: true });
      const worker = await seedAi(context, owner, 'Worker', { acceptsDelegation: true });
      await addGroupAi(context, groupId, boss, owner);
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId }),
      ).toEqual({
        ok: false,
        reason: 'not_in_room',
      });
    });

    it('rejects an AI in the group but not in the topic', async () => {
      const topicId = await seedTopic(context, owner, groupId, false);
      const { boss, worker } = await readyPair();
      await addTopicAi(context, topicId, boss, owner);
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId, topicId }),
      ).toEqual({ ok: false, reason: 'not_in_room' });
    });

    it('rejects a non-General topic that belongs to another group', async () => {
      const otherGroupId = await seedGroup(context, owner);
      const topicId = await seedTopic(context, owner, otherGroupId, false);
      const boss = await seedAi(context, owner, 'Boss', { canDelegate: true });
      const worker = await seedAi(context, owner, 'Worker', { acceptsDelegation: true });
      await addTopicAi(context, topicId, boss, owner);
      await addTopicAi(context, topicId, worker, owner);
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId, topicId }),
      ).toEqual({ ok: false, reason: 'not_in_room' });
    });

    it('rejects a General topic that belongs to another group', async () => {
      const otherGroupId = await seedGroup(context, owner);
      const topicId = await seedTopic(context, owner, otherGroupId, true);
      const { boss, worker } = await readyPair();
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId, topicId }),
      ).toEqual({ ok: false, reason: 'not_in_room' });
    });

    it('rejects an inactive AI', async () => {
      const boss = await seedAi(context, owner, 'Boss', { canDelegate: true });
      const worker = await seedAi(context, owner, 'Worker', {
        acceptsDelegation: true,
        status: 'stopped',
      });
      await addGroupAi(context, groupId, boss, owner);
      await addGroupAi(context, groupId, worker, owner);
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: worker, groupId }),
      ).toEqual({
        ok: false,
        reason: 'inactive',
      });
    });

    it('rejects an unknown id as inactive', async () => {
      const { boss } = await readyPair();
      expect(
        await checkDelegation(context.db, { fromAiId: boss, toAiId: randomUUID(), groupId }),
      ).toEqual({ ok: false, reason: 'inactive' });
    });
  });

  describe('createDelegation', () => {
    it('caps long text and drops extra items', async () => {
      const { boss, worker } = await readyPair();
      const result = await createDelegation(context.db, {
        fromAiId: boss,
        toAiId: worker,
        groupId,
        objective: 'o'.repeat(1500),
        contextSummary: 'c'.repeat(2000),
        acceptance: Array.from({ length: 12 }, (_, i) => `a${i}`.padEnd(350, 'z')),
        constraints: ['  keep me  '],
        artifacts: ['', '   ', 'artifact'],
        returnFormat: 'r'.repeat(300),
        budget: { currency: 'USD', max: 5 },
        replyTo: 'msg-1',
      });
      if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`);
      expect(result.delegation).toMatchObject({ toAiId: worker, status: 'working' });

      const [row] = await context.db
        .select()
        .from(aiDelegations)
        .where(eq(aiDelegations.id, result.delegation.id))
        .limit(1);
      if (!row) throw new Error('delegation row missing');
      expect(row.objective).toHaveLength(OBJECTIVE_MAX);
      expect(row.contextSummary).toHaveLength(CONTEXT_SUMMARY_MAX);
      expect(row.acceptance).toHaveLength(DELEGATION_LIST_MAX);
      expect(row.acceptance.every((item) => item.length <= DELEGATION_ITEM_MAX)).toBe(true);
      expect(row.constraints).toEqual(['keep me']);
      expect(row.artifacts).toEqual(['artifact']);
      expect(row.returnFormat).toHaveLength(RETURN_FORMAT_MAX);
      expect(row.budgetCurrency).toBe('USD');
      expect(row.budgetMax).toBe('5.00');
      expect(row.status).toBe('working');
    });

    it('drops a negative budget', async () => {
      const { boss, worker } = await readyPair();
      const result = await createDelegation(context.db, {
        fromAiId: boss,
        toAiId: worker,
        groupId,
        objective: 'Do it',
        budget: { currency: 'USD', max: -1 },
      });
      if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`);
      const [row] = await context.db
        .select()
        .from(aiDelegations)
        .where(eq(aiDelegations.id, result.delegation.id))
        .limit(1);
      if (!row) throw new Error('delegation row missing');
      expect(row.budgetCurrency).toBeNull();
      expect(row.budgetMax).toBeNull();
    });

    it('rejects an empty objective', async () => {
      const { boss, worker } = await readyPair();
      expect(
        await createDelegation(context.db, {
          fromAiId: boss,
          toAiId: worker,
          groupId,
          objective: '   ',
        }),
      ).toEqual({ ok: false, reason: 'empty_objective' });
    });

    it('reports the permission reason when the check fails', async () => {
      const { boss } = await readyPair();
      const idle = await seedAi(context, owner, 'Idle', { acceptsDelegation: true });
      expect(
        await createDelegation(context.db, {
          fromAiId: boss,
          toAiId: idle,
          groupId,
          objective: 'Do it',
        }),
      ).toEqual({ ok: false, reason: 'not_in_room' });
    });
  });

  describe('getDelegationForAi', () => {
    it('returns null for a third AI', async () => {
      const id = await createReadyDelegation();
      const third = await seedAi(context, owner, 'Third');
      expect(await getDelegationForAi(context.db, id, third)).toBeNull();
      expect(await getDelegationForAi(context.db, id, randomUUID())).toBeNull();
      expect(await getDelegationForAi(context.db, randomUUID(), third)).toBeNull();
    });
  });

  describe('finishDelegation', () => {
    it('finishes once and only by the target', async () => {
      const { boss, worker } = await readyPair();
      const created = await createDelegation(context.db, {
        fromAiId: boss,
        toAiId: worker,
        groupId,
        objective: 'Do it',
      });
      if (!created.ok) throw new Error(`seed delegation failed: ${created.reason}`);
      const id = created.delegation.id;

      expect(await finishDelegation(context.db, { id, aiId: boss, status: 'completed' })).toBe(
        false,
      );
      expect(
        await finishDelegation(context.db, {
          id,
          aiId: worker,
          status: 'completed',
          resultSummary: 's'.repeat(9000),
          artifacts: ['result'],
        }),
      ).toBe(true);
      expect(await finishDelegation(context.db, { id, aiId: worker, status: 'failed' })).toBe(
        false,
      );

      const view = await getDelegationForAi(context.db, id, worker);
      expect(view?.status).toBe('completed');
      expect(view?.resultSummary).toHaveLength(RESULT_SUMMARY_MAX);
      expect(view?.artifacts).toEqual(['result']);
    });
  });

  describe('cancelDelegation', () => {
    it('cancels only by the source and only once', async () => {
      const { boss, worker } = await readyPair();
      const created = await createDelegation(context.db, {
        fromAiId: boss,
        toAiId: worker,
        groupId,
        objective: 'Do it',
      });
      if (!created.ok) throw new Error(`seed delegation failed: ${created.reason}`);
      const id = created.delegation.id;

      expect(await cancelDelegation(context.db, { id, aiId: worker })).toBe(false);
      expect(await cancelDelegation(context.db, { id, aiId: boss })).toBe(true);
      expect(await cancelDelegation(context.db, { id, aiId: boss })).toBe(false);

      const view = await getDelegationForAi(context.db, id, boss);
      expect(view?.status).toBe('canceled');
    });

    it('cannot cancel a finished delegation', async () => {
      const { boss, worker } = await readyPair();
      const created = await createDelegation(context.db, {
        fromAiId: boss,
        toAiId: worker,
        groupId,
        objective: 'Do it',
      });
      if (!created.ok) throw new Error(`seed delegation failed: ${created.reason}`);
      const id = created.delegation.id;

      expect(await finishDelegation(context.db, { id, aiId: worker, status: 'completed' })).toBe(
        true,
      );
      expect(await cancelDelegation(context.db, { id, aiId: boss })).toBe(false);
    });
  });
});

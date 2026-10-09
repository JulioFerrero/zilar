import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createTestContext, TEST_XMPP_DOMAIN, testSql, type TestContext } from '../../test-support';
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

interface DelegationRow {
  objective: string;
  contextSummary: string | null;
  acceptance: string[];
  constraints: string[];
  artifacts: string[];
  returnFormat: string | null;
  budgetCurrency: string | null;
  budgetMax: string | null;
  status: string;
}

interface BudgetRow {
  budgetCurrency: string | null;
  budgetMax: string | null;
}

async function seedOwner(context: TestContext): Promise<string> {
  const ownerId = randomUUID();
  const email = `${ownerId}@example.com`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO "user" (id, name, email) VALUES (${ownerId}, ${'Owner'}, ${email})`;
    }),
  );
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
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  const jid = `${localpart}@${TEST_XMPP_DOMAIN}`;
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO provider_connections (id, owner, provider, encrypted_key, label) VALUES (${connectionId}, ${ownerId}, ${'openai'}, ${'CHANGE_ME'}, NULL)`;
      yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status, can_delegate, accepts_delegation) VALUES (${aiId}, ${ownerId}, ${name}, ${'dev'}, ${'Persona'}, ${connectionId}, ${'gpt-4o-mini'}, ${localpart}, ${jid}, ${options.status ?? 'active'}, ${options.canDelegate ?? false}, ${options.acceptsDelegation ?? false})`;
    }),
  );
  return aiId;
}

async function seedGroup(context: TestContext, ownerId: string): Promise<string> {
  const groupId = randomUUID();
  const roomLocalpart = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO groups (id, room_localpart, title, created_by) VALUES (${groupId}, ${roomLocalpart}, ${'Room'}, ${ownerId})`;
      yield* sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${groupId}, ${ownerId}, ${'owner'})`;
    }),
  );
  return groupId;
}

async function seedTopic(
  context: TestContext,
  ownerId: string,
  groupId: string,
  isGeneral: boolean,
): Promise<string> {
  const topicId = randomUUID();
  const roomLocalpart = randomUUID();
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topics (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by) VALUES (${topicId}, ${groupId}, ${isGeneral ? 'General' : 'Work'}, ${'G'}, ${roomLocalpart}, ${'public'}, ${'chat'}, ${'open'}, ${isGeneral}, ${ownerId})`;
    }),
  );
  return topicId;
}

async function addGroupAi(
  context: TestContext,
  groupId: string,
  aiId: string,
  addedBy: string,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO group_ais (group_id, ai_id, added_by) VALUES (${groupId}, ${aiId}, ${addedBy})`;
    }),
  );
}

async function addTopicAi(
  context: TestContext,
  topicId: string,
  aiId: string,
  addedBy: string,
): Promise<void> {
  await testSql(context)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topic_ais (topic_id, ai_id, added_by) VALUES (${topicId}, ${aiId}, ${addedBy})`;
    }),
  );
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

      const [row] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<DelegationRow>`SELECT objective, context_summary, acceptance, constraints, artifacts, return_format, budget_currency, budget_max, status FROM ai_delegations WHERE id = ${result.delegation.id} LIMIT 1`;
        }),
      );
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
      const [row] = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<BudgetRow>`SELECT budget_currency, budget_max FROM ai_delegations WHERE id = ${result.delegation.id} LIMIT 1`;
        }),
      );
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

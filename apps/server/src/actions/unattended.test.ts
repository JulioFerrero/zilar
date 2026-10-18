import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { removeGroupAi } from '../groups/ais';
import { removeTopicAi } from '../topics/ais';
import { createTestContext, testSql, type TestContext } from '../test-support';
import { seedAi, seedGroup, seedUser } from '../test-support/seed';
import { createAuditRecorder } from '../audit/service';
import type { ActionAnnouncer } from './announce';
import { createActionGateway } from './gateway';
import { runOnApprovalDecided } from './queries';
import { buildRegistry, type ActionAdapter } from './registry';

// T-1655: a scheduled run is "unattended". Tier 0/1 run as usual, but a
// tier-2 request without a matching standing rule is refused with
// `needs_approval` instead of parking an approval card nobody will see.
// These tests exercise the gateway directly with two tiny adapters, so no
// network, no provider and no chat is involved.

interface CountRow {
  total: number;
}

const requestedBy = 'ai-bot@zilar.localhost';

const lowAdapter: ActionAdapter<unknown> = {
  name: 'demo.low',
  description: 'Low-tier demo action, runs without approval.',
  tier: 0,
  argsSchema: Schema.Struct({ text: Schema.String }),
  describe: (args) => ({ summary: `Low: ${(args as { text: string }).text}` }),
  execute: async (_ctx, args) => ({ summary: `ran ${(args as { text: string }).text}` }),
};

// Tier 2 and deliberately without `allowAlways`, so no standing rule can
// ever exist for it and the approval path is always the only way it runs.
const highAdapter: ActionAdapter<unknown> = {
  name: 'demo.high',
  description: 'High-tier demo action that needs approval.',
  tier: 2,
  argsSchema: Schema.Struct({ text: Schema.String }),
  describe: (args) => ({ summary: `High: ${(args as { text: string }).text}` }),
  execute: async (_ctx, args) => ({ summary: `ran ${(args as { text: string }).text}` }),
};

describe('scheduled (unattended) action requests (T-1655)', () => {
  let context: TestContext;
  let now: Date;

  beforeEach(async () => {
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
  });

  afterEach(async () => {
    await context.close();
  });

  function gatewayFor(adapters: ReturnType<typeof buildRegistry>, announce?: ActionAnnouncer) {
    return createActionGateway({
      db: context.db,
      adapters,
      audit: createAuditRecorder({ db: context.db }),
      logger: { warn: () => undefined, error: () => undefined },
      ...(announce === undefined ? {} : { announce }),
      now: () => now,
    });
  }

  async function countApprovals(): Promise<number> {
    const [row] = (await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<CountRow>`SELECT count(*)::int AS total FROM approvals`;
      }),
    )) as [CountRow];
    return row.total;
  }

  it('runs a tier-0 action in an unattended request', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const gateway = gatewayFor(buildRegistry([lowAdapter]));

    const outcome = await gateway.request({
      aiId,
      action: 'demo.low',
      args: { text: 'hi' },
      requestedBy,
      unattended: true,
    });

    expect(outcome).toEqual({ status: 'executed', summary: 'ran hi' });
  });

  it('refuses an unattended tier-2 action with needs_approval, no card, no announce', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const announces: string[] = [];
    const announce: ActionAnnouncer = {
      approvalRequested: async () => {
        announces.push('approvalRequested');
      },
      outcome: async () => {
        announces.push('outcome');
      },
    };
    const gateway = gatewayFor(buildRegistry([highAdapter]), announce);
    const approvalsBefore = await countApprovals();

    const outcome = await gateway.request({
      aiId,
      action: 'demo.high',
      args: { text: 'scheduled' },
      requestedBy,
      unattended: true,
    });

    expect(outcome).toEqual({ status: 'denied', reason: 'needs_approval' });
    expect(await countApprovals()).toBe(approvalsBefore);
    expect(announces).toEqual([]);
  });

  it('an attended tier-2 action still parks a card (pending_approval)', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const gateway = gatewayFor(buildRegistry([highAdapter]));

    const outcome = await gateway.request({
      aiId,
      action: 'demo.high',
      args: { text: 'watched' },
      requestedBy,
    });

    expect(outcome.status).toBe('pending_approval');
    expect(await countApprovals()).toBe(1);
  });
});

// T-1991: an AI removed from a group or topic must not run an action its
// request already raised, even if a card is decided afterwards.
describe('pending actions after the AI leaves (T-1991)', () => {
  let context: TestContext;
  let now: Date;

  beforeEach(async () => {
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
  });

  afterEach(async () => {
    await context.close();
  });

  function actionDeps() {
    return {
      db: context.db,
      adapters: buildRegistry([]),
      audit: createAuditRecorder({ db: context.db }),
      logger: { warn: () => undefined, error: () => undefined },
    };
  }

  async function seedPending(
    aiId: string,
    groupId: string,
    topicId: string,
  ): Promise<{ approvalId: string; pendingId: string }> {
    const approvalId = randomUUID();
    const pendingId = randomUUID();
    const expiresAt = new Date(now.getTime() + 60_000);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO approvals
            (id, ai_id, group_id, topic_id, action, summary, args_hash, requested_by, status, expires_at)
          VALUES (${approvalId}, ${aiId}, ${groupId}, ${topicId}, ${'demo.high'},
            ${'Send the report'}, ${'a'.repeat(64)}, ${requestedBy}, ${'approved'}, ${expiresAt})`;
        yield* sql`INSERT INTO pending_actions
            (id, approval_id, ai_id, group_id, topic_id, action, args, args_hash, requested_by, status)
          VALUES (${pendingId}, ${approvalId}, ${aiId}, ${groupId}, ${topicId}, ${'demo.high'},
            ${'{}'}::jsonb, ${'a'.repeat(64)}, ${requestedBy}, ${'waiting'})`;
      }),
    );
    return { approvalId, pendingId };
  }

  async function pendingRow(
    id: string,
  ): Promise<{ status: string; finishedAt: Date | null } | undefined> {
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ status: string; finishedAt: Date | null }>`
          SELECT status, finished_at FROM pending_actions WHERE id = ${id}`;
      }),
    );
    return row;
  }

  async function seedTopic(groupId: string, ownerId: string): Promise<string> {
    const id = randomUUID();
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topics
            (id, group_id, name, glyph, room_localpart, visibility, kind, status, is_general, created_by)
          VALUES (${id}, ${groupId}, ${'Reports'}, ${'R'}, ${`t${randomUUID().slice(0, 12)}`},
            ${'public'}, ${'chat'}, ${'open'}, ${false}, ${ownerId})`;
        yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by)
          VALUES (${id}, ${ownerId}, ${ownerId})`;
      }),
    );
    return id;
  }

  it('cancels an approved action when its AI left the group before the decision', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );
    const { approvalId, pendingId } = await seedPending(aiId, groupId, generalTopicId);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM group_ais WHERE group_id = ${groupId} AND ai_id = ${aiId}`;
      }),
    );

    await runOnApprovalDecided(actionDeps(), approvalId, () => now);

    expect(await pendingRow(pendingId)).toEqual({ status: 'cancelled', finishedAt: now });
    const [audit] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ detail: { reason: string } }>`SELECT detail FROM audit_log
          WHERE action = 'action.cancelled' AND ai_id = ${aiId}`;
      }),
    );
    expect(audit?.detail.reason).toBe('ai_not_in_topic');
  });

  it('cancels the AI waiting actions when it is removed from a topic or a group', async () => {
    const ownerId = await seedUser(context);
    const { aiId } = await seedAi(context, ownerId);
    const { groupId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );
    const topicId = await seedTopic(groupId, ownerId);
    await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topic_ais (topic_id, ai_id, added_by)
          VALUES (${topicId}, ${aiId}, ${ownerId})`;
      }),
    );
    const topicPending = await seedPending(aiId, groupId, topicId);

    await removeTopicAi(
      {
        db: context.db,
        adminClient: context.adminClient,
        domain: context.config.xmpp.domain,
        logger: context.logger,
      },
      topicId,
      ownerId,
      aiId,
    );
    expect((await pendingRow(topicPending.pendingId))?.status).toBe('cancelled');

    // The same holds when the AI leaves the whole group.
    const otherOwner = await seedUser(context);
    const { aiId: groupAiId } = await seedAi(context, otherOwner);
    const second = await seedGroup(
      context,
      otherOwner,
      [{ userId: otherOwner, role: 'owner' }],
      [groupAiId],
    );
    const groupPending = await seedPending(groupAiId, second.groupId, second.generalTopicId);

    await removeGroupAi(context.db, context.adminClient, {
      groupId: second.groupId,
      actorId: otherOwner,
      aiId: groupAiId,
      domain: context.config.xmpp.domain,
      logger: context.logger,
    });
    expect((await pendingRow(groupPending.pendingId))?.status).toBe('cancelled');
  });
});

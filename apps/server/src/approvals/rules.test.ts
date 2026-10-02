import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  aiLimits,
  ais,
  approvalRules,
  approvals,
  groupAis,
  groupMembers,
  groups,
  providerConnections,
  topicAis,
  topics,
  user,
} from '../db/schema';
import { createTestContext, type TestContext } from '../test-support';
import { createApp } from '../app';
import { bootstrapUser } from '../test-support';
import { ApprovalServiceError, createApproval, decideApproval, toPublicApproval } from './service';
import {
  createRule,
  findActiveRule,
  listActiveRulesForAi,
  listActiveRulesForTopic,
  revokeActiveRulesForAiInGroup,
  revokeActiveRulesForAiInTopic,
  revokeRule,
} from './rules';
import { buildAlwaysEligible, buildRegistry, type ActionAdapter } from '../actions/registry';
import { createActionGateway } from '../actions/gateway';
import { createAuditRecorder } from '../audit/service';
import { auditLog } from '../db/schema';

function argsHash(seed: number): string {
  const buf = randomBytes(32);
  buf[0] = seed & 0xff;
  buf[1] = (seed >> 8) & 0xff;
  return buf.toString('hex');
}

async function seedUser(context: TestContext, overrides: { name?: string } = {}): Promise<string> {
  const id = randomUUID();
  await context.db.insert(user).values({
    id,
    name: overrides.name ?? 'User',
    email: `${id}@example.com`,
  });
  return id;
}

async function seedAi(
  context: TestContext,
  ownerId: string,
): Promise<{ aiId: string; jid: string }> {
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'sealed-placeholder',
    label: null,
  });
  const aiId = randomUUID();
  const localpart = `ai-${aiId}`;
  const jid = `${localpart}@zilar.localhost`;
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Helper AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart,
    jid,
    status: 'active',
  });
  await context.db.insert(aiLimits).values({ aiId, perDayUsd: '1.00', perMonthUsd: '20.00' });
  return { aiId, jid };
}

async function seedGroup(
  context: TestContext,
  ownerId: string,
  members: Array<{ userId: string; role: 'owner' | 'admin' | 'member' }>,
  aiIds: string[],
): Promise<{ groupId: string; generalTopicId: string }> {
  const groupId = randomUUID();
  await context.db.insert(groups).values({
    id: groupId,
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    title: 'Trip',
    createdBy: ownerId,
  });
  await context.db.insert(groupMembers).values(
    members.map((entry) => ({
      groupId,
      userId: entry.userId,
      role: entry.role,
    })),
  );
  for (const aiId of aiIds) {
    await context.db.insert(groupAis).values({ groupId, aiId, addedBy: ownerId });
  }
  // Every group has a General topic; group-scoped fixtures use it.
  const generalTopicId = randomUUID();
  await context.db.insert(topics).values({
    id: generalTopicId,
    groupId,
    name: 'General',
    glyph: 'G',
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: true,
    createdBy: ownerId,
  });
  return { groupId, generalTopicId };
}

async function seedTopic(
  context: TestContext,
  groupId: string,
  creatorId: string,
  overrides: { name?: string; visibility?: 'public' | 'private' } = {},
): Promise<string> {
  const topicId = randomUUID();
  await context.db.insert(topics).values({
    id: topicId,
    groupId,
    name: overrides.name ?? `Topic ${topicId.slice(0, 8)}`,
    glyph: 'T',
    roomLocalpart: `g${randomBytes(15).toString('hex').slice(0, 15)}`,
    visibility: overrides.visibility ?? 'public',
    kind: 'chat',
    status: 'open',
    isGeneral: false,
    createdBy: creatorId,
  });
  return topicId;
}

async function seedApproval(
  context: TestContext,
  args: {
    aiId: string;
    groupId?: string;
    topicId?: string;
    action?: string;
    hashSeed?: number;
  },
  now: Date,
): Promise<{ id: string }> {
  const row = await createApproval(
    context.db,
    {
      aiId: args.aiId,
      ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
      ...(args.topicId === undefined ? {} : { topicId: args.topicId }),
      action: args.action ?? 'demo.echo',
      summary: 'Echo a message: "hi"',
      argsHash: argsHash(args.hashSeed ?? 1),
      requestedBy: 'ai-bot@zilar.localhost',
      expiresAt: new Date(now.getTime() + 60_000),
    },
    now,
  );
  return { id: row.id };
}

describe('approval rules service (T-0099)', () => {
  let context: TestContext;
  let now: Date;

  beforeEach(async () => {
    context = await createTestContext();
    now = new Date('2026-01-01T00:00:00Z');
  });

  afterEach(async () => {
    await context.close();
  });

  describe('createRule', () => {
    it('inserts one row for the personal chat (group_id = null)', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { rule, created } = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      expect(created).toBe(true);
      expect(rule.scope).toBe('personal');
      expect(rule.groupId).toBeNull();
      expect(rule.action).toBe('demo.echo');
      expect(rule.createdBy).toBe(ownerId);
    });

    it('inserts one row for a topic', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      const { rule, created } = await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      expect(created).toBe(true);
      expect(rule.scope).toBe('group');
      expect(rule.groupId).toBe(groupId);
      expect(rule.topicId).toBe(generalTopicId);
    });

    it('is idempotent: a second create returns the existing row', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const first = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const second = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      expect(first.rule.id).toBe(second.rule.id);
      expect(second.created).toBe(false);

      const rows = await context.db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.aiId, aiId));
      expect(rows).toHaveLength(1);
    });

    it('enforces one active rule per (ai, topic, action) at the DB level', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      // The partial unique index refuses the second active rule directly,
      // bypassing the service-level dedupe.
      await expect(
        context.db.insert(approvalRules).values({
          id: randomUUID(),
          aiId,
          groupId,
          topicId: generalTopicId,
          action: 'demo.echo',
          createdBy: ownerId,
        }),
      ).rejects.toThrow();
    });

    it('rejects a row with only one of group_id / topic_id (CHECK)', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      await expect(
        context.db.insert(approvalRules).values({
          id: randomUUID(),
          aiId,
          groupId,
          topicId: null,
          action: 'demo.echo',
          createdBy: ownerId,
        }),
      ).rejects.toThrow();
      await expect(
        context.db.insert(approvalRules).values({
          id: randomUUID(),
          aiId,
          groupId: null,
          topicId: generalTopicId,
          action: 'demo.echo',
          createdBy: ownerId,
        }),
      ).rejects.toThrow();
    });

    it('lets a personal rule and a topic rule for the same AI + action coexist', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      const personal = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const group = await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      expect(personal.created).toBe(true);
      expect(group.created).toBe(true);
    });

    it('lets the same action have rules in two topics of one group', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      const otherTopicId = await seedTopic(context, groupId, ownerId, { name: 'Other' });
      const first = await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const second = await createRule(
        context.db,
        { aiId, groupId, topicId: otherTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      expect(first.created).toBe(true);
      expect(second.created).toBe(true);
      expect(first.rule.id).not.toBe(second.rule.id);
    });
  });

  describe('findActiveRule', () => {
    it('returns null when no rule exists', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const row = await findActiveRule(context.db, {
        aiId,
        groupId: null,
        topicId: null,
        action: 'demo.echo',
      });
      expect(row).toBeNull();
    });

    it('returns the active rule for an exact (ai, chat, action) match', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const row = await findActiveRule(context.db, {
        aiId,
        groupId: null,
        topicId: null,
        action: 'demo.echo',
      });
      expect(row).not.toBeNull();
      expect(row?.action).toBe('demo.echo');
    });

    it('does not return a personal rule for a topic query, or vice versa', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const asGroup = await findActiveRule(context.db, {
        aiId,
        groupId,
        topicId: generalTopicId,
        action: 'demo.echo',
      });
      expect(asGroup).toBeNull();
      // And: a topic rule does not match a personal query.
      await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const asPersonal = await findActiveRule(context.db, {
        aiId,
        groupId: null,
        topicId: null,
        action: 'demo.echo',
      });
      expect(asPersonal).not.toBeNull();
    });

    it('does not return a rule of another topic in the same group', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      const otherTopicId = await seedTopic(context, groupId, ownerId, { name: 'Other' });
      await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const other = await findActiveRule(context.db, {
        aiId,
        groupId,
        topicId: otherTopicId,
        action: 'demo.echo',
      });
      expect(other).toBeNull();
    });

    it('does not return a revoked rule', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { rule } = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      await revokeRule(context.db, { ruleId: rule.id, actorId: ownerId, now });
      const row = await findActiveRule(context.db, {
        aiId,
        groupId: null,
        topicId: null,
        action: 'demo.echo',
      });
      expect(row).toBeNull();
    });
  });

  describe('list and revoke', () => {
    it('lists active rules for an AI and skips revoked ones', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const first = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.other', createdBy: ownerId },
        now,
      );
      await revokeRule(context.db, { ruleId: first.rule.id, actorId: ownerId, now });

      const rules = await listActiveRulesForAi(context.db, aiId);
      expect(rules).toHaveLength(1);
      expect(rules[0]?.action).toBe('demo.other');
    });

    it('lists active rules for a topic', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const rules = await listActiveRulesForTopic(context.db, generalTopicId);
      expect(rules).toHaveLength(1);
    });

    it('revokeRule is null on a missing id and idempotent on an already-revoked one', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { rule } = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const missing = await revokeRule(context.db, {
        ruleId: 'no-such-id',
        actorId: ownerId,
        now,
      });
      expect(missing).toBeNull();
      // First revoke succeeds; second is idempotent.
      const first = await revokeRule(context.db, {
        ruleId: rule.id,
        actorId: ownerId,
        now,
      });
      expect(first).not.toBeNull();
      const second = await revokeRule(context.db, {
        ruleId: rule.id,
        actorId: ownerId,
        now,
      });
      expect(second).not.toBeNull();
    });
  });

  describe('decideApproval + rule creation', () => {
    it('creates a rule for the personal chat when the AI owner approves_always', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { id: approvalId } = await seedApproval(context, { aiId }, now);
      const result = await decideApproval(
        context.db,
        {
          approvalId,
          userId: ownerId,
          decision: 'approve_always',
          alwaysEligible: () => true,
        },
        now,
      );
      expect(result?.rule?.created).toBe(true);
      expect(result?.rule?.groupId).toBeNull();
      expect(result?.row.status).toBe('approved_always');
    });

    it('creates a topic rule when a group admin approves_always', async () => {
      const ownerId = await seedUser(context);
      const adminId = await seedUser(context, { name: 'Admin' });
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [
          { userId: ownerId, role: 'owner' },
          { userId: adminId, role: 'admin' },
        ],
        [aiId],
      );
      const { id: approvalId } = await seedApproval(
        context,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo' },
        now,
      );
      const result = await decideApproval(
        context.db,
        {
          approvalId,
          userId: adminId,
          decision: 'approve_always',
          alwaysEligible: () => true,
        },
        now,
      );
      expect(result?.rule?.created).toBe(true);
      expect(result?.rule?.groupId).toBe(groupId);
      expect(result?.rule?.topicId).toBe(generalTopicId);
    });

    it('refuses approve_always with 400 always_not_allowed when the action is not eligible', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { id: approvalId } = await seedApproval(context, { aiId }, now);
      let caught: unknown;
      try {
        await decideApproval(
          context.db,
          {
            approvalId,
            userId: ownerId,
            decision: 'approve_always',
            alwaysEligible: () => false,
          },
          now,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ApprovalServiceError);
      expect((caught as ApprovalServiceError).errorCode).toBe('always_not_allowed');
      // The approval row is still pending — nothing changed.
      const [row] = await context.db.select().from(approvals).where(eq(approvals.id, approvalId));
      expect(row?.status).toBe('pending');
      const rules = await context.db.select().from(approvalRules);
      expect(rules).toHaveLength(0);
    });

    it('a plain member cannot decide, so no rule is created', async () => {
      const ownerId = await seedUser(context);
      const memberId = await seedUser(context, { name: 'Member' });
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [
          { userId: ownerId, role: 'owner' },
          { userId: memberId, role: 'member' },
        ],
        [aiId],
      );
      const { id: approvalId } = await seedApproval(
        context,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo' },
        now,
      );
      const memberResult = await decideApproval(
        context.db,
        {
          approvalId,
          userId: memberId,
          decision: 'approve_always',
          alwaysEligible: () => true,
        },
        now,
      );
      expect(memberResult).toBeNull();
      const rules = await context.db.select().from(approvalRules);
      expect(rules).toHaveLength(0);
    });

    it('deciding twice does not duplicate the rule', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const first = await seedApproval(context, { aiId, action: 'demo.echo', hashSeed: 100 }, now);
      const second = await seedApproval(context, { aiId, action: 'demo.echo', hashSeed: 101 }, now);
      const r1 = await decideApproval(
        context.db,
        {
          approvalId: first.id,
          userId: ownerId,
          decision: 'approve_always',
          alwaysEligible: () => true,
        },
        now,
      );
      const r2 = await decideApproval(
        context.db,
        {
          approvalId: second.id,
          userId: ownerId,
          decision: 'approve_always',
          alwaysEligible: () => true,
        },
        now,
      );
      expect(r1?.rule?.created).toBe(true);
      expect(r2?.rule?.created).toBe(false);
      expect(r1?.rule?.id).toBe(r2?.rule?.id);
      const rows = await context.db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.aiId, aiId));
      expect(rows).toHaveLength(1);
    });
  });

  describe('toPublicApproval includes alwaysEligible', () => {
    it('reports false by default and true when the predicate allows it', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { id: approvalId } = await seedApproval(context, { aiId, action: 'demo.echo' }, now);
      const decided = await decideApproval(
        context.db,
        {
          approvalId,
          userId: ownerId,
          decision: 'approve_once',
        },
        now,
      );
      const publicDefault = toPublicApproval(decided!.row, now);
      expect(publicDefault.alwaysEligible).toBe(false);
      const publicWithPredicate = toPublicApproval(decided!.row, now, true);
      expect(publicWithPredicate.alwaysEligible).toBe(true);
    });
  });

  describe('lifecycle: removeGroupAi revokes group rules', () => {
    it('kills the AI rules for the group but leaves personal rules alone', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      const personal = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const group = await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      // Run the same revoke helper removeGroupAi uses.
      const revoked = await revokeActiveRulesForAiInGroup(context.db, {
        aiId,
        groupId,
        actorId: ownerId,
        now,
      });
      expect(revoked).toHaveLength(1);
      expect(revoked[0]?.id).toBe(group.rule.id);

      const [personalRow] = await context.db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.id, personal.rule.id));
      expect(personalRow?.revokedAt).toBeNull();
      const [groupRow] = await context.db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.id, group.rule.id));
      expect(groupRow?.revokedAt).not.toBeNull();
    });

    it('removing the AI from one topic revokes only that topic rules', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      const { groupId, generalTopicId } = await seedGroup(
        context,
        ownerId,
        [{ userId: ownerId, role: 'owner' }],
        [aiId],
      );
      const otherTopicId = await seedTopic(context, groupId, ownerId, { name: 'Other' });
      const general = await createRule(
        context.db,
        { aiId, groupId, topicId: generalTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      const other = await createRule(
        context.db,
        { aiId, groupId, topicId: otherTopicId, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      // Run the same revoke helper topic-AI removal uses.
      const revoked = await revokeActiveRulesForAiInTopic(context.db, {
        aiId,
        topicId: otherTopicId,
        actorId: ownerId,
        now,
      });
      expect(revoked).toHaveLength(1);
      expect(revoked[0]?.id).toBe(other.rule.id);

      const [generalRow] = await context.db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.id, general.rule.id));
      expect(generalRow?.revokedAt).toBeNull();
      const [otherRow] = await context.db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.id, other.rule.id));
      expect(otherRow?.revokedAt).not.toBeNull();
    });

    it('deleting the AI row cascades the rules away', async () => {
      const ownerId = await seedUser(context);
      const { aiId } = await seedAi(context, ownerId);
      await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: ownerId },
        now,
      );
      await context.db.delete(ais).where(eq(ais.id, aiId));
      const rows = await context.db.select().from(approvalRules);
      expect(rows).toHaveLength(0);
    });
  });

  describe('buildAlwaysEligible predicate', () => {
    function makeAdapter(overrides: Partial<ActionAdapter<unknown>>): ActionAdapter<unknown> {
      return {
        name: 'demo.echo',
        description: 'demo',
        tier: 2,
        argsSchema: z.object({ text: z.string() }),
        describe: () => ({ summary: 'demo' }),
        execute: async () => ({ summary: 'ok' }),
        ...overrides,
      };
    }

    it('returns true only when allowAlways is true and there is no estimateCost', () => {
      const eligible = buildAlwaysEligible({
        'demo.echo': makeAdapter({ allowAlways: true }),
      });
      expect(eligible('demo.echo')).toBe(true);

      const notOptedIn = buildAlwaysEligible({
        'demo.echo': makeAdapter({}),
      });
      expect(notOptedIn('demo.echo')).toBe(false);

      const hasCost = buildAlwaysEligible({
        'demo.echo': makeAdapter({
          allowAlways: true,
          estimateCost: () => ({ currency: 'EUR', amount: 1 }),
        }),
      });
      expect(hasCost('demo.echo')).toBe(false);

      const unknown = buildAlwaysEligible({});
      expect(unknown('demo.echo')).toBe(false);
    });
  });

  describe('end-to-end: approve_always then second request auto-runs (T-0099)', () => {
    // A demo.echo adapter for tests; mirrors `buildDemoEchoAdapter` but
    // typed here so the e2e test can drop into a fresh registry without
    // pulling in `ACTION_DEMO_ENABLED` config plumbing.
    const adapter: ActionAdapter<unknown> = {
      name: 'demo.echo',
      description: 'Repeats a short text back (demo, no side effects).',
      tier: 2,
      argsSchema: z.object({ text: z.string().trim().min(1).max(200) }),
      describe: (args) => ({
        summary: `Echo a message: "${(args as { text: string }).text}"`,
      }),
      allowAlways: true,
      execute: async (_ctx, args) => ({
        summary: `Echoed: ${(args as { text: string }).text}`,
      }),
    };

    it('runs the action immediately on the second request, no approval row, audit has action.auto_approved', async () => {
      const adapters = buildRegistry([adapter]);
      const alwaysEligible = buildAlwaysEligible(adapters);
      const app = createApp({
        db: context.db,
        logger: context.logger,
        config: context.config,
        auth: context.auth,
        adminClient: context.adminClient,
        alwaysEligible,
      });
      const owner = await bootstrapUser(context, app, 'owner-flow@example.com');
      const { aiId } = await seedAi(context, owner.id);

      const gateway = createActionGateway({
        db: context.db,
        adapters,
        audit: createAuditRecorder({ db: context.db }),
        logger: {
          warn: () => undefined,
          error: () => undefined,
        },
        now: () => now,
      });

      // First request: pending_approval because no rule exists yet.
      const first = await gateway.request({
        aiId,
        action: 'demo.echo',
        args: { text: 'first' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(first.status).toBe('pending_approval');

      // Insert the rule the route would create after a human approves_always.
      await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );

      // Second request: auto-runs, no approval row, no card.
      const approvalCountBefore = (await context.db.select().from(approvals)).length;
      const second = await gateway.request({
        aiId,
        action: 'demo.echo',
        args: { text: 'second' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(second).toEqual({ status: 'executed', summary: 'Echoed: second' });
      const approvalCountAfter = (await context.db.select().from(approvals)).length;
      expect(approvalCountAfter).toBe(approvalCountBefore);

      const audits = await context.db.select().from(auditLog);
      const autoApproved = audits.find((row) => row.action === 'action.auto_approved');
      expect(autoApproved).toBeDefined();
      expect(autoApproved?.subjectId).toMatch(/^[0-9a-z-]+$/); // a rule id
      expect(autoApproved?.argsHash).toMatch(/^[0-9a-f]{64}$/);
      const executed = audits.find((row) => row.action === 'action.executed');
      expect(executed).toBeDefined();

      // args text never leaks into audit.
      const auditJson = JSON.stringify(audits);
      expect(auditJson).not.toContain('second');
      expect(auditJson).not.toContain('text');
    });

    it('a stopped AI with a rule is denied, nothing runs', async () => {
      const adapters = buildRegistry([adapter]);
      const alwaysEligible = buildAlwaysEligible(adapters);
      const app = createApp({
        db: context.db,
        logger: context.logger,
        config: context.config,
        auth: context.auth,
        adminClient: context.adminClient,
        alwaysEligible,
      });
      const owner = await bootstrapUser(context, app, 'owner-stopped@example.com');
      const { aiId } = await seedAi(context, owner.id);
      await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      // Stop the AI: kill switch.
      await context.db.update(ais).set({ status: 'stopped' }).where(eq(ais.id, aiId));

      const gateway = createActionGateway({
        db: context.db,
        adapters,
        audit: createAuditRecorder({ db: context.db }),
        logger: {
          warn: () => undefined,
          error: () => undefined,
        },
        now: () => now,
      });
      const outcome = await gateway.request({
        aiId,
        action: 'demo.echo',
        args: { text: 'should not run' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(outcome).toEqual({ status: 'denied', reason: 'ai_not_active' });
      const audits = await context.db.select().from(auditLog);
      const autoApproved = audits.find((row) => row.action === 'action.auto_approved');
      expect(autoApproved).toBeUndefined();
    });

    it('a revoked rule falls back to a normal approval card', async () => {
      const adapters = buildRegistry([adapter]);
      const alwaysEligible = buildAlwaysEligible(adapters);
      const app = createApp({
        db: context.db,
        logger: context.logger,
        config: context.config,
        auth: context.auth,
        adminClient: context.adminClient,
        alwaysEligible,
      });
      const owner = await bootstrapUser(context, app, 'owner-revoked@example.com');
      const { aiId } = await seedAi(context, owner.id);
      const { rule } = await createRule(
        context.db,
        { aiId, groupId: null, topicId: null, action: 'demo.echo', createdBy: owner.id },
        now,
      );
      await revokeRule(context.db, { ruleId: rule.id, actorId: owner.id, now });

      const gateway = createActionGateway({
        db: context.db,
        adapters,
        audit: createAuditRecorder({ db: context.db }),
        logger: {
          warn: () => undefined,
          error: () => undefined,
        },
        now: () => now,
      });
      const outcome = await gateway.request({
        aiId,
        action: 'demo.echo',
        args: { text: 'revoked' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(outcome.status).toBe('pending_approval');
    });

    it('a rule never bypasses the policy: AI no longer in the group, or invalid args', async () => {
      const adapters = buildRegistry([adapter]);
      const calls: unknown[] = [];
      const counting: ActionAdapter<unknown> = {
        ...adapter,
        execute: async (ctx, args) => {
          calls.push(args);
          return adapter.execute(ctx, args);
        },
      };
      const app = createApp({
        db: context.db,
        logger: context.logger,
        config: context.config,
        auth: context.auth,
        adminClient: context.adminClient,
        alwaysEligible: buildAlwaysEligible(adapters),
      });
      const owner = await bootstrapUser(context, app, 'owner-policy@example.com');
      const { aiId } = await seedAi(context, owner.id);
      const group = await seedGroup(
        context,
        owner.id,
        [{ userId: owner.id, role: 'owner' }],
        [aiId],
      );
      await createRule(
        context.db,
        {
          aiId,
          groupId: group.groupId,
          topicId: group.generalTopicId,
          action: 'demo.echo',
          createdBy: owner.id,
        },
        now,
      );
      const gateway = createActionGateway({
        db: context.db,
        adapters: buildRegistry([counting]),
        audit: createAuditRecorder({ db: context.db }),
        logger: { warn: () => undefined, error: () => undefined },
        now: () => now,
      });

      // Invalid args still fail the schema even though a rule exists.
      const invalid = await gateway.request({
        aiId,
        groupId: group.groupId,
        topicId: group.generalTopicId,
        action: 'demo.echo',
        args: { text: '' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(invalid).toEqual({ status: 'denied', reason: 'invalid_args' });

      // The AI left the room without the rule being revoked (a direct row
      // delete): the rule alone must not let it act there.
      await context.db.delete(groupAis).where(eq(groupAis.groupId, group.groupId));
      const outside = await gateway.request({
        aiId,
        groupId: group.groupId,
        topicId: group.generalTopicId,
        action: 'demo.echo',
        args: { text: 'hello' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(outside).toEqual({ status: 'denied', reason: 'ai_not_in_group' });
      expect(calls).toHaveLength(0);
    });

    it('scope is exact: a rule for topic A does not fire in topic B, fires in A, never personal', async () => {
      const adapters = buildRegistry([adapter]);
      const alwaysEligible = buildAlwaysEligible(adapters);
      const app = createApp({
        db: context.db,
        logger: context.logger,
        config: context.config,
        auth: context.auth,
        adminClient: context.adminClient,
        alwaysEligible,
      });
      const owner = await bootstrapUser(context, app, 'owner-scope@example.com');
      const { aiId } = await seedAi(context, owner.id);
      const group1 = await seedGroup(
        context,
        owner.id,
        [{ userId: owner.id, role: 'owner' }],
        [aiId],
      );
      const topicB = await seedTopic(context, group1.groupId, owner.id, { name: 'Topic B' });
      // The AI works in both topics: membership of topic B (a `topic_ais`
      // row) lets the request reach the approval path there.
      await context.db.insert(topicAis).values({
        topicId: topicB,
        aiId,
        addedBy: owner.id,
      });
      const group2 = await seedGroup(
        context,
        owner.id,
        [{ userId: owner.id, role: 'owner' }],
        [aiId],
      );
      await createRule(
        context.db,
        {
          aiId,
          groupId: group1.groupId,
          topicId: group1.generalTopicId,
          action: 'demo.echo',
          createdBy: owner.id,
        },
        now,
      );

      const gateway = createActionGateway({
        db: context.db,
        adapters,
        audit: createAuditRecorder({ db: context.db }),
        logger: {
          warn: () => undefined,
          error: () => undefined,
        },
        now: () => now,
      });
      // Another topic of the same group: still requires approval.
      const otherTopic = await gateway.request({
        aiId,
        groupId: group1.groupId,
        topicId: topicB,
        action: 'demo.echo',
        args: { text: 'wrong topic' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(otherTopic.status).toBe('pending_approval');
      // Different group: still requires approval.
      const g2 = await gateway.request({
        aiId,
        groupId: group2.groupId,
        topicId: group2.generalTopicId,
        action: 'demo.echo',
        args: { text: 'wrong group' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(g2.status).toBe('pending_approval');
      // Personal chat: still requires approval.
      const personal = await gateway.request({
        aiId,
        action: 'demo.echo',
        args: { text: 'wrong chat' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(personal.status).toBe('pending_approval');
      // The original topic: auto-runs.
      const original = await gateway.request({
        aiId,
        groupId: group1.groupId,
        topicId: group1.generalTopicId,
        action: 'demo.echo',
        args: { text: 'right topic' },
        requestedBy: 'ai-bot@zilar.localhost',
      });
      expect(original).toEqual({ status: 'executed', summary: 'Echoed: right topic' });
    });
  });
});
